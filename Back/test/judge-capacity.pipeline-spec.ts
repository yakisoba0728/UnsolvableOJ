import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Queue } from 'bullmq';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, createConnection, type Socket } from 'node:net';
import { cpus, platform, release } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { JUDGE_QUEUE } from '../src/common/queue.constants.js';
import { base, bearer, closeApp, createApp, login, register } from './helpers.js';

interface Measurement {
  event: 'judge_completed'; workerId: string; submissionId: string; generation: number;
  language: string; status: string; queueWaitMs: number; claimMs: number; judgeMs: number;
  reportMs: number; totalMs: number; processCpuUserUs: number; processCpuSystemUs: number;
  processRssBytes: number; processPeakRssKiB: number;
}
interface OwnedWorker {
  child: ChildProcess; closed: Promise<void>; log: string; measurements: Measurement[];
}

// Only owned worker links are interrupted; this does not restart Redis/API services.
async function loopbackProxy(host: string, port: number) {
  expect(['127.0.0.1', 'localhost', '::1']).toContain(host);
  const sockets = new Set<Socket>();
  let blocked = false;
  let rejectedConnections = 0;
  const server = createServer((client) => {
    if (blocked) { rejectedConnections++; client.destroy(); return; }
    const upstream = createConnection({ host, port });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => { client.destroy(); upstream.destroy(); });
    }
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing proxy port');
  return {
    port: address.port,
    get rejectedConnections() { return rejectedConnections; },
    block() { blocked = true; for (const socket of sockets) socket.destroy(); },
    restore() { blocked = false; },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), min: at(0), max: at(1) };
}
// Linux procfs samples belong only to child PIDs created by this test. Sampling
// each process directly avoids assuming BullMQ distributes warmup jobs fairly.
const clockTicks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
async function resources(worker: OwnedWorker) {
  const [stat, status] = await Promise.all([
    readFile(`/proc/${worker.child.pid}/stat`, 'utf8'),
    readFile(`/proc/${worker.child.pid}/status`, 'utf8'),
  ]);
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  return {
    cpuTicks: Number(fields[11]) + Number(fields[12]),
    peakRssKiB: Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1]),
  };
}
const sources = JSON.parse(await readFile(new URL('../../Judge/runtime/smoke-sources.json', import.meta.url), 'utf8')) as Record<string, string>;

