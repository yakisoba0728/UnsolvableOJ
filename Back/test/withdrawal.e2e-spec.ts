import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { DataSource, EntityManager } from 'typeorm';
import request from 'supertest';
import { vi } from 'vitest';
import configured from '../src/database/data-source.js';
import { configureHttp } from '../src/configure-http.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { PasswordHasher } from '../src/modules/auth/password-hasher.service.js';
import { UsersModule } from '../src/modules/users/users.module.js';
import { User } from '../src/modules/users/user.entity.js';
import { UserRole } from '../src/modules/users/user-role.enum.js';
import { AdminService } from '../src/modules/admin/admin.service.js';
import { AccountWithdrawal1795600000000 } from '../src/database/migrations/1795600000000-account-withdrawal.js';

describe('withdrawal (real PostgreSQL, authentication, preserved content and races)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let auth: AuthService;
  const ids: string[] = [];
  const password = 'withdraw-password-123';
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              CORS_ORIGIN: 'http://localhost:4173',
              JWT_ACCESS_EXPIRES_IN: '15m',
            }),
          ],
        }),
        TypeOrmModule.forRoot(configured.options),
        AuthModule,
        UsersModule,
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    auth = app.get(AuthService);
  });
  afterAll(async () => {
    if (ids.length)
      await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    await app?.close();
  });
  async function account() {
    const name = `withdraw_${randomUUID().slice(0, 8)}`;
    const session = await auth.register({
      email: `${name}@example.com`,
      username: name,
      password,
    });
    ids.push(session.user.id);
    return session;
  }
  function actor(session: Awaited<ReturnType<typeof account>>) {
    return {
      id: session.user.id,
      role: session.user.role,
      tokenVersion: app.get(JwtService).decode(session.accessToken)
        .tokenVersion,
    };
  }
  function withdraw(
    token: string,
    data: object = { currentPassword: password, confirmation: '회원 탈퇴' },
  ) {
    return request(app.getHttpServer())
      .delete('/api/v1/auth/account')
      .auth(token, { type: 'bearer' })
      .send(data);
  }
  const me = (token: string) =>
    request(app.getHttpServer())
      .get('/api/v1/users/me')
      .auth(token, { type: 'bearer' });
  it('requires authentication, exact confirmation, valid current password and forbids extra fields', async () => {
    const a = await account();
    await withdraw('invalid').expect(401);
    await withdraw(a.accessToken, {
      currentPassword: password,
      confirmation: '탈퇴',
    }).expect(400);
    await withdraw(a.accessToken, {
      currentPassword: password,
      confirmation: '회원 탈퇴',
      id: randomUUID(),
    }).expect(400);
    await withdraw(a.accessToken, {
      currentPassword: 'wrong-password-123',
      confirmation: '회원 탈퇴',
    }).expect(400);
    await me(a.accessToken).expect(200);
  });
  it('anonymizes identity, preserves authored content, revokes every login, excludes profile/rankings and clears invitations', async () => {
    const a = await account(),
      other = await account();
    const second = await auth.login({ email: a.user.email, password });
    // A legacy account may already occupy a deterministic tombstone address.
    const [legacy] = await db.query(
      'INSERT INTO users(email,username,password_hash) VALUES($1,$2,$3) RETURNING id',
      [
        a.user.id + '@deleted.invalid',
        'legacy_' + randomUUID().slice(0, 8),
        'not-a-login-hash',
      ],
    );
    ids.push(legacy.id);
    const [post] = await db.query(
      "INSERT INTO community_posts(author_id,category,title,body) VALUES($1,'FREE','Preserved','Text') RETURNING id",
      [a.user.id],
    );
    const [exam] = await db.query(
      "INSERT INTO enterprise_tests(owner_id,title,starts_at,ends_at,duration_min,problem_ids,invite_code,invite_only,invite_emails,invite_user_ids) VALUES($1,'Exam',now()+interval '1 day',now()+interval '2 day',10,ARRAY[gen_random_uuid()],$2,true,ARRAY[$3]::text[],ARRAY[$4]::uuid[]) RETURNING id",
      [
        other.user.id,
        randomUUID().replaceAll('-', ''),
        a.user.email,
        a.user.id,
      ],
    );
    await withdraw(a.accessToken).expect(204);
    await me(a.accessToken).expect(401);
    await me(second.accessToken).expect(401);
    await expect(
      auth.login({ email: a.user.email, password }),
    ).rejects.toThrow();
    await expect(auth.refresh(a.refreshToken!)).rejects.toThrow();
    await expect(auth.refresh(second.refreshToken!)).rejects.toThrow();
    await request(app.getHttpServer())
      .get(`/api/v1/users/${a.user.username}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/rankings')
      .expect(200)
      .expect(({ body }) =>
        expect(body.some((u: { id: string }) => u.id === a.user.id)).toBe(
          false,
        ),
      );
    const [row] = await db.query('SELECT * FROM users WHERE id=$1', [
      a.user.id,
    ]);
    expect(row.deleted_at).toBeTruthy();
    expect(row.email).toMatch(/@deleted\.invalid$/);
    expect(row.email).not.toBe(a.user.email);
    expect(row.username).toMatch(/^탈퇴한사용자_/);
    expect(row.username).not.toContain(a.user.username);
    expect(
      await app.get(PasswordHasher).verify(password, row.password_hash),
    ).toBe(false);
    const [content] = await db.query(
      'SELECT author_id,body FROM community_posts WHERE id=$1',
      [post.id],
    );
    expect(content).toEqual({ author_id: a.user.id, body: 'Text' });
    const [invite] = await db.query(
      'SELECT invite_emails,invite_user_ids FROM enterprise_tests WHERE id=$1',
      [exam.id],
    );
    expect(invite.invite_emails).toEqual([]);
    expect(invite.invite_user_ids).toEqual([]);
    await me(other.accessToken).expect(200);
    // Re-registering the released email is a new account, with no previous content or invitations.
    const replacement = await auth.register({
      email: a.user.email,
      username: a.user.username,
      password,
    });
    ids.push(replacement.user.id);
    expect(replacement.user.id).not.toBe(a.user.id);
    await withdraw(a.accessToken).expect(401);
  });
  it('blocks administrator withdrawal and temporary-password withdrawal', async () => {
    const a = await account();
    await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [a.user.id]);
    await withdraw(a.accessToken).expect(409);
    await db.query(
      "UPDATE users SET role='USER',must_change_password=true WHERE id=$1",
      [a.user.id],
    );
    await withdraw(a.accessToken).expect(403);
    await db.query('UPDATE users SET must_change_password=false WHERE id=$1', [
      a.user.id,
    ]);
    await withdraw(a.accessToken).expect(204);
  });
  it('cannot be restored by admin role, suspension or temporary-password tools or stale direct writes', async () => {
    const a = await account(),
      adm = await account();
    await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [adm.user.id]);
    const service = new AdminService(
      db,
      {} as never,
      app.get(getRepositoryToken(User)),
      {} as never,
      app.get(PasswordHasher),
    );
    const administrator = { id: adm.user.id, role: UserRole.ADMIN };
    await withdraw(a.accessToken).expect(204);
    await expect(
      service.changeRole(a.user.id, UserRole.ADMIN, administrator),
    ).rejects.toThrow();
    await expect(
      service.changeSuspension(a.user.id, false, administrator),
    ).rejects.toThrow();
    await expect(
      service.issueTemporaryPassword(a.user.id, administrator),
    ).rejects.toThrow();
    await expect(
      db.query(
        "UPDATE users SET deleted_at=NULL,username='Restored' WHERE id=$1",
        [a.user.id],
      ),
    ).rejects.toThrow('Withdrawn account identity');
    await expect(
      auth.changeUsername(a.user.id, { username: 'Restored' }),
    ).rejects.toThrow();
    await expect(
      auth.changePassword(a.user.id, {
        currentPassword: password,
        newPassword: 'new-password-123',
      }),
    ).rejects.toThrow();
  });
  it('serializes duplicate withdrawals with one irreversible transition', async () => {
    const a = await account();
    const responses = await Promise.all([
      withdraw(a.accessToken),
      withdraw(a.accessToken),
    ]);
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      204, 401,
    ]);
    const [row] = await db.query(
      'SELECT token_version FROM users WHERE id=$1',
      [a.user.id],
    );
    expect(row.token_version).toBe(actor(a).tokenVersion + 1);
  });
  it('withdrawal wins before already-started refresh, username change and login without resurrecting identity or sessions', async () => {
    const a = await account();
    const hasher = app.get(PasswordHasher);
    const original = hasher.verify.bind(hasher);
    let release!: () => void, entered!: () => void;
    const paused = new Promise<void>((r) => {
      release = r;
    });
    const locked = new Promise<void>((r) => {
      entered = r;
    });
    let first = true;
    const spy = vi
      .spyOn(hasher, 'verify')
      .mockImplementation(async (candidate, hash) => {
        const valid = await original(candidate, hash);
        if (first) {
          first = false;
          entered();
          await paused;
        }
        return valid;
      });
    try {
      const deleting = auth.withdraw(actor(a), password);
      await locked;
      const attempts = [
        auth.refresh(a.refreshToken!),
        auth.changeUsername(
          a.user.id,
          { username: 'racing_name' },
          undefined,
          actor(a).tokenVersion,
        ),
        auth.login({ email: a.user.email, password }),
      ];
      // All competing requests wait behind the withdrawal's user lock.
      release();
      await deleting;
      const result = await Promise.allSettled(attempts);
      expect(result.every((r) => r.status === 'rejected')).toBe(true);
      await me(a.accessToken).expect(401);
      const [row] = await db.query(
        'SELECT username,deleted_at FROM users WHERE id=$1',
        [a.user.id],
      );
      expect(row.deleted_at).toBeTruthy();
      expect(row.username).toMatch(/^탈퇴한사용자_/);
    } finally {
      release();
      spy.mockRestore();
    }
  });
  it('preserves refresh rotation and same-token concurrency semantics after the lock-order change', async () => {
    const a = await account();
    const results = await Promise.allSettled([
      auth.refresh(a.refreshToken!),
      auth.refresh(a.refreshToken!),
    ]);
    const success = results.filter((r) => r.status === 'fulfilled');
    expect(success).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    if (rejected?.status !== 'rejected')
      throw new Error('Expected a rejected rotation');
    expect(rejected.reason.getStatus()).toBe(409);
    const winner = success[0];
    if (winner.status !== 'fulfilled')
      throw new Error('Expected a successful rotation');
    const next = await auth.refresh(winner.value.refreshToken!);
    await me(next.accessToken).expect(200);
    await db.query(
      'UPDATE users SET token_version=token_version+1 WHERE id=$1',
      [a.user.id],
    );
    await expect(auth.refresh(next.refreshToken!)).rejects.toThrow();
    const [live] = await db.query(
      'SELECT count(*)::int AS count FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL',
      [a.user.id],
    );
    expect(live.count).toBe(0);
  });
  it('password change remains atomic, keeps the new login usable and fences a stale withdrawal', async () => {
    const a = await account();
    const session = await auth.changePassword(
      a.user.id,
      { currentPassword: password, newPassword: 'replacement-password-123' },
      actor(a).tokenVersion,
    );
    await me(session.accessToken).expect(200);
    await me(a.accessToken).expect(401);
    await expect(auth.withdraw(actor(a), password)).rejects.toThrow();
    await expect(
      auth.login({ email: a.user.email, password }),
    ).rejects.toThrow();
    const relogged = await auth.login({
      email: a.user.email,
      password: 'replacement-password-123',
    });
    await me(relogged.accessToken).expect(200);
  });

  it.each(['logout', 'session', 'others'] as const)(
    'revocation %s waits for an in-flight rotation and revokes the successor too',
    async (kind) => {
      const a = await account();
      const retained = await auth.login({ email: a.user.email, password });
      const jwt = app.get(JwtService);
      const family = jwt.decode(a.accessToken).sid;
      const keptFamily = jwt.decode(retained.accessToken).sid;
      // oxlint-disable-next-line typescript/unbound-method -- The spy rebinds the original receiver with call(this).
      const original = EntityManager.prototype.query;
      let release!: () => void, entered!: () => void;
      const held = new Promise<void>((r) => {
        release = r;
      });
      const inserted = new Promise<void>((r) => {
        entered = r;
      });
      let armed = true;
      const spy = vi
        .spyOn(EntityManager.prototype, 'query')
        .mockImplementation(async function (this: EntityManager, sql, params) {
          const result = await original.call(this, sql, params);
          if (
            armed &&
            sql.includes('INSERT INTO refresh_tokens') &&
            params?.[0] === a.user.id
          ) {
            armed = false;
            entered();
            await held;
          }
          return result;
        });
      let refreshing: ReturnType<AuthService['refresh']> | undefined;
      let revoking: Promise<unknown> | undefined;
      try {
        refreshing = auth.refresh(a.refreshToken!);
        await inserted;
        revoking =
          kind === 'logout'
            ? auth.logout(a.refreshToken!)
            : kind === 'session'
              ? auth.revokeSession(a.user.id, family)
              : auth.revokeOtherSessions(a.user.id, keptFamily);
        // Observe the actual blocking database request, rather than relying on a sleep.
        let blocked = false;
        for (let n = 0; n < 150; n++) {
          const [{ count }] = await db.query(
            `SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND (query LIKE '%refresh_tokens%' OR query LIKE '%users%')`,
          );
          if (count) {
            blocked = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 20));
        }
        expect(blocked).toBe(true);
        release();
        const successor = await refreshing;
        await revoking;
        await me(successor.accessToken).expect(401);
        await expect(auth.refresh(successor.refreshToken!)).rejects.toThrow();
        await me(retained.accessToken).expect(200);
      } finally {
        release();
        await Promise.allSettled(
          [refreshing, revoking].filter(
            (promise): promise is Promise<unknown> => promise !== undefined,
          ),
        );
        spy.mockRestore();
      }
    },
  );
  it.each(['logout', 'session', 'others'] as const)(
    'revocation %s before rotation prevents any new successor',
    async (kind) => {
      const a = await account();
      const retained = await auth.login({ email: a.user.email, password });
      const jwt = app.get(JwtService);
      if (kind === 'logout') await auth.logout(a.refreshToken!);
      else if (kind === 'session')
        await auth.revokeSession(a.user.id, jwt.decode(a.accessToken).sid);
      else
        await auth.revokeOtherSessions(
          a.user.id,
          jwt.decode(retained.accessToken).sid,
        );
      await expect(auth.refresh(a.refreshToken!)).rejects.toThrow();
      await me(a.accessToken).expect(401);
      await me(retained.accessToken).expect(200);
    },
  );
  it('refuses migration rollback after any withdrawal, preserving the irreversible tombstone', async () => {
    const a = await account();
    await withdraw(a.accessToken).expect(204);
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await expect(
        new AccountWithdrawal1795600000000().down(runner),
      ).rejects.toThrow('Cannot roll back irreversible');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    await me(a.accessToken).expect(401);
  });
});
