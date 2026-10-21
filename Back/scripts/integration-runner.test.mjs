import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { integrationDatabaseUrl, stopChild } from './run-integration.mjs';

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

test('direct native configs abort without the runner marker', async () => {
  const env = { ...process.env, DATABASE_URL: 'postgresql://unused:unused@127.0.0.1/unsolvable_oj' };
  delete env.UNSOLVABLE_TEST_DATABASE;
  await assert.rejects(
    execFile(process.execPath, ['vitest.config.e2e.ts'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env,
    }),
    (error) => {
      assert.match(error.stderr, /disposable database/);
      return true;
    },
  );
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
  for (const mode of ['e2e', 'pipeline'])
    assert.equal(scripts[`test:${mode}`], `npm run build && node scripts/run-integration.mjs ${mode}`);
  assert.equal(scripts['test:migrations'], 'npm run build && node scripts/check-migrations.mjs');
  const runner = await read('./run-integration.mjs');
  assert.ok(runner.indexOf('const redisDb =') < runner.indexOf("import('../dist/database/data-source.js')"));
  assert.ok(runner.indexOf('await db.runMigrations()') < runner.indexOf('child = spawn('));
  assert.ok(runner.indexOf('await stopChild(child, true)') < runner.indexOf('DROP DATABASE'));
  assert.match(runner, /if \(created\) await admin\.query\(`DROP DATABASE "\$\{name\}" WITH \(FORCE\)`\)/);
  assert.match(await read('../vitest.config.pipeline.ts'), /import e2e from '\.\/vitest\.config\.e2e\.js'/);
});

test('nginx uses Docker DNS resolve compatible with 1.27.5 without rewriting URI or trust headers', async () => {
  const nginx = await read('../../Front/nginx.conf');
  assert.match(nginx, /upstream unsolvable_api\s*\{[\s\S]*zone unsolvable_api 64k;/);
  assert.match(nginx, /resolver 127\.0\.0\.11 valid=5s ipv6=off;/);
  assert.match(nginx, /server back:3000 resolve;/);
  assert.match(nginx, /proxy_pass http:\/\/unsolvable_api;/);
  assert.match(nginx, /client_max_body_size 16m;/);
  assert.match(nginx, /location \/assets\/ \{\s*try_files \$uri =404;/);
  for (const header of [
    'Host $host', 'X-Real-IP $remote_addr',
    'X-Forwarded-For $remote_addr', 'X-Forwarded-Proto $scheme',
  ]) assert.ok(nginx.includes(`proxy_set_header ${header};`));
});
