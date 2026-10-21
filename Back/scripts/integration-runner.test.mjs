import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { integrationDatabaseUrl, stopChild, waitForApiListening } from './run-integration.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const execFile = promisify(execFileCallback);
const name = `unsolvable_integration_${'a'.repeat(32)}`;
const databaseUrl = `postgresql://test:unused@127.0.0.1/${name}`;

test('direct integration entry points reject missing or foreign database ownership', () => {
  for (const env of [
    {},
    { DATABASE_URL: databaseUrl },
    { DATABASE_URL: databaseUrl, UNSOLVABLE_TEST_DATABASE: 'unsolvable_oj' },
    { DATABASE_URL: 'postgresql://test:unused@127.0.0.1/unsolvable_oj', UNSOLVABLE_TEST_DATABASE: name },
  ]) assert.throws(() => integrationDatabaseUrl(env), /disposable database/);
  assert.equal(integrationDatabaseUrl({ DATABASE_URL: databaseUrl, UNSOLVABLE_TEST_DATABASE: name }), databaseUrl);
});

test('the child database URL keeps certificate paths and PostgreSQL options', () => {
  const url = new URL(databaseUrl);
  for (const [key, value] of [
    ['sslrootcert', '/fixture/ca.pem'],
    ['sslcert', '/fixture/client.pem'],
    ['sslkey', '/fixture/client.key'],
    ['sslmode', 'verify-full'],
    ['options', '-c search_path=fixture'],
  ]) url.searchParams.set(key, value);
  assert.equal(
    integrationDatabaseUrl({ DATABASE_URL: url.href, UNSOLVABLE_TEST_DATABASE: name }),
    url.href,
  );
});

test('direct native configs and judge-flow abort without the runner marker', async () => {
  const env = { ...process.env, DATABASE_URL: 'postgresql://unused:unused@127.0.0.1/unsolvable_oj' };
  delete env.UNSOLVABLE_TEST_DATABASE;
  for (const script of ['vitest.config.e2e.ts', 'scripts/check-judge-flow.mjs']) {
    await assert.rejects(
      execFile(process.execPath, [script], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env,
      }),
      (error) => {
        assert.match(error.stderr, /disposable database/);
        return true;
      },
    );
  }
});

function childEmitter() {
  return Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
}

test('API readiness requires the owned child listening message and actual bound port', async () => {
  const child = childEmitter();
  const ready = waitForApiListening(child);
  child.emit('message', { type: 'unrelated', port: 3100 });
  assert.equal(child.listenerCount('message'), 1);
  child.emit('message', { type: 'unsolvable-api-listening', address: { address: '127.0.0.1', port: 43210 } });
  assert.deepEqual(await ready, { address: '127.0.0.1', port: 43210 });
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('message'), 0);
});

test('API startup failure, invalid messages and already-exited children fail closed', async () => {
  const exited = childEmitter();
  const ready = waitForApiListening(exited);
  exited.emit('exit', 1, null);
  await assert.rejects(ready, /exited before listening/);
  const failed = childEmitter();
  const failure = waitForApiListening(failed);
  failed.emit('error', new Error('spawn failed'));
  await assert.rejects(failure, /spawn failed/);
  const invalid = childEmitter();
  const invalidReady = waitForApiListening(invalid);
  invalid.emit('message', { type: 'unsolvable-api-listening', address: { address: '0.0.0.0', port: 3100 } });
  await assert.rejects(invalidReady, /invalid listening address/);
  await assert.rejects(waitForApiListening(Object.assign(childEmitter(), { signalCode: 'SIGTERM' })), /exited before listening/);
});

