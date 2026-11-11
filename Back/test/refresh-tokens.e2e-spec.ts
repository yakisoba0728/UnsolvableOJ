import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

const password = 'test-password-123';
const HOUR_MS = 3_600_000;

// 가입은 앱마다 분당 5회, 로그인은 10회까지라 이 파일은 4명만 만들고 가입 응답의 세션도 쓴다.
describe('Refresh tokens and temporary passwords (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  const suffix = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());
  type Session = {
    accessToken: string;
    refreshToken: string;
    refreshTokenExpiresAt: string;
    remember: boolean;
    user: { id: string; email: string };
  };
  let solverSession: Session;
  let solver: Session['user'];
  let admin: Session['user'];
  let adminSession: Session;
  let remembered: Session;

  const signIn = async (
    email: string,
    extra: object = {},
    secret = password,
  ): Promise<Session> =>
    (
      await http()
        .post(`${base}/auth/login`)
        .send({ email, password: secret, ...extra })
        .expect(200)
    ).body;
  const refresh = (refreshToken: string) =>
    http().post(`${base}/auth/refresh`).send({ refreshToken });
  const tokenRows = (userId: string) =>
    db.query<{ revoked: boolean }[]>(
      'SELECT revoked_at IS NOT NULL AS revoked FROM refresh_tokens WHERE user_id = $1',
      [userId],
    );

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    solverSession = await register(app, 'rot', suffix);
    solver = solverSession.user;
    admin = (await register(app, 'radm', suffix)).user;
    await db.query(
      "UPDATE users SET role = 'ADMIN', token_version = token_version + 1 WHERE id = $1",
      [admin.id],
    );
    adminSession = await signIn(admin.email);
  });

  afterAll(async () => {
    try {
      await db?.query(
        "DELETE FROM users WHERE username LIKE '%' || $1 || '%'",
        [suffix],
      );
    } finally {
      await closeApp(app, []);
    }
  });

  it('issues a 12-hour refresh token by default and 30 days when remembered, storing only its hash', async () => {
    const short = solverSession;
    const long = (remembered = await signIn(solver.email, { remember: true }));
    expect(short).toMatchObject({ remember: false, tokenType: 'Bearer' });
    expect(long.remember).toBe(true);
    const lifetime = (session: Session) =>
      Date.parse(session.refreshTokenExpiresAt) - Date.now();
    expect(lifetime(short)).toBeGreaterThan(11.9 * HOUR_MS);
    expect(lifetime(short)).toBeLessThanOrEqual(12 * HOUR_MS);
    expect(lifetime(long)).toBeGreaterThan(29.9 * 24 * HOUR_MS);
    const [stored] = await db.query<{ count: number }[]>(
      'SELECT count(*)::integer AS count FROM refresh_tokens WHERE token_hash = $1 OR token_hash = $2',
      [short.refreshToken, long.refreshToken],
    );
    expect(stored.count).toBe(0);
    // 가입 때 받은 토큰도 회전된다.
    solverSession = (await refresh(short.refreshToken).expect(200)).body;
  });

  it('rotates on refresh and revokes the whole family when a used token comes back', async () => {
    const first = await signIn(solver.email, { remember: true });
    const second = (await refresh(first.refreshToken).expect(200)).body;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second).toMatchObject({ remember: true, user: { id: solver.id } });
    await http().get(`${base}/users/me`).set(bearer(second.accessToken)).expect(200);

    // 유예(10초)가 지난 뒤 이미 쓴 first를 다시 내면 탈취로 보고, 정상 사용자가 가진 second까지 끊는다.
    await db.query(
      "UPDATE refresh_tokens SET revoked_at = revoked_at - interval '1 minute' WHERE user_id = $1 AND revoked_at IS NOT NULL",
      [solver.id],
    );
    await refresh(first.refreshToken).expect(401);
    await refresh(second.refreshToken).expect(401);
    // 다른 로그인(계열)은 영향을 받지 않는다.
    await refresh(remembered.refreshToken).expect(200).then(({ body }) => {
      remembered = body;
    });
    await refresh('not-a-real-token').expect(401);
  });

  it('answers a token rotated moments ago with 409 and keeps the login when tabs race to refresh', async () => {
    // 로그인은 분당 10회라 새로 로그인하지 않고 remembered 로그인을 쓴다.
    const used = remembered.refreshToken;
    // 잠금 없이 동시에, 또는 앞 탭의 저장이 늦게 보여 잠금 뒤에 같은 토큰을 다시 보내는 경우.
    const racing = await Promise.all([refresh(used), refresh(used)]);
    expect(racing.map((response) => response.status)).toEqual(expect.arrayContaining([200, 409]));
    await refresh(used).expect(409);
    const next = racing.find((response) => response.status === 200)!.body as Session;
    remembered = (await refresh(next.refreshToken).expect(200)).body;
  });

  it('lists login devices without token values and logs out one or all other devices at once', async () => {
    const [a, b, c] = [
      await signIn(solver.email, { remember: true }),
      await signIn(solver.email),
      (await refresh(remembered.refreshToken).expect(200)).body as Session,
    ];
    remembered = c;
    const list = async (token: string) =>
      (await http().get(`${base}/auth/sessions`).set(bearer(token)).expect(200))
        .body as {
        id: string;
        createdAt: string;
        lastUsedAt: string;
        remember: boolean;
        current: boolean;
      }[];
    const devices = await list(a.accessToken);
    expect(devices.length).toBeGreaterThanOrEqual(3);
    expect(devices.filter((device) => device.current)).toHaveLength(1);
    for (const device of devices)
      expect(Object.keys(device).sort()).toEqual(
        ['createdAt', 'current', 'expiresAt', 'id', 'lastUsedAt', 'remember'],
      );
    const serialized = JSON.stringify(devices);
    for (const session of [a, b, c])
      expect(serialized).not.toContain(session.refreshToken);
    // 회전해도 같은 기기(계열)로 남고, 로그인한 시각은 처음 그대로다.
    const ofC = (await list(c.accessToken)).find((device) => device.current)!;
    expect(Date.parse(ofC.createdAt)).toBeLessThan(Date.parse(ofC.lastUsedAt));

    // 남의 로그인은 끊지 못한다(같은 204지만 그대로 유효).
    const current = devices.find((device) => device.current)!;
    await http()
      .delete(`${base}/auth/sessions/${current.id}`)
      .set(bearer(adminSession.accessToken))
      .expect(204);
    await http().get(`${base}/users/me`).set(bearer(a.accessToken)).expect(200);

    // b 기기만 로그아웃: b의 refresh token과 아직 만료되지 않은 access token이 바로 거절된다.
    const ofB = (await list(b.accessToken)).find((device) => device.current)!;
    await http()
      .delete(`${base}/auth/sessions/${ofB.id}`)
      .set(bearer(a.accessToken))
      .expect(204);
    await http().get(`${base}/users/me`).set(bearer(b.accessToken)).expect(401);
    await refresh(b.refreshToken).expect(401);

    // 다른 기기 모두 로그아웃: a만 남는다.
    await http().delete(`${base}/auth/sessions`).set(bearer(a.accessToken)).expect(204);
    await http().get(`${base}/users/me`).set(bearer(c.accessToken)).expect(401);
    expect((await list(a.accessToken)).map((device) => device.current)).toEqual([true]);
    remembered = (await refresh(a.refreshToken).expect(200)).body;
  });

  it('logout revokes the refresh token and answers the same for unknown tokens', async () => {
    await http()
      .post(`${base}/auth/logout`)
      .send({ refreshToken: remembered.refreshToken })
      .expect(204);
    await refresh(remembered.refreshToken).expect(401);
    // 로그아웃한 로그인의 access token도 만료를 기다리지 않고 거절한다.
    await http().get(`${base}/users/me`).set(bearer(remembered.accessToken)).expect(401);
    await http()
      .post(`${base}/auth/logout`)
      .send({ refreshToken: 'unknown-token' })
      .expect(204);
    await http().post(`${base}/auth/logout`).send({}).expect(400);
  });

  it('rejects refresh after a role change or suspension', async () => {
    const roleChanged = await signIn(solver.email);
    await http()
      .patch(`${base}/admin/users/${solver.id}/role`)
      .set(bearer(adminSession.accessToken))
      .send({ role: 'AUTHOR' })
      .expect(200);
    await refresh(roleChanged.refreshToken).expect(401);

    const suspended = await signIn(solver.email);
    await http()
      .patch(`${base}/admin/users/${solver.id}/suspension`)
      .set(bearer(adminSession.accessToken))
      .send({ suspended: true })
      .expect(200);
    await refresh(suspended.refreshToken).expect(401);
    await http()
      .patch(`${base}/admin/users/${solver.id}/suspension`)
      .set(bearer(adminSession.accessToken))
      .send({ suspended: false })
      .expect(200);
    // 정지 해제 뒤에도 정지 전에 발급된 토큰은 되살아나지 않는다.
    await refresh(suspended.refreshToken).expect(401);
  });

  it('password change revokes every refresh token and returns a new one', async () => {
    const current: Session = await register(app, 'rpw', suffix);
    const elsewhere = await signIn(current.user.email, { remember: true });
    const { body: changed } = await http()
      .patch(`${base}/auth/password`)
      .set(bearer(current.accessToken))
      .send({
        currentPassword: password,
        newPassword: 'changed-password-456',
        remember: true,
      })
      .expect(200);
    expect(changed.remember).toBe(true);
    await refresh(current.refreshToken).expect(401);
    await refresh(elsewhere.refreshToken).expect(401);
    await refresh(changed.refreshToken).expect(200);
  });

  it('lets only another ADMIN issue a temporary password, which replaces the old one and ends sessions', async () => {
    const targetSession: Session = await register(app, 'rtmp', suffix);
    const target = targetSession.user;
    const issue = (id: string, token: string) =>
      http()
        .post(`${base}/admin/users/${id}/temporary-password`)
        .set(bearer(token));

    await issue(target.id, targetSession.accessToken).expect(403);
    await issue(admin.id, adminSession.accessToken).expect(409);
    await issue(randomUUID(), adminSession.accessToken).expect(404);

    const { body } = await issue(target.id, adminSession.accessToken).expect(201);
    expect(Object.keys(body)).toEqual(['temporaryPassword']);
    expect(body.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);

    await http()
      .post(`${base}/auth/login`)
      .send({ email: target.email, password })
      .expect(401);
    await http()
      .get(`${base}/users/me`)
      .set(bearer(targetSession.accessToken))
      .expect(401);
    await refresh(targetSession.refreshToken).expect(401);
    expect(await tokenRows(target.id)).toEqual([{ revoked: true }]);
    const fresh = await signIn(target.email, {}, body.temporaryPassword);
    expect(fresh.user).toMatchObject({ id: target.id, mustChangePassword: true });

    // 비밀번호를 바꾸기 전에는 계정 API(비밀번호·로그인 기기) 밖의 요청을 403으로 막는다(401이면 웹이 로그아웃시킨다).
    const me = (token: string) =>
      http().get(`${base}/users/me`).set(bearer(token));
    const blocked = await me(fresh.accessToken).expect(403);
    expect(blocked.body.message).toContain('비밀번호를 먼저 바꿔');
    await http().get(`${base}/auth/sessions`).set(bearer(fresh.accessToken)).expect(200);
    // 갱신해도 표시는 남는다.
    const rotated: Session = (await refresh(fresh.refreshToken).expect(200)).body;
    expect(rotated.user).toMatchObject({ mustChangePassword: true });
    const { body: changed } = await http()
      .patch(`${base}/auth/password`)
      .set(bearer(rotated.accessToken))
      .send({
        currentPassword: body.temporaryPassword,
        newPassword: 'chosen-password-789',
      })
      .expect(200);
    expect(changed.user.mustChangePassword).toBe(false);
    await me(changed.accessToken).expect(200);

    const [audit] = await db.query<{ actor: string; details: object }[]>(
      `SELECT actor_id AS actor, details FROM audit_events
       WHERE action = 'user.temporary_password' AND target_id = $1`,
      [target.id],
    );
    expect(audit).toEqual({ actor: admin.id, details: {} });
  });
});
