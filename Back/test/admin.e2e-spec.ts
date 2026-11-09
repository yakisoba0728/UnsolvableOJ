import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { suspendedMessage } from '../src/modules/auth/auth.service.js';
import {
  base,
  bearer,
  closeApp,
  createApp,
  login,
  register,
} from './helpers.js';

const password = 'test-password-123';

// 가입 속도 제한(분당 5회)은 앱 인스턴스마다 세므로 이 파일은 자기 앱을 쓰고, 나머지 사용자는 SQL로 넣는다.
describe('Admin console (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  const suffix = randomUUID().slice(0, 8);
  let admin: { user: { id: string; email: string }; accessToken: string };
  let adminToken: string;
  const http = () => request(app.getHttpServer());

  async function makeAdmin(name: string) {
    const body = await register(app, name, suffix);
    await db.query(
      "UPDATE users SET role = 'ADMIN', token_version = token_version + 1 WHERE id = $1",
      [body.user.id],
    );
    return {
      user: body.user as { id: string; email: string },
      accessToken: (await login(app, body.user.email)).accessToken as string,
    };
  }

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    admin = await makeAdmin('console');
    adminToken = admin.accessToken;
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

  it('pages and filters users by name, email, and role', async () => {
    const tag = `pg${suffix}`;
    await db.query(
      `INSERT INTO users(email, username, password_hash, role, created_at)
       SELECT 'Mail' || $1 || n || '@example.com', 'm_' || $1 || '_' || n, 'x',
              CASE WHEN n = 2 THEN 'AUTHOR'::user_role ELSE 'USER'::user_role END,
              '2026-01-01'::timestamptz + n * interval '1 minute'
       FROM generate_series(1, 3) n`,
      [tag],
    );
    const list = async (query: string) =>
      (
        await http()
          .get(`${base}/admin/users?${query}`)
          .set(bearer(adminToken))
          .expect(200)
      ).body;

    const first = await list(`q=${tag}&limit=2`);
    expect(first).toMatchObject({ total: 3, totalPages: 2, limit: 2 });
    expect(first.items.map((u: { username: string }) => u.username)).toEqual([
      `m_${tag}_3`,
      `m_${tag}_2`,
    ]);
    expect(first.items[0]).toMatchObject({
      suspendedAt: null,
      createdAt: expect.any(String),
    });
    expect(first.items[0]).not.toHaveProperty('passwordHash');
    expect(first.items[0]).not.toHaveProperty('tokenVersion');
    const second = await list(
      `q=${tag}&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
    );
    expect(second.items.map((u: { username: string }) => u.username)).toEqual([
      `m_${tag}_1`,
    ]);
    expect(second.nextCursor).toBeNull();

    // 이메일만 맞아도 찾고, 대소문자는 가리지 않는다.
    expect((await list(`q=MAIL${tag.toUpperCase()}1`)).total).toBe(1);
    expect((await list(`q=${tag}&role=AUTHOR`)).items).toEqual([
      expect.objectContaining({ username: `m_${tag}_2`, role: 'AUTHOR' }),
    ]);
    // %·_는 와일드카드가 아니라 글자 그대로 찾는다.
    expect((await list(`q=${encodeURIComponent(`${tag}%`)}`)).total).toBe(0);
    expect((await list(`q=${tag}_`)).total).toBe(3);
    await http()
      .get(`${base}/admin/users?role=OWNER`)
      .set(bearer(adminToken))
      .expect(400);
  });

  it('suspends a user, revokes tokens, blocks login, and audits it', async () => {
    const target = await register(app, 'suspendee', suffix);
    await http()
      .get(`${base}/admin/users`)
      .set(bearer(target.accessToken))
      .expect(403);
    await http()
      .patch(`${base}/admin/users/${admin.user.id}/suspension`)
      .set(bearer(target.accessToken))
      .send({ suspended: true })
      .expect(403);

    const suspended = await http()
      .patch(`${base}/admin/users/${target.user.id}/suspension`)
      .set(bearer(adminToken))
      .send({ suspended: true })
      .expect(200);
    expect(suspended.body).toEqual({
      id: target.user.id,
      suspendedAt: expect.any(String),
    });
    const revoked = await http()
      .get(`${base}/users/me`)
      .set(bearer(target.accessToken))
      .expect(401);
    expect(revoked.body.message).toBe('다시 로그인해야 합니다.');
    const blocked = await http()
      .post(`${base}/auth/login`)
      .send({ email: target.user.email, password })
      .expect(403);
    expect(blocked.body.message).toBe(suspendedMessage);
    // 비밀번호가 틀리면 정지 여부를 알리지 않는다.
    await http()
      .post(`${base}/auth/login`)
      .send({ email: target.user.email, password: 'wrong-password-123' })
      .expect(401);

    // 이미 정지된 계정을 다시 정지해도 기록이 늘지 않는다.
    await http()
      .patch(`${base}/admin/users/${target.user.id}/suspension`)
      .set(bearer(adminToken))
      .send({ suspended: true })
      .expect(200);
    const audit = await http()
      .get(`${base}/admin/audit?action=user.suspend&targetId=${target.user.id}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(audit.body.total).toBe(1);
    expect(audit.body.items[0]).toMatchObject({
      actorId: admin.user.id,
      actorUsername: `console_${suffix}`,
      targetType: 'user',
      targetUsername: `suspendee_${suffix}`,
    });

    await http()
      .patch(`${base}/admin/users/${target.user.id}/suspension`)
      .set(bearer(adminToken))
      .send({ suspended: false })
      .expect(200)
      .expect(({ body }) => expect(body.suspendedAt).toBeNull());
    const again = await login(app, target.user.email);
    await http()
      .get(`${base}/users/me`)
      .set(bearer(again.accessToken))
      .expect(200);
    const history = await http()
      .get(`${base}/admin/audit?targetId=${target.user.id}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(
      history.body.items.map((event: { action: string }) => event.action),
    ).toEqual(['user.unsuspend', 'user.suspend']);
  });

  it('refuses self-suspension, unknown users, and malformed bodies', async () => {
    const self = await http()
      .patch(`${base}/admin/users/${admin.user.id}/suspension`)
      .set(bearer(adminToken))
      .send({ suspended: true })
      .expect(409);
    expect(self.body.message).toBe('자신의 계정을 정지할 수 없습니다.');
    await http()
      .patch(`${base}/admin/users/${randomUUID()}/suspension`)
      .set(bearer(adminToken))
      .send({ suspended: true })
      .expect(404);
    await http()
      .patch(`${base}/admin/users/${admin.user.id}/suspension`)
      .set(bearer(adminToken))
      .send({ suspended: 'yes' })
      .expect(400);
  });

  it('never lets two admins suspend each other at the same time', async () => {
    const other = await makeAdmin('rival');
    const responses = await Promise.all([
      http()
        .patch(`${base}/admin/users/${other.user.id}/suspension`)
        .set(bearer(adminToken))
        .send({ suspended: true }),
      http()
        .patch(`${base}/admin/users/${admin.user.id}/suspension`)
        .set(bearer(other.accessToken))
        .send({ suspended: true }),
    ]);
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.every((status) => [200, 401, 403].includes(status))).toBe(
      true,
    );
    const rows: { suspended: boolean }[] = await db.query(
      'SELECT suspended_at IS NOT NULL AS suspended FROM users WHERE id = ANY($1::uuid[])',
      [[admin.user.id, other.user.id]],
    );
    expect(rows.filter((row) => row.suspended)).toHaveLength(1);
    // 다음 테스트를 위해 되돌린다.
    await db.query(
      'UPDATE users SET suspended_at = NULL WHERE id = ANY($1::uuid[])',
      [[admin.user.id, other.user.id]],
    );
    adminToken = (await login(app, admin.user.email)).accessToken;
  });

  it('pages and filters the audit log by actor and action', async () => {
    const targets: { id: string }[] = await db.query(
      `INSERT INTO users(email, username, password_hash)
       SELECT 'a' || $1 || n || '@example.com', 'a_' || $1 || '_' || n, 'x'
       FROM generate_series(1, 3) n RETURNING id`,
      [`au${suffix}`],
    );
    for (const target of targets)
      await http()
        .patch(`${base}/admin/users/${target.id}/role`)
        .set(bearer(adminToken))
        .send({ role: 'AUTHOR' })
        .expect(200);
    const query = `action=user.role&actorId=${admin.user.id}&limit=2`;
    const first = await http()
      .get(`${base}/admin/audit?${query}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(first.body).toMatchObject({ total: 3, totalPages: 2 });
    const second = await http()
      .get(
        `${base}/admin/audit?${query}&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      )
      .set(bearer(adminToken))
      .expect(200);
    const seen = [...first.body.items, ...second.body.items].map(
      (event: { targetId: string }) => event.targetId,
    );
    expect(seen.sort()).toEqual(targets.map((target) => target.id).sort());
    expect(second.body.nextCursor).toBeNull();
    await http()
      .get(`${base}/admin/audit?actorId=not-a-uuid`)
      .set(bearer(adminToken))
      .expect(400);
  });
});
