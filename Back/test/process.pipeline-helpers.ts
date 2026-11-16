import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { DataSource } from 'typeorm';
import { databaseConnectionOptions } from '../src/config/database.config.js';

export interface OwnedProcess { child: ChildProcess; closed: Promise<void>; log: string }

export function startOwnedProcess(processes: OwnedProcess[], entry: string, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const owned: OwnedProcess = { child, log: '', closed: new Promise((resolve) => child.once('close', () => resolve())) };
  const capture = (chunk: Buffer) => { owned.log = (owned.log + chunk.toString()).slice(-100_000); };
  child.stdout!.on('data', capture);
  child.stderr!.on('data', capture);
  child.on('error', (error) => { owned.log += error.message; });
  processes.push(owned);
  return owned;
}

export async function stopOwnedProcess(owned: OwnedProcess | undefined, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') {
  if (!owned || owned.child.exitCode !== null || owned.child.signalCode !== null) return;
  owned.child.kill(signal);
  await Promise.race([owned.closed, delay(10_000, undefined, { ref: false })]);
  if (owned.child.exitCode === null && owned.child.signalCode === null) {
    owned.child.kill('SIGKILL');
    await Promise.race([owned.closed, delay(5000, undefined, { ref: false })]);
  }
  assert.ok(owned.child.exitCode !== null || owned.child.signalCode !== null, 'Owned test process did not exit within 15 seconds');
}

export async function reserveLoopbackPort() {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

export function disposableDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  assert.equal(env.NODE_ENV, 'test', 'Process-fault tests require NODE_ENV=test');
  assert.ok(env.DATABASE_URL, 'Process-fault tests require DATABASE_URL');
  const url = new URL(env.DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Only PostgreSQL connection URLs are allowed');
  // pg supports host/database/options in the query string, which can override
  // the authority/path checked below. This local fault harness needs none of them.
  assert.equal(url.search, '', 'Database URL query overrides are not allowed');
  assert.equal(url.hash, '', 'Database URL fragments are not allowed');
  const name = env.UNSOLVABLE_TEST_DATABASE;
  assert.ok(name && /^unsolvable_integration_[a-f0-9]{32}$/.test(name) && url.pathname === `/${name}`, 'Use the disposable integration runner');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'This process-fault test only accepts a loopback database');
  return url.href;
}

export async function disposableDatabaseObserver(env: NodeJS.ProcessEnv = process.env) {
  const url = disposableDatabaseUrl(env);
  const db = await new DataSource({ type: 'postgres', ...databaseConnectionOptions(url, env.DATABASE_SSL === 'true'), entities: [], migrations: [] }).initialize();
  try {
    assert.equal((await db.query('SELECT current_database() AS name'))[0].name, env.UNSOLVABLE_TEST_DATABASE);
    return db;
  } catch (error) {
    await db.destroy();
    throw error;
  }
}
