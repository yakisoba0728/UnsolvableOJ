import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureHttp } from '../src/configure-http.js';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { JUDGE_QUEUE } from '../src/common/queue.constants.js';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

const base = '/api/v1';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const judge = (generation: number, attempt: string) => ({
  'X-Judge-Token': 'test-judge-token-with-at-least-32-characters',
  'X-Judge-Generation': String(generation),
  'X-Judge-Attempt': attempt,
});

describe('Backend features (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  const userIds: string[] = [];
  let problemId: string | undefined;
  let submissionId: string | undefined;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureHttp(app);
    await app.init();
    db = app.get(DataSource);
  });

  it('keeps a submission on its problem version, fences attempts, and reconciles XP', async () => {
    const suffix = randomUUID().slice(0, 8);
    const register = async (name: string) => {
      const response = await request(app.getHttpServer())
        .post(`${base}/auth/register`)
        .send({
          email: `${name}-${suffix}@example.com`,
          username: `${name}_${suffix}`,
          password: 'test-password-123',
        })
        .expect(201);
      userIds.push(response.body.user.id);
      return response.body;
    };
    const author = await register('author');
    const solver = await register('solver');
    const admin = await register('admin');
    await db.query(
      "UPDATE users SET role = 'AUTHOR', token_version = token_version + 1 WHERE id = $1",
      [author.user.id],
    );
    await db.query(
      "UPDATE users SET role = 'ADMIN', token_version = token_version + 1 WHERE id = $1",
      [admin.user.id],
    );
    const login = async (email: string) =>
      (
        await request(app.getHttpServer())
          .post(`${base}/auth/login`)
          .send({ email, password: 'test-password-123' })
          .expect(200)
      ).body;
    const authorToken = (await login(author.user.email)).accessToken;
    const adminToken = (await login(admin.user.email)).accessToken;
    await request(app.getHttpServer())
      .get(`${base}/users/me`)
      .set(bearer(author.accessToken))
      .expect(401);

    const created = await request(app.getHttpServer())
      .post(`${base}/problems`)
      .set(bearer(authorToken))
      .send({
        slug: `version-${suffix}`,
        title: 'Version one',
        statementMarkdown: 'x'.repeat(150_000),
        inputDescriptionMarkdown: 'numbers',
        outputDescriptionMarkdown: 'sum',
        difficulty: 'BEGINNER',
        status: 'DRAFT',
        timeLimitMs: 5000,
        memoryLimitMb: 512,
        testCases: [
          { input: '1 2\n', expectedOutput: '3\n', isSample: true },
          { input: '5 7\n', expectedOutput: '12\n', isSample: false },
        ],
      })
      .expect(201);
    problemId = created.body.id;
    await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}/status`)
      .set(bearer(authorToken))
      .send({ status: 'PUBLISHED' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}/status`)
      .set(bearer(adminToken))
      .send({ status: 'PUBLISHED' })
      .expect(200);
    const publicView = await request(app.getHttpServer())
      .get(`${base}/problems/version-${suffix}`)
      .expect(200);
    expect(JSON.stringify(publicView.body)).not.toContain('5 7');
    await request(app.getHttpServer())
      .get(`${base}/problems?page=1000001`)
      .expect(400);
    await request(app.getHttpServer())
      .get(`${base}/submissions?page=1000001`)
      .set(bearer(solver.accessToken))
      .expect(400);
    await request(app.getHttpServer())
      .get(`${base}/problems/${problemId}/manage`)
      .set(bearer(solver.accessToken))
      .expect(403);

    const submitted = await request(app.getHttpServer())
      .post(`${base}/problems/${problemId}/submissions`)
      .set(bearer(solver.accessToken))
      .send({
        language: 'PYTHON',
        sourceCode: 'print(3)\n#' + 'x'.repeat(199_990),
      })
      .expect(202);
    submissionId = submitted.body.id;
    expect(submitted.body.problemVersion).toBe(1);
    await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}`)
      .set(bearer(authorToken))
      .send({})
      .expect(409);
    await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}`)
      .set(bearer(authorToken))
      .send({ timeLimitMs: null })
      .expect(400);
    const updated = await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}`)
      .set(bearer(authorToken))
      .send({
        title: 'Version two',
        testCases: [
          { input: '9 9\n', expectedOutput: '18\n', isSample: false },
        ],
      })
      .expect(200);
    expect(updated.body.currentVersion).toBe(2);
    expect(updated.body.status).toBe('DRAFT');
    expect(updated.body).toMatchObject({
      timeLimitMs: 5000,
      memoryLimitMb: 512,
    });
    const path = `${base}/internal/judge/submissions/${submissionId}`;
    const firstAttempt = randomUUID();
    const claim = await request(app.getHttpServer())
      .get(path)
      .set(judge(1, firstAttempt))
      .expect(200);
    expect(
      claim.body.testCases.map((item: { input: string }) => item.input),
    ).toEqual(['1 2\n', '5 7\n']);
    await request(app.getHttpServer())
      .get(path)
      .set(judge(1, randomUUID()))
      .expect(409);
    await request(app.getHttpServer())
      .patch(`${path}/heartbeat`)
      .set(judge(1, firstAttempt))
      .expect(200);
    await db.query(
      "UPDATE submissions SET judge_lease_expires_at = now() - interval '1 second' WHERE id = $1",
      [submissionId],
    );
    const secondAttempt = randomUUID();
    await request(app.getHttpServer())
      .get(path)
      .set(judge(1, secondAttempt))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${path}/result`)
      .set(judge(1, firstAttempt))
      .send({ status: 'ACCEPTED', passedTestCases: 2, totalTestCases: 2 })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`${path}/result`)
      .set(judge(1, secondAttempt))
      .send({
        status: 'ACCEPTED',
        passedTestCases: 2,
        totalTestCases: 2,
        memoryKb: 512,
        debugOutputs: [
          {
            testCase: 1,
            stdout: '3\n',
            stderr: '',
            stdoutTruncated: false,
            stderrTruncated: false,
          },
        ],
      })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${path}/result`)
      .set(judge(1, secondAttempt))
      .send({ status: 'ACCEPTED', passedTestCases: 2, totalTestCases: 2 })
      .expect(200);
    // The current problem is now a draft with different tests. The detail must
    // still show only the public sample from the immutable submitted version.
    const oldDetail = await request(app.getHttpServer())
      .get(`${base}/submissions/${submissionId}`)
      .set(bearer(solver.accessToken))
      .expect(200);
    expect(oldDetail.body.sampleTestCases).toEqual([
      { testCase: 1, input: '1 2\n', expectedOutput: '3\n' },
    ]);
    expect(JSON.stringify(oldDetail.body)).not.toContain('5 7');
    await request(app.getHttpServer())
      .get(`${base}/submissions/${submissionId}`)
      .set(bearer(authorToken))
      .expect(404);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/users/me`)
          .set(bearer(solver.accessToken))
          .expect(200)
      ).body,
    ).toMatchObject({ xp: 10, solvedCount: 1 });

    await request(app.getHttpServer())
      .post(`${base}/submissions/${submissionId}/rejudge`)
      .set(bearer(solver.accessToken))
      .expect(403);
    const rejudge = await request(app.getHttpServer())
      .post(`${base}/submissions/${submissionId}/rejudge`)
      .set(bearer(authorToken))
      .expect(202);
    expect(rejudge.body.judgeGeneration).toBe(2);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/submissions/${submissionId}`)
          .set(bearer(solver.accessToken))
          .expect(200)
      ).body.sampleTestCases,
    ).toEqual([]);
    await request(app.getHttpServer())
      .patch(`${path}/result`)
      .set(judge(1, secondAttempt))
      .send({ status: 'ACCEPTED', passedTestCases: 2, totalTestCases: 2 })
      .expect(409);
    const thirdAttempt = randomUUID();
    await request(app.getHttpServer())
      .get(path)
      .set(judge(2, thirdAttempt))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${path}/result`)
      .set(judge(2, thirdAttempt))
      .send({ status: 'WRONG_ANSWER', passedTestCases: 0, totalTestCases: 2 })
      .expect(200);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/users/me`)
          .set(bearer(solver.accessToken))
          .expect(200)
      ).body,
    ).toMatchObject({ xp: 0, solvedCount: 0 });

    await request(app.getHttpServer())
      .get(`${base}/admin/ops`)
      .set(bearer(authorToken))
      .expect(403);
    const ops = await request(app.getHttpServer())
      .get(`${base}/admin/ops`)
      .set(bearer(adminToken))
      .expect(200);
    expect(ops.body.queue).toHaveProperty('waiting');
    await request(app.getHttpServer())
      .patch(`${base}/admin/users/${solver.user.id}/role`)
      .set(bearer(adminToken))
      .send({ role: 'AUTHOR' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`${base}/users/me`)
      .set(bearer(solver.accessToken))
      .expect(401);
    const audit = await request(app.getHttpServer())
      .get(`${base}/admin/audit`)
      .set(bearer(adminToken))
      .expect(200);
    expect(
      audit.body.some(
        (event: { action: string }) => event.action === 'user.role',
      ),
    ).toBe(true);
    await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}/status`)
      .set(bearer(authorToken))
      .send({ status: 'ARCHIVED' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`${base}/problems/version-${suffix}`)
      .expect(404);
  });

  afterAll(async () => {
    if (app && submissionId) {
      const queue = app.get<Queue>(getQueueToken(JUDGE_QUEUE));
      for (const generation of [1, 2]) {
        const job = await queue.getJob(`${submissionId}-${generation}`);
        if (job) await job.remove();
      }
    }
    if (problemId) {
      await db.query('DELETE FROM submissions WHERE problem_id = $1', [
        problemId,
      ]);
      await db.query('DELETE FROM problems WHERE id = $1', [problemId]);
    }
    if (userIds.length)
      await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    if (app) await app.close();
  });
});
