import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { JUDGE_QUEUE } from '../src/common/queue.constants.js';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  const userIds: string[] = [];
  let problemId: string | undefined;
  let submissionId: string | undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
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
    const register = async (name: string) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
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
    const other = await register('other');
    await dataSource.query('UPDATE users SET role = $1 WHERE id = $2', [
      'AUTHOR',
      author.user.id,
    ]);
    const authorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: author.user.email, password: 'test-password-123' })
      .expect(200);

    const created = await request(app.getHttpServer())
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${authorLogin.body.accessToken}`)
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
    problemId = created.body.id;
    await dataSource.query(
      "UPDATE problems SET status = 'PUBLISHED' WHERE id = $1",
      [problemId],
    );

    const publicProblem = await request(app.getHttpServer())
      .get(`/api/v1/problems/sum-${suffix}`)
      .expect(200);
    expect(publicProblem.body.samples).toHaveLength(1);
    expect(JSON.stringify(publicProblem.body)).not.toContain('5 7');

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
    const judged = await request(app.getHttpServer())
      .patch(`/api/v1/internal/judge/submissions/${submitted.body.id}/result`)
      .set(judgeHeader)
      .send({
        status: 'ACCEPTED',
        passedTestCases: 2,
        totalTestCases: 2,
        runtimeMs: 8,
        memoryKb: 1024,
      })
      .expect(200);
    expect(judged.body.status).toBe('ACCEPTED');

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
  });

  afterAll(async () => {
    if (app && submissionId) {
      const queue = app.get<Queue>(getQueueToken(JUDGE_QUEUE));
      const job = await queue.getJob(`${submissionId}-1`);
      if (job) await job.remove();
    }
    if (problemId) {
      await dataSource.query('DELETE FROM submissions WHERE problem_id = $1', [
        problemId,
      ]);
      await dataSource.query('DELETE FROM problems WHERE id = $1', [problemId]);
    }
    if (userIds.length) {
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        userIds,
      ]);
    }
    if (app) await app.close();
  });
});
