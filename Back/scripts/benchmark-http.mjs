// Disposable, loopback-only HTTP benchmark. Never point at a live deployment.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { stopChild } from './run-integration.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const local = (host) => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host);
const configuredUrl = new URL(process.env.DATABASE_URL);
assert.equal(process.env.OJ_DISPOSABLE_BENCHMARK, '1', 'Explicit disposable benchmark opt-in required');
assert.ok(['postgres:', 'postgresql:'].includes(configuredUrl.protocol), 'A PostgreSQL connection URL is required');
assert.equal(configuredUrl.search, '', 'Connection query overrides are forbidden in this disposable harness');
assert.ok(local(configuredUrl.hostname), 'Only a local disposable PostgreSQL server is supported');
assert.ok(local(process.env.REDIS_HOST), 'Only a local disposable Redis server is supported');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.OPENAI_API_KEY ?? '', '', 'Live AI credentials are forbidden');
assert.equal(process.env.EMAIL_ENABLED, 'false', 'Email must be explicitly disabled');

if (process.argv.includes('--serve')) {
  assert.match(configuredUrl.pathname, /^\/unsolvable_benchmark_[a-f0-9]{32}$/, 'The API must use the harness-created database');
  await import('reflect-metadata');
  const [{ NestFactory }, { AppModule }, { configureHttp }] = await Promise.all([
    import('@nestjs/core'), import('../dist/app.module.js'), import('../dist/configure-http.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  console.log(`READY ${await app.getUrl()}`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
} else {
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  assert.ok(local(admin.connectionParameters.host), 'The effective PostgreSQL destination must be loopback');
  const name = `unsolvable_benchmark_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }));
  let database;
  let server;
  let redis;
  let created = false;
  let benchmarkError;
  let interrupted = false;
  const interruption = new AbortController();
  const interrupt = (signal) => {
    if (interrupted) return;
    interrupted = true;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    interruption.abort(new Error(`Benchmark interrupted by ${signal}`));
    if (server && server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const checkpoint = () => interruption.signal.throwIfAborted();
  const results = [];
  const resources = () => {
    const stat = readFileSync(`/proc/${server.pid}/stat`, 'utf8').split(') ')[1].split(' ');
    const status = readFileSync(`/proc/${server.pid}/status`, 'utf8');
    return { cpuTicks: Number(stat[11]) + Number(stat[12]), peakRssKiB: Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1]) };
  };
  const clearOwnThrottles = async () => {
    // The caller supplies a fresh Redis process; only this benchmark's rate counters are removed.
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'throttle:*', 'COUNT', 100);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  };
  try {
    await admin.connect();
    checkpoint();
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    checkpoint();
    process.env.DATABASE_URL = url.href;
    await import('reflect-metadata');
    database = (await import('../dist/database/data-source.js')).default;
    await database.initialize();
    checkpoint();
    await database.runMigrations();
    checkpoint();
    await database.query("INSERT INTO users(id,email,username,password_hash) VALUES('00000000-0000-4000-8000-000000000001','benchmark@example.test','benchmark','not-a-login-password')");
    await database.query(`INSERT INTO problems(id,slug,title,statement_md,difficulty,status,author_id)
      SELECT md5('benchmark-problem-'||n)::uuid,'benchmark-'||n,'Benchmark problem '||n,'Synthetic statement','BEGINNER','PUBLISHED',
      '00000000-0000-4000-8000-000000000001'::uuid FROM generate_series(1,2000) AS n`);
    await database.query('ANALYZE problems');
    await database.destroy();
    checkpoint();
    const { default: Redis } = await import('ioredis');
    redis = new Redis({ host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT), db: Number(process.env.REDIS_DB) });
    assert.equal(await redis.dbsize(), 0, 'A fresh empty Redis database is required; pre-existing data must not be changed');
    checkpoint();
    server = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve'], {
      cwd: directory, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    server.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    const origin = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Benchmark API startup timed out: ${stderr}`)), 30_000);
      let output = '';
      server.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/READY (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      server.once('error', (error) => { clearTimeout(timeout); reject(error); });
      server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Benchmark API exited ${code}: ${stderr}`)); });
    });
    const endpoint = `${origin}/api/v1/problems?limit=20`;
    async function round(concurrency, requests) {
      checkpoint();
      await clearOwnThrottles();
      const latency = [];
      const statuses = {};
      let next = 0;
      const before = resources();
      const start = performance.now();
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next++ < requests) {
          checkpoint();
          const begin = performance.now();
          const response = await fetch(endpoint, { signal: AbortSignal.any([interruption.signal, AbortSignal.timeout(15_000)]) });
          const body = await response.json();
          if (response.status === 200) assert.equal(body.items.length, 20);
          statuses[response.status] = (statuses[response.status] ?? 0) + 1;
          latency.push(performance.now() - begin);
        }
      }));
      const elapsedMs = performance.now() - start;
      const after = resources();
      latency.sort((a, b) => a - b);
      const percentile = (fraction) => latency[Math.ceil(latency.length * fraction) - 1];
      const cpuMs = (after.cpuTicks - before.cpuTicks) / ticksPerSecond * 1000;
      return { concurrency, requests, elapsedMs, requestsPerSecond: requests / elapsedMs * 1000, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), statuses, apiCpuMs: cpuMs, apiCpuPercent: cpuMs / elapsedMs * 100, apiPeakRssKiB: after.peakRssKiB };
    }
    await round(1, 20); // Exclude initial module/JIT/connection warm-up.
    for (const concurrency of [1, 8, 32]) {
      const samples = [];
      for (let repeat = 0; repeat < 3; repeat++) {
        const sample = await round(concurrency, 80);
        assert.deepEqual(sample.statuses, { 200: 80 });
        samples.push(sample);
      }
      results.push({ concurrency, samples });
    }
    const overload = await round(32, 160);
    assert.deepEqual(overload.statuses, { 200: 100, 429: 60 });
    const report = {
      scope: 'Synthetic local public problem listing; 2000 problems; three warm samples per concurrency. Client and server are separate processes on one shared host. No end-to-end judge or production capacity claim.',
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(),
      applicationSourceTree: execFileSync('git', ['rev-parse', 'HEAD:Back/src'], { cwd: directory, encoding: 'utf8' }).trim(),
      environment: { node: process.version, kernel: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, cpuMeasurement: 'API child /proc CPU ticks; excludes load client, PostgreSQL and Redis', peakRssMeasurement: 'API process lifetime high-water mark, not per-round incremental allocation' },
      dataset: { problems: 2000, pageSize: 20, repeats: 3, warmupRequests: 20 },
      results, overload,
    };
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    benchmarkError = error;
    if (!interrupted) throw error;
    console.error('Benchmark interrupted; cleaning up its disposable resources.');
  } finally {
    const cleanupErrors = [];
    let stopped = true;
    try { await stopChild(server); } catch (error) { stopped = false; cleanupErrors.push(error); }
    if (redis) {
      let timeout;
      try {
        await Promise.race([
          redis.quit(),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Redis cleanup timed out')), 2000); }),
        ]);
      } catch (error) { cleanupErrors.push(error); }
      finally { clearTimeout(timeout); redis.disconnect(); }
    }
    try { if (database?.isInitialized) await database.destroy(); } catch (error) { cleanupErrors.push(error); }
    try { if (created && stopped) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); } catch (error) { cleanupErrors.push(error); }
    try { await admin.end(); } catch (error) { cleanupErrors.push(error); }
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    if (cleanupErrors.length) {
      const error = new AggregateError([...(benchmarkError ? [benchmarkError] : []), ...cleanupErrors], 'Disposable benchmark cleanup failed');
      if (interrupted) console.error(error);
      else throw error;
    }
  }
}
