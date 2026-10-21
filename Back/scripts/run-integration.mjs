import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export function integrationDatabaseUrl(env = process.env) {
  const name = env.UNSOLVABLE_TEST_DATABASE;
  assert.ok(
    name &&
      /^unsolvable_integration_[a-f0-9]{32}$/.test(name) &&
      env.DATABASE_URL &&
      new URL(env.DATABASE_URL).pathname === `/${name}`,
    'Use the project integration command to create a disposable database.',
  );
  return env.DATABASE_URL;
}

export async function stopChild(child, group = false) {
  if (!child?.pid) return;
  const signal = (value) => {
    if (!group && (child.exitCode !== null || child.signalCode !== null))
      return false;
    try {
      process.kill(group ? -child.pid : child.pid, value);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  if (!signal('SIGTERM')) return;
  for (let i = 0; i < 50 && signal(0); i++) await delay(100);
  if (signal(0)) {
    signal('SIGKILL');
    for (let i = 0; i < 50 && signal(0); i++) await delay(100);
  }
  assert.ok(
    !signal(0),
    'Test children are still running; retaining the disposable database.',
  );
}

async function runIntegration() {
  const [mode, ...args] = process.argv.slice(2);
  assert.ok(['e2e', 'pipeline'].includes(mode), 'Expected e2e or pipeline.');
  // Capture the test DB before dotenv can supply the development Redis DB (usually 0).
  const redisDb = mode === 'e2e'
    ? process.env.REDIS_DB ?? '1'
    : process.env.PIPELINE_REDIS_DB ?? '2';
  await import('reflect-metadata');
  const [{ DataSource }, { default: configured }] = await Promise.all([
    import('typeorm'),
    import('../dist/database/data-source.js'),
  ]);
  const name = `unsolvable_integration_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(configured.options.url);
  url.pathname = `/${name}`;
  // Children must re-read URL certificate paths consumed by the parent's SSL options.
  const childUrl = new URL(process.env.DATABASE_URL);
  childUrl.pathname = url.pathname;
  const admin = new DataSource({
    ...configured.options,
    entities: [],
    migrations: [],
  });
  let db;
  let created = false;
  let child;
  let interrupted = false;
  const interrupt = (signal) => {
    interrupted = true;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    await admin.initialize();
    if (interrupted) return;
    // The configured database is only used to create and drop the disposable one; it is never migrated.
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    db = await new DataSource({ ...configured.options, url: url.href }).initialize();
    assert.equal((await db.query('SELECT current_database() AS name'))[0].name, name);
    await db.runMigrations();
    await db.destroy();
    if (interrupted) return;
    child = spawn(process.execPath, [
      'node_modules/vitest/vitest.mjs', 'run', '--config',
      `./vitest.config.${mode}.ts`, ...args,
    ], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: childUrl.href,
        UNSOLVABLE_TEST_DATABASE: name,
        REDIS_DB: redisDb,
      },
      // One owned POSIX process group includes Vitest's workers and the judge child.
      detached: true,
      stdio: 'inherit',
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
    if (!interrupted) process.exitCode = code;
  } finally {
    try {
      await stopChild(child, true);
      if (db?.isInitialized) await db.destroy();
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      if (admin.isInitialized) await admin.destroy();
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runIntegration();
