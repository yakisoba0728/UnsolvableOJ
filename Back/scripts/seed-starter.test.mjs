import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./seed-starter.mjs', import.meta.url));
test('starter CLI loads cwd .env and refuses missing DB URLs before constructing a client', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'starter-cli-test-'));
  try {
    // Intercept pg so even a broken URL guard cannot touch any database.
    const preload = join(cwd, 'no-database.mjs');
    writeFileSync(preload, `import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier !== 'pg') return next(specifier, context);
  return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(
    'export default {Client: class { constructor(options) { console.log("CLIENT_CONFIG", JSON.stringify(options)); } async connect() { throw new Error("STOP_BEFORE_DATABASE"); } }}'
  ) };
}});`);
    const env = { ...process.env, DOTENV_CONFIG_PATH: join(cwd, '.env'), DOTENV_CONFIG_QUIET: 'true' };
    delete env.DATABASE_URL;
    delete env.DATABASE_SSL;
    const run = (...args) => spawnSync(process.execPath, ['--import', preload, script, ...args], { cwd, env, encoding: 'utf8', timeout: 10_000 });
    for (const mode of ['--apply', '--rollback-check']) {
      const missing = run(mode);
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /DATABASE_URL is required/);
      assert.doesNotMatch(missing.stdout, /CLIENT_CONFIG/);
    }
    assert.equal(run().status, 0, 'offline preview requires no database');
    const url = 'postgresql://test:unused@127.0.0.1:1/starter_cli_test';
    writeFileSync(join(cwd, '.env'), `DATABASE_URL=${url}\nDATABASE_SSL=false\n`);
    const configured = run('--rollback-check');
    assert.match(configured.stdout, new RegExp(url));
    assert.match(configured.stderr, /STOP_BEFORE_DATABASE/);
    env.DATABASE_URL = '   ';
    assert.match(run('--apply').stderr, /DATABASE_URL is required/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
