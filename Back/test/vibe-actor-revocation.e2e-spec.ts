import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource, EntityManager } from 'typeorm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { UserRole } from '../src/modules/users/user-role.enum.js';
import { VibeAi } from '../src/modules/vibe/vibe.ai.js';
import { VibeController } from '../src/modules/vibe/vibe.controller.js';
import { VibeRunner } from '../src/modules/vibe/vibe.runner.js';
import { VibeService } from '../src/modules/vibe/vibe.service.js';
import { challenge, editableFiles } from '../src/modules/vibe/vibe.catalog.js';
import { base, bearer, createApp } from './helpers.js';

describe('Vibe actor revocation after authentication (real PostgreSQL)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  const run = vi.fn<VibeRunner['run']>();
  const assist = vi.fn<VibeAi['assist']>();
  const evaluate = vi.fn<VibeAi['evaluate']>();
  const http = () => request(app.getHttpServer());
  const password = 'vibe-actor-fixture-password';

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    run.mockImplementation(async (_files, final, content) =>
      [...content.publicChecks, ...(final ? content.hiddenChecks : [])].map(
        ({ name }) => ({ name, passed: true }),
      ),
    );
    assist.mockRejectedValue(new Error('No provider calls in this fixture'));
    evaluate.mockRejectedValue(new Error('No provider calls in this fixture'));
    vi.spyOn(app.get(VibeRunner), 'run').mockImplementation(run);
    vi.spyOn(app.get(VibeAi), 'assist').mockImplementation(assist);
    vi.spyOn(app.get(VibeAi), 'evaluate').mockImplementation(evaluate);
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  async function account() {
    const username = `va_${randomUUID().slice(0, 8)}`;
    const session = await app.get(AuthService).register({
      username,
      email: `${username}@example.com`,
      password,
    });
    const payload = app.get(JwtService).decode(session.accessToken);
    return {
      session,
      actor: {
        id: session.user.id,
        role: UserRole.USER,
        tokenVersion: payload.tokenVersion,
        sessionId: payload.sid,
      },
    };
  }

  async function staffAssessment() {
    const owner = await account();
    const candidate = await account();
    const exam = await http()
      .post(`${base}/enterprise/tests`)
      .set(bearer(owner.session.accessToken))
      .send({
        title: 'Vibe staff target withdrawal',
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        durationMin: 30,
        problemIds: [],
        vibeChallengeIds: [challenge.id],
        // A public assessment still retains the withdrawn candidate's workspace.
        inviteOnly: false,
      })
      .expect(201);
    const attempt = await http()
      .post(`${base}/enterprise/join/${exam.body.inviteCode}/start`)
      .set(bearer(candidate.session.accessToken))
      .expect(201);
    const task = await app
      .get(VibeService)
      .startEnterprise(
        attempt.body.id as string,
        challenge.id,
        candidate.actor,
      );
    return {
      owner,
      candidate,
      task,
      examId: attempt.body.id as string,
      path: `${base}/enterprise/tests/${exam.body.id}/attempts/${attempt.body.id}/vibe/${task.id}`,
    };
  }

  it.each(['start', 'edit', 'run', 'enterprise-start'] as const)(
    'rejects %s after an authenticated request waits behind revocation locks',
    async (kind) => {
      const { session, actor } = await account();
      const task =
        kind === 'edit' || kind === 'run'
          ? await app.get(VibeService).start(challenge.id, actor)
          : undefined;
      let examId: string | undefined;
      if (kind === 'enterprise-start') {
        const owner = await account();
        const exam = await http()
          .post(`${base}/enterprise/tests`)
          .set(bearer(owner.session.accessToken))
          .send({
            title: 'Vibe actor revocation',
            startsAt: new Date(Date.now() - 60_000).toISOString(),
            endsAt: new Date(Date.now() + 3_600_000).toISOString(),
            durationMin: 30,
            problemIds: [],
            vibeChallengeIds: [challenge.id],
          })
          .expect(201);
        const attempt = await http()
          .post(`${base}/enterprise/join/${exam.body.inviteCode}/start`)
          .set(bearer(session.accessToken))
          .expect(201);
        examId = attempt.body.id as string;
      }
      const retained = task
        ? await db.query(
            'SELECT state,revision,operation_id,busy_until FROM vibe_attempts WHERE id=$1',
            [task.id],
          )
        : [];
      const lock = db.createQueryRunner();
      await lock.connect();
      await lock.startTransaction();
      let pending: Promise<request.Response> | undefined;
      try {
        const [{ pid }]: { pid: number }[] = await lock.query(
          'SELECT pg_backend_pid() AS pid',
        );
        await lock.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
          actor.id,
        ]);
        if (task)
          await lock.query(
            'SELECT id FROM vibe_attempts WHERE id=$1 FOR UPDATE',
            [task.id],
          );
        if (examId)
          await lock.query(
            'SELECT id FROM enterprise_attempts WHERE id=$1 FOR UPDATE',
            [examId],
          );
        const path =
          kind === 'start'
            ? `${base}/vibe/challenges/${challenge.id}/attempts`
            : kind === 'enterprise-start'
              ? `${base}/enterprise/attempts/${examId!}/vibe/${challenge.id}`
              : `${base}/vibe/attempts/${task!.id}/${kind === 'edit' ? 'files' : 'runs'}`;
        const call = kind === 'edit' ? http().patch(path) : http().post(path);
        pending = call
          .set(bearer(session.accessToken))
          .send(
            kind === 'edit'
              ? {
                  revision: 0,
                  files: { ...editableFiles(), 'src/tags.ts': '// stale edit' },
                }
              : { revision: 0 },
          )
          .then((response) => response);
        await expect
          .poll(
            async () => {
              const [{ blocked }]: { blocked: boolean }[] = await db.query(
                'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) AS blocked',
                [pid],
              );
              return blocked;
            },
            { timeout: 2500 },
          )
          .toBe(true);
        // The real request has passed JWT authentication and is now waiting.
        // Session-only revocation deliberately preserves the account token version.
        await lock.query(
          kind === 'run'
            ? 'UPDATE refresh_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1'
            : 'UPDATE users SET deleted_at=clock_timestamp(),token_version=token_version+1 WHERE id=$1',
          [actor.id],
        );
        await lock.commitTransaction();
        expect((await pending).status).toBe(401);
        if (task) {
          expect(
            await db.query(
              'SELECT state,revision,operation_id,busy_until FROM vibe_attempts WHERE id=$1',
              [task.id],
            ),
          ).toEqual(retained);
          expect(
            await db.query(
              'SELECT revision FROM vibe_revisions WHERE attempt_id=$1',
              [task.id],
            ),
          ).toEqual([{ revision: 0 }]);
        } else {
          expect(
            await db.query('SELECT id FROM vibe_attempts WHERE user_id=$1', [
              actor.id,
            ]),
          ).toEqual([]);
        }
        expect(run).not.toHaveBeenCalled();
        expect(assist).not.toHaveBeenCalled();
        expect(evaluate).not.toHaveBeenCalled();
      } finally {
        if (lock.isTransactionActive) await lock.rollbackTransaction();
        await lock.release();
        if (pending) await pending;
      }
    },
  );

  it('rejects an already authenticated actor after actual account withdrawal', async () => {
    const { actor } = await account();
    await app.get(AuthService).withdraw(actor, password);
    await expect(
      app.get(VibeController).start(challenge.id, actor),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      await db.query('SELECT id FROM vibe_attempts WHERE user_id=$1', [
        actor.id,
      ]),
    ).toEqual([]);
  });

  it.each(['submit', 'evaluate'] as const)(
    'rejects staff %s queued behind actual candidate withdrawal without modifying retained evidence',
    async (kind) => {
      const a = await staffAssessment();
      if (kind === 'evaluate')
        // Seed an unavailable evaluation using the configured executor/AI doubles.
        await app.get(VibeService).run(a.task.id, a.candidate.actor, 0, true);
      await db.query(
        'UPDATE enterprise_attempts SET finished_at=clock_timestamp() WHERE id=$1',
        [a.examId],
      );
      const retained = await db.query(
        'SELECT state,revision,submitted_at,operation_id,busy_until FROM vibe_attempts WHERE id=$1',
        [a.task.id],
      );
      vi.clearAllMocks();

      // Holding the workspace also makes the unfixed implementation wait after
      // its stale reviewContext read, so withdrawal wins deterministically.
      const lock = db.createQueryRunner();
      await lock.connect();
      await lock.startTransaction();
      let releaseWithdrawal!: () => void;
      const paused = new Promise<void>((resolve) => {
        releaseWithdrawal = resolve;
      });
      let withdrawalPid: number | undefined;
      let withdrawalFailure: unknown;
      let withdrawing: Promise<void> | undefined;
      let grading: Promise<request.Response> | undefined;
      // oxlint-disable-next-line typescript/unbound-method -- Restore the original receiver with call(this).
      const original = EntityManager.prototype.query;
      const spy = vi
        .spyOn(EntityManager.prototype, 'query')
        .mockImplementation(async function (this: EntityManager, sql, params) {
          const result = await original.call(this, sql, params);
          if (
            sql.includes('UPDATE users SET deleted_at=clock_timestamp()') &&
            Array.isArray(params) &&
            params[0] === a.candidate.actor.id
          ) {
            const [{ pid }] = (await original.call(
              this,
              'SELECT pg_backend_pid() AS pid',
            )) as { pid: number }[];
            withdrawalPid = pid;
            // The actual withdrawal update and user lock remain uncommitted;
            // a separate reviewContext statement still sees an active owner.
            await paused;
          }
          return result;
        });
      try {
        const [{ pid }]: { pid: number }[] = await lock.query(
          'SELECT pg_backend_pid() AS pid',
        );
        await lock.query(
          'SELECT id FROM vibe_attempts WHERE id=$1 FOR UPDATE',
          [a.task.id],
        );
        withdrawing = app
          .get(AuthService)
          .withdraw(a.candidate.actor, password)
          .catch((error: unknown) => {
            withdrawalFailure = error;
          });
        await expect.poll(() => withdrawalPid, { timeout: 2500 }).toBeDefined();
        grading = http()
          .post(`${a.path}/evaluation`)
          .set(bearer(a.owner.session.accessToken))
          .then((response) => response);
        await expect
          .poll(
            async () => {
              const [{ blocked }]: { blocked: boolean }[] = await db.query(
                `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
                   AND ($1=ANY(pg_blocking_pids(pid)) OR $2=ANY(pg_blocking_pids(pid)))) AS blocked`,
                [pid, withdrawalPid],
              );
              return blocked;
            },
            { timeout: 2500 },
          )
          .toBe(true);
        releaseWithdrawal();
        await withdrawing;
        expect(withdrawalFailure).toBeUndefined();
        expect(
          await db.query(
            'SELECT id FROM users WHERE id=$1 AND deleted_at IS NOT NULL',
            [a.candidate.actor.id],
          ),
        ).toEqual([{ id: a.candidate.actor.id }]);
        await lock.commitTransaction();
        expect((await grading).status).toBe(409);
        expect(
          await db.query(
            'SELECT state,revision,submitted_at,operation_id,busy_until FROM vibe_attempts WHERE id=$1',
            [a.task.id],
          ),
        ).toEqual(retained);
        expect(
          await db.query(
            'SELECT revision FROM vibe_revisions WHERE attempt_id=$1',
            [a.task.id],
          ),
        ).toEqual([{ revision: 0 }]);
        expect(run).not.toHaveBeenCalled();
        expect(assist).not.toHaveBeenCalled();
        expect(evaluate).not.toHaveBeenCalled();
        await http()
          .get(a.path)
          .set(bearer(a.owner.session.accessToken))
          .expect(200)
          .expect(({ body }) => expect(body.canGrade).toBe(false));
      } finally {
        releaseWithdrawal();
        if (lock.isTransactionActive) await lock.rollbackTransaction();
        await lock.release();
        await Promise.allSettled([withdrawing, grading]);
        spy.mockRestore();
      }
    },
    15_000,
  );

  it('lets staff grade a nondeleted candidate without requiring an active candidate account or session', async () => {
    const a = await staffAssessment();
    await db.query(
      'UPDATE enterprise_attempts SET finished_at=clock_timestamp() WHERE id=$1',
      [a.examId],
    );
    await db.query(
      'UPDATE users SET suspended_at=clock_timestamp(),must_change_password=true,token_version=token_version+1 WHERE id=$1',
      [a.candidate.actor.id],
    );
    await db.query(
      'UPDATE refresh_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1',
      [a.candidate.actor.id],
    );
    await http()
      .post(`${a.path}/evaluation`)
      .set(bearer(a.owner.session.accessToken))
      .expect(201)
      .expect(({ body }) => expect(body.report.outcome).toBe(40));
    expect(run).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledOnce();
    expect(assist).not.toHaveBeenCalled();
  });
});
