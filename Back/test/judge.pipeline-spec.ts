import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  base,
  bearer,
  closeApp,
  createApp,
  login,
  register,
} from './helpers.js';

const sources = JSON.parse(
  await readFile(
    new URL('../../Judge/runtime/smoke-sources.json', import.meta.url),
    'utf8',
  ),
) as Record<string, string>;

describe('API → Redis → real worker → go-judge → API', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let worker: ChildProcess | undefined;
  let workerStopped: Promise<void> | undefined;
  let workerLog = '';
  let problemId: string | undefined;
  let adminToken: string;
  let solverToken: string;
  let acceptedId: string;
  const jobs: string[] = [];

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    const suffix = randomUUID().slice(0, 8);
    const admin = await register(app, 'pipeline_admin', suffix);
    const solver = await register(app, 'pipeline_solver', suffix);
    solverToken = solver.accessToken;
    await db.query("UPDATE users SET role = 'ADMIN' WHERE id = $1", [
      admin.user.id,
    ]);
    adminToken = (await login(app, admin.user.email)).accessToken;
    const created = await request(app.getHttpServer())
      .post(`${base}/problems`)
      .set(bearer(adminToken))
      .send({
        slug: `pipeline-${suffix}`,
        title: 'Pipeline sum',
        statementMarkdown: 'Add two integers.',
        inputDescriptionMarkdown: 'Two integers',
        outputDescriptionMarkdown: 'Their sum',
        difficulty: 'BEGINNER',
        status: 'PUBLISHED',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testCases: [
          { input: '1 2\n', expectedOutput: '3\n', isSample: true },
          { input: '5 7\n', expectedOutput: '12\n', isSample: false },
        ],
      })
      .expect(201);
    problemId = created.body.id;
    worker = spawn(process.execPath, ['../Judge/dist/worker.js'], {
      env: {
        ...process.env,
        API_BASE_URL: `${await app.getUrl()}${base}`,
        JUDGE_CONCURRENCY: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const log = (chunk: Buffer) => {
      workerLog = (workerLog + chunk.toString()).slice(-100_000);
    };
    worker.stdout!.on('data', log);
    worker.stderr!.on('data', log);
    worker.on('error', (error) => {
      workerLog += error.message;
    });
    workerStopped = new Promise((resolve) =>
      worker!.once('close', () => resolve()),
    );
    await vi.waitFor(() => expect(workerLog).toContain('Judge worker ready'), {
      timeout: 15_000,
    });
  });

  async function result(id: string) {
    // Poll storage so slow compiler startup cannot exhaust the public API's rate limit.
    await expect
      .poll(
        async () => {
          if (worker?.exitCode !== null)
            throw new Error(`Worker exited: ${workerLog}`);
          const [row] = await db.query(
            'SELECT status FROM submissions WHERE id = $1',
            [id],
          );
          return row?.status;
        },
        { timeout: 75_000, interval: 500 },
      )
      .not.toMatch(/^(QUEUED|JUDGING)$/);
    return (
      await request(app.getHttpServer())
        .get(`${base}/submissions/${id}`)
        .set(bearer(solverToken))
        .expect(200)
    ).body;
  }

  async function submit(language: string, sourceCode: string) {
    const { body } = await request(app.getHttpServer())
      .post(`${base}/problems/${problemId}/submissions`)
      .set(bearer(solverToken))
      .send({ language, sourceCode })
      .expect(202);
    jobs.push(`${body.id}-1`);
    return result(body.id);
  }

  it.each(Object.entries(sources))(
    'accepts %s through the complete pipeline',
    async (language, source) => {
      const judged = await submit(language, source);
      expect(judged, workerLog).toMatchObject({
        status: 'ACCEPTED',
        passedTestCases: 2,
        totalTestCases: 2,
      });
      expect(judged.runtimeMs).toBeGreaterThanOrEqual(0);
      expect(judged.memoryKb).toBeGreaterThan(0);
      if (language === 'PYTHON') acceptedId = judged.id;
    },
  );

  it.each([
    ['WRONG_ANSWER', 'PYTHON', 'print(0)'],
    ['TIME_LIMIT_EXCEEDED', 'PYTHON', 'while True: pass'],
    [
      'MEMORY_LIMIT_EXCEEDED',
      'PYTHON',
      'data = bytearray(512 * 1024 * 1024); print(3)',
    ],
    ['RUNTIME_ERROR', 'PYTHON', 'raise RuntimeError("intentional")'],
    ['OUTPUT_LIMIT_EXCEEDED', 'PYTHON', 'while True: print("x" * 65536)'],
    ['COMPILE_ERROR', 'C', 'this is not valid C'],
  ])(
    'persists %s from the actual runtime',
    async (status, language, source) => {
      expect(await submit(language, source), workerLog).toMatchObject({
        status,
        passedTestCases: 0,
        totalTestCases: 2,
      });
    },
  );

  it('rejudges with a new generation, awards XP once, and reports worker health', async () => {
    expect(acceptedId).toBeTruthy();
    const rejudge = await request(app.getHttpServer())
      .post(`${base}/submissions/${acceptedId}/rejudge`)
      .set(bearer(adminToken))
      .expect(202);
    jobs.push(`${acceptedId}-2`);
    expect(rejudge.body.judgeGeneration).toBe(2);
    expect(await result(acceptedId)).toMatchObject({
      status: 'ACCEPTED',
      judgeGeneration: 2,
    });
    const me = await request(app.getHttpServer())
      .get(`${base}/users/me`)
      .set(bearer(solverToken))
      .expect(200);
    expect(me.body).toMatchObject({ xp: 10, solvedCount: 1 });
    await expect
      .poll(
        async () => {
          const ops = await request(app.getHttpServer())
            .get(`${base}/admin/ops`)
            .set(bearer(adminToken))
            .expect(200);
          return ops.body.workers.length;
        },
        { timeout: 15_000, interval: 1000 },
      )
      .toBeGreaterThan(0);
  });

  afterAll(async () => {
    if (worker && worker.exitCode === null) {
      worker.kill('SIGTERM');
      await Promise.race([workerStopped, delay(10_000)]);
      if (worker.exitCode === null) {
        worker.kill('SIGKILL');
        await workerStopped;
      }
    }
    await mkdir('reports', { recursive: true });
    await writeFile('reports/pipeline-worker.log', workerLog);
    await closeApp(app, jobs);
  });
});