test('cleanup waits for the owned child process group to stop', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  try {
    await once(child, 'spawn');
    await stopChild(child, true);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    await stopChild(child, true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

test('project commands build fresh and provision before spawning; only the created DB is dropped', async () => {
  const { scripts } = JSON.parse(await read('../package.json'));
  for (const mode of ['e2e', 'pipeline', 'judge-flow'])
    assert.equal(scripts[`test:${mode}`], `npm run build && node scripts/run-integration.mjs ${mode}`);
  assert.equal(scripts['test:migrations'], 'npm run build && node scripts/check-migrations.mjs');
  const runner = await read('./run-integration.mjs');
  assert.ok(runner.indexOf('const redisDb =') < runner.indexOf("import('../dist/database/data-source.js')"));
  assert.ok(runner.indexOf('await db.runMigrations()') < runner.indexOf('child = spawn('));
  assert.ok(runner.indexOf('await stopChild(child, true)') < runner.indexOf('DROP DATABASE'));
  assert.match(runner, /if \(created\) await admin\.query\(`DROP DATABASE "\$\{name\}" WITH \(FORCE\)`\)/);
  const e2e = await read('../vitest.config.e2e.ts');
  assert.match(e2e, /UNSOLVABLE_TEST_DATABASE/);
  assert.match(e2e, /new URL\(databaseUrl\)\.pathname !== `\/\$\{databaseName\}`/);
  assert.doesNotMatch(e2e, /local_password|unsolvable_oj/);
  assert.match(await read('../vitest.config.pipeline.ts'), /import e2e from '\.\/vitest\.config\.e2e\.js'/);
});

test('judge-flow cannot mutate an unrelated healthy API before child readiness', async () => {
  const flow = await read('./check-judge-flow.mjs');
  assert.match(flow, /DATABASE_URL: integrationDatabaseUrl\(\)/);
  assert.ok(flow.indexOf('DATABASE_URL: integrationDatabaseUrl()') < flow.indexOf("await import('../dist/config/env.validation.js')"));
  assert.match(flow, /connectionString: databaseOptions\.url/);
  assert.match(flow, /ssl: databaseOptions\.ssl/);
  assert.match(flow, /JUDGE_TEST_PORT \|\| '0'/);
  assert.ok(flow.indexOf('await waitForApiListening(server)') < flow.indexOf("await api('/health')"));
  assert.ok(flow.indexOf('await waitForApiListening(server)') < flow.indexOf("await api('/auth/register'"));
  assert.ok(flow.indexOf("assert.ok(workerLog.includes('Judge worker ready')") < flow.indexOf("await api('/auth/register'"));
  const main = await read('../src/main.ts');
  assert.ok(main.indexOf('await app.listen(') < main.indexOf("type: 'unsolvable-api-listening'"));
});

test('populated solve ledger rollback refuses before any schema is dropped', async () => {
  const migration = await read('../src/database/migrations/1790550000000-backend-foundations.ts');
  const down = migration.slice(migration.indexOf('async down('));
  assert.ok(down.indexOf('LOCK TABLE user_problem_solves') < down.indexOf('IF EXISTS (SELECT 1 FROM user_problem_solves)'));
  assert.ok(down.indexOf('RAISE EXCEPTION') < down.indexOf('DROP TABLE'));
  assert.match(down, /populated solve ledger; preserve XP and solve history/);
});

test('nginx uses Docker DNS resolve compatible with 1.27.5 without rewriting URI or trust headers', async () => {
  const nginx = await read('../../Front/nginx.conf');
  assert.match(nginx, /upstream unsolvable_api\s*\{[\s\S]*zone unsolvable_api 64k;/);
  assert.match(nginx, /resolver 127\.0\.0\.11 valid=5s ipv6=off;/);
  assert.match(nginx, /server back:3000 resolve;/);
  assert.match(nginx, /proxy_pass http:\/\/unsolvable_api;/);
  assert.match(nginx, /client_max_body_size 16m;/);
  for (const header of [
    'Host $host', 'X-Real-IP $remote_addr',
    'X-Forwarded-For $remote_addr', 'X-Forwarded-Proto $scheme',
  ]) assert.ok(nginx.includes(`proxy_set_header ${header};`));
});
