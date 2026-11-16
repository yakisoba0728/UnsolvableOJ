import type { NestExpressApplication } from '@nestjs/platform-express';
import { Queue } from 'bullmq';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { JUDGE_QUEUE } from '../src/common/queue.constants.js';
import { base, bearer, closeApp, createApp, login, register } from './helpers.js';

interface OwnedProcess { child: ChildProcess; closed: Promise<void>; log: string }

// The fixture Nest app is closed before this test. Only the spawned API process
// serves requests or runs recovery timers; SQL/Queue clients are observers.
describe('actual owned API process restart during native judging', () => {
  let fixture: NestExpressApplication | undefined;
  let db: DataSource;
  let queue: Queue;
  let api: OwnedProcess | undefined;
  let worker: OwnedProcess | undefined;
  let url: string;
  let port: number;
  let problemId: string;
  let solverId: string;
  let solverToken: string;
  const processes: OwnedProcess[] = [];
  const jobs: string[] = [];
  const evidence: unknown[] = [];

  function start(entry: string, env: NodeJS.ProcessEnv) {
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
  async function stop(owned: OwnedProcess | undefined, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') {
    if (!owned || owned.child.exitCode !== null || owned.child.signalCode !== null) return;
    owned.child.kill(signal);
    await Promise.race([owned.closed, delay(10_000)]);
    if (owned.child.exitCode === null && owned.child.signalCode === null) { owned.child.kill('SIGKILL'); await owned.closed; }
  }
  async function startApi() {
    api = start('dist/main.js', {
      NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
      EMAIL_ENABLED: 'false', EMAIL_WORKER_ENABLED: 'false', OPENAI_API_KEY: '',
      VIBE_SANDBOX_URL: '', VIBE_SANDBOX_TOKEN: '',
    });
    await expect.poll(async () => {
      if (api!.child.exitCode !== null) throw new Error(`API exited: ${api!.log}`);
      try { return (await fetch(`${url}${base}/health`, { signal: AbortSignal.timeout(500) })).ok; }
      catch { return false; }
    }, { timeout: 15_000, interval: 500 }).toBe(true);
    return api;
  }
  async function state(id: string) {
    const [row] = await db.query(`SELECT status, judge_generation AS generation, judge_attempt_id AS attempt,
      recovery_count AS recoveries, completed_for_learning AS learned FROM submissions WHERE id=$1`, [id]);
    return row;
  }
  async function submit(slow = false) {
    const response = await request(url).post(`${base}/problems/${problemId}/submissions`)
      .set(bearer(solverToken)).send({ language: 'PYTHON', sourceCode: slow ? 'import time\ntime.sleep(8)\nprint(3)' : 'print(3)' }).expect(202);
    const id = response.body.id as string;
    jobs.push(`${id}-1`);
    return id;
  }

  beforeAll(async () => {
    fixture = await createApp();
    await fixture.listen(0, '127.0.0.1');
    const fixtureDb = fixture.get(DataSource);
    const suffix = randomUUID().slice(0, 8);
    const admin = await register(fixture, 'restart_admin', suffix);
    const solver = await register(fixture, 'restart_solver', suffix);
    solverId = solver.user.id;
    solverToken = solver.accessToken;
    await fixtureDb.query("UPDATE users SET role='ADMIN' WHERE id=$1", [admin.user.id]);
    const adminToken = (await login(fixture, admin.user.email)).accessToken;
    const created = await request(fixture.getHttpServer()).post(`${base}/problems`).set(bearer(adminToken)).send({
      slug: `restart-${suffix}`, title: 'API restart fixture', statementMarkdown: 'Add two integers.',
      inputDescriptionMarkdown: 'Two integers', outputDescriptionMarkdown: 'Sum', difficulty: 'BEGINNER',
      status: 'PUBLISHED', timeLimitMs: 15_000, memoryLimitMb: 256,
      testCases: [{ input: '1 2\n', expectedOutput: '3\n', isSample: true }],
    }).expect(201);
    problemId = created.body.id;
    db = await new DataSource({ ...fixtureDb.options, entities: [], migrations: [] }).initialize();
    queue = new Queue(JUDGE_QUEUE, { connection: {
      host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT),
      username: process.env.REDIS_USERNAME || undefined, password: process.env.REDIS_PASSWORD || undefined,
      db: Number(process.env.REDIS_DB), maxRetriesPerRequest: 1,
    } });
    await closeApp(fixture, []);
    fixture = undefined;
    const listener = createServer();
    await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('No API test port');
    port = address.port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    url = `http://127.0.0.1:${port}`;
  });

  it('restarts the API process while a lease is active and preserves queued requests, final results and single XP', async () => {
    const firstApi = await startApi();
    worker = start('../Judge/dist/worker.js', { API_BASE_URL: `${url}${base}`, JUDGE_CONCURRENCY: '1', JUDGE_METRICS: 'json' });
    await expect.poll(() => worker!.log, { timeout: 15_000 }).toContain('Judge worker ready');
    const first = await submit(true);
    await expect.poll(() => state(first), { timeout: 15_000, interval: 25 }).toMatchObject({ status: 'JUDGING', generation: 1 });
    const claimed = await state(first);
    const second = await submit();
    expect(await state(second)).toMatchObject({ status: 'QUEUED', generation: 1 });
    const started = performance.now();
    await stop(firstApi, 'SIGKILL');
    expect(firstApi.child.signalCode).toBe('SIGKILL');
    // A request made during a stopped server must fail, not be reported accepted.
    await expect(fetch(`${url}${base}/problems/${problemId}/submissions`, {
      method: 'POST', headers: { ...bearer(solverToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'PYTHON', sourceCode: 'print(3)' }), signal: AbortSignal.timeout(1000),
    })).rejects.toThrow();
    expect(await state(first)).toMatchObject({ status: 'JUDGING', generation: 1, attempt: claimed.attempt });
    const replacement = await startApi();
    const restartMs = performance.now() - started;
    expect(replacement.child.pid).not.toBe(firstApi.child.pid);
    const third = await submit();
    await expect.poll(async () => [await state(first), await state(second), await state(third)], { timeout: 40_000, interval: 100 }).toMatchObject([
      { status: 'ACCEPTED', generation: 1, attempt: claimed.attempt, recoveries: 0, learned: true },
      { status: 'ACCEPTED', generation: 1, recoveries: 0, learned: true },
      { status: 'ACCEPTED', generation: 1, recoveries: 0, learned: true },
    ]);
    for (const id of [first, second, third]) {
      await expect.poll(async () => (await queue.getJob(`${id}-1`))?.getState(), { timeout: 5000 }).toBe('completed');
      const [{ notifications }] = await db.query("SELECT count(*)::int AS notifications FROM notifications WHERE submission_id=$1 AND type='JUDGED'", [id]);
      expect(notifications).toBe(1);
    }
    const me = await request(url).get(`${base}/users/me`).set(bearer(solverToken)).expect(200);
    expect(me.body).toMatchObject({ xp: 10, solvedCount: 1 });
    expect(await db.query('SELECT awarded_xp FROM user_problem_solves WHERE user_id=$1 AND problem_id=$2', [solverId, problemId])).toEqual([{ awarded_xp: 10 }]);
    const [{ count }] = await db.query('SELECT count(*)::int AS count FROM submissions WHERE user_id=$1 AND problem_id=$2', [solverId, problemId]);
    expect(count, 'the failed request while the server was stopped must not create a row').toBe(3);
    expect(worker.child.exitCode).toBeNull();
    expect(worker.child.signalCode).toBeNull();
    evidence.push({ scenario: 'actual owned API SIGKILL and replacement process', restartMs, completionMs: performance.now() - started,
      submissions: 3, finalStatus: 'ACCEPTED', generation: 1, recoveries: 0, xp: 10, failedDuringDowntime: 1,
      otherApiInstancesRunning: 0, redisRestarted: false });
  });

  afterAll(async () => {
    await stop(worker);
    await stop(api);
    await mkdir('reports', { recursive: true });
    await writeFile('reports/phase2-api-restart.json', JSON.stringify({ schemaVersion: 1, timestamp: new Date().toISOString(), evidence }, null, 2) + '\n');
    await writeFile('reports/phase2-api-restart.log', processes.map((owned, i) => `Owned process ${i}\n${owned.log}`).join('\n'));
    if (queue) {
      try { for (const id of jobs) await (await queue.getJob(id))?.remove(); }
      finally { await queue.close(); }
    }
    if (db?.isInitialized) await db.destroy();
    await closeApp(fixture, []);
  });
});
