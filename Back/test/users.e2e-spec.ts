import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

// 가입 속도 제한은 앱 인스턴스마다 따로 세므로, 가입이 많은 다른 파일과 앱을 나눈다.
describe('Users (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
  });

  afterAll(() => closeApp(app, []));

  it('reports the overall rank on /users/me with the ranking order, even outside the top 100', async () => {
    const suffix = randomUUID().slice(0, 8);
    // 가입 API는 분당 5회 제한이 있으므로 API로는 한 명만 만들고 나머지는 SQL로 넣는다.
    const me = await register(app, 'rankme', suffix);
    await db.query("UPDATE users SET xp=2000000000, created_at='2026-01-02' WHERE id=$1", [me.user.id]);
    const insert = (name: string, count: number, xp: number, createdAt: string) =>
      db.query(
        `INSERT INTO users(email, username, password_hash, xp, created_at)
         SELECT $1 || '-' || n || '@example.com', $1 || '_' || n, 'x', $3, $4
         FROM generate_series(1, $2::int) n`,
        [`rank${name}_${suffix}`, count, xp, createdAt],
      );
    const rankOf = async () =>
      (
        await request(app.getHttpServer())
          .get(`${base}/users/me`)
          .set(bearer(me.accessToken))
          .expect(200)
      ).body.rank;
    try {
      // 같은 XP면 먼저 가입한 사람이 앞선다.
      await insert('earlier', 1, 2_000_000_000, '2026-01-01');
      await insert('later', 1, 2_000_000_000, '2026-01-03');
      expect(await rankOf()).toBe(2);

      // 101명이 앞서면 랭킹 목록(상위 100명)에는 없어도 순위를 받는다.
      await insert('above', 101, 2_100_000_000, '2026-01-01');
      const rankings = await request(app.getHttpServer()).get(`${base}/rankings`).expect(200);
      expect(rankings.body.some((entry: { id: string }) => entry.id === me.user.id)).toBe(false);
      expect(await rankOf()).toBe(103);
    } finally {
      await db.query("DELETE FROM users WHERE username LIKE 'rank%\\_' || $1 || '\\_%'", [suffix]);
    }
  });
});
