import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getOptionsToken } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/configure-http.js';
import { notifySubmissionJudged } from '../src/modules/notifications/notifications.service.js';

describe('Community moderation, follow feed and notifications (PostgreSQL e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  // 0: 글쓴이, 1: 답변자, 2: 다른 사용자, 3: 관리자
  const users: { id: string; token: string; email: string }[] = [];
  const problems: string[] = [];
  const base = '/api/v1';
  const call = (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    user = -1,
  ) => {
    const req = request(app.getHttpServer())[method](base + path);
    return user < 0
      ? req
      : req.set('Authorization', `Bearer ${users[user].token}`);
  };
  const posts = '/community/posts';
  const create = async (user = 0, title = '모더레이션 질문') => {
    const res = await call('post', posts, user)
      .send({ category: 'QUESTION', title, body: '본문' })
      .expect(201);
    return res.body.id as string;
  };
  const answer = async (postId: string, user = 1) =>
    (
      await call('post', `${posts}/${postId}/comments`, user)
        .send({ body: '답변' })
        .expect(201)
    ).body.id as string;
  const ids = (body: { items: { id: string }[] }) =>
    body.items.map((item) => item.id);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getOptionsToken())
      .useValue({
        throttlers: [{ name: 'default', ttl: 60000, limit: 100 }],
        skipIf: () => true,
      })
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    for (let i = 0; i < 4; i++) {
      const suffix = randomUUID().slice(0, 8);
      const email = `moderation-${suffix}@example.com`;
      const res = await request(app.getHttpServer())
        .post(`${base}/auth/register`)
        .send({
          email,
          username: `moderation_${suffix}`,
          password: 'test-password-123',
        })
        .expect(201);
      users.push({ id: res.body.user.id, token: res.body.accessToken, email });
    }
    await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [users[3].id]);
    const login = await request(app.getHttpServer())
      .post(`${base}/auth/login`)
      .send({ email: users[3].email, password: 'test-password-123' })
      .expect(200);
    users[3].token = login.body.accessToken;
  });
  afterAll(async () => {
    if (db && users.length) {
      const userIds = users.map((u) => u.id);
      await db.query('DELETE FROM submissions WHERE user_id=ANY($1::uuid[])', [
        userIds,
      ]);
      if (problems.length)
        await db.query('DELETE FROM problems WHERE id=ANY($1::uuid[])', [
          problems,
        ]);
      await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [userIds]);
    }
    if (app) await app.close();
  });

  it('accepts one report per user per target and lets admins list, hide and resolve', async () => {
    const id = await create();
    const commentId = await answer(id);
    const reason = { reason: '광고성 글입니다.' };
    await call('post', `${posts}/${id}/report`).send(reason).expect(401);
    await call('post', `${posts}/${id}/report`, 1)
      .send({ reason: '  ' })
      .expect(400);
    await call('post', `${posts}/${id}/report`, 0).send(reason).expect(400);
    await call('post', `${posts}/${id}/report`, 1).send(reason).expect(201);
    await call('post', `${posts}/${id}/report`, 1).send(reason).expect(409);
    await call('post', `${posts}/${id}/report`, 2).send(reason).expect(201);
    await call('post', `${posts}/${id}/comments/${commentId}/report`, 0)
      .send(reason)
      .expect(201);
    await call('post', `${posts}/${id}/comments/${commentId}/report`, 1)
      .send(reason)
      .expect(400);

    await call('get', '/admin/community/reports', 1).expect(403);
    const open = await call('get', '/admin/community/reports', 3).expect(200);
    const mine = open.body.items.filter(
      (r: { post: { id: string } }) => r.post.id === id,
    );
    expect(mine).toHaveLength(3);
    const commentReport = mine.find(
      (r: { targetType: string }) => r.targetType === 'COMMENT',
    );
    expect(commentReport.comment).toMatchObject({
      id: commentId,
      hidden: false,
    });
    expect(commentReport.author.id).toBe(users[1].id);
    expect(commentReport.reporter.id).toBe(users[0].id);

    // 글 숨김: 공개 목록·상세에서 빠지고, 작성자와 관리자에게만 숨김 표시로 보인다.
    await call('put', `/admin/community/posts/${id}/hidden`, 1).expect(403);
    await call('put', `/admin/community/posts/${id}/hidden`, 3).expect(200);
    await call(
      'put',
      `/admin/community/posts/${randomUUID()}/hidden`,
      3,
    ).expect(404);
    await call('get', `${posts}/${id}`).expect(404);
    await call('get', `${posts}/${id}`, 1).expect(404);
    await call('get', `${posts}/${id}/comments`).expect(404);
    await call('put', `${posts}/${id}/vote`, 1).expect(404);
    await call('post', `${posts}/${id}/comments`, 2)
      .send({ body: '숨긴 글에 답변' })
      .expect(404);
    expect(
      (await call('get', `${posts}/${id}`, 0).expect(200)).body.hidden,
    ).toBe(true);
    expect(
      (await call('get', `${posts}/${id}`, 3).expect(200)).body.hidden,
    ).toBe(true);
    expect(
      ids((await call('get', `${posts}?limit=50`).expect(200)).body),
    ).not.toContain(id);
    const written = (await call('get', `${posts}/mine`, 0).expect(200)).body
      .written;
    expect(written.find((p: { id: string }) => p.id === id).hidden).toBe(true);
    const resolved = await call(
      'get',
      '/admin/community/reports?status=resolved',
      3,
    ).expect(200);
    expect(
      resolved.body.items.filter(
        (r: { post: { id: string }; targetType: string }) =>
          r.post.id === id && r.targetType === 'POST',
      ),
    ).toHaveLength(2);
    const [audit] = await db.query(
      'SELECT actor_id AS "actorId", details FROM audit_events WHERE action=\'community_post.hide\' AND target_id=$1',
      [id],
    );
    expect(audit).toEqual({
      actorId: users[3].id,
      details: { authorId: users[0].id },
    });

    await call('delete', `/admin/community/posts/${id}/hidden`, 3).expect(200);
    expect((await call('get', `${posts}/${id}`).expect(200)).body.hidden).toBe(
      false,
    );

    // 답변 숨김: 답변 수와 공개 답변 목록에서 빠지고, 답변 작성자에게는 숨김 표시로 남는다.
    await call(
      'put',
      `/admin/community/comments/${commentId}/hidden`,
      3,
    ).expect(200);
    const publicComments = await call('get', `${posts}/${id}/comments`).expect(
      200,
    );
    expect(publicComments.body.total).toBe(0);
    expect((await call('get', `${posts}/${id}`)).body.commentCount).toBe(0);
    const own = await call('get', `${posts}/${id}/comments`, 1).expect(200);
    expect(own.body.items).toMatchObject([{ id: commentId, hidden: true }]);
    await call('put', `${posts}/${id}/comments/${commentId}/vote`, 2).expect(
      404,
    );

    await call(
      'put',
      `/admin/community/reports/${randomUUID()}/resolved`,
      3,
    ).expect(404);
    const another = await create(0, '처리만 할 신고');
    await call('post', `${posts}/${another}/report`, 2)
      .send(reason)
      .expect(201);
    const [report] = await db.query(
      'SELECT id FROM community_reports WHERE post_id=$1',
      [another],
    );
    await call(
      'put',
      `/admin/community/reports/${report.id}/resolved`,
      3,
    ).expect(200);
    const [closed] = await db.query(
      'SELECT resolved_at IS NOT NULL AS resolved FROM community_reports WHERE id=$1',
      [report.id],
    );
    expect(closed.resolved).toBe(true);
    expect((await call('get', `${posts}/${another}`)).body.hidden).toBe(false);
  });

  it('rejects votes on your own post or answer but still lets you remove them', async () => {
    const id = await create();
    const own = await answer(id, 0);
    await call('put', `${posts}/${id}/vote`, 0).expect(400);
    await call('put', `${posts}/${id}/comments/${own}/vote`, 0).expect(400);
    await call('delete', `${posts}/${id}/vote`, 0).expect(200);
    await call('delete', `${posts}/${id}/comments/${own}/vote`, 0).expect(200);
    await call('put', `${posts}/${id}/vote`, 1).expect(200);
    await call('put', `${posts}/${id}/comments/${own}/vote`, 1).expect(200);
  });

  it('counts one view per user or IP per day', async () => {
    const id = await create();
    const views = async () => (await call('get', `${posts}/${id}`)).body.views;
    await call('post', `${posts}/${id}/view`).expect(201);
    await call('post', `${posts}/${id}/view`).expect(201);
    expect(await views()).toBe(1);
    await call('post', `${posts}/${id}/view`, 1).expect(201);
    await call('post', `${posts}/${id}/view`, 1).expect(201);
    expect(await views()).toBe(2);
    await db.query(
      "UPDATE community_post_views SET viewed_at=now()-interval '2 days' WHERE post_id=$1",
      [id],
    );
    await call('post', `${posts}/${id}/view`).expect(201);
    expect(await views()).toBe(3);
    await call('post', `${posts}/${randomUUID()}/view`).expect(404);
  });

  it('filters the list to followed authors and shows follower counts', async () => {
    const followed = await create(0, '팔로잉 피드 글');
    const other = await create(2, '팔로우 안 한 글');
    await call('put', `${posts}/${followed}/follow`, 1).expect(200);
    await call('get', `${posts}?following=true`).expect(401);
    await call('get', `${posts}?following=maybe`, 1).expect(400);
    const feed = await call(
      'get',
      `${posts}?following=true&limit=50`,
      1,
    ).expect(200);
    expect(ids(feed.body)).toContain(followed);
    expect(ids(feed.body)).not.toContain(other);
    expect(
      feed.body.items.every(
        (p: { authorId: string }) => p.authorId === users[0].id,
      ),
    ).toBe(true);
    const stats = await call('get', `${posts}/${followed}/author-stats`).expect(
      200,
    );
    expect(stats.body).toMatchObject({ followers: 1, following: 0 });
    const follower = await call('get', `${posts}/${other}/author-stats`).expect(
      200,
    );
    expect(follower.body.following).toBe(0);
    await call('put', `${posts}/${other}/follow`, 0).expect(200);
    expect(
      (await call('get', `${posts}/${other}/author-stats`)).body.followers,
    ).toBe(1);
    expect(
      (await call('get', `${posts}/${followed}/author-stats`)).body.following,
    ).toBe(1);
  });

  it('notifies answers, acceptance and finished judging with paging and read state', async () => {
    await call('get', '/notifications').expect(401);
    await call('put', '/notifications/read-all', 0).expect(200);
    const id = await create(0, '알림 질문');
    await answer(id, 0); // 내 글에 내가 단 답변은 알리지 않는다.
    const commentId = await answer(id, 1);
    let list = await call('get', '/notifications', 0).expect(200);
    expect(list.body.unread).toBe(1);
    expect(list.body.items[0]).toMatchObject({
      type: 'ANSWER',
      readAt: null,
      commentId,
      actor: { id: users[1].id },
      post: { id, title: '알림 질문' },
      submission: null,
    });

    for (let i = 0; i < 2; i++) {
      await call(
        'put',
        `${posts}/${id}/accepted-answer/${commentId}`,
        0,
      ).expect(200);
      await call('delete', `${posts}/${id}/accepted-answer`, 0).expect(200);
    }
    list = await call('get', '/notifications', 1).expect(200);
    expect(
      list.body.items.filter((n: { type: string }) => n.type === 'ACCEPTED'),
    ).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      type: 'ACCEPTED',
      actor: { id: users[0].id },
      post: { id },
    });

    const [problem]: { id: string }[] = await db.query(
      `INSERT INTO problems(slug,title,statement_md,difficulty,status,author_id)
      VALUES($1,'알림 문제','내용','BEGINNER','PUBLISHED',$2) RETURNING id`,
      [`notify-${randomUUID()}`, users[3].id],
    );
    problems.push(problem.id);
    const [submission]: { id: string }[] = await db.query(
      `INSERT INTO submissions(user_id,problem_id,language,source_code,status)
      VALUES($1,$2,'PYTHON','print(1)','WRONG_ANSWER') RETURNING id`,
      [users[2].id, problem.id],
    );
    await notifySubmissionJudged(db.manager, submission.id);
    await call('put', '/notifications/read-all', 2).expect(200);
    // 재채점이 끝나면 같은 알림을 다시 안 읽음으로 올린다.
    await notifySubmissionJudged(db.manager, submission.id);
    list = await call('get', '/notifications', 2).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.unread).toBe(1);
    expect(list.body.items[0]).toMatchObject({
      type: 'JUDGED',
      actor: null,
      post: null,
      submission: {
        id: submission.id,
        status: 'WRONG_ANSWER',
        problemTitle: '알림 문제',
      },
    });

    const notificationId = list.body.items[0].id as string;
    await call('put', `/notifications/${notificationId}/read`, 0).expect(404);
    expect(
      (
        await call('put', `/notifications/${notificationId}/read`, 2).expect(
          200,
        )
      ).body,
    ).toEqual({ unread: 0 });
    expect(
      (await call('get', '/notifications/unread-count', 2).expect(200)).body,
    ).toEqual({ unread: 0 });

    for (let i = 0; i < 3; i++) await answer(id, 2);
    const paged = await call('get', '/notifications?page=2&limit=2', 0).expect(
      200,
    );
    // 첫 테스트의 답변 알림(읽음) 1개 + 이 테스트의 답변 알림 4개
    expect(paged.body).toMatchObject({
      total: 5,
      unread: 4,
      page: 2,
      limit: 2,
      totalPages: 3,
    });
    expect(paged.body.items).toHaveLength(2);
    await call('get', '/notifications?limit=51', 0).expect(400);
    await call('put', '/notifications/read-all', 0).expect(200);
    expect(
      (await call('get', '/notifications/unread-count', 0)).body.unread,
    ).toBe(0);
  });
});
