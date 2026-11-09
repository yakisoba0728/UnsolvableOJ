import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Queue } from 'bullmq';
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

const judge = (generation: number, attempt: string) => ({
  'X-Judge-Token': 'test-judge-token-with-at-least-32-characters',
  'X-Judge-Generation': String(generation),
  'X-Judge-Attempt': attempt,
});

describe('Judging core: rejudge versions, staff access, test submissions (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let queue: Queue;
  const jobIds: string[] = [];
  const suffix = randomUUID().slice(0, 8);
  let adminToken: string;
  let authorToken: string;
  let otherAuthorToken: string;
  let solver: { accessToken: string; user: { id: string } };
  let author: { user: { id: string; email: string } };

  const http = () => request(app.getHttpServer());
  const createProblem = async (slug: string, expectedOutput = '3\n') => {
    const created = await http()
      .post(`${base}/problems`)
      .set(bearer(authorToken))
      .send({
        slug: `${slug}-${suffix}`,
        title: slug,
        statementMarkdown: 'sum',
        inputDescriptionMarkdown: 'numbers',
        outputDescriptionMarkdown: 'sum',
        difficulty: 'BEGINNER',
        status: 'DRAFT',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testCases: [{ input: '1 2\n', expectedOutput, isSample: true }],
      })
      .expect(201);
    return created.body.id as string;
  };
  const publish = (id: string) =>
    http()
      .patch(`${base}/problems/${id}/status`)
      .set(bearer(adminToken))
      .send({ status: 'PUBLISHED' })
      .expect(200);
  const submit = async (problemId: string, token: string) => {
    const submitted = await http()
      .post(`${base}/problems/${problemId}/submissions`)
      .set(bearer(token))
      .send({ language: 'PYTHON', sourceCode: 'print(3)' })
      .expect(202);
    jobIds.push(`${submitted.body.id}-1`);
    return submitted.body as { id: string; isTest: boolean };
  };
  const finish = async (id: string, generation: number, status: string) => {
    const attempt = randomUUID();
    const claim = await http()
      .get(`${base}/internal/judge/submissions/${id}`)
      .set(judge(generation, attempt))
      .expect(200);
    await http()
      .patch(`${base}/internal/judge/submissions/${id}/result`)
      .set(judge(generation, attempt))
      .send({ status, passedTestCases: 0, totalTestCases: 1 })
      .expect(200);
    return claim.body as { testCases: { expectedOutput: string }[] };
  };
  const me = async () =>
    (await http().get(`${base}/users/me`).set(bearer(solver.accessToken)).expect(200))
      .body as { xp: number; solvedCount: number };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    queue = app.get<Queue>(getQueueToken(JUDGE_QUEUE));
    const admin = await register(app, 'jcadmin', suffix);
    author = await register(app, 'jcauthor', suffix);
    const otherAuthor = await register(app, 'jcother', suffix);
    solver = await register(app, 'jcsolver', suffix);
    await db.query(
      "UPDATE users SET role='ADMIN', token_version=token_version+1 WHERE id=$1",
      [admin.user.id],
    );
    await db.query(
      "UPDATE users SET role='AUTHOR', token_version=token_version+1 WHERE id = ANY($1::uuid[])",
      [[author.user.id, otherAuthor.user.id]],
    );
    adminToken = (await login(app, admin.user.email)).accessToken;
    authorToken = (await login(app, author.user.email)).accessToken;
    otherAuthorToken = (await login(app, otherAuthor.user.email)).accessToken;
  });

  afterAll(() => closeApp(app, jobIds));

  it('rejudges published problems on the current version but keeps the submitted version for unpublished ones', async () => {
    const problemId = await createProblem('rejudge-version', '4\n');
    await publish(problemId);
    const submission = await submit(problemId, solver.accessToken);
    await finish(submission.id, 1, 'WRONG_ANSWER');

    // 작성자가 잘못된 기대 출력을 고치고 관리자가 다시 공개한다.
    await http()
      .patch(`${base}/problems/${problemId}`)
      .set(bearer(authorToken))
      .send({ testCases: [{ input: '1 2\n', expectedOutput: '3\n', isSample: true }] })
      .expect(200);
    // 아직 검수 전(DRAFT)이면 다른 사용자의 결과를 고치지 않은 테스트로 다시 채점한다.
    const draftRejudge = await http()
      .post(`${base}/submissions/${submission.id}/rejudge`)
      .set(bearer(authorToken))
      .expect(202);
    jobIds.push(`${submission.id}-2`);
    expect(draftRejudge.body.problemVersion).toBe(1);
    expect((await finish(submission.id, 2, 'WRONG_ANSWER')).testCases[0].expectedOutput).toBe('4\n');

    await publish(problemId);
    const rejudged = await http()
      .post(`${base}/submissions/${submission.id}/rejudge`)
      .set(bearer(authorToken))
      .expect(202);
    jobIds.push(`${submission.id}-3`);
    expect(rejudged.body).toMatchObject({ problemVersion: 2, judgeGeneration: 3 });
    const claim = await finish(submission.id, 3, 'ACCEPTED');
    expect(claim.testCases[0].expectedOutput).toBe('3\n');
    expect(await me()).toMatchObject({ xp: 10, solvedCount: 1 });
    // 채점이 끝나면 제출자에게 알림이 한 건 생기고, 재채점이 끝날 때마다 다시 안 읽음이 된다.
    const notifications = await http()
      .get(`${base}/notifications`)
      .set(bearer(solver.accessToken))
      .expect(200);
    const judged = notifications.body.items.filter(
      (item: { type: string; submission?: { id: string } }) =>
        item.type === 'JUDGED' && item.submission?.id === submission.id,
    );
    expect(judged).toEqual([
      expect.objectContaining({ readAt: null, submission: expect.objectContaining({ status: 'ACCEPTED' }) }),
    ]);
  });

  it('lets only the problem author and admins list and read other users’ submissions', async () => {
    const problemId = await createProblem('staff-view');
    await publish(problemId);
    const submission = await submit(problemId, solver.accessToken);

    const detail = await http()
      .get(`${base}/submissions/${submission.id}`)
      .set(bearer(authorToken))
      .expect(200);
    expect(detail.body.sourceCode).toBe('print(3)');
    await http()
      .get(`${base}/submissions/${submission.id}`)
      .set(bearer(adminToken))
      .expect(200);
    await http()
      .get(`${base}/submissions/${submission.id}`)
      .set(bearer(otherAuthorToken))
      .expect(404);

    const list = await http()
      .get(`${base}/problems/${problemId}/submissions?status=QUEUED`)
      .set(bearer(authorToken))
      .expect(200);
    expect(list.body.items).toEqual([
      expect.objectContaining({
        id: submission.id,
        user: { id: solver.user.id, username: `jcsolver_${suffix}` },
      }),
    ]);
    expect(list.body.items[0]).not.toHaveProperty('sourceCode');
    await http()
      .get(`${base}/problems/${problemId}/submissions`)
      .set(bearer(otherAuthorToken))
      .expect(403);
    await http()
      .get(`${base}/problems/${problemId}/submissions`)
      .set(bearer(solver.accessToken))
      .expect(403);
    await http()
      .get(`${base}/problems/${problemId}/submissions`)
      .set(bearer(adminToken))
      .expect(200);
  });

  it('accepts author test submissions on drafts without XP, solves, mission progress, stats or history', async () => {
    const problemId = await createProblem('draft-test');
    await http()
      .post(`${base}/problems/${problemId}/submissions`)
      .set(bearer(otherAuthorToken))
      .send({ language: 'PYTHON', sourceCode: 'print(3)' })
      .expect(404);
    await http()
      .post(`${base}/problems/${problemId}/submissions`)
      .set(bearer(solver.accessToken))
      .send({ language: 'PYTHON', sourceCode: 'print(3)' })
      .expect(404);

    const before = (
      await http().get(`${base}/users/me`).set(bearer(authorToken)).expect(200)
    ).body;
    const test = await submit(problemId, authorToken);
    expect(test.isTest).toBe(true);
    await finish(test.id, 1, 'ACCEPTED');
    expect(
      (await http().get(`${base}/users/me`).set(bearer(authorToken)).expect(200)).body,
    ).toMatchObject({ xp: before.xp, solvedCount: before.solvedCount });
    const [row] = await db.query(
      'SELECT accepted_for_xp, completed_for_learning FROM submissions WHERE id=$1',
      [test.id],
    );
    expect(row).toEqual({ accepted_for_xp: false, completed_for_learning: false });
    const mine = await http()
      .get(`${base}/submissions`)
      .set(bearer(authorToken))
      .expect(200);
    expect(mine.body.items.map((item: { id: string }) => item.id)).not.toContain(test.id);
    const missions = await http()
      .get(`${base}/missions`)
      .set(bearer(authorToken))
      .expect(200);
    expect(
      missions.body.items.find((item: { id: string }) => item.id === 'daily').current,
    ).toBe(0);
    const staff = await http()
      .get(`${base}/problems/${problemId}/submissions`)
      .set(bearer(authorToken))
      .expect(200);
    expect(staff.body.items[0]).toMatchObject({ id: test.id, isTest: true });

    await publish(problemId);
    const listed = await http().get(`${base}/problems?limit=1000`).expect(200);
    expect(
      listed.body.items.find((item: { id: string }) => item.id === problemId),
    ).toMatchObject({ solverCount: 0, acceptanceRate: null });
  });

  it('bulk-rejudges a problem 200 at a time behind new submissions, skipping queued ones', async () => {
    const problemId = await createProblem('bulk');
    await publish(problemId);
    const queued = await submit(problemId, solver.accessToken);
    await db.query(
      `INSERT INTO submissions(problem_id, user_id, language, source_code, status, created_at)
       SELECT $1, $2, 'PYTHON', 'print(3)', 'WRONG_ANSWER', now() - interval '1 hour' + n * interval '1 second'
       FROM generate_series(1, 201) n`,
      [problemId, solver.user.id],
    );
    const ids: { id: string }[] = await db.query(
      'SELECT id FROM submissions WHERE problem_id=$1 AND id <> $2 ORDER BY created_at, id',
      [problemId, queued.id],
    );
    jobIds.push(...ids.map(({ id }) => `${id}-2`));

    await http()
      .post(`${base}/problems/${problemId}/rejudge`)
      .set(bearer(otherAuthorToken))
      .send({})
      .expect(403);
    const first = await http()
      .post(`${base}/problems/${problemId}/rejudge`)
      .set(bearer(authorToken))
      .send({})
      .expect(202);
    expect(first.body).toEqual({
      requeued: 200,
      skipped: 0,
      remaining: 2,
      next: ids[199].id,
    });
    const job = await queue.getJob(`${ids[0].id}-2`);
    expect(job?.opts.priority).toBe(10);
    const second = await http()
      .post(`${base}/problems/${problemId}/rejudge`)
      .set(bearer(authorToken))
      .send({ after: first.body.next })
      .expect(202);
    expect(second.body).toEqual({ requeued: 1, skipped: 1, remaining: 0, next: null });
    const [{ count }] = await db.query(
      "SELECT count(*)::int FROM submissions WHERE problem_id=$1 AND status='QUEUED' AND judge_generation=2",
      [problemId],
    );
    expect(count).toBe(201);
    const audit = await db.query(
      "SELECT count(*)::int AS count FROM audit_events WHERE action='problem.rejudge' AND target_id=$1",
      [problemId],
    );
    expect(audit[0].count).toBe(2);
  });

  it('a released lease is requeued on the next generation and uses one recovery up to the cap', async () => {
    const problemId = await createProblem('release');
    await publish(problemId);
    // 앞선 테스트가 남긴 solver의 대기 제출이 대기 상한에 걸리지 않게 관리자로 제출한다.
    const submission = await submit(problemId, adminToken);
    jobIds.push(`${submission.id}-2`);
    const attempt = randomUUID();
    const path = `${base}/internal/judge/submissions/${submission.id}`;
    await http().get(path).set(judge(1, attempt)).expect(200);
    await http().patch(`${path}/release`).set(judge(1, randomUUID())).expect(409);
    await http().patch(`${path}/release`).set(judge(1, attempt)).expect(200);
    await http().patch(`${path}/release`).set(judge(1, attempt)).expect(409);
    const [row] = await db.query(
      'SELECT status, judge_generation, recovery_count FROM submissions WHERE id=$1',
      [submission.id],
    );
    expect(row).toEqual({ status: 'QUEUED', judge_generation: 2, recovery_count: 1 });
    expect(await queue.getJob(`${submission.id}-2`)).toBeTruthy();
    await http().get(path).set(judge(1, randomUUID())).expect(409);

    // 반납이 반복되면 복구 상한에서 멈춘다.
    await db.query('UPDATE submissions SET recovery_count = 5 WHERE id = $1', [submission.id]);
    const last = randomUUID();
    await http().get(path).set(judge(2, last)).expect(200);
    await http().patch(`${path}/release`).set(judge(2, last)).expect(200);
    const [stopped] = await db.query(
      'SELECT status, judge_generation, recovery_count FROM submissions WHERE id=$1',
      [submission.id],
    );
    expect(stopped).toEqual({ status: 'SYSTEM_ERROR', judge_generation: 3, recovery_count: 6 });
    expect(await queue.getJob(`${submission.id}-3`)).toBeFalsy();
  });

  it('caps pending submissions per account and the per-submission judging budget for non-admins', async () => {
    const problemId = await createProblem('pending-cap');
    await publish(problemId);
    const limiter = await register(app, 'jcpending', suffix);
    for (let i = 0; i < 3; i += 1) await submit(problemId, limiter.accessToken);
    const blocked = await http()
      .post(`${base}/problems/${problemId}/submissions`)
      .set(bearer(limiter.accessToken))
      .send({ language: 'PYTHON', sourceCode: 'print(3)' })
      .expect(429);
    expect(blocked.body.message).toContain('3개');
    // 하나가 끝나면 다시 제출할 수 있다.
    await db.query(
      "UPDATE submissions SET status = 'ACCEPTED' WHERE id = (SELECT id FROM submissions WHERE user_id = $1 LIMIT 1)",
      [limiter.user.id],
    );
    await submit(problemId, limiter.accessToken);

    const tooSlow = {
      slug: `budget-${suffix}`,
      title: 'budget',
      statementMarkdown: 'sum',
      inputDescriptionMarkdown: 'numbers',
      outputDescriptionMarkdown: 'sum',
      difficulty: 'BEGINNER',
      timeLimitMs: 30_000,
      testCases: [1, 2, 3].map(() => ({ input: '1 2\n', expectedOutput: '3\n', isSample: false })),
    };
    await http().post(`${base}/problems`).set(bearer(authorToken)).send(tooSlow).expect(400);
    await http().post(`${base}/problems`).set(bearer(adminToken)).send(tooSlow).expect(201);
    await http()
      .patch(`${base}/problems/${problemId}`)
      .set(bearer(authorToken))
      .send({
        timeLimitMs: 60_000,
        testCases: [1, 2].map(() => ({ input: '1 2\n', expectedOutput: '3\n', isSample: true })),
      })
      .expect(400);
    await http()
      .patch(`${base}/problems/${problemId}`)
      .set(bearer(authorToken))
      .send({ timeLimitMs: 60_000 })
      .expect(200);
  });
});
