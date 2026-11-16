import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('Owner assessment detail snapshots (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let owner: string;
  let candidate: string;
  let author: string;
  let authorId: string;
  let admin: string;
  const suffix = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());
  const minutes = (value: number) => new Date(Date.now() + value * 60_000).toISOString();
  const selectedKeys = ['difficulty', 'id', 'memoryLimitMb', 'timeLimitMs', 'title', 'version'];
  const publicKeys = ['description', 'durationMin', 'endsAt', 'problemCount', 'startsAt', 'title'];

  async function problem(name: string) {
    const { body } = await http().post(`${base}/problems`).set(bearer(owner)).send({
      slug: `detail-${name}-${suffix}`, title: 'selected original title', difficulty: 'BEGINNER',
      statementMarkdown: 'problem body must not be in the owner summary',
      inputDescriptionMarkdown: 'input', outputDescriptionMarkdown: 'output',
      isPrivate: true, timeLimitMs: 1000, memoryLimitMb: 128,
      editorialMarkdown: 'staff-only editorial',
      testCases: [
        { input: 'sample input', expectedOutput: 'sample output', isSample: true },
        { input: 'private input', expectedOutput: 'private answer', isSample: false },
      ],
    }).expect(201);
    return body.id as string;
  }

  async function assessment(problemId: string) {
    const { body } = await http().post(`${base}/enterprise/tests`).set(bearer(owner)).send({
      title: 'selected summary test', startsAt: minutes(10), endsAt: minutes(60), durationMin: 30,
      problemIds: [problemId],
    }).expect(201);
    return body as { id: string; inviteCode: string };
  }

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    owner = (await register(app, 'sumowner', suffix)).accessToken;
    candidate = (await register(app, 'sumcandidate', suffix)).accessToken;
    const sourceAuthor = await register(app, 'sumauthor', suffix);
    author = sourceAuthor.accessToken;
    authorId = sourceAuthor.user.id;
    const administrator = await register(app, 'sumadmin', suffix);
    await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [administrator.user.id]);
    admin = administrator.accessToken;
  });
  afterAll(() => closeApp(app, []));

  it('returns only whitelisted v2 metadata to owner/admin after the source advances to v3', async () => {
    const id = await problem('revision');
    await http().patch(`${base}/problems/${id}`).set(bearer(owner)).send({
      title: 'selected second title', difficulty: 'HARD', timeLimitMs: 1500, memoryLimitMb: 256,
    }).expect(200);
    const test = await assessment(id);
    await http().patch(`${base}/problems/${id}`).set(bearer(owner)).send({
      title: 'current third title', difficulty: 'EXPERT', timeLimitMs: 3000, memoryLimitMb: 512,
    }).expect(200);

    for (const token of [owner, admin]) {
      const { body } = await http().get(`${base}/enterprise/tests/${test.id}`).set(bearer(token)).expect(200);
      expect(body.problemVersions).toEqual([{ problemId: id, version: 2 }]);
      expect(body.selectedProblems).toEqual([{
        id, version: 2, title: 'selected second title', difficulty: 'HARD', timeLimitMs: 1500, memoryLimitMb: 256,
      }]);
      expect(Object.keys(body.selectedProblems[0]).sort()).toEqual(selectedKeys);
      for (const secret of ['private input', 'private answer', 'staff-only editorial', 'problem body must not be in the owner summary', 'current third title'])
        expect(JSON.stringify(body)).not.toContain(secret);
    }
    // This new projection belongs only to the authorized detail endpoint.
    const listed = await http().get(`${base}/enterprise/tests`).set(bearer(owner)).expect(200);
    expect(listed.body.find((item: { id: string }) => item.id === test.id)).not.toHaveProperty('selectedProblems');
    const results = await http().get(`${base}/enterprise/tests/${test.id}/results`).set(bearer(owner)).expect(200);
    expect(results.body.test).not.toHaveProperty('selectedProblems');
  });

  it('keeps owner detail inaccessible to candidates and leaves the pre-start invitation projection unchanged', async () => {
    const id = await problem('authorization');
    const test = await assessment(id);
    await http().get(`${base}/enterprise/tests/${test.id}`).expect(401);
    for (const token of [candidate, author])
      await http().get(`${base}/enterprise/tests/${test.id}`).set(bearer(token)).expect(404);
    const { body } = await http().get(`${base}/enterprise/join/${test.inviteCode}`).set(bearer(candidate)).expect(200);
    expect(Object.keys(body.test).sort()).toEqual(publicKeys);
    for (const hidden of [id, 'selected original title', 'private input', 'private answer', 'staff-only editorial'])
      expect(JSON.stringify(body)).not.toContain(hidden);
    expect(body.attempt).toBeNull();
  });

  it('retains selected metadata when a different author later makes the source private', async () => {
    const id = await problem('unpublished');
    // Isolated fixture: a source published by another author, then selected.
    await db.query("UPDATE problems SET status='PUBLISHED',is_private=false,author_id=$2 WHERE id=$1", [id, authorId]);
    const test = await assessment(id);
    await http().patch(`${base}/problems/${id}`).set(bearer(author)).send({
      isPrivate: true, title: 'later private source title',
    }).expect(200);
    const { body } = await http().get(`${base}/enterprise/tests/${test.id}`).set(bearer(owner)).expect(200);
    expect(body.selectedProblems).toEqual([{
      id, version: 1, title: 'selected original title', difficulty: 'BEGINNER', timeLimitMs: 1000, memoryLimitMb: 128,
    }]);
    expect(JSON.stringify(body)).not.toContain('later private source title');
    expect(JSON.stringify(body)).not.toContain('private answer');
  });

  it('keeps the header bindings and summaries consistent across a concurrent version refresh', async () => {
    const id = await problem('consistent');
    const test = await assessment(id);
    await http().patch(`${base}/problems/${id}`).set(bearer(owner)).send({ title: 'refreshed second title' }).expect(200);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let paused = false;
    const create = db.createQueryRunner.bind(db);
    const spy = vi.spyOn(db, 'createQueryRunner').mockImplementation((mode) => {
      const runner = create(mode);
      const query = runner.query.bind(runner) as typeof runner.query;
      vi.spyOn(runner, 'query').mockImplementation(async (sql: string, parameters?: unknown[] | Record<string, unknown>, structured?: boolean) => {
        if (!paused && sql.includes('SELECT b.problem_id AS id, b.version,') && Array.isArray(parameters) && parameters[0] === test.id) {
          paused = true;
          await gate;
        }
        return structured ? query(sql, parameters, true) : query(sql, parameters);
      });
      return runner;
    });
    const pending = http().get(`${base}/enterprise/tests/${test.id}`).set(bearer(owner)).then((response) => response);
    try {
      await expect.poll(() => paused, { timeout: 2500 }).toBe(true);
      await http().patch(`${base}/enterprise/tests/${test.id}`).set(bearer(owner))
        .send({ refreshProblemVersions: true }).expect(200);
      release();
      const response = await pending;
      expect(response.status).toBe(200);
      expect(response.body.problemVersions).toEqual([{ problemId: id, version: 1 }]);
      expect(response.body.selectedProblems[0]).toMatchObject({ id, version: 1, title: 'selected original title' });
    } finally {
      release();
      spy.mockRestore();
      await pending;
    }
    const latest = await http().get(`${base}/enterprise/tests/${test.id}`).set(bearer(owner)).expect(200);
    expect(latest.body.problemVersions).toEqual([{ problemId: id, version: 2 }]);
    expect(latest.body.selectedProblems[0]).toMatchObject({ id, version: 2, title: 'refreshed second title' });
  });
});
