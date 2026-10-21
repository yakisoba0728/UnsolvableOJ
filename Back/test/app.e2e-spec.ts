import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { closeApp, createApp, login, register } from './helpers.js';

describe('AppController (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let submissionId: string | undefined;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    dataSource = app.get(DataSource);
  });

  it('/api/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('ok');
        expect(body.dependencies).toEqual({ database: 'up', redis: 'up' });
      });
  });

  it('registers users, creates a problem, submits code, and records a judge result', async () => {
    const suffix = randomUUID().slice(0, 8);
    const author = await register(app, 'author', suffix);
    const solver = await register(app, 'solver', suffix);
    const other = await register(app, 'other', suffix);
    await dataSource.query('UPDATE users SET role = $1 WHERE id = $2', [
      'AUTHOR',
      author.user.id,
    ]);
    const authorLogin = await login(app, author.user.email);

    const created = await request(app.getHttpServer())
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${authorLogin.accessToken}`)
      .send({
        slug: `sum-${suffix}`,
        title: 'Sum',
        statementMarkdown: 'Add two numbers.',
        inputDescriptionMarkdown: 'Two integers',
        outputDescriptionMarkdown: 'Their sum',
        difficulty: 'BEGINNER',
        status: 'DRAFT',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testCases: [
          { input: '1 2\n', expectedOutput: '3\n', isSample: true },
          { input: '5 7\n', expectedOutput: '12\n', isSample: false },
        ],
      })
      .expect(201);
    const problemId = created.body.id;
    await dataSource.query(
      "UPDATE problems SET status = 'PUBLISHED' WHERE id = $1",
      [problemId],
    );

    const publicProblem = await request(app.getHttpServer())
      .get(`/api/v1/problems/sum-${suffix}`)
      .expect(200);
    expect(publicProblem.body.samples).toHaveLength(1);
    expect(JSON.stringify(publicProblem.body)).not.toContain('5 7');
    const problemStats = async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/problems?limit=100')
        .expect(200);
      return response.body.items.find(
        (item: { id: string }) => item.id === problemId,
      );
    };
    expect(await problemStats()).toMatchObject({
      solverCount: 0,
      acceptanceRate: null,
    });

    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/problems/${problemId}/submissions`)
      .set('Authorization', `Bearer ${solver.accessToken}`)
      .send({
        language: 'PYTHON',
        sourceCode: 'print(sum(map(int, input().split())))',
      })
      .expect(202);
    expect(submitted.body.status).toBe('QUEUED');
    submissionId = submitted.body.id;
    expect(await problemStats()).toMatchObject({
      solverCount: 0,
      acceptanceRate: null,
    });

    await request(app.getHttpServer())
      .get(`/api/v1/submissions/${submitted.body.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);

    const judgeHeader = {
      'X-Judge-Token': 'test-judge-token-with-at-least-32-characters',
      'X-Judge-Generation': '1',
      'X-Judge-Attempt': randomUUID(),
    };
    const claimed = await request(app.getHttpServer())
      .get(`/api/v1/internal/judge/submissions/${submitted.body.id}`)
      .set(judgeHeader)
      .expect(200);
    expect(claimed.body.testCases).toHaveLength(2);
    expect(
      claimed.body.testCases.map(
        (testCase: { isSample: boolean }) => testCase.isSample,
      ),
    ).toEqual([true, false]);
    const debugOutputs = [
      {
        testCase: 1,
        stdout: '3\n',
        stderr: 'debug message\n',
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    ];
    const judged = await request(app.getHttpServer())
      .patch(`/api/v1/internal/judge/submissions/${submitted.body.id}/result`)
      .set(judgeHeader)
      .send({
        status: 'ACCEPTED',
        passedTestCases: 2,
        totalTestCases: 2,
        runtimeMs: 8,
        memoryKb: 1024,
        debugOutputs,
      })
      .expect(200);
    expect(judged.body.status).toBe('ACCEPTED');
    expect(await problemStats()).toMatchObject({
      solverCount: 1,
      acceptanceRate: 100,
    });
    // Repeated ACs count once per user; infrastructure errors and pending jobs do not lower the rate.
    await dataSource.query(
      `INSERT INTO submissions (user_id, problem_id, language, source_code, status)
       SELECT $1, $2, 'PYTHON', 'print(0)', status::submission_status
       FROM unnest($3::text[]) AS status`,
      [
        solver.user.id,
        problemId,
        [
          'ACCEPTED',
          'WRONG_ANSWER',
          'QUEUED',
          'JUDGING',
          'SYSTEM_ERROR',
          'CANCELLED',
        ],
      ],
    );
    expect(await problemStats()).toMatchObject({
      solverCount: 1,
      acceptanceRate: 66.7,
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/internal/judge/submissions/${submitted.body.id}/result`)
      .set(judgeHeader)
      .send({ status: 'ACCEPTED', passedTestCases: 2, totalTestCases: 2 })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/internal/judge/submissions/${submitted.body.id}/result`)
      .set(judgeHeader)
      .send({ status: 'WRONG_ANSWER', passedTestCases: 0, totalTestCases: 2 })
      .expect(409);

    const mine = await request(app.getHttpServer())
      .get(`/api/v1/submissions/${submitted.body.id}`)
      .set('Authorization', `Bearer ${solver.accessToken}`)
      .expect(200);
    expect(mine.body.sourceCode).toContain('print(sum');
    expect(mine.body.status).toBe('ACCEPTED');
    expect(mine.body.debugOutputs).toEqual(debugOutputs);
    expect(mine.body.sampleTestCases).toEqual([
      { testCase: 1, input: '1 2\n', expectedOutput: '3\n' },
    ]);

    const list = await request(app.getHttpServer())
      .get('/api/v1/submissions')
      .set('Authorization', `Bearer ${solver.accessToken}`)
      .expect(200);
    expect(list.body.items[0]).not.toHaveProperty('debugOutputs');
    expect(list.body.items[0]).not.toHaveProperty('sampleTestCases');
    expect(list.body.items[0]).not.toHaveProperty('sourceCode');

    await request(app.getHttpServer())
      .post(`/api/v1/submissions/${submitted.body.id}/rejudge`)
      .set('Authorization', `Bearer ${authorLogin.accessToken}`)
      .expect(202);
    const requeued = await request(app.getHttpServer())
      .get(`/api/v1/submissions/${submitted.body.id}`)
      .set('Authorization', `Bearer ${solver.accessToken}`)
      .expect(200);
    expect(requeued.body.debugOutputs).toEqual([]);
    expect(await problemStats()).toMatchObject({
      solverCount: 1,
      acceptanceRate: 50,
    });
  });

  afterAll(async () => {
    await closeApp(
      app,
      submissionId ? [`${submissionId}-1`, `${submissionId}-2`] : [],
    );
  });
});
