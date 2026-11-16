import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { JUDGE_QUEUE } from '../src/common/queue.constants.js';
import { base, bearer, closeApp, createApp, login, register } from './helpers.js';
import { disposableDatabaseUrl, startOwnedProcess, stopOwnedProcess, type OwnedProcess } from './process.pipeline-helpers.js';

describe('actual worker loss while rejudging an already accepted submission', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let queue: Queue;
  let adminToken: string;
  let solverToken: string;
  let solverId: string;
  let problemId: string;
  const processes: OwnedProcess[] = [];
  const jobs: string[] = [];
  const evidence: unknown[] = [];

  async function startWorker() {
    const owned = startOwnedProcess(processes, '../Judge/dist/worker.js', {
      API_BASE_URL: `${await app.getUrl()}${base}`, JUDGE_CONCURRENCY: '1', JUDGE_METRICS: 'json',
    });
    await expect.poll(() => owned.log, { timeout: 15_000 }).toContain('Judge worker ready');
    return owned;
  }
  async function state(id: string) {
    return (await db.query(`SELECT status, judge_generation AS generation, judge_attempt_id AS attempt,
      recovery_count AS recoveries, judge_lease_expires_at AS lease,
      accepted_for_xp AS accepted, completed_for_learning AS learned FROM submissions WHERE id=$1`, [id]))[0];
  }
  async function consistency(id: string) {
    expect(await db.query('SELECT accepted_submission_id, awarded_xp FROM user_problem_solves WHERE user_id=$1 AND problem_id=$2', [solverId, problemId])).toEqual([{ accepted_submission_id: id, awarded_xp: 10 }]);
    expect((await request(app.getHttpServer()).get(`${base}/users/me`).set(bearer(solverToken)).expect(200)).body).toMatchObject({ xp: 10, solvedCount: 1 });
    const [counts] = await db.query(`SELECT
      (SELECT count(*)::int FROM submissions WHERE user_id=$1 AND problem_id=$2 AND completed_for_learning) AS learning,
      (SELECT count(*)::int FROM notifications WHERE submission_id=$3 AND type='JUDGED') AS notifications`, [solverId, problemId, id]);
    expect(counts).toEqual({ learning: 1, notifications: 1 });
  }

  beforeAll(async () => {
    disposableDatabaseUrl();
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    queue = app.get<Queue>(getQueueToken(JUDGE_QUEUE));
    const suffix = randomUUID().slice(0, 8);
    const admin = await register(app, 'rejudge_loss_admin', suffix);
    const solver = await register(app, 'rejudge_loss_solver', suffix);
    solverId = solver.user.id;
    solverToken = solver.accessToken;
    await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [admin.user.id]);
    adminToken = (await login(app, admin.user.email)).accessToken;
    const created = await request(app.getHttpServer()).post(`${base}/problems`).set(bearer(adminToken)).send({
      slug: `rejudge-loss-${suffix}`, title: 'Rejudge recovery fixture', statementMarkdown: 'Add two integers.',
      inputDescriptionMarkdown: 'Two integers', outputDescriptionMarkdown: 'Sum', difficulty: 'BEGINNER',
      status: 'PUBLISHED', timeLimitMs: 15_000, memoryLimitMb: 256,
      testCases: [{ input: '1 2\n', expectedOutput: '3\n', isSample: true }],
    }).expect(201);
    problemId = created.body.id;
  });

  it('preserves earned evidence across rejudge SIGKILL, natural lease recovery and an obsolete callback', async () => {
    const originalWorker = await startWorker();
    const submitted = await request(app.getHttpServer()).post(`${base}/problems/${problemId}/submissions`)
      .set(bearer(solverToken)).send({ language: 'PYTHON', sourceCode: 'import time\ntime.sleep(3)\nprint(3)' }).expect(202);
    const id = submitted.body.id as string;
    jobs.push(`${id}-1`, `${id}-2`, `${id}-3`);
    await expect.poll(() => state(id), { timeout: 15_000, interval: 100 }).toMatchObject({ status: 'ACCEPTED', generation: 1, recoveries: 0, accepted: true, learned: true });
    await expect.poll(async () => (await queue.getJob(`${id}-1`))?.getState(), { timeout: 5000 }).toBe('completed');
    await consistency(id);
    const rejudged = await request(app.getHttpServer()).post(`${base}/submissions/${id}/rejudge`).set(bearer(adminToken)).expect(202);
    expect(rejudged.body.judgeGeneration).toBe(2);
    await expect.poll(() => state(id), { timeout: 10_000, interval: 25 }).toMatchObject({ status: 'JUDGING', generation: 2, recoveries: 0, accepted: true, learned: true });
    const interrupted = await state(id);
    const started = performance.now();
    await stopOwnedProcess(originalWorker, 'SIGKILL');
    expect(originalWorker.child.signalCode).toBe('SIGKILL');
    // No timestamp writes, fake timers, recovery API calls or Redis lock edits.
    // Previously earned evidence must remain throughout this real outage.
    await consistency(id);
    await expect.poll(() => state(id), { timeout: 95_000, interval: 250 }).toMatchObject({ status: 'QUEUED', generation: 3, recoveries: 1, attempt: null, lease: null, accepted: true, learned: true });
    expect(Date.now()).toBeGreaterThanOrEqual((interrupted.lease as Date).getTime());
    const recoveredMs = performance.now() - started;
    await consistency(id);
    const callback = (generation: number, attempt: string) => request(app.getHttpServer()).patch(`${base}/internal/judge/submissions/${id}/result`)
      .set('X-Judge-Token', process.env.JUDGE_SERVICE_TOKEN!).set('X-Judge-Generation', String(generation)).set('X-Judge-Attempt', attempt)
      .send({ status: 'ACCEPTED', runtimeMs: 1, memoryKb: 1, passedTestCases: 1, totalTestCases: 1, debugOutputs: [], testResults: [] });
    await callback(2, interrupted.attempt).expect(409);
    const replacement = await startWorker();
    expect(replacement.child.pid).not.toBe(originalWorker.child.pid);
    await expect.poll(() => state(id), { timeout: 20_000, interval: 100 }).toMatchObject({ status: 'ACCEPTED', generation: 3, recoveries: 1, accepted: true, learned: true, lease: null });
    const final = await state(id);
    expect(final.attempt).not.toBe(interrupted.attempt);
    await callback(2, interrupted.attempt).expect(409);
    await callback(3, final.attempt).expect(200);
    expect(await state(id)).toEqual(final);
    await consistency(id);
    await expect.poll(async () => (await queue.getJob(`${id}-3`))?.getState(), { timeout: 5000 }).toBe('completed');
    evidence.push({ scenario: 'accepted generation 1, interrupted rejudge generation 2, natural recovery generation 3', recoveredMs,
      completedMs: performance.now() - started, finalStatus: 'ACCEPTED', generation: 3, recoveries: 1, xp: 10,
      solveRows: 1, learningRows: 1, notifications: 1, staleCallback: 409, duplicateFinalCallback: 200, leaseClockChanged: false });
  }, 150_000);

  afterAll(async () => {
    const errors: unknown[] = [];
    for (const owned of processes) { try { await stopOwnedProcess(owned); } catch (error) { errors.push(error); } }
    await mkdir('reports', { recursive: true });
    await writeFile('reports/phase2-rejudge-recovery.json', JSON.stringify({ schemaVersion: 1, timestamp: new Date().toISOString(), evidence }, null, 2) + '\n');
    await writeFile('reports/phase2-rejudge-recovery.log', processes.map((owned, i) => `Owned process ${i}\n${owned.log}`).join('\n'));
    try { await closeApp(app, jobs); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Rejudge recovery cleanup failed');
  }, 60_000);
});
