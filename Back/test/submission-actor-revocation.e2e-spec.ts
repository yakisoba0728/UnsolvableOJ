import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { EnterpriseService } from '../src/modules/enterprise/enterprise.service.js';
import { SubmissionsService } from '../src/modules/submissions/submissions.service.js';
import { SubmissionLanguage } from '../src/modules/submissions/submission.enums.js';
import { UserRole } from '../src/modules/users/user-role.enum.js';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('submission actor revocation after authentication (real PostgreSQL)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let problemId: string;
  let inviteCode: string;
  const suffix = randomUUID().slice(0, 8);
  const jobIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const payload = { language: SubmissionLanguage.PYTHON, sourceCode: 'print(3)' };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    const owner = await register(app, 'actor_owner', suffix);
    const created = await http().post(`${base}/problems`).set(bearer(owner.accessToken)).send({
      slug: `actor-revocation-${suffix}`, title: 'Actor revocation',
      statementMarkdown: 'Print 3.', inputDescriptionMarkdown: '', outputDescriptionMarkdown: '3',
      difficulty: 'BEGINNER', testCases: [{ input: '', expectedOutput: '3', isSample: true }],
    }).expect(201);
    problemId = created.body.id;
    await db.query("UPDATE problems SET status='PUBLISHED' WHERE id=$1", [problemId]);
    const exam = await http().post(`${base}/enterprise/tests`).set(bearer(owner.accessToken)).send({
      title: 'Actor revocation', startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMin: 30, problemIds: [problemId],
    }).expect(201);
    inviteCode = exam.body.inviteCode;
  });
  afterAll(() => closeApp(app, jobIds));

  async function account(role = UserRole.USER) {
    const name = `actor_${randomUUID().slice(0, 8)}`;
    const session = await app.get(AuthService).register({
      email: `${name}@example.com`, username: name, password: 'test-password-123',
    });
    if (role === UserRole.ADMIN)
      await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [session.user.id]);
    const token = app.get(JwtService).decode(session.accessToken);
    const actor = { id: session.user.id, role, tokenVersion: token.tokenVersion, sessionId: token.sid };
    return { session, actor };
  }

  for (const kind of ['ordinary', 'enterprise'] as const) {
    it.each([
      ['password-version', 'UPDATE users SET token_version=token_version+1 WHERE id=$1'],
      ['suspension', 'UPDATE users SET suspended_at=clock_timestamp(),token_version=token_version+1 WHERE id=$1'],
      ['temporary-password', 'UPDATE users SET must_change_password=true,token_version=token_version+1 WHERE id=$1'],
      ['session-only', 'UPDATE refresh_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1'],
    ])(`rejects a ${kind} request when %s revocation commits during its user-lock wait`, async (_, revokeSql) => {
      const { session, actor } = await account();
      const attemptId = kind === 'enterprise'
        ? (await app.get(EnterpriseService).start(inviteCode, actor)).id : null;
      const path = attemptId
        ? `${base}/enterprise/attempts/${attemptId}/problems/${problemId}/submissions`
        : `${base}/problems/${problemId}/submissions`;
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      let pending: Promise<request.Response> | undefined;
      try {
        const [{ pid }]: { pid: number }[] = await runner.query('SELECT pg_backend_pid() AS pid');
        await runner.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
        pending = http().post(path).set(bearer(session.accessToken)).send(payload).then((response) => {
          if (response.body.id) jobIds.push(`${response.body.id}-1`);
          return response;
        });
        await expect.poll(async () => {
          const [{ blocked }]: { blocked: boolean }[] = await db.query(
            'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) AS blocked',
            [pid],
          );
          return blocked;
        }, { timeout: 2500 }).toBe(true);
        await runner.query(revokeSql, [actor.id]);
        await runner.commitTransaction();
        expect((await pending).status).toBe(401);
        expect(await db.query('SELECT id FROM submissions WHERE user_id=$1', [actor.id])).toEqual([]);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        if (pending) await pending;
      }
    });

    it(`rejects a stale ${kind} actor after actual account withdrawal`, async () => {
      const { actor } = await account();
      const attemptId = kind === 'enterprise'
        ? (await app.get(EnterpriseService).start(inviteCode, actor)).id : null;
      await app.get(AuthService).withdraw(actor, 'test-password-123');
      const service = app.get(SubmissionsService);
      const pending = attemptId
        ? service.createForAttempt(attemptId, problemId, payload, actor)
        : service.create(problemId, payload, actor);
      // Keep unexpected baseline jobs removable even if this assertion fails.
      const observed = pending.then((response) => {
        jobIds.push(`${response.id}-1`);
        return response;
      });
      await expect(observed).rejects.toMatchObject({ status: 401 });
      expect(await db.query('SELECT id FROM submissions WHERE user_id=$1', [actor.id])).toEqual([]);
    });
  }

  it('does not exempt an administrator from post-authentication account revalidation', async () => {
    const { actor } = await account(UserRole.ADMIN);
    await db.query("UPDATE users SET role='USER',token_version=token_version+1 WHERE id=$1", [actor.id]);
    const pending = app.get(SubmissionsService).create(problemId, payload, actor).then((response) => {
      jobIds.push(`${response.id}-1`);
      return response;
    });
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(await db.query('SELECT id FROM submissions WHERE user_id=$1', [actor.id])).toEqual([]);
  });
});
