import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('optional-auth password-change visibility', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  type Account = { accessToken: string; user: { id: string } };
  let admin: Account;
  let author: Account;
  let hidden: string;
  let visible: string;
  const suffix = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());
  const pending = (account: Account) =>
    db.query('UPDATE users SET must_change_password=true WHERE id=$1', [
      account.user.id,
    ]);

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    admin = await register(app, 'oa_admin', suffix);
    author = await register(app, 'oa_author', suffix);
    await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [
      admin.user.id,
    ]);
    const createPost = async (title: string) =>
      (
        await http()
          .post(`${base}/community/posts`)
          .set(bearer(author.accessToken))
          .send({ category: 'FREE', title, body: 'visibility fixture' })
          .expect(201)
      ).body.id as string;
    hidden = await createPost(`hidden-optional-${suffix}`);
    visible = await createPost(`public-optional-${suffix}`);
    await db.query('UPDATE community_posts SET hidden_at=now() WHERE id=$1', [
      hidden,
    ]);
  });
  beforeEach(async () => {
    await db.query(
      'UPDATE users SET must_change_password=false WHERE id=ANY($1::uuid[])',
      [[admin.user.id, author.user.id]],
    );
  });
  afterAll(() => closeApp(app, []));

  it('preserves healthy admin and author access while denying anonymous hidden-content reads', async () => {
    await http()
      .get(`${base}/community/posts/${hidden}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    await http()
      .get(`${base}/community/posts/${hidden}`)
      .set(bearer(author.accessToken))
      .expect(200);
    await http().get(`${base}/community/posts/${hidden}`).expect(404);
  });

  it('removes privileged hidden-content visibility from pending-password admins on optional routes', async () => {
    await pending(admin);
    for (const path of ['', '/comments', '/author-stats']) {
      await http()
        .get(`${base}/community/posts/${hidden}${path}`)
        .set(bearer(admin.accessToken))
        .expect(404);
    }
    await http()
      .post(`${base}/community/posts/${hidden}/view`)
      .set(bearer(admin.accessToken))
      .expect(404);
  });

  it('also removes a pending-password author identity from optional routes', async () => {
    await pending(author);
    await http()
      .get(`${base}/community/posts/${hidden}`)
      .set(bearer(author.accessToken))
      .expect(404);
  });

  it('still serves public content anonymously and retains strict password-change enforcement', async () => {
    await pending(admin);
    await http()
      .get(`${base}/community/posts/${visible}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    await http().get(`${base}/community/posts/${visible}`).expect(200);
    await http()
      .get(`${base}/community/posts/${visible}`)
      .set(bearer('invalid-fixture-token'))
      .expect(200);
    await http()
      .get(`${base}/admin/users`)
      .set(bearer(admin.accessToken))
      .expect(403);
  });
});