describe('bounded mixed-language capacity and worker link recovery', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let queue: Queue;
  let problemId: string;
  let slowProblemId: string;
  const solvers: { id: string; token: string }[] = [];
  const workers: OwnedWorker[] = [];
  const jobs: string[] = [];
  const trials: unknown[] = [];
  const recovery: unknown[] = [];

  async function startWorker(overrides: NodeJS.ProcessEnv = {}) {
    const child = spawn(process.execPath, ['../Judge/dist/worker.js'], {
      env: { ...process.env, API_BASE_URL: `${await app.getUrl()}${base}`, JUDGE_CONCURRENCY: '1', JUDGE_METRICS: 'json', ...overrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const worker: OwnedWorker = { child, log: '', measurements: [], closed: new Promise((resolve) => child.once('close', () => resolve())) };
    workers.push(worker);
    let partial = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      worker.log = (worker.log + chunk.toString()).slice(-100_000);
      partial += chunk.toString();
      const lines = partial.split('\n');
      partial = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith('{')) continue;
        const value = JSON.parse(line) as Measurement;
        if (value.event === 'judge_completed') worker.measurements.push(value);
      }
    });
    child.stderr!.on('data', (chunk: Buffer) => { worker.log = (worker.log + chunk.toString()).slice(-100_000); });
    child.on('error', (error) => { worker.log += error.message; });
    await expect.poll(() => worker.log, { timeout: 15_000 }).toContain('Judge worker ready');
    return worker;
  }
  async function stopWorker(worker: OwnedWorker, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') {
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) return;
    worker.child.kill(signal);
    await Promise.race([worker.closed, delay(10_000)]);
    if (worker.child.exitCode === null && worker.child.signalCode === null) { worker.child.kill('SIGKILL'); await worker.closed; }
  }
  async function submit(language: string, sourceCode: string, solver = solvers[0], problem = problemId) {
    const started = performance.now();
    const response = await request(app.getHttpServer()).post(`${base}/problems/${problem}/submissions`)
      .set(bearer(solver.token)).send({ language, sourceCode }).expect(202);
    const id = response.body.id as string;
    jobs.push(`${id}-1`);
    return { id, apiMs: performance.now() - started };
  }
  async function state(id: string) {
    const [row] = await db.query(`SELECT status, judge_generation AS generation, judge_attempt_id AS attempt,
      recovery_count AS recoveries, judge_lease_expires_at AS lease FROM submissions WHERE id=$1`, [id]);
    return row as { status: string; generation: number; attempt: string; recoveries: number; lease: Date | null };
  }
  async function accepted(ids: string[], timeout = 75_000) {
    await expect.poll(async () => {
      const rows = await db.query('SELECT status FROM submissions WHERE id=ANY($1::uuid[])', [ids]);
      return rows.map((row: { status: string }) => row.status);
    }, { timeout, interval: 100 }).toEqual(ids.map(() => 'ACCEPTED'));
  }
  async function consistency(ids: string[], generation = 1, recoveries = 0) {
    const counts = await db.query(`SELECT s.id, s.judge_generation, s.recovery_count, s.completed_for_learning,
      (SELECT count(*)::int FROM notifications n WHERE n.submission_id=s.id AND n.type='JUDGED') AS notifications
      FROM submissions s WHERE s.id=ANY($1::uuid[])`, [ids]);
    expect(counts).toHaveLength(ids.length);
    for (const row of counts) expect(row).toMatchObject({ judge_generation: generation, recovery_count: recoveries, completed_for_learning: true, notifications: 1 });
    for (const solver of solvers) {
      const solves = await db.query('SELECT problem_id, awarded_xp FROM user_problem_solves WHERE user_id=$1', [solver.id]);
      expect(new Set(solves.map((row: { problem_id: string }) => row.problem_id)).size).toBe(solves.length);
      expect(solves.every((row: { awarded_xp: number }) => row.awarded_xp === 10)).toBe(true);
      const [{ xp }] = await db.query('SELECT xp FROM users WHERE id=$1', [solver.id]);
      expect(xp).toBe(solves.length * 10);
    }
  }
  beforeAll(async () => {
    expect(Number.isSafeInteger(clockTicks) && clockTicks > 0).toBe(true);
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    queue = app.get<Queue>(getQueueToken(JUDGE_QUEUE));
    const suffix = randomUUID().slice(0, 8);
    const admin = await register(app, 'capacity_admin', suffix);
    await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [admin.user.id]);
    const adminToken = (await login(app, admin.user.email)).accessToken;
    for (let i = 0; i < 3; i++) {
      const solver = await register(app, `capacity_solver${i}`, suffix);
      solvers.push({ id: solver.user.id, token: solver.accessToken });
    }
    for (const [name, timeLimitMs] of [['sum', 5000], ['slow', 15000]] as const) {
      const response = await request(app.getHttpServer()).post(`${base}/problems`).set(bearer(adminToken)).send({
        slug: `capacity-${name}-${suffix}`, title: `Capacity ${name}`, statementMarkdown: 'Add two integers.',
        inputDescriptionMarkdown: 'Two integers', outputDescriptionMarkdown: 'Sum', difficulty: 'BEGINNER',
        status: 'PUBLISHED', timeLimitMs, memoryLimitMb: 256,
        testCases: [{ input: '1 2\n', expectedOutput: '3\n', isSample: true }],
      }).expect(201);
      if (name === 'sum') problemId = response.body.id; else slowProblemId = response.body.id;
    }
  });

  // Alternating order and two samples/configuration expose shared-runner variance.
  it.each([1, 2, 2, 1])('measures the eight-language mix with %i worker processes', async (count) => {
    const group: OwnedWorker[] = [];
    try {
      for (let i = 0; i < count; i++) group.push(await startWorker());
      const warmups = await Promise.all(group.map((_, i) => submit('PYTHON', 'import time\ntime.sleep(0.2)\nprint(3)', solvers[i])));
      await accepted(warmups.map((job) => job.id));
      await expect.poll(() => group.flatMap((worker) => worker.measurements).length, { timeout: 5000 }).toBe(count);
      const cpuBefore = await Promise.all(group.map(resources));
      const started = performance.now();
      const submitted = await Promise.all(Object.entries(sources).map(([language, source], i) => submit(language, source, solvers[i % solvers.length])));
      const ids = submitted.map((job) => job.id);
      await accepted(ids);
      await expect.poll(() => group.flatMap((worker) => worker.measurements).filter((m) => ids.includes(m.submissionId)).length, { timeout: 5000 }).toBe(ids.length);
      const elapsedMs = performance.now() - started;
      const metrics = group.flatMap((worker) => worker.measurements).filter((m) => ids.includes(m.submissionId));
      for (const m of metrics) expect(m).toMatchObject({ status: 'ACCEPTED', generation: 1 });
      expect(new Set(metrics.map((m) => m.submissionId)).size).toBe(8);
      const after = await Promise.all(group.map(resources));
      const cpuMs = after.reduce((sum, current, index) => sum + (current.cpuTicks - cpuBefore[index].cpuTicks) * 1000 / clockTicks, 0);
      trials.push({ workers: count, concurrencyPerWorker: 1, submissions: 8, elapsedMs, jobsPerSecond: 8000 / elapsedMs,
        apiSubmissionMs: percentiles(submitted.map((job) => job.apiMs)), queueWaitMs: percentiles(metrics.map((m) => m.queueWaitMs)),
        workerCpuMs: cpuMs, workerCpuCores: cpuMs / elapsedMs,
        workerPeakRssKiB: after.map((sample) => sample.peakRssKiB), workerCpuSamples: { clockTicks, before: cpuBefore, after },
        acknowledgedWorkerMs: percentiles(metrics.map((m) => m.totalMs)), measurements: metrics });
      await consistency(ids);
    } finally { await Promise.all(group.map((worker) => stopWorker(worker))); }
  });

  it('reconnects the worker Redis link, retains queued work and applies duplicate deliveries once', async () => {
    const proxy = await loopbackProxy(process.env.REDIS_HOST ?? '127.0.0.1', Number(process.env.REDIS_PORT ?? 6379));
    let worker: OwnedWorker | undefined;
    try {
      worker = await startWorker({ REDIS_HOST: '127.0.0.1', REDIS_PORT: String(proxy.port) });
      const first = await submit('PYTHON', 'import time\ntime.sleep(2)\nprint(3)', solvers[0], slowProblemId);
      await expect.poll(() => state(first.id), { timeout: 10_000, interval: 25 }).toMatchObject({ status: 'JUDGING' });
      const started = performance.now();
      proxy.block();
      const second = await submit('PYTHON', sources.PYTHON, solvers[1], slowProblemId);
      const duplicate = `duplicate-${randomUUID()}`;
      jobs.push(duplicate);
      await queue.add('judge-submission', { submissionId: first.id, generation: 1 }, { jobId: duplicate });
      await accepted([first.id]);
      expect(await state(second.id)).toMatchObject({ status: 'QUEUED', generation: 1 });
      await expect.poll(() => proxy.rejectedConnections, { timeout: 5000 }).toBeGreaterThan(0);
      proxy.restore();
      await accepted([first.id, second.id]);
      await expect.poll(async () => (await queue.getJob(duplicate))?.getState(), { timeout: 5000 }).toBe('completed');
      await expect.poll(async () => (await queue.getJob(`${first.id}-1`))?.getState(), { timeout: 5000 }).toBe('completed');
      expect(worker.child.exitCode).toBeNull();
      await consistency([first.id, second.id]);
      await expect.poll(() => worker!.measurements.length, { timeout: 5000 }).toBe(2);
      recovery.push({ scenario: 'worker Redis TCP interruption/reconnect and duplicate delivery', elapsedMs: performance.now() - started, rejectedConnections: proxy.rejectedConnections, result: 'ACCEPTED', generation: 1 });
    } finally { proxy.restore(); if (worker) await stopWorker(worker); await proxy.close(); }
  });

  it('replays the same result after an API link interruption without re-executing or duplicating XP', async () => {
    const apiUrl = new URL(await app.getUrl());
    const proxy = await loopbackProxy(apiUrl.hostname, Number(apiUrl.port));
    let worker: OwnedWorker | undefined;
    try {
      worker = await startWorker({ API_BASE_URL: `http://127.0.0.1:${proxy.port}${base}` });
      const submitted = await submit('PYTHON', 'import time\ntime.sleep(2)\nprint(3)', solvers[0], slowProblemId);
      await expect.poll(() => state(submitted.id), { timeout: 10_000, interval: 25 }).toMatchObject({ status: 'JUDGING' });
      const initial = await state(submitted.id);
      const started = performance.now();
      proxy.block();
      await expect.poll(() => proxy.rejectedConnections, { timeout: 15_000, interval: 25 }).toBeGreaterThan(0);
      proxy.restore();
      await accepted([submitted.id]);
      await expect.poll(() => worker!.measurements.length, { timeout: 5000 }).toBe(1);
      expect(worker.measurements[0].reportMs).toBeGreaterThanOrEqual(900);
      expect(await state(submitted.id)).toMatchObject({ generation: 1, attempt: initial.attempt, recoveries: 0 });
      await consistency([submitted.id]);
      recovery.push({ scenario: 'worker API TCP interruption and result retry', elapsedMs: performance.now() - started, rejectedConnections: proxy.rejectedConnections, result: 'ACCEPTED', generation: 1, reportMs: worker.measurements[0].reportMs });
    } finally { proxy.restore(); if (worker) await stopWorker(worker); await proxy.close(); }
  });

  it('fences a competing duplicate delivery while another real worker owns the active lease', async () => {
    const group = [await startWorker(), await startWorker()];
    try {
      const submitted = await submit('PYTHON', 'import time\ntime.sleep(3)\nprint(3)', solvers[1], slowProblemId);
      await expect.poll(() => state(submitted.id), { timeout: 10_000, interval: 25 }).toMatchObject({ status: 'JUDGING' });
      const original = await state(submitted.id);
      const duplicate = `competing-${randomUUID()}`;
      jobs.push(duplicate);
      await queue.add('judge-submission', { submissionId: submitted.id, generation: 1 }, { jobId: duplicate });
      await expect.poll(async () => (await queue.getJob(duplicate))?.getState(), { timeout: 2000, interval: 25 }).toBe('completed');
      expect(await state(submitted.id)).toMatchObject({ status: 'JUDGING', attempt: original.attempt, generation: 1 });
      await accepted([submitted.id]);
      await expect.poll(() => group.flatMap((worker) => worker.measurements).length, { timeout: 5000 }).toBe(1);
      await consistency([submitted.id]);
      recovery.push({ scenario: 'two-worker duplicate delivery during active lease', result: 'ACCEPTED', generation: 1, executions: 1 });
    } finally { await Promise.all(group.map((worker) => stopWorker(worker))); }
  });

  it('recovers a killed worker after the actual 60-second lease expires and fences its callback', async () => {
    const originalWorker = await startWorker();
    let replacement: OwnedWorker | undefined;
    try {
      const submitted = await submit('PYTHON', 'import time\ntime.sleep(2)\nprint(3)', solvers[2], slowProblemId);
      jobs.push(`${submitted.id}-2`);
      await expect.poll(() => state(submitted.id), { timeout: 10_000, interval: 25 }).toMatchObject({ status: 'JUDGING' });
      const original = await state(submitted.id);
      const started = performance.now();
      await stopWorker(originalWorker, 'SIGKILL');
      expect(originalWorker.child.signalCode).toBe('SIGKILL');
      // Real DB lease and recovery timer: no timestamp writes or private method calls.
      await expect.poll(() => state(submitted.id), { timeout: 95_000, interval: 250 }).toMatchObject({ status: 'QUEUED', generation: 2, recoveries: 1 });
      expect(Date.now()).toBeGreaterThanOrEqual(original.lease!.getTime());
      const recoveredMs = performance.now() - started;
      await request(app.getHttpServer()).patch(`${base}/internal/judge/submissions/${submitted.id}/result`)
        .set('X-Judge-Token', process.env.JUDGE_SERVICE_TOKEN!).set('X-Judge-Generation', '1').set('X-Judge-Attempt', original.attempt)
        .send({ status: 'ACCEPTED', runtimeMs: 1, memoryKb: 1, passedTestCases: 1, totalTestCases: 1, debugOutputs: [], testResults: [] }).expect(409);
      replacement = await startWorker();
      await accepted([submitted.id], 20_000);
      expect(await state(submitted.id)).toMatchObject({ generation: 2, recoveries: 1, lease: null });
      const [{ notifications }] = await db.query("SELECT count(*)::int AS notifications FROM notifications WHERE submission_id=$1 AND type='JUDGED'", [submitted.id]);
      expect(notifications).toBe(1);
      await consistency([submitted.id], 2, 1);
      recovery.push({ scenario: 'SIGKILL and natural database lease expiry', recoveredMs, completedMs: performance.now() - started, result: 'ACCEPTED', generation: 2, recoveries: 1, staleCallback: 409 });
    } finally { await stopWorker(originalWorker); if (replacement) await stopWorker(replacement); }
  }, 120_000);

  afterAll(async () => {
    await Promise.all(workers.map((worker) => stopWorker(worker)));
    await mkdir('reports', { recursive: true });
    await writeFile('reports/phase2-judge-capacity.json', JSON.stringify({
      schemaVersion: 1, timestamp: new Date().toISOString(),
      environment: { node: process.version, platform: platform(), kernel: release(), logicalCpus: cpus().length, cpu: cpus()[0]?.model },
      scope: 'Disposable API/PostgreSQL/Redis, real workers and go-judge; eight accepted languages, one sample/job, alternating 1/2/2/1 worker trials after Python warmup.',
      limitations: ['Eight jobs/trial: p95/p99 are sample maxima, not steady-state tail estimates.', 'Shared CI runner; no production capacity or before/after optimization claim.', 'Worker CPU uses owned-PID procfs tick deltas; peak RSS includes warmup. API also hosts the test harness: isolated API CPU/RSS is not reported.', 'Proxy faults interrupt worker TCP links, not Redis/API services. Natural lease expiry uses real time.'],
      trials, recovery,
    }, null, 2) + '\n');
    await writeFile('reports/phase2-judge-workers.log', workers.map((worker, index) => `Worker ${index}\n${worker.log}`).join('\n'));
    await closeApp(app, jobs);
  });
});
