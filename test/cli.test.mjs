import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
function run(script, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 5000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      SEEDANCE_CONFIG_FILE: '/nonexistent/seedance-example.env',
      SEEDANCE_BASE_URL: 'http://127.0.0.1:1',
    },
  });
}
test('CLI help exits without opening MCP or requiring credentials', () => {
  const r = run('src/index.mjs', ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /SEEDANCE_API_KEY/);
  assert.equal(r.stderr, '');
});
test('CLI reports the package version and rejects unsupported flags', () => {
  const versionResult = run('src/index.mjs', ['--version']);
  assert.equal(versionResult.status, 0);
  assert.equal(versionResult.stdout.trim(), version);
  const invalid = run('src/index.mjs', ['--unknown']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown/);
});
test('default verification is offline and independent of Codex installation', () => {
  const r = run('scripts/verify.mjs');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /six tools/i);
  assert.match(r.stdout, /offline/i);
});
