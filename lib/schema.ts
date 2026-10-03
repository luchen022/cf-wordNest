import { env } from "cloudflare:workers";

/**
 * The application owns its schema.
 *
 * Workers Builds deploys straight from a Git push, so a fresh database must
 * become usable without anyone running a migration command. The first request
 * against an empty database creates the tables; later requests only read the
 * stored version.
 *
 * Append a new array entry when the schema changes instead of editing the
 * existing ones, so deployments already in use upgrade in place.
 */
const MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE IF NOT EXISTS users (
       id            INTEGER PRIMARY KEY AUTOINCREMENT,
       username      TEXT    NOT NULL UNIQUE,
       password_hash TEXT    NOT NULL,
       role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
       status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
       created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
       updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE IF NOT EXISTS user_ai_settings (
       user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
       base_url   TEXT NOT NULL DEFAULT 'https://api.deepseek.com',
       model      TEXT NOT NULL DEFAULT 'deepseek-chat',
       api_key    TEXT NOT NULL DEFAULT '',
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE IF NOT EXISTS lists (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       name       TEXT    NOT NULL,
       created_at TEXT    NOT NULL DEFAULT (datetime('now')),
       UNIQUE (user_id, name)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id)`,
    `CREATE TABLE IF NOT EXISTS user_prefs (
       user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
       current_list_id INTEGER REFERENCES lists(id) ON DELETE SET NULL,
       marked_only     INTEGER NOT NULL DEFAULT 0,
       updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE IF NOT EXISTS words (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
       word       TEXT    NOT NULL,
       marked     INTEGER NOT NULL DEFAULT 0,
       created_at TEXT    NOT NULL DEFAULT (datetime('now')),
       UNIQUE (list_id, word)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_words_list ON words(list_id)`,
    `CREATE INDEX IF NOT EXISTS idx_words_list_marked ON words(list_id, marked)`,
    `CREATE TABLE IF NOT EXISTS definitions (
       id              INTEGER PRIMARY KEY AUTOINCREMENT,
       word_id         INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
       part_of_speech  TEXT    NOT NULL DEFAULT '',
       meaning         TEXT    NOT NULL DEFAULT '',
       example         TEXT    NOT NULL DEFAULT '',
       note            TEXT    NOT NULL DEFAULT '',
       sort_order      INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE INDEX IF NOT EXISTS idx_definitions_word ON definitions(word_id)`,
    `CREATE TABLE IF NOT EXISTS conversations (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       title      TEXT    NOT NULL DEFAULT '新对话',
       created_at TEXT    NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS messages (
       id              INTEGER PRIMARY KEY AUTOINCREMENT,
       conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
       role            TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
       content         TEXT    NOT NULL,
       created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id)`,
    `CREATE TABLE IF NOT EXISTS word_relations (
       id            INTEGER PRIMARY KEY AUTOINCREMENT,
       word_id       INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
       relation_type TEXT    NOT NULL,
       target_word   TEXT    NOT NULL,
       created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
       UNIQUE (word_id, relation_type, target_word)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_word_relations_word ON word_relations(word_id)`,
  ],
  [
    // Brute-force protection for the login form. Workers isolates do not share
    // memory, so failed-attempt counters have to be persisted.
    `CREATE TABLE IF NOT EXISTS login_attempts (
       key           TEXT    PRIMARY KEY,
       count         INTEGER NOT NULL DEFAULT 0,
       first_at      INTEGER NOT NULL,
       blocked_until INTEGER NOT NULL DEFAULT 0
     )`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS user_ai_providers (
       user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
       provider TEXT NOT NULL CHECK (provider IN ('workers', 'custom'))
     )`,
  ],
];

/** Cached per isolate so the version lookup runs once per Worker instance. */
let initialized: Promise<void> | null = null;

async function readVersion(db: D1Database): Promise<number> {
  try {
    const row = await db
      .prepare("SELECT version FROM schema_meta WHERE id = 1")
      .first<{ version: number }>();
    return row?.version ?? 0;
  } catch {
    // The metadata table is absent, which means this is a brand new database.
    return -1;
  }
}

export async function ensureSchema(): Promise<void> {
  if (initialized) return initialized;

  initialized = (async () => {
    const db = env.DB;
    let version = await readVersion(db);

    if (version < 0) {
      await db
        .prepare(
          "CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)",
        )
        .run();
      await db.prepare("INSERT OR IGNORE INTO schema_meta (id, version) VALUES (1, 0)").run();
      version = 0;
    }

    for (let index = version; index < MIGRATIONS.length; index += 1) {
      for (const statement of MIGRATIONS[index]) {
        await db.prepare(statement).run();
      }
      await db
        .prepare("UPDATE schema_meta SET version = ? WHERE id = 1")
        .bind(index + 1)
        .run();
    }
  })().catch((error) => {
    // Do not cache a failure: let the next request try again.
    initialized = null;
    throw error;
  });

  return initialized;
}
