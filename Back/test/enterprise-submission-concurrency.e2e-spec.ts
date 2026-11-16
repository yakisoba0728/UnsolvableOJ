import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource, type QueryRunner } from 'typeorm';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('enterprise submission eligibility after lock waits (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let owner: string;
  let candidate: { accessToken: string; user: { id: string; username: string } };
  let problemId: string;
  const suffix = randomUUID().slice(0, 8);
  const jobIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const minutes = (value: number) => new Date(Date.now() + value * 60_000).toISOString();

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    owner = (await register(app, 'atomicowner', suffix)).accessToken;
    candidate = await register(app, 'atomiccandidate', suffix);
    const created = await http().post(`${base}/problems`).set(bearer(owner)).send({
      slug: `atomic-exam-${suffix}`,
      title: 'Atomic exam',
      statementMarkdown: 'Print 3.',
      inputDescriptionMarkdown: 'None.',
      outputDescriptionMarkdown: '3',
      difficulty: 'BEGINNER',
      isPrivate: true,
      testCases: [{ input: '', expectedOutput: '3', isSample: true }],
    }).expect(201);
    problemId = created.body.id;
  });

  afterAll(() => closeApp(app, jobIds));

  async function attempt(inviteOnly = false) {
    const created = await http().post(`${base}/enterprise/tests`).set(bearer(owner)).send({
      title: 'Atomic exam', startsAt: minutes(-10), endsAt: minutes(60),
      durationMin: 30, problemIds: [problemId], vibeChallengeIds: ['post-search-v1'], inviteOnly,
      ...(inviteOnly ? { invitees: [candidate.user.username] } : {}),
    }).expect(201);
    const started = await http().post(`${base}/enterprise/join/${created.body.inviteCode}/start`)
      .set(bearer(candidate.accessToken)).expect(201);
    return { id: started.body.id as string, testId: created.body.id as string };
  }

  function submit(id: string) {
    return http().post(`${base}/enterprise/attempts/${id}/problems/${problemId}/submissions`)
      .set(bearer(candidate.accessToken))
      .send({ language: 'PYTHON', sourceCode: 'print(3)' })
      .then((response) => {
        if (response.body.id) jobIds.push(`${response.body.id}-1`);
        return response;
      });
  }

  async function waitForBlockedRequest(blocker: number) {
    const timeout = Date.now() + 2500;
    while (Date.now() < timeout) {
      const [row]: { blocked: boolean }[] = await db.query(
        'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked',
        [blocker],
      );
      if (row.blocked) return;
      await delay(20);
    }
    throw new Error('Submission did not reach the controlled database lock.');
  }

  async function withBlockedSubmission(
    id: string,
    acquire: (runner: QueryRunner) => Promise<unknown>,
    duringWait: (runner: QueryRunner) => Promise<unknown>,
  ) {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: ReturnType<typeof submit> | undefined;
    try {
      const [{ pid }]: { pid: number }[] = await runner.query('SELECT pg_backend_pid() AS pid');
      await acquire(runner);
      pending = submit(id);
      await waitForBlockedRequest(pid);
      await duringWait(runner);
      await runner.commitTransaction();
      return await pending;
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      if (pending) await pending;
    }
  }

  async function expectNoSubmission(id: string) {
    const [{ count }]: { count: number }[] = await db.query(
      'SELECT count(*)::int AS count FROM submissions WHERE attempt_id=$1', [id],
    );
    expect(count).toBe(0);
  }

  it('rejects a submission when finish commits while it waits on the per-user quota lock', async () => {
    const exam = await attempt();
    const response = await withBlockedSubmission(exam.id,
      (runner) => runner.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [candidate.user.id]),
      () => http().post(`${base}/enterprise/attempts/${exam.id}/finish`).set(bearer(candidate.accessToken)).expect(200),
    );
    expect(response.status).toBe(403);
    await expectNoSubmission(exam.id);
  });

  it('rechecks finish state after waiting on the attempt row itself', async () => {
    const exam = await attempt();
    const response = await withBlockedSubmission(exam.id,
      async (runner) => {
        await runner.query('SELECT id FROM enterprise_attempts WHERE id=$1 FOR UPDATE', [exam.id]);
        await runner.query('UPDATE enterprise_attempts SET finished_at=clock_timestamp() WHERE id=$1', [exam.id]);
      },
      async () => {},
    );
    expect(response.status).toBe(403);
    await expectNoSubmission(exam.id);
  });

  it('uses current time after waiting, even if the transaction began before the deadline', async () => {
    const exam = await attempt();
    await db.query("UPDATE enterprise_attempts SET deadline_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1", [exam.id]);
    const response = await withBlockedSubmission(exam.id,
      (runner) => runner.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [candidate.user.id]),
      () => delay(600),
    );
    expect(response.status).toBe(403);
    await expectNoSubmission(exam.id);
  });

  it('honors an earlier test end as well as the candidate deadline', async () => {
    const exam = await attempt();
    await db.query("UPDATE enterprise_tests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1", [exam.testId]);
    expect((await submit(exam.id)).status).toBe(403);
    await expectNoSubmission(exam.id);
  });

  it('denies an attempt after its invitation is removed', async () => {
    const exam = await attempt(true);
    await db.query("UPDATE enterprise_tests SET invite_user_ids='{}',invite_emails='{}' WHERE id=$1", [exam.testId]);
    expect((await submit(exam.id)).status).toBe(404);
    await expectNoSubmission(exam.id);
  });

  it('does not deadlock the quota lock against a workspace foreign-key check', async () => {
    const exam = await attempt();
    const response = await withBlockedSubmission(exam.id,
      (runner) => runner.query('SELECT id FROM enterprise_attempts WHERE id=$1 FOR UPDATE', [exam.id]),
      (runner) => runner.query(
        `INSERT INTO vibe_attempts(user_id,challenge_id,state,model,enterprise_attempt_id,deadline_at)
         SELECT $1,'post-search-v1',$3::jsonb,'test',id,deadline_at FROM enterprise_attempts WHERE id=$2`,
        [candidate.user.id, exam.id, JSON.stringify({
          files: {}, messages: [], events: [], runs: [], undo: null,
          report: null, aiRequests: 0, evaluations: 0,
        })],
      ),
    );
    expect(response.status).toBe(202);
    expect(response.body.attemptId).toBe(exam.id);
  });
});
