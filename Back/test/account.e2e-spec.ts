import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { base, bearer, closeApp, createApp, login, register } from './helpers.js';

// 공개 프로필·랭킹 페이지·계정 설정. 가입은 분당 5회라 추가 사용자는 SQL로 넣는다.
describe('Account (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  const suffix = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
  });

  afterAll(async () => {
    try {
      if (!db) return;
      // 제출→문제→작성자 순으로 지운다(문제·작성자 FK는 RESTRICT). 높은 XP가 남으면 다른 파일의 순위가 바뀐다.
      const problems = `SELECT id FROM problems WHERE slug LIKE '%-' || $1`;
      await db.query(`DELETE FROM submissions WHERE problem_id IN (${problems})`, [suffix]);
      await db.query(`DELETE FROM problems WHERE id IN (${problems})`, [suffix]);
      await db.query('DELETE FROM users WHERE username ILIKE $1', [`%\\_${suffix}`]);
    } finally {
      await closeApp(app, []);
    }
  });

  it('shows a public profile without private fields and lists only public solved problems', async () => {
    const me = await register(app, 'prof', suffix);
    const userId = me.user.id as string;
    await db.query('UPDATE users SET xp=2147000000, level=5 WHERE id=$1', [userId]);
    const solve = async (status: string) => {
      const [p] = await db.query(
        `INSERT INTO problems(slug,title,statement_md,difficulty,status,author_id)
         VALUES($1,$2,'Test','EASY',$3,$4) RETURNING id`,
        [`acct-${status.toLowerCase()}-${suffix}`, `${status} 문제`, status, userId],
      );
      const [s] = await db.query(
        `INSERT INTO submissions(user_id,problem_id,language,source_code,status,accepted_for_xp)
         VALUES($1,$2,'C','int main(){}','ACCEPTED',true) RETURNING id`,
        [userId, p.id],
      );
      await db.query(
        'INSERT INTO user_problem_solves(user_id,problem_id,accepted_submission_id,awarded_xp) VALUES($1,$2,$3,20)',
        [userId, p.id, s.id],
      );
    };
    await solve('PUBLISHED');
    await solve('DRAFT');
    await db.query("INSERT INTO user_badges(user_id,badge) VALUES($1,'night-coder')", [userId]);

    // 이름은 대소문자 없이 찾는다.
    const { body } = await http().get(`${base}/users/PROF_${suffix}`).expect(200);
    expect(body).toMatchObject({
      id: userId,
      username: `prof_${suffix}`,
      level: 5,
      xp: 2147000000,
      solvedCount: 2,
      badges: [{ badge: 'night-coder' }],
      solvedProblems: [{ slug: `acct-published-${suffix}`, difficulty: 'EASY' }],
    });
    expect(body.solvedProblems).toHaveLength(1);
    expect(body.createdAt).toBeTruthy();
    for (const key of ['email', 'role', 'rating', 'passwordHash', 'password_hash', 'tokenVersion'])
      expect(body).not.toHaveProperty(key);

    const mine = await http().get(`${base}/users/me`).set(bearer(me.accessToken)).expect(200);
    expect(body.rank).toBe(mine.body.rank);

    await http().get(`${base}/users/nobody_${suffix}`).expect(404);
  });

  it('pages rankings with the same rank as /users/me and keeps the default top-100 array', async () => {
    await db.query(
      `INSERT INTO users(email, username, password_hash, xp)
       SELECT 'rk' || n || '-' || $1 || '@example.com', 'rk' || n || '_' || $1, 'x', 10 - n
       FROM generate_series(1, 2) n`,
      [suffix],
    );
    const legacy = await http().get(`${base}/rankings`).expect(200);
    expect(Array.isArray(legacy.body)).toBe(true);
    expect(legacy.body.length).toBeLessThanOrEqual(100);

    const [top] = await db.query('SELECT id FROM users ORDER BY xp DESC, created_at ASC, id LIMIT 1');
    const first = await http().get(`${base}/rankings?page=1&limit=2`).expect(200);
    const [{ total }] = await db.query('SELECT count(*)::integer AS total FROM users');
    expect(first.body).toMatchObject({ page: 1, limit: 2, total, totalPages: Math.ceil(total / 2) });
    expect(first.body.items[0]).toMatchObject({ id: top.id, rank: 1 });
    expect(first.body.items[0]).not.toHaveProperty('email');

    const second = await http().get(`${base}/rankings?page=2&limit=1`).expect(200);
    expect(second.body.items[0].id).toBe(first.body.items[1].id);
    expect(second.body.items[0].rank).toBe(first.body.items[1].rank);

    await http().get(`${base}/rankings?limit=101`).expect(400);
    await http().get(`${base}/rankings?page=0`).expect(400);
  });

  it('changes the password with the current one and invalidates other sessions', async () => {
    const first = await register(app, 'pw', suffix);
    const email = `pw-${suffix}@example.com`;
    const other = await login(app, email);
    const change = (token: string, currentPassword: string, newPassword: string) =>
      http().patch(`${base}/auth/password`).set(bearer(token)).send({ currentPassword, newPassword });

    // 틀린 현재 비밀번호는 400이며 세션은 유지된다.
    await change(first.accessToken, 'wrong-password-1', 'new-password-456').expect(400);
    await change(first.accessToken, 'test-password-123', 'short').expect(400);
    await http().get(`${base}/users/me`).set(bearer(other.accessToken)).expect(200);

    const { body } = await change(first.accessToken, 'test-password-123', 'new-password-456').expect(200);
    expect(body.user).toMatchObject({ id: first.user.id });
    await http().get(`${base}/users/me`).set(bearer(first.accessToken)).expect(401);
    await http().get(`${base}/users/me`).set(bearer(other.accessToken)).expect(401);
    await http().get(`${base}/users/me`).set(bearer(body.accessToken)).expect(200);

    await http().post(`${base}/auth/login`).send({ email, password: 'test-password-123' }).expect(401);
    await http().post(`${base}/auth/login`).send({ email, password: 'new-password-456' }).expect(200);
    await http().patch(`${base}/auth/password`).send({ currentPassword: 'x', newPassword: 'new-password-789' }).expect(401);
  });

  it('changes the username under the register rules and case-insensitive uniqueness', async () => {
    const me = await register(app, 'nm', suffix);
    await db.query(
      `INSERT INTO users(email, username, password_hash) VALUES($1, $2, 'x')`,
      [`taken-${suffix}@example.com`, `taken_${suffix}`],
    );
    const rename = (username: string) =>
      http().patch(`${base}/auth/username`).set(bearer(me.accessToken)).send({ username });

    await rename(`TAKEN_${suffix}`).expect(409);
    await rename('BOJ_Import').expect(409);
    // 가입과 같은 형식 검사(이 경로는 분당 5회라 한 가지만 확인한다)
    await rename('no spaces').expect(400);

    // 대소문자만 바꾸는 자기 이름 변경은 허용한다.
    const { body } = await rename(`NM_${suffix}`).expect(200);
    expect(body.user.username).toBe(`NM_${suffix}`);
    expect(body.accessToken).toBeTruthy();
    // 이름 변경은 기존 토큰을 무효화하지 않는다.
    const mine = await http().get(`${base}/users/me`).set(bearer(me.accessToken)).expect(200);
    expect(mine.body.username).toBe(`NM_${suffix}`);

    await rename(`renamed_${suffix}`).expect(200);
    await http().get(`${base}/users/renamed_${suffix}`).expect(200);
    await http().get(`${base}/users/nm_${suffix}`).expect(404);
  });
});
