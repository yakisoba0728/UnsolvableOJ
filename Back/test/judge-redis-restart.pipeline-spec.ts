import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { JUDGE_QUEUE } from '../src/common/queue.constants.js';
import { createOwnedRedis } from './owned-redis.pipeline-helpers.js';
import { disposableDatabaseObserver, reserveLoopbackPort, startOwnedProcess, stopOwnedProcess, type OwnedProcess } from './process.pipeline-helpers.js';

const base = '/api/v1';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('actual owned Redis daemon restart during mixed native judging', () => {
  let db: DataSource | undefined;
  let redis: Awaited<ReturnType<typeof createOwnedRedis>> | undefined;
  let probe: Redis | undefined;
  let queue: Queue | undefined;
  let api: OwnedProcess | undefined;
  let worker: OwnedProcess | undefined;
  const processes: OwnedProcess[] = [];
  const evidence: unknown[] = [];
  const events: unknown[] = [];
  let connectionLog = '';

  it('restarts only its own cleanly stopped AOF Redis, rejects outage requests and preserves accepted mixed work', async () => {
    db = await disposableDatabaseObserver();
    redis = await createOwnedRedis();
    const connection = { host: '127.0.0.1', port: redis.port, db: 0, maxRetriesPerRequest: 1 };
    const captureError = (error: Error) => { connectionLog = (connectionLog + `${error.message}\n`).slice(-20_000); };
    probe = new Redis(connection);
    probe.on('error', captureError);
    queue = new Queue(JUDGE_QUEUE, { connection });
    queue.on('error', captureError);
    await expect.poll(async () => { try { return await probe!.ping(); } catch { return ''; } }, { timeout: 10_000 }).toBe('PONG');
    expect(await probe.info('persistence')).toContain('aof_enabled:1');
    const runId = (value: string) => value.match(/^run_id:(\w+)\r?$/m)?.[1];
    const firstRunId = runId(await probe.info('server'));
    expect(firstRunId).toBeTruthy();

    const port = await reserveLoopbackPort();
    const url = `http://127.0.0.1:${port}`;
    const testRedis = { REDIS_HOST: '127.0.0.1', REDIS_PORT: String(redis.port), REDIS_DB: '0', REDIS_USERNAME: '', REDIS_PASSWORD: '' };
    api = startOwnedProcess(processes, 'dist/main.js', {
      ...testRedis, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
      EMAIL_ENABLED: 'false', EMAIL_WORKER_ENABLED: 'false', OPENAI_API_KEY: '', VIBE_SANDBOX_URL: '', VIBE_SANDBOX_TOKEN: '',
    });
    await expect.poll(async () => {
      if (api!.child.exitCode !== null || api!.child.signalCode !== null) throw new Error('Owned API exited before readiness');
      try { return (await fetch(`${url}${base}/health`, { signal: AbortSignal.timeout(500) })).ok; }
      catch { return false; }
    }, { timeout: 15_000, interval: 500 }).toBe(true);
    const suffix = randomUUID().slice(0, 8);
    const password = 'test-password-123';
    async function register(name: string) {
      return (await request(url).post(`${base}/auth/register`).send({ email: `${name}-${suffix}@example.com`, username: `${name}_${suffix}`, password }).expect(201)).body;
    }
    const admin = await register('redis_admin');
    const solver = await register('redis_solver');
    await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [admin.user.id]);
    const adminToken = (await request(url).post(`${base}/auth/login`).send({ email: admin.user.email, password }).expect(200)).body.accessToken;
    const created = await request(url).post(`${base}/problems`).set(bearer(adminToken)).send({
      slug: `redis-restart-${suffix}`, title: 'Redis restart fixture', statementMarkdown: 'Add two integers.',
      inputDescriptionMarkdown: 'Two integers', outputDescriptionMarkdown: 'Sum', difficulty: 'BEGINNER',
      status: 'PUBLISHED', timeLimitMs: 15_000, memoryLimitMb: 256,
      testCases: [{ input: '1 2\n', expectedOutput: '3\n', isSample: true }],
    }).expect(201);
    const problemId = created.body.id as string;
    const post = (language: string, sourceCode: string) => request(url).post(`${base}/problems/${problemId}/submissions`)
      .set(bearer(solver.accessToken)).send({ language, sourceCode });
    const state = async (id: string) => (await db!.query(`SELECT status, judge_generation AS generation, judge_attempt_id AS attempt,
      recovery_count AS recoveries, completed_for_learning AS learned FROM submissions WHERE id=$1`, [id]))[0];
    const count = async () => (await db!.query('SELECT count(*)::int AS count FROM submissions WHERE user_id=$1 AND problem_id=$2', [solver.user.id, problemId]))[0].count;

    worker = startOwnedProcess(processes, '../Judge/dist/worker.js', { ...testRedis, API_BASE_URL: `${url}${base}`, JUDGE_CONCURRENCY: '1', JUDGE_METRICS: 'json' });
    await expect.poll(() => worker!.log, { timeout: 15_000 }).toContain('Judge worker ready');
    const first = (await post('PYTHON', 'import time\ntime.sleep(8)\nprint(3)').expect(202)).body.id as string;
    await expect.poll(() => state(first), { timeout: 10_000, interval: 25 }).toMatchObject({ status: 'JUDGING', generation: 1 });
    const claimed = await state(first);
    const second = (await post('C', '#include <stdio.h>\nint main(void){puts("3");return 0;}').expect(202)).body.id as string;
    const third = (await post('JAVASCRIPT', 'console.log(3)').expect(202)).body.id as string;
    for (const id of [second, third]) expect(await state(id)).toMatchObject({ status: 'QUEUED', generation: 1 });
    expect(await count()).toBe(3);
    events.push({ stage: 'mixed work accepted', submissions: [first, second, third], containerId: redis.containerId, volume: redis.volume, imageId: redis.imageId });

    const started = performance.now();
    const stopped = await redis.stop();
    events.push({ stage: 'Redis daemon cleanly stopped', exitCode: stopped.State.ExitCode, finishedAt: stopped.State.FinishedAt });
    await expect(probe.ping()).rejects.toThrow();
    expect(await state(first)).toMatchObject({ status: 'JUDGING', generation: 1, attempt: claimed.attempt });
    const requestStarted = performance.now();
    // The current global Redis-backed throttle fails closed before admission.
    // Record the actual server-error status; do not misreport it as a guaranteed 503.
    const rejected = await post('PYTHON', 'print(3)').timeout({ response: 2000, deadline: 3000 });
    const rejectedMs = performance.now() - requestStarted;
    expect(rejected.status).toBeGreaterThanOrEqual(500);
    expect(rejected.status).toBeLessThan(600);
    expect(await count()).toBe(3);
    expect(api.child.exitCode).toBeNull();
    expect(api.child.signalCode).toBeNull();
    events.push({ stage: 'outage submission rejected', status: rejected.status, elapsedMs: rejectedMs, createdRows: 0 });
    // Internal result callbacks use PostgreSQL and must still commit during the
    // Redis outage. The worker cannot complete its queue acknowledgement yet.
    await expect.poll(() => state(first), { timeout: 15_000, interval: 100 }).toMatchObject({ status: 'ACCEPTED', generation: 1, attempt: claimed.attempt, recoveries: 0, learned: true });
    for (const id of [second, third]) expect(await state(id)).toMatchObject({ status: 'QUEUED', generation: 1 });
    events.push({ stage: 'active result committed while Redis is stopped', elapsedMs: performance.now() - started, queuedJobs: 2 });
    await redis.start();
    await expect.poll(async () => { try { return await probe!.ping(); } catch { return ''; } }, { timeout: 10_000 }).toBe('PONG');
    const secondRunId = runId(await probe.info('server'));
    expect(secondRunId).toBeTruthy();
    expect(secondRunId).not.toBe(firstRunId);
    expect(await probe.info('persistence')).toContain('aof_enabled:1');
    const restartMs = performance.now() - started;
    for (const id of [first, second, third]) expect((await queue.getJob(`${id}-1`))?.data.submissionId).toBe(id);
    events.push({ stage: 'Redis restarted with persisted jobs', restartMs, firstRunId, secondRunId });
    await expect.poll(async () => [await state(first), await state(second), await state(third)], { timeout: 40_000, interval: 100 }).toMatchObject([
      { status: 'ACCEPTED', generation: 1, attempt: claimed.attempt, recoveries: 0, learned: true },
      { status: 'ACCEPTED', generation: 1, recoveries: 0, learned: true },
      { status: 'ACCEPTED', generation: 1, recoveries: 0, learned: true },
    ]);
    // Retrying the rejected request succeeds once the service and pending budget recover.
    const retried = (await post('PYTHON', 'print(3)').expect(202)).body.id as string;
    await expect.poll(() => state(retried), { timeout: 15_000 }).toMatchObject({ status: 'ACCEPTED', generation: 1, recoveries: 0, learned: true });
    for (const id of [first, second, third, retried]) {
      await expect.poll(async () => (await queue!.getJob(`${id}-1`))?.getState(), { timeout: 5000 }).toBe('completed');
      expect((await db.query("SELECT count(*)::int AS count FROM notifications WHERE submission_id=$1 AND type='JUDGED'", [id]))[0].count).toBe(1);
    }
    expect(await count()).toBe(4);
    expect(await db.query('SELECT awarded_xp FROM user_problem_solves WHERE user_id=$1 AND problem_id=$2', [solver.user.id, problemId])).toEqual([{ awarded_xp: 10 }]);
    expect((await request(url).get(`${base}/users/me`).set(bearer(solver.accessToken)).expect(200)).body).toMatchObject({ xp: 10, solvedCount: 1 });
    expect(worker.child.exitCode).toBeNull();
    expect(worker.child.signalCode).toBeNull();
    evidence.push({ scenario: 'actual clean owned Redis daemon restart with AOF and mixed queued work', restartMs,
      completionMs: performance.now() - started, originalLanguages: ['PYTHON', 'C', 'JAVASCRIPT'], acceptedSubmissions: 4,
      failedDuringDowntime: 1, failureStatus: rejected.status, failureLatencyMs: rejectedMs, generation: 1, recoveries: 0, xp: 10,
      redisImage: redis.image, redisImageId: redis.imageId, appendonly: true, appendfsync: 'everysec', cleanStopExitCode: stopped.State.ExitCode,
      firstRunId, secondRunId, workflowRedisRestarted: false, crashDurabilityTested: false });
  }, 120_000);

  afterAll(async () => {
    const errors: unknown[] = [];
    const cleanup = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { errors.push(error); } };
    await cleanup(() => stopOwnedProcess(worker));
    await cleanup(() => stopOwnedProcess(api));
    if (queue) await cleanup(() => queue!.disconnect());
    probe?.disconnect();
    if (redis) await cleanup(() => redis!.close());
    if (db?.isInitialized) await cleanup(() => db!.destroy());
    await mkdir('reports', { recursive: true });
    await writeFile('reports/phase2-redis-restart.json', JSON.stringify({ schemaVersion: 1, timestamp: new Date().toISOString(), evidence, events, cleanupSucceeded: errors.length === 0 }, null, 2) + '\n');
    await writeFile('reports/phase2-redis-restart.log', [...processes.map((owned, i) => `Owned process ${i}\n${owned.log}`), redis?.log ?? '', connectionLog].join('\n'));
    if (errors.length) throw new AggregateError(errors, 'Owned Redis scenario cleanup failed');
  }, 120_000);
});
