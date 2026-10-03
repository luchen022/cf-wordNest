import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const options = process.argv.slice(2);
if (options.some((option) => !['--preview', '--dry-run'].includes(option))) {
  throw new Error('Only --preview and --dry-run are supported.');
}

const sourcePath = resolve('dist/server/wrangler.json');
let config;
try {
  config = JSON.parse(await readFile(sourcePath, 'utf8'));
} catch {
  throw new Error('Build output is missing. Run npm run build first.');
}

// Local development uses a simulated D1 binding. Production explicitly inherits
// the dashboard binding instead of submitting a draft resource for provisioning.
const d1Bindings = config.d1_databases ?? [];
if (!d1Bindings.some((binding) => binding.binding === 'DB')) {
  throw new Error('The build must declare the DB binding.');
}
const bindingNames = new Set(d1Bindings.map((binding) => binding.binding));
config.d1_databases = [];
config.unsafe ??= {};
config.unsafe.bindings = [
  ...(config.unsafe.bindings ?? []).filter((binding) => !bindingNames.has(binding.name)),
  ...d1Bindings.map((binding) => ({ name: binding.binding, type: 'inherit' })),
];
const manualConfigPath = resolve(dirname(sourcePath), 'wrangler.manual.json');
await writeFile(manualConfigPath, JSON.stringify(config, null, 2) + '\n');

const require = createRequire(import.meta.url);
const wranglerPath = resolve(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
const command = options.includes('--preview') ? ['versions', 'upload'] : ['deploy'];
const args = [
  wranglerPath, ...command, '--config', manualConfigPath,
  '--experimental-provision=false', '--experimental-auto-create=false',
  ...(options.includes('--dry-run') ? ['--dry-run'] : []),
];
console.log('Using the existing dashboard DB binding. Database creation is disabled.');
const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
  if (process.exitCode !== 0) {
    console.error('Check Worker → Bindings: manually select your D1 database with variable name DB, save/deploy that binding, then retry.');
  }
});
