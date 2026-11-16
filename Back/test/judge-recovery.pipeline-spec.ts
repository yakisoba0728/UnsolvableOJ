import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Queue } from 'bullmq';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { JUDGE_QUEUE } from '../src/common/queue.constants.js';
import {
  base,
  bearer,
  closeApp,
  createApp,
  login,
  register,
} from './helpers.js';

describe('real worker termination and lease recovery', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let queue: Queue;
  let worker: ChildProcess | undefined;
  let workerStopped: Promise<void> | undefined;
  let workerLog = '';
  let problemId: string;
  let solverId: string;
  let solverToken: string;
  const jobs: string[] = [];

  async function startWorker() {
    const logStart = workerLog.length;
    worker = spawn(process.execPath, ['../Judge/dist/worker.js'], {
      env: {
        ...process.env,
        API_BASE_URL: `${await app.getUrl()}${base}`,
        JUDGE_CONCURRENCY: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const log = (chunk: Buffer) => { workerLog += chunk.toString(); };
    worker.stdout!.on('data', log);
    worker.stderr!.on('data', log);
    worker.on('error', (error) => { workerLog += error.message; });
    workerStopped = new Promise((resolve) => worker!.once('close', () => resolve()));
    await expect.poll(() => workerLog.slice(logStart), { timeout: 15_000 })
      .toContain('Judge worker ready');
  }

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    queue = app.get<Queue>(getQueueToken(JUDGE_QUEUE));
    const suffix = randomUUID().slice(0, 8);
    const admin = await register(app, 'recovery_admin', suffix);
    const solver = await register(app, 'recovery_solver', suffix);
    solverId = solver.user.id;
    solverToken = solver.accessToken;
    await db.query("UPDATE users SET role = 'ADMIN' WHERE id = $1", [admin.user.id]);
    const adminToken = (await login(app, admin.user.email)).accessToken;
    const created = await request(app.getHttpServer())
      .post(`${base}/problems`)
      .set(bearer(adminToken))
      .send({
        slug: `recovery-${suffix}`,
        title: 'Worker recovery fixture',
        statementMarkdown: 'Add two integers.',
        inputDescriptionMarkdown: 'Two integers',
        outputDescriptionMarkdown: 'Their sum',
        difficulty: 'BEGINNER',
        status: 'PUBLISHED',
        timeLimitMs: 15_000,
        memoryLimitMb: 256,
        testCases: [{ input: '1 2\n', expectedOutput: '3\n', isSample: true }],
      })
      .expect(201);
    problemId = created.body.id;
    await startWorker();
  });

  it('recovers after SIGKILL, fences the old attempt and records learning/XP once (simulated lease expiry)', async () => {
    const submitted = await request(app.getHttpServer())
      .post(`${base}/problems/${problemId}/submissions`)
      .set(bearer(solverToken))
      // This bounded sleep runs only inside the actual go-judge sandbox, never on the host.
      .send({ language: 'PYTHON', sourceCode: 'import time\ntime.sleep(5)\nprint(sum(map(int,input().split())))' })
      .expect(202);
    const id = submitted.body.id as string;
    jobs.push(`${id}-1`, `${id}-2`);

    async function state() {
      const [row] = await db.query(
        `SELECT status, judge_generation AS generation, judge_attempt_id AS attempt,
          judge_lease_expires_at AS lease, recovery_count AS recoveries,
          accepted_for_xp AS accepted, completed_for_learning AS learned,
          runtime_ms, memory_kb, passed_test_cases, total_test_cases, updated_at
         FROM submissions WHERE id = $1`,
        [id],
      );
      return row;
    }

    await expect.poll(state, { timeout: 15_000, interval: 25 }).toMatchObject({
      status: 'JUDGING', generation: 1, attempt: expect.any(String),
      recoveries: 0, accepted: false, learned: false,
    });
    const original = await state();
    const terminated = worker!;
    expect(terminated.kill('SIGKILL')).toBe(true);
    await workerStopped;
    expect(terminated.signalCode).toBe('SIGKILL');

    // Simulate expiry in this owned disposable database; do not fake timers or invoke
    // private recovery methods. The application's real 30s timer must recover the job.
    const expired = await db.query(
      `UPDATE submissions SET judge_lease_expires_at = now() - interval '1 second'
       WHERE id = $1 AND judge_generation = 1 AND judge_attempt_id = $2
         AND status = 'JUDGING' RETURNING id`,
      [id, original.attempt],
    );
    expect(expired[1]).toBe(1);
    await expect.poll(state, { timeout: 40_000, interval: 250 }).toMatchObject({
      status: 'QUEUED', generation: 2, attempt: null, lease: null,
      recoveries: 1, accepted: false, learned: false,
    });

    const replay = {
      status: 'ACCEPTED', runtimeMs: 1, memoryKb: 1024,
      passedTestCases: 1, totalTestCases: 1, debugOutputs: [], testResults: [],
    };
    const report = (generation: number, attempt: string) => request(app.getHttpServer())
      .patch(`${base}/internal/judge/submissions/${id}/result`)
      .set('X-Judge-Token', process.env.JUDGE_SERVICE_TOKEN!)
      .set('X-Judge-Generation', String(generation))
      .set('X-Judge-Attempt', attempt)
      .send(replay);
    await report(1, original.attempt).expect(409);
    expect(await state()).toMatchObject({ status: 'QUEUED', generation: 2, recoveries: 1 });

    await startWorker();
    expect(worker!.pid).not.toBe(terminated.pid);
    await expect.poll(state, { timeout: 20_000, interval: 250 }).toMatchObject({
      status: 'ACCEPTED', generation: 2, attempt: expect.any(String), lease: null,
      recoveries: 1, accepted: true, learned: true,
      passed_test_cases: 1, total_test_cases: 1,
    });
    const terminal = await state();
    expect(terminal.attempt).not.toBe(original.attempt);
    const judged = await request(app.getHttpServer())
      .get(`${base}/submissions/${id}`)
      .set(bearer(solverToken))
      .expect(200);
    expect(judged.body).toMatchObject({
      status: 'ACCEPTED', judgeGeneration: 2,
      debugOutputs: [{ testCase: 1, stdout: '3\n' }],
    });

    // Both an obsolete callback and the successful attempt's duplicate go through the API.
    await report(1, original.attempt).expect(409);
    await report(2, terminal.attempt).expect(200);
    expect(await state()).toEqual(terminal);
    const me = await request(app.getHttpServer())
      .get(`${base}/users/me`)
      .set(bearer(solverToken))
      .expect(200);
    expect(me.body).toMatchObject({ xp: 10, solvedCount: 1 });
    expect(await db.query(
      'SELECT accepted_submission_id, awarded_xp FROM user_problem_solves WHERE user_id = $1 AND problem_id = $2',
      [solverId, problemId],
    )).toEqual([{ accepted_submission_id: id, awarded_xp: 10 }]);
    const [counts] = await db.query(
      `SELECT
        (SELECT count(*)::int FROM submissions WHERE user_id=$1 AND problem_id=$2 AND completed_for_learning) AS learning,
        (SELECT count(*)::int FROM notifications WHERE submission_id=$3 AND type='JUDGED') AS notifications`,
      [solverId, problemId, id],
    );
    expect(counts).toEqual({ learning: 1, notifications: 1 });

    await expect.poll(async () => (await queue.getJob(`${id}-2`))?.getState(), {
      timeout: 5_000, interval: 100,
    }).toBe('completed');
    // The old queue lock still uses its real timeout. Wait until it is absent before
    // normal teardown removes this owned job; do not alter Redis locks or fake its clock.
    // This verifies API lease recovery, not BullMQ's independent multi-scan stalled loop.
    const redis = await queue.getBackend().client;
    await expect.poll(async () => (await redis.get(queue.toKey(`${id}-1:lock`))) === null, {
      timeout: 35_000, interval: 250,
    }).toBe(true);
    expect(await state()).toEqual(terminal);
  });

  afterAll(async () => {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGTERM');
      await Promise.race([workerStopped, delay(10_000)]);
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.kill('SIGKILL');
        await workerStopped;
      }
    }
    await mkdir('reports', { recursive: true });
    await writeFile('reports/pipeline-recovery-worker.log', workerLog);
    await closeApp(app, jobs);
  });
});
