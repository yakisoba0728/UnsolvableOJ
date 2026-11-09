import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('Enterprise tests: server storage, invite link, attempts, results (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  const jobIds: string[] = [];
  const suffix = randomUUID().slice(0, 8);
  let owner: string;
  let outsider: string;
  let candidate: { accessToken: string; user: { id: string } };
  let other: string;
  const http = () => request(app.getHttpServer());
  const problem = async (token: string, slug: string, extra: Record<string, unknown> = {}) => {
    const created = await http()
      .post(`${base}/problems`)
      .set(bearer(token))
      .send({
        slug: `${slug}-${suffix}`,
        title: slug,
        statementMarkdown: 'sum',
        inputDescriptionMarkdown: 'numbers',
        outputDescriptionMarkdown: 'sum',
        editorialMarkdown: 'secret editorial',
        difficulty: 'BEGINNER',
        testCases: [
          { input: '1 2\n', expectedOutput: '3\n', isSample: true },
          { input: '5 5\n', expectedOutput: '10\n', isSample: false },
        ],
        ...extra,
      })
      .expect(201);
    return created.body.id as string;
  };
  const submit = (token: string, attemptId: string, problemId: string) =>
    http()
      .post(`${base}/enterprise/attempts/${attemptId}/problems/${problemId}/submissions`)
      .set(bearer(token))
      .send({ language: 'PYTHON', sourceCode: 'print(3)' });
  const minutes = (value: number) => new Date(Date.now() + value * 60_000).toISOString();

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    owner = (await register(app, 'entowner', suffix)).accessToken;
    outsider = (await register(app, 'entoutsider', suffix)).accessToken;
    candidate = await register(app, 'entcand', suffix);
    other = (await register(app, 'entother', suffix)).accessToken;
  });

  afterAll(() => closeApp(app, jobIds));

  it('runs a test from creation through a candidate attempt to owner-only results', async () => {
    const publicProblem = await problem(outsider, 'ent-public');
    await db.query("UPDATE problems SET status = 'PUBLISHED' WHERE id = $1", [publicProblem]);
    const privateProblem = await problem(owner, 'ent-private', { isPrivate: true });
    const othersDraft = await problem(outsider, 'ent-draft');

    const body = {
      title: '백엔드 채용 1차',
      description: '두 문제를 30분 안에 풀어 주세요.',
      startsAt: minutes(-1),
      endsAt: minutes(60),
      durationMin: 30,
      problemIds: [privateProblem, publicProblem],
    };
    await http()
      .post(`${base}/enterprise/tests`)
      .set(bearer(owner))
      .send({ ...body, problemIds: [othersDraft] })
      .expect(400);
    await http()
      .post(`${base}/enterprise/tests`)
      .set(bearer(owner))
      .send({ ...body, durationMin: 120 })
      .expect(400);
    const created = await http().post(`${base}/enterprise/tests`).set(bearer(owner)).send(body).expect(201);
    const test = created.body as { id: string; inviteCode: string };
    expect(test.inviteCode).toMatch(/^[\w-]{16}$/);
    const list = await http().get(`${base}/enterprise/tests`).set(bearer(owner)).expect(200);
    expect(list.body.map((item: { id: string }) => item.id)).toContain(test.id);
    await http().get(`${base}/enterprise/tests/${test.id}`).set(bearer(other)).expect(404);

    // 응시자는 링크로 들어와 시작한다. 시작 전에는 문제를 주지 않는다.
    const info = await http().get(`${base}/enterprise/join/${test.inviteCode}`).set(bearer(candidate.accessToken)).expect(200);
    expect(info.body).toMatchObject({ attempt: null, isOwner: false, test: { problemCount: 2 } });
    expect(info.body.test.problemIds).toBeUndefined();
    await http().get(`${base}/enterprise/join/nope`).set(bearer(candidate.accessToken)).expect(404);
    await http().post(`${base}/enterprise/join/${test.inviteCode}/start`).set(bearer(owner)).expect(403);
    const started = await http()
      .post(`${base}/enterprise/join/${test.inviteCode}/start`)
      .set(bearer(candidate.accessToken))
      .expect(201);
    const again = await http()
      .post(`${base}/enterprise/join/${test.inviteCode}/start`)
      .set(bearer(candidate.accessToken))
      .expect(201);
    expect(again.body.id).toBe(started.body.id);
    const attemptId = started.body.id as string;
    expect(Date.parse(started.body.deadlineAt) - Date.parse(started.body.startedAt)).toBeLessThanOrEqual(30 * 60_000 + 1000);

    const view = await http().get(`${base}/enterprise/attempts/${attemptId}`).set(bearer(candidate.accessToken)).expect(200);
    expect(view.body.problems.map((item: { id: string }) => item.id)).toEqual([privateProblem, publicProblem]);
    expect(view.body.problems[0]).toMatchObject({ samples: [{ input: '1 2\n', expectedOutput: '3\n' }], solved: false });
    expect(JSON.stringify(view.body)).not.toContain('secret editorial');
    expect(JSON.stringify(view.body)).not.toContain('5 5');
    await http().get(`${base}/enterprise/attempts/${attemptId}`).set(bearer(other)).expect(404);

    // 시험 문제에만, 본인만 제출한다. 기업 전용 문제의 일반 제출 경로는 그대로 막힌다.
    const onPrivate = await submit(candidate.accessToken, attemptId, privateProblem).expect(202);
    jobIds.push(`${onPrivate.body.id}-1`);
    expect(onPrivate.body.isTest).toBe(true);
    const onPublic = await submit(candidate.accessToken, attemptId, publicProblem).expect(202);
    jobIds.push(`${onPublic.body.id}-1`);
    await submit(candidate.accessToken, attemptId, othersDraft).expect(404);
    await submit(other, attemptId, privateProblem).expect(404);
    await http()
      .post(`${base}/problems/${privateProblem}/submissions`)
      .set(bearer(candidate.accessToken))
      .send({ language: 'PYTHON', sourceCode: 'print(3)' })
      .expect(404);

    await db.query("UPDATE submissions SET status = 'ACCEPTED' WHERE id = $1", [onPrivate.body.id]);
    await db.query("UPDATE submissions SET status = 'WRONG_ANSWER' WHERE id = $1", [onPublic.body.id]);

    // 공개 문제 작성자는 다른 회사 응시 제출을 보거나 다시 채점하지 못한다.
    const forProblem = await http()
      .get(`${base}/problems/${publicProblem}/submissions`)
      .set(bearer(outsider))
      .expect(200);
    expect(forProblem.body.items.map((item: { id: string }) => item.id)).not.toContain(onPublic.body.id);
    await http().get(`${base}/submissions/${onPublic.body.id}`).set(bearer(outsider)).expect(404);
    await http().post(`${base}/submissions/${onPublic.body.id}/rejudge`).set(bearer(outsider)).expect(403);
    const sourceForOwner = await http().get(`${base}/submissions/${onPublic.body.id}`).set(bearer(owner)).expect(200);
    expect(sourceForOwner.body.sourceCode).toBe('print(3)');

    const results = await http().get(`${base}/enterprise/tests/${test.id}/results`).set(bearer(owner)).expect(200);
    expect(results.body.summary).toEqual({ candidates: 1, averageScore: 50, perfect: 0 });
    expect(results.body.candidates[0]).toMatchObject({ solved: 1, score: 50, user: { id: candidate.user.id } });
    await http().get(`${base}/enterprise/tests/${test.id}/results`).set(bearer(other)).expect(404);
    const mine = await http().get(`${base}/submissions`).set(bearer(candidate.accessToken)).expect(200);
    expect(mine.body.items).toHaveLength(0);

    // 종료하면 더 낼 수 없고, 시작된 테스트는 고치거나 지울 수 없다.
    const finished = await http()
      .post(`${base}/enterprise/attempts/${attemptId}/finish`)
      .set(bearer(candidate.accessToken))
      .expect(200);
    expect(finished.body).toMatchObject({ id: attemptId, finishedAt: expect.any(String) });
    await submit(candidate.accessToken, attemptId, privateProblem).expect(403);
    await http().patch(`${base}/enterprise/tests/${test.id}`).set(bearer(owner)).send({ title: 'x' }).expect(409);
    await http().delete(`${base}/enterprise/tests/${test.id}`).set(bearer(owner)).expect(409);
  });

  it('keeps a scheduled test closed until it starts, and lets the owner edit or delete it', async () => {
    const publicProblem = await problem(outsider, 'ent-later');
    await db.query("UPDATE problems SET status = 'PUBLISHED' WHERE id = $1", [publicProblem]);
    const created = await http()
      .post(`${base}/enterprise/tests`)
      .set(bearer(owner))
      .send({ title: '예정', startsAt: minutes(60), endsAt: minutes(120), durationMin: 30, problemIds: [publicProblem] })
      .expect(201);
    await http()
      .post(`${base}/enterprise/join/${created.body.inviteCode}/start`)
      .set(bearer(other))
      .expect(409);
    const edited = await http()
      .patch(`${base}/enterprise/tests/${created.body.id}`)
      .set(bearer(owner))
      .send({ title: '예정(수정)' })
      .expect(200);
    expect(edited.body.title).toBe('예정(수정)');
    await http().patch(`${base}/enterprise/tests/${created.body.id}`).set(bearer(other)).send({ title: 'x' }).expect(404);
    await http().delete(`${base}/enterprise/tests/${created.body.id}`).set(bearer(owner)).expect(200);
    await http().get(`${base}/enterprise/tests/${created.body.id}`).set(bearer(owner)).expect(404);
  });
});
