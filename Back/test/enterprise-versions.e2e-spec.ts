import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('Enterprise problem versions (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let owner: string;
  let candidate: string;
  let other: string;
  let admin: string;
  const jobs: string[] = [];
  const suffix = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());
  const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
  const createProblem = async (name: string) => {
    const { body } = await http().post(`${base}/problems`).set(bearer(owner)).send({
      slug: `versions-${name}-${suffix}`, title: 'original title',
      statementMarkdown: 'original statement', inputDescriptionMarkdown: 'input',
      outputDescriptionMarkdown: 'output', difficulty: 'BEGINNER', isPrivate: true,
      editorialMarkdown: 'staff-only editorial', timeLimitMs: 1000, memoryLimitMb: 128,
      testCases: [
        { input: 'sample input', expectedOutput: 'sample answer', isSample: true },
        { input: 'hidden input', expectedOutput: 'hidden answer', isSample: false },
      ],
    }).expect(201);
    return body.id as string;
  };
  const edit = (id: string) => http().patch(`${base}/problems/${id}`).set(bearer(owner)).send({
    title: 'changed title', statementMarkdown: 'changed statement', timeLimitMs: 2000,
    testCases: [{ input: 'changed sample', expectedOutput: 'changed answer', isSample: true }],
  }).expect(200);
  const exam = async (problemIds: string[], scheduled = false) => {
    const { body } = await http().post(`${base}/enterprise/tests`).set(bearer(owner)).send({
      title: 'fixed assessment', startsAt: minutes(scheduled ? 5 : -1), endsAt: minutes(60),
      durationMin: 30, problemIds,
    }).expect(201);
    return body;
  };
  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    owner = (await register(app, 'verowner', suffix)).accessToken;
    candidate = (await register(app, 'vercand', suffix)).accessToken;
    other = (await register(app, 'verother', suffix)).accessToken;
    const administrator = await register(app, 'veradmin', suffix);
    await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [administrator.user.id]);
    admin = administrator.accessToken;
  });
  afterAll(() => closeApp(app, jobs));

  it('keeps the same statement, samples, limits and judge version for every candidate after source edits', async () => {
    const problemId = await createProblem('fixed');
    const test = await exam([problemId]);
    await edit(problemId);
    const started = await http().post(`${base}/enterprise/join/${test.inviteCode}/start`).set(bearer(candidate)).expect(201);
    const second = await http().post(`${base}/enterprise/join/${test.inviteCode}/start`).set(bearer(other)).expect(201);
    for (const [token, attemptId] of [[candidate, started.body.id], [other, second.body.id]]) {
      const view = await http().get(`${base}/enterprise/attempts/${attemptId}`).set(bearer(token)).expect(200);
      expect(view.body.problems[0]).toMatchObject({
        id: problemId, title: 'original title', statementMarkdown: 'original statement',
        timeLimitMs: 1000, memoryLimitMb: 128, problemVersion: 1,
        samples: [{ input: 'sample input', expectedOutput: 'sample answer' }],
      });
      expect(JSON.stringify(view.body)).not.toContain('hidden input');
      expect(JSON.stringify(view.body)).not.toContain('staff-only editorial');
      const submitted = await http().post(`${base}/enterprise/attempts/${attemptId}/problems/${problemId}/submissions`)
        .set(bearer(token)).send({ language: 'PYTHON', sourceCode: 'print(1)' }).expect(202);
      jobs.push(`${submitted.body.id}-1`);
      expect(submitted.body.problemVersion).toBe(1);
      await db.query("UPDATE submissions SET status='WRONG_ANSWER' WHERE id=$1", [submitted.body.id]);
      await http().post(`${base}/submissions/${submitted.body.id}/rejudge`).set(bearer(owner)).expect(403);
      const rejudged = await http().post(`${base}/submissions/${submitted.body.id}/rejudge`).set(bearer(admin)).expect(202);
      jobs.push(`${submitted.body.id}-2`);
      expect(rejudged.body.problemVersion).toBe(1);
    }
  });

  it('preserves selected versions on ordinary edits and only refreshes them explicitly before start', async () => {
    const problemId = await createProblem('refresh');
    const test = await exam([problemId], true);
    expect(test.problemVersions).toEqual([{ problemId, version: 1 }]);
    await edit(problemId);
    const ordinary = await http().patch(`${base}/enterprise/tests/${test.id}`).set(bearer(owner))
      .send({ title: 'title change', problemIds: [problemId] }).expect(200);
    expect(ordinary.body.problemVersions).toEqual([{ problemId, version: 1 }]);
    await http().patch(`${base}/enterprise/tests/${test.id}`).set(bearer(other))
      .send({ refreshProblemVersions: true }).expect(404);
    const refreshed = await http().patch(`${base}/enterprise/tests/${test.id}`).set(bearer(owner))
      .send({ refreshProblemVersions: true }).expect(200);
    expect(refreshed.body.problemVersions).toEqual([{ problemId, version: 2 }]);
    await db.query("UPDATE enterprise_tests SET starts_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [test.id]);
    await http().patch(`${base}/enterprise/tests/${test.id}`).set(bearer(owner))
      .send({ refreshProblemVersions: true }).expect(409);
    const started = await http().post(`${base}/enterprise/join/${test.inviteCode}/start`).set(bearer(candidate)).expect(201);
    const view = await http().get(`${base}/enterprise/attempts/${started.body.id}`).set(bearer(candidate)).expect(200);
    expect(view.body.problems[0]).toMatchObject({ title: 'changed title', problemVersion: 2 });
  });

  it('preserves chosen order and versions while adding and removing problems', async () => {
    const first = await createProblem('first');
    const second = await createProblem('second');
    const test = await exam([first, second], true);
    await edit(first);
    const reordered = await http().patch(`${base}/enterprise/tests/${test.id}`).set(bearer(owner))
      .send({ problemIds: [second, first] }).expect(200);
    expect(reordered.body.problemVersions).toEqual([{ problemId: second, version: 1 }, { problemId: first, version: 1 }]);
    await http().patch(`${base}/enterprise/tests/${test.id}`).set(bearer(owner))
      .send({ problemIds: [second] }).expect(200);
    const readded = await http().patch(`${base}/enterprise/tests/${test.id}`).set(bearer(owner))
      .send({ problemIds: [first, second] }).expect(200);
    expect(readded.body.problemVersions).toEqual([{ problemId: first, version: 2 }, { problemId: second, version: 1 }]);
  });

  it.each(['invitation', 'deadline'] as const)('rechecks %s after waiting for an assessment edit', async (change) => {
    const problemId = await createProblem(`start-${change}`);
    const test = await exam([problemId]);
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<request.Response> | undefined;
    try {
      const [{ pid }]: { pid: number }[] = await runner.query('SELECT pg_backend_pid() AS pid');
      await runner.query('SELECT id FROM enterprise_tests WHERE id=$1 FOR UPDATE', [test.id]);
      pending = http().post(`${base}/enterprise/join/${test.inviteCode}/start`).set(bearer(candidate)).then((response) => response);
      await expect.poll(async () => {
        const [{ blocked }]: { blocked: boolean }[] = await db.query(
          'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked', [pid],
        );
        return blocked;
      }, { timeout: 2500 }).toBe(true);
      if (change === 'invitation')
        await runner.query("UPDATE enterprise_tests SET invite_only=true, invite_user_ids='{}', invite_emails='{}' WHERE id=$1", [test.id]);
      else
        await runner.query("UPDATE enterprise_tests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1", [test.id]);
      await runner.commitTransaction();
      const response = await pending;
      expect(response.status).toBe(change === 'invitation' ? 404 : 409);
      expect((await db.query('SELECT count(*)::int AS count FROM enterprise_attempts WHERE test_id=$1', [test.id]))[0].count).toBe(0);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      if (pending) await pending;
    }
  });

  it('starts concurrent candidates without changing the shared version binding', async () => {
    const problemId = await createProblem('concurrent');
    const test = await exam([problemId]);
    const results = await Promise.all([candidate, other].map((token) =>
      http().post(`${base}/enterprise/join/${test.inviteCode}/start`).set(bearer(token)).expect(201),
    ));
    expect(new Set(results.map((response) => response.body.id)).size).toBe(2);
    const pinned = await http().get(`${base}/enterprise/tests/${test.id}`).set(bearer(owner)).expect(200);
    expect(pinned.body.problemVersions).toEqual([{ problemId, version: 1 }]);
  });

  it('keeps a refreshed binding when an ordinary edit waited behind the refresh transaction', async () => {
    const problemId = await createProblem('refresh-race');
    const test = await exam([problemId], true);
    await edit(problemId);
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<request.Response> | undefined;
    try {
      const [{ pid }]: { pid: number }[] = await runner.query('SELECT pg_backend_pid() AS pid');
      await runner.query('SELECT id FROM enterprise_tests WHERE id=$1 FOR UPDATE', [test.id]);
      await runner.query('UPDATE enterprise_problem_versions SET version=2 WHERE test_id=$1', [test.id]);
      pending = http().patch(`${base}/enterprise/tests/${test.id}`).set(bearer(owner))
        .send({ title: 'ordinary edit after refresh', problemIds: [problemId] }).then((response) => response);
      await expect.poll(async () => {
        const [{ blocked }]: { blocked: boolean }[] = await db.query(
          'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked', [pid],
        );
        return blocked;
      }, { timeout: 2500 }).toBe(true);
      await runner.commitTransaction();
      const response = await pending;
      expect(response.status).toBe(200);
      expect(response.body.problemVersions).toEqual([{ problemId, version: 2 }]);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      if (pending) await pending;
    }
  });

  it('retains an authorized frozen selection after its public source is unpublished, but refuses a refresh', async () => {
    const problemId = await createProblem('retained-permission');
    // A different author grants access by publishing. The exam preserves that
    // selected revision, never a later private revision or hidden source fields.
    await db.query("UPDATE problems SET status='PUBLISHED',is_private=false,author_id=(SELECT id FROM users WHERE username=$2) WHERE id=$1", [problemId, `verother_${suffix}`]);
    const test = await exam([problemId], true);
    await http().patch(`${base}/problems/${problemId}`).set(bearer(other))
      .send({ title: 'new private revision', isPrivate: true }).expect(200);
    const changed = await http().patch(`${base}/enterprise/tests/${test.id}`).set(bearer(owner))
      .send({ title: 'still valid selection', problemIds: [problemId] }).expect(200);
    expect(changed.body.problemVersions).toEqual([{ problemId, version: 1 }]);
    await http().patch(`${base}/enterprise/tests/${test.id}`).set(bearer(owner))
      .send({ refreshProblemVersions: true }).expect(400);
    const retained = await http().get(`${base}/enterprise/tests/${test.id}`).set(bearer(owner)).expect(200);
    expect(retained.body.problemVersions).toEqual([{ problemId, version: 1 }]);
  });

  it('matches withdrawal user-before-test lock order and rejects a previously authenticated revoked account', async () => {
    const account = await register(app, 'verwithdraw', suffix);
    const problemId = await createProblem('withdrawal');
    const { body: test } = await http().post(`${base}/enterprise/tests`).set(bearer(owner)).send({
      title: 'withdrawal ordering', startsAt: minutes(-1), endsAt: minutes(60), durationMin: 30,
      problemIds: [problemId], inviteOnly: true, invitees: [account.user.username],
    }).expect(201);
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<request.Response> | undefined;
    try {
      const [{ pid }]: { pid: number }[] = await runner.query('SELECT pg_backend_pid() AS pid');
      await runner.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [account.user.id]);
      pending = http().post(`${base}/enterprise/join/${test.inviteCode}/start`).set(bearer(account.accessToken)).then((response) => response);
      await expect.poll(async () => {
        const [{ blocked }]: { blocked: boolean }[] = await db.query(
          'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked', [pid],
        );
        return blocked;
      }, { timeout: 2500 }).toBe(true);
      await runner.query("SET LOCAL lock_timeout='1500ms'");
      // Same row ordering as AuthService.withdraw, with no external effects.
      await runner.query('UPDATE enterprise_tests SET invite_user_ids=array_remove(invite_user_ids,$2::uuid) WHERE id=$1', [test.id, account.user.id]);
      await runner.query('UPDATE users SET deleted_at=clock_timestamp(),token_version=token_version+1 WHERE id=$1', [account.user.id]);
      await runner.commitTransaction();
      expect((await pending).status).toBe(401);
      expect((await db.query('SELECT count(*)::int AS count FROM enterprise_attempts WHERE test_id=$1', [test.id]))[0].count).toBe(0);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      if (pending) await pending;
    }
  });
});
