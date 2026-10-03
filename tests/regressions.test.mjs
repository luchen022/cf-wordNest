import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { stripTypeScriptTypes } from 'node:module';

// Execute the actual TypeScript modules with a SQLite-backed D1 adapter.
// No real provider credentials, external network requests, or production data.
async function harness() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  const db = {
    prepare(query) {
      let args = [];
      return {
        query,
        bind(...values) { args = values; return this; },
        first() { return sql.prepare(query).get(...args) ?? null; },
        all() { return { results: sql.prepare(query).all(...args), success: true }; },
        run() {
          const result = sql.prepare(query).run(...args);
          return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
    },
    batch(statements) {
      sql.exec('BEGIN');
      try {
        const results = statements.map((s) => /^\s*SELECT/i.test(s.query) ? s.all() : s.run());
        sql.exec('COMMIT');
        return results;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  const env = { DB: db, SESSION_SECRET: 'test-only-secret' };
  const cookieValues = new Map();
  const context = vm.createContext({ crypto, TextEncoder, TextDecoder, btoa, atob, URL, Headers, Response,
    AbortSignal, ReadableStream, console: { error() {} }, fetch: (...args) => context.mockFetch(...args) });
  const stubs = {
    'cloudflare:workers': { env },
    'next/headers': { cookies: async () => ({ get: (key) => cookieValues.get(key), set: (key, value) => cookieValues.set(key, { value }), delete: (key) => cookieValues.delete(key) }), headers: async () => new Headers({ host: 'localhost' }) },
    'next/navigation': { redirect() { throw new Error('REDIRECT'); } },
    'next/cache': { revalidatePath() {} },
  };
  const modules = new Map();
  async function load(specifier, parent = resolve('tests/entry.ts')) {
    const key = stubs[specifier] ? specifier : resolve(specifier.startsWith('@/') ? specifier.slice(2) : dirname(parent), specifier.startsWith('@/') ? '' : specifier);
    if (modules.has(key)) return modules.get(key);
    const pending = (async () => {
    let module;
    if (stubs[key]) {
      const exports = stubs[key];
      module = new vm.SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context, identifier: key });
    } else {
      const file = key.endsWith('.ts') ? key : `${key}.ts`;
      const source = await readFile(file, 'utf8');
      module = new vm.SourceTextModule(stripTypeScriptTypes(source), { context, identifier: file });
    }
    return module;
    })();
    modules.set(key, pending);
    return pending;
  }
  const entry = new vm.SourceTextModule(`
    import * as auth from '../lib/auth.ts'; import * as words from '../app/actions/words.ts';
    import * as admin from '../app/actions/admin.ts'; import * as registration from '../app/actions/auth.ts';
    import * as settings from '../app/actions/settings.ts';
    import * as ai from '../lib/ai.ts'; import * as credentials from '../lib/credentials.ts';
    import { ensureSchema } from '../lib/schema.ts';
    export { auth, words, admin, registration, ai, credentials, settings, ensureSchema };
  `, { context, identifier: resolve('tests/entry.ts') });
  // Normalize extensions so cyclic db/schema imports share the same instance.
  const linker = (name, parent) => load(name.replace(/\.ts$/, ''), parent.identifier);
  await entry.link(linker);
  await entry.evaluate();
  const api = entry.namespace;
  await api.ensureSchema();
  sql.exec("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash-one', 'admin'); INSERT INTO lists (user_id, name) VALUES (1, 'test')");
  async function signIn(id = 1) { cookieValues.set('wordnest_session', { value: await api.auth.createSessionToken(id) }); }
  await signIn();
  return { ...api, sql, env, context, cookieValues, signIn };
}

test('password reset revokes existing sessions without clearing login protection', async () => {
  const h = await harness();
  const old = h.cookieValues.get('wordnest_session').value;
  h.sql.exec("INSERT INTO login_attempts VALUES ('someone|ip', 5, 0, 9999999999999)");
  assert.equal(await h.auth.verifySessionToken(old), 1);
  assert.equal((await h.admin.resetUserPasswordAction({ userId: 1, password: 'new-password' })).ok, true);
  assert.equal(await h.auth.verifySessionToken(old), null);
  assert.equal(h.sql.prepare('SELECT count(*) AS n FROM login_attempts').get().n, 1);
  await h.signIn();
  assert.equal((await h.auth.getCurrentUser()).id, 1);
  h.sql.exec("UPDATE users SET status = 'disabled' WHERE id = 1");
  assert.equal(await h.auth.getCurrentUser(), null);
});

test('tampered and legacy session tokens are rejected', async () => {
  const h = await harness();
  const token = h.cookieValues.get('wordnest_session').value;
  assert.equal(await h.auth.verifySessionToken(token.replace('v2.1.', 'v2.2.')), null);
  assert.equal(await h.auth.verifySessionToken(token.replace('v2.', '')), null);
});

test('concurrent initialization creates exactly one administrator', async () => {
  const h = await harness();
  h.sql.exec('DELETE FROM users');
  function form(username) { const data = new FormData(); data.set('username', username); data.set('password', 'password-123'); data.set('confirm', 'password-123'); return data; }
  const results = await Promise.allSettled([
    h.registration.registerAction({}, form('first')),
    h.registration.registerAction({}, form('second')),
  ]);
  assert.equal(h.sql.prepare('SELECT count(*) AS n FROM users').get().n, 1);
  assert.equal(results.filter((r) => r.status === 'fulfilled' && r.value.error.includes('已初始化')).length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason.message === 'REDIRECT').length, 1);
});

test('word saves roll back every change on definition failure and invalidate graph on success', async () => {
  const h = await harness();
  const initial = await h.words.saveWordAction({ listId: 1, word: 'original', definitions: [{ meaning: 'old' }] });
  assert.equal(initial.ok, true);
  h.sql.prepare("INSERT INTO word_relations (word_id, relation_type, target_word) VALUES (?, 'related', 'other')").run(initial.wordId);
  h.sql.exec("CREATE TRIGGER fail_definition BEFORE INSERT ON definitions WHEN NEW.meaning = 'fail' BEGIN SELECT RAISE(ABORT, 'failure'); END");
  const failed = await h.words.saveWordAction({ listId: 1, wordId: initial.wordId, word: 'changed', definitions: [{ meaning: 'new' }, { meaning: 'fail' }] });
  assert.equal(failed.ok, false);
  assert.equal(h.sql.prepare('SELECT word FROM words').get().word, 'original');
  assert.equal(h.sql.prepare('SELECT meaning FROM definitions').get().meaning, 'old');
  assert.equal(h.sql.prepare('SELECT count(*) AS n FROM word_relations').get().n, 1);
  assert.equal((await h.words.saveWordAction({ listId: 1, word: 'failed-new', definitions: [{ meaning: 'fail' }] })).ok, false);
  assert.equal(h.sql.prepare('SELECT count(*) AS n FROM words').get().n, 1);
  assert.equal((await h.words.saveWordAction({ listId: 1, wordId: initial.wordId, word: 'changed', definitions: [{ meaning: 'new' }] })).ok, true);
  assert.equal(h.sql.prepare('SELECT count(*) AS n FROM word_relations').get().n, 0);
});

test('word ownership is enforced and admin responses never include password hashes', async () => {
  const h = await harness();
  const users = await h.admin.getUsersAction();
  assert.equal(Object.hasOwn(users[0], 'password_hash'), false);
  h.sql.exec("INSERT INTO users (username, password_hash) VALUES ('other', 'other-hash'); INSERT INTO lists (user_id, name) VALUES (2, 'private')");
  assert.equal((await h.words.saveWordAction({ listId: 2, word: 'forbidden', definitions: [{ meaning: 'x' }] })).ok, false);
  await h.signIn(2);
  assert.equal((await h.admin.getUsersAction()).length, 0);
});

test('credentials are encrypted, bound to the owner, and legacy plaintext upgrades', async () => {
  const h = await harness();
  const encrypted = await h.credentials.encryptCredential('test-api-key', 1);
  assert.ok(!encrypted.includes('test-api-key'));
  assert.equal(await h.credentials.decryptCredential(encrypted, 1), 'test-api-key');
  await assert.rejects(h.credentials.decryptCredential(encrypted, 2));
  await assert.rejects(h.credentials.decryptCredential(encrypted.slice(0, -4) + 'AAAA', 1));
  h.sql.exec("INSERT INTO user_ai_settings (user_id, api_key) VALUES (1, 'legacy-key')");
  assert.equal((await h.ai.getAiConfig(1)).apiKey, 'legacy-key');
  assert.ok(h.sql.prepare('SELECT api_key FROM user_ai_settings').get().api_key.startsWith('enc:v1:'));
  assert.equal((await h.ai.getAiConfig(1)).apiKey, 'legacy-key');
});

test('AI URLs enforce HTTPS and preserve provider paths', async () => {
  const h = await harness();
  for (const invalid of ['garbage', 'http://example.com', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com?token=x', 'https://example.com/#fragment']) {
    assert.throws(() => h.ai.buildChatCompletionsUrl(invalid));
  }
  assert.equal(h.ai.buildChatCompletionsUrl('https://example.com/v1/'), 'https://example.com/v1/chat/completions');
  assert.equal(h.ai.buildChatCompletionsUrl('https://example.com/custom/chat/completions'), 'https://example.com/custom/chat/completions');
});

test('AI calls reject redirects and preserve caller cancellation alongside timeout', async () => {
  const h = await harness();
  const controller = new AbortController();
  h.context.mockFetch = async (_url, options) => {
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    controller.abort();
    assert.equal(options.signal.aborted, true);
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  };
  assert.equal(await h.ai.chatCompletion({ baseUrl: 'https://example.com', model: 'test', apiKey: '' }, [], { signal: controller.signal }), 'OK');
});


test('settings save encrypts keys, preserves masked keys, and allows recovery after secret rotation', async () => {
  const h = await harness();
  const input = { baseUrl: 'https://example.com/v1', model: 'test', apiKey: 'secret-test-key' };
  assert.equal((await h.settings.saveAiSettingsAction(input)).ok, true);
  assert.ok(h.sql.prepare('SELECT api_key FROM user_ai_settings').get().api_key.startsWith('enc:v1:'));
  assert.equal((await h.settings.saveAiSettingsAction({ ...input, model: 'new-model', apiKey: 'sec******-key' })).ok, true);
  assert.equal((await h.ai.getAiConfig(1)).apiKey, input.apiKey);
  assert.equal((await h.ai.getAiConfig(1)).model, 'new-model');
  assert.equal((await h.settings.saveAiSettingsAction({ ...input, baseUrl: 'http://example.com' })).ok, false);
  h.env.SESSION_SECRET = 'rotated-test-secret';
  await h.signIn();
  assert.equal((await h.settings.saveAiSettingsAction({ ...input, apiKey: 'sec******-key' })).ok, false);
  assert.equal((await h.settings.saveAiSettingsAction({ ...input, apiKey: 'replacement-key' })).ok, true);
  assert.equal((await h.ai.getAiConfig(1)).apiKey, 'replacement-key');
});

test('signed future and expired sessions are rejected', async () => {
  const h = await harness();
  const now = Date.now();
  h.context.Date = { now: () => now + 60_000 };
  const future = await h.auth.createSessionToken(1);
  h.context.Date = { now: () => now };
  assert.equal(await h.auth.verifySessionToken(future), null);
  const token = await h.auth.createSessionToken(1);
  h.context.Date = { now: () => now + 31 * 24 * 60 * 60 * 1000 };
  assert.equal(await h.auth.verifySessionToken(token), null);
});


test('login submits only one password and setup cannot run after initialization', async () => {
  const h = await harness();
  h.sql.prepare('UPDATE users SET password_hash = ? WHERE id = 1').run(await h.auth.hashPassword('test-password'));
  const form = new FormData();
  form.set('intent', 'login'); form.set('username', 'admin'); form.set('password', 'test-password');
  await assert.rejects(h.registration.authenticateAction({}, form), /REDIRECT/);
  assert.equal((await h.auth.getCurrentUser()).id, 1);
  form.set('intent', 'register');
  assert.match((await h.registration.authenticateAction({}, form)).error, /系统已初始化/);
  form.set('intent', 'unexpected');
  assert.match((await h.registration.authenticateAction({}, form)).error, /刷新/);
});

test('built-in AI is default and selecting it preserves custom credentials per user', async () => {
  const h = await harness();
  assert.equal((await h.ai.getAiConfig(1)).provider, 'workers');
  assert.equal((await h.settings.saveAiSettingsAction({ baseUrl: 'https://example.com', model: 'custom-model', apiKey: 'secret' })).ok, true);
  assert.equal(await h.ai.getAiProvider(1), 'custom');
  const saved = h.sql.prepare('SELECT api_key FROM user_ai_settings WHERE user_id = 1').get().api_key;
  assert.equal((await h.settings.saveAiSettingsAction({ provider: 'workers', baseUrl: '', model: '', apiKey: '' })).ok, true);
  assert.equal((await h.ai.getAiConfig(1)).provider, 'workers');
  assert.equal(h.sql.prepare('SELECT api_key FROM user_ai_settings WHERE user_id = 1').get().api_key, saved);
  assert.equal((await h.settings.saveAiSettingsAction({ provider: 'custom', baseUrl: 'https://example.com', model: 'custom-model', apiKey: 's******' })).ok, true);
  assert.equal((await h.ai.getAiConfig(1)).apiKey, 'secret');
  h.sql.exec("INSERT INTO users (username, password_hash) VALUES ('another', 'hash')");
  assert.equal(await h.ai.getAiProvider(2), 'workers');
});

test('Workers AI uses the binding for JSON and streaming, with no external fallback', async () => {
  const h = await harness();
  const config = h.ai.workersAiConfig();
  await assert.rejects(h.ai.chatCompletion(config, []), /尚未连接/);
  let calls = 0;
  h.context.mockFetch = () => { throw new Error('external provider must not run'); };
  h.env.AI = { async run(model, input, options) {
    calls++;
    assert.equal(model, '@cf/qwen/qwen3-30b-a3b-fp8');
    assert.ok(options.signal);
    if (input.stream) return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n')); controller.close(); } });
    assert.equal(input.response_format.type, 'json_object');
    return { choices: [{ message: { content: '{"ok":true}' } }] };
  } };
  assert.equal(await h.ai.chatCompletion(config, [], { json: true }), '{"ok":true}');
  assert.match(await (await h.ai.chatCompletionStream(config, [])).text(), /OK/);
  assert.equal(calls, 2);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(h.ai.chatCompletion(config, [], { signal: abort.signal }));
  assert.equal(calls, 2);
  h.env.AI.run = async () => { throw new Error('quota exceeded secret detail'); };
  await assert.rejects(h.ai.chatCompletion(config, []), /额度已用完/);
});
