import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { UserRole } from '../src/modules/users/user-role.enum.js';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('community relationship withdrawal fence (real PostgreSQL)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let postId: string;
  const suffix = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    const owner = await register(app, 'relation_owner', suffix);
    const post = await http().post(`${base}/community/posts`).set(bearer(owner.accessToken))
      .send({ category: 'FREE', title: 'Preserved post', body: 'Relationship fixture' }).expect(201);
    postId = post.body.id;
  });
  afterAll(() => closeApp(app, []));

  for (const kind of ['saved', 'follow'] as const) {
    it(`keeps ${kind} data erased when withdrawal wins before a blocked request`, async () => {
      const session = await register(app, `relation_${kind}`, suffix);
      const token = app.get(JwtService).decode(session.accessToken);
      const actor = {
        id: session.user.id, role: UserRole.USER, tokenVersion: token.tokenVersion, sessionId: token.sid,
      };
      const path = `${base}/community/posts/${postId}/${kind}`;
      await http().put(path).set(bearer(session.accessToken)).expect(200);
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      let pending: Promise<request.Response> | undefined;
      try {
        const [{ pid }]: { pid: number }[] = await runner.query('SELECT pg_backend_pid() AS pid');
        await runner.query('SELECT id FROM community_posts WHERE id=$1 FOR UPDATE', [postId]);
        pending = http().put(path).set(bearer(session.accessToken)).then((response) => response);
        await expect.poll(async () => {
          const [{ blocked }]: { blocked: boolean }[] = await db.query(
            'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) AS blocked',
            [pid],
          );
          return blocked;
        }, { timeout: 2500 }).toBe(true);
        await app.get(AuthService).withdraw(actor, 'test-password-123');
        await runner.commitTransaction();
        expect((await pending).status).toBe(401);
        const table = kind === 'saved' ? 'community_saved' : 'community_follows';
        expect(await db.query(`SELECT user_id FROM ${table} WHERE user_id=$1`, [actor.id])).toEqual([]);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        if (pending) await pending;
      }
    });
  }
});
