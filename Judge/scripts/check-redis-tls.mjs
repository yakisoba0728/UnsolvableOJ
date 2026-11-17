// Finite integration test against a newly owned Redis instance, never a supplied
// server address. --docker is for CI; --redis-server /path supports local tools.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { loadWorkerConfig } from '../dist/config.js';

const run = promisify(execFile);
async function bounded(operation, ms, message) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = globalThis.setTimeout(() => reject(new Error(message)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
const args = process.argv.slice(2);
const docker = args.length === 1 && args[0] === '--docker';
const binary = args.length === 2 && args[0] === '--redis-server' && isAbsolute(args[1]) ? args[1] : undefined;
assert.ok(docker || binary, 'Use --docker or --redis-server /absolute/path');
const directory = await mkdtemp(join(tmpdir(), 'oj-redis-tls-'));
const identity = randomBytes(10).toString('hex');
const password = randomBytes(32).toString('hex');
const ca = join(directory, 'cert.pem');
const key = join(directory, 'key.pem');
let child;
let container;
const containerName = `oj-redis-tls-${identity}`;
let containerAttempted = false;
const clients = [];
let worker;
let queue;
let events;

try {
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
    '-subj', '/CN=redis.unit.test', '-addext', 'subjectAltName=DNS:redis.unit.test',
    '-keyout', key, '-out', ca], { timeout: 10_000 });
  let port;
  if (docker) port = 6379;
  else {
    const listener = createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
  }
  const files = docker ? '/test' : directory;
  const configPath = join(directory, 'redis.conf');
  await writeFile(configPath, [
    `bind ${docker ? '0.0.0.0' : '127.0.0.1'}`, 'port 0', `tls-port ${port}`,
    `tls-cert-file "${files}/cert.pem"`, `tls-key-file "${files}/key.pem"`,
    `tls-ca-cert-file "${files}/cert.pem"`, 'tls-auth-clients yes',
    'tls-protocols "TLSv1.2 TLSv1.3"', `requirepass "${password}"`,
    'save ""', 'appendonly no', 'maxmemory 64mb', 'maxmemory-policy noeviction',
  ].join('\n') + '\n', { mode: 0o600 });
  if (docker) {
    containerAttempted = true;
    const { stdout } = await run('docker', ['run', '-d', '--name', containerName, '--label', `unsolvable.tls-test=${identity}`,
      '--user', `${process.getuid()}:${process.getgid()}`, '--read-only',
      '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--memory=128m', '--cpus=0.5', '--pids-limit=64',
      '--publish', '127.0.0.1::6379', '--mount', `type=bind,src=${directory},dst=/test,readonly`,
      '--entrypoint', 'redis-server', 'redis:8.10.3', '/test/redis.conf'], { timeout: 120_000 });
    container = stdout.trim();
    assert.match(container, /^[0-9a-f]{64}$/);
    const mapping = (await run('docker', ['port', container, '6379/tcp'], { timeout: 15_000 })).stdout.trim();
    assert.match(mapping, /^127\.0\.0\.1:\d+$/);
    port = Number(mapping.split(':')[1]);
  } else {
    child = spawn(binary, [configPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    // Error text stays local: the config includes synthetic credentials, but no
    // daemon log is copied into published output.
    child.stderr.resume();
    child.on('error', () => {});
  }

  const env = {
    JUDGE_DEPLOYMENT_MODE: 'dedicated', API_BASE_URL: 'https://api.unit.test/api/v1',
    JUDGE_SERVICE_TOKEN: randomBytes(32).toString('hex'), GO_JUDGE_TOKEN: randomBytes(32).toString('hex'),
    REDIS_HOST: '127.0.0.1', REDIS_PORT: String(port), REDIS_PASSWORD: password,
    REDIS_TLS: 'true', REDIS_TLS_SERVERNAME: 'redis.unit.test', REDIS_TLS_CA_FILE: ca,
    REDIS_TLS_CERT_FILE: ca, REDIS_TLS_KEY_FILE: key,
  };
  function connect(overrides = {}) {
    const client = new Redis({ ...loadWorkerConfig({ ...env, ...overrides }).redis,
      lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 0,
      connectTimeout: 1500, commandTimeout: 2000 });
    client.on('error', () => {});
    clients.push(client);
    return client;
  }
  let ready;
  for (let attempt = 0; attempt < 30; attempt++) {
    const client = connect();
    try { await client.connect(); assert.equal(await client.ping(), 'PONG'); ready = client; break; }
    catch { client.disconnect(); await setTimeout(100); }
  }
  assert.ok(ready, 'Owned TLS Redis did not become ready');
  for (const overrides of [
    { REDIS_TLS_CA_FILE: undefined },
    { REDIS_TLS_SERVERNAME: 'wrong.unit.test' },
    { REDIS_TLS_CERT_FILE: undefined, REDIS_TLS_KEY_FILE: undefined },
    { REDIS_PASSWORD: randomBytes(32).toString('hex') },
  ]) {
    const invalid = connect(overrides);
    await assert.rejects(async () => { await invalid.connect(); await invalid.ping(); });
    invalid.disconnect();
  }
  const connection = loadWorkerConfig(env).redis;
  const queueName = `oj-tls-${identity}`;
  queue = new Queue(queueName, { connection });
  events = new QueueEvents(queueName, { connection });
  worker = new Worker(queueName, async job => {
    assert.deepEqual(job.data, { synthetic: true });
    return { tlsQueueRoundTrip: true };
  }, { connection, concurrency: 1 });
  // Explicitly observed errors prevent uncaught EventEmitter failures; the
  // awaited ready/job timeouts still fail this integration check.
  for (const resource of [queue, events, worker]) resource.on('error', () => {});
  await bounded(Promise.all([events.waitUntilReady(), worker.waitUntilReady()]), 5000, 'TLS BullMQ readiness timed out');
  const job = await bounded(queue.add('owned-transport-check', { synthetic: true }), 5000, 'TLS enqueue timed out');
  assert.deepEqual(await bounded(job.waitUntilFinished(events, 5000), 6000, 'TLS job timed out'), { tlsQueueRoundTrip: true });
  await bounded(worker.close(), 5000, 'TLS worker close timed out'); worker = undefined;
  await bounded(events.close(), 5000, 'TLS events close timed out'); events = undefined;
  await bounded(queue.obliterate({ force: true }), 5000, 'TLS owned queue cleanup timed out');
  await bounded(queue.close(), 5000, 'TLS queue close timed out'); queue = undefined;
} finally {
  for (const client of clients) client.disconnect();
  const cleanup = await Promise.allSettled([
    ...[worker?.close(true), events?.close(), queue?.close()].filter(Boolean)
      .map(operation => bounded(operation, 5000, 'TLS client cleanup timed out')),
    (async () => {
      if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([new Promise(resolve => child.once('exit', resolve)), setTimeout(3000)]);
        if (child.exitCode === null) {
          child.kill('SIGKILL');
          await bounded(new Promise(resolve => child.once('exit', resolve)), 3000, 'Owned Redis did not exit');
        }
      }
    })(),
    (async () => {
      if (container) await run('docker', ['rm', '-f', container], { timeout: 15_000 });
      else if (containerAttempted) {
        // A timed-out run can create the container before losing its ID response.
        let label;
        try { label = (await run('docker', ['inspect', '--format', '{{index .Config.Labels "unsolvable.tls-test"}}', containerName], { timeout: 15_000 })).stdout.trim(); }
        catch (error) {
          if (error.code !== 'ENOENT' && !/No such (object|container)/i.test(error.stderr ?? '')) throw new Error('Owned container cleanup could not be verified');
        }
        if (label === identity) await run('docker', ['rm', '-f', containerName], { timeout: 15_000 });
        else if (label) throw new Error('Owned container identity mismatch');
      }
    })(),
  ]);
  await rm(directory, { recursive: true, force: true });
  assert.ok(cleanup.every(result => result.status === 'fulfilled'), 'Owned TLS-test cleanup failed');
}
console.log(JSON.stringify({ result: 'PASS', transport: 'actual Redis TLS with mutual authentication',
  rejected: ['untrusted CA', 'wrong hostname', 'missing client certificate', 'wrong Redis password'],
  bullmqJobs: 1, ownedResourcesOnly: true, cleanup: 'completed' }));
