import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./benchmark-enterprise-results.mjs', import.meta.url));
for (const serve of [false, true]) {
  for (const [url, reason] of [
    ['http://127.0.0.1:1/postgres', /A PostgreSQL protocol is required/],
    ['postgresql://fixture@127.0.0.1:1/postgres?host=example.invalid', /Connection query overrides are forbidden/],
  ]) {
    test(`${serve ? 'API child' : 'parent'} rejects ${new URL(url).search ? 'connection overrides' : 'foreign protocol'} before connecting`, () => {
      const result = spawnSync(process.execPath, [script, ...(serve ? ['--serve'] : []), '--candidates=1000', '--rows=50'], {
        encoding: 'utf8', timeout: 5000,
        env: { ...process.env, OJ_DISPOSABLE_BENCHMARK: '1', DATABASE_URL: url,
          NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '1', REDIS_DB: '1',
          EMAIL_ENABLED: 'false', EMAIL_WORKER_ENABLED: 'false', OPENAI_API_KEY: '' },
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, reason);
      assert.doesNotMatch(result.stderr, /ECONNREFUSED|ENOTFOUND|Owned|READY/);
    });
  }
}
