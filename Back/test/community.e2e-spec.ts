import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getOptionsToken } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/configure-http.js';

describe('Community (PostgreSQL e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  const users: { id: string; token: string; email: string }[] = [];
  const problems: string[] = [];
  const posts: string[] = [];
  const base = '/api/v1/community/posts';
  const draft = {
    category: 'QUESTION',
    title: '반복문 질문',
    body: '접근 방법을 알려주세요.',
  };
  const call = (
    method: 'get' | 'post' | 'put' | 'delete',
    path = '',
    user = -1,
  ) => {
    const req = request(app.getHttpServer())[method](base + path);
    return user < 0
      ? req
      : req.set('Authorization', `Bearer ${users[user].token}`);
  };
  const create = async (values: object = {}, user = 0) => {
    const res = await call('post', '', user)
      .send({ ...draft, ...values })
      .expect(201);
    posts.push(res.body.id as string);
    return res.body.id as string;
  };
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
    await app.init();
    db = app.get(DataSource);
    for (let i = 0; i < 3; i++) {
      const suffix = randomUUID().slice(0, 8);
      const email = `community-${suffix}@example.com`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          username: `community_${suffix}`,
          password: 'test-password-123',
        })
        .expect(201);
      users.push({ id: res.body.user.id, token: res.body.accessToken, email });
    }
    await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [users[2].id]);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: users[2].email, password: 'test-password-123' })
      .expect(200);
    users[2].token = login.body.accessToken;
    for (const status of ['PUBLISHED', 'DRAFT']) {
      const [problem]: { id: string }[] = await db.query(
        `INSERT INTO problems(slug,title,statement_md,difficulty,status,author_id)
        VALUES($1,'커뮤니티 연결 문제','문제 내용','BEGINNER',$2,$3) RETURNING id`,
        [`community-${randomUUID()}`, status, users[2].id],
      );
      problems.push(problem.id);
    }
  });
  afterAll(async () => {
    if (db) {
      if (posts.length)
        await db.query('DELETE FROM community_posts WHERE id=ANY($1::uuid[])', [
          posts,
        ]);
      if (problems.length)
        await db.query('DELETE FROM problems WHERE id=ANY($1::uuid[])', [
          problems,
        ]);
      if (users.length)
        await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [
          users.map((u) => u.id),
        ]);
    }
    if (app) await app.close();
  });

  it('validates all four categories, review code, solution problem, and publication status', async () => {
    await call('post').send(draft).expect(401);
    for (const values of [
      { title: '  ' },
      { body: '' },
      { category: 'UNKNOWN' },
      { category: 'REVIEW' },
      { category: 'SOLUTION' },
      { problemId: problems[1] },
      { problemId: randomUUID() },
      { authorId: users[1].id },
      { code: 'x'.repeat(30001) },
    ])
      await call('post', '', 0)
        .send({ ...draft, ...values })
        .expect(400);
    for (const category of ['QUESTION', 'SOLUTION', 'REVIEW', 'FREE']) {
      const id = await create({
        category,
        code: 'print(3)',
        language: 'Python',
        problemId: problems[0],
      });
      const res = await call('get', `/${id}`).expect(200);
      expect(res.body.author).not.toHaveProperty('email');
      expect(res.body.author).not.toHaveProperty('passwordHash');
      expect(res.body.problem.id).toBe(problems[0]);
    }
    await call('get', '?page=0').expect(400);
    await call('get', '?limit=51').expect(400);
    await call('get', '/invalid-uuid').expect(400);
  });

  it('filters, searches and paginates without returning full source in lists', async () => {
    const marker = randomUUID();
    await create({
      category: 'FREE',
      title: `검색 ${marker}`,
      code: 'private preview',
      body: '100% test',
    });
    await create({ category: 'FREE', title: `검색 ${marker} 두번째` });
    const res = await call('get', `?category=FREE&q=${marker}&limit=1`).expect(
      200,
    );
    expect(res.body.total).toBe(2);
    expect(res.body.totalPages).toBe(2);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).not.toHaveProperty('code');
    const next = await call(
      'get',
      `?category=FREE&q=${marker}&limit=1&page=2`,
    ).expect(200);
    expect(next.body.items[0].id).not.toBe(res.body.items[0].id);
    const linked = await call('get', `?problemId=${problems[0]}`).expect(200);
    expect(linked.body.total).toBe(4);
    const injection = await call('get', '?q=%27%20OR%201%3D1--').expect(200);
    expect(injection.body.total).toBe(0);
  });

  it('enforces ownership and allows admin deletion but not editing', async () => {
    const id = await create();
    await call('put', `/${id}`, 1).send(draft).expect(403);
    await call('put', `/${id}`, 2).send(draft).expect(403);
    await call('delete', `/${id}`, 1).expect(403);
    await call('put', `/${id}`, 0)
      .send({ ...draft, category: 'FREE' })
      .expect(400);
    await call('put', `/${id}`, 0)
      .send({ ...draft, title: '수정한 제목' })
      .expect(200);
    const res = await call('get', `/${id}`).expect(200);
    expect(res.body.title).toBe('수정한 제목');
    await call('delete', `/${id}`, 2).expect(200);
    await call('get', `/${id}`).expect(404);
    expect(
      await db.query(
        'SELECT actor_id AS "actorId", action FROM audit_events WHERE target_id=$1',
        [id],
      ),
    ).toEqual([{ actorId: users[2].id, action: 'community_post.delete' }]);
  });

  it('accepts only answers to the same question and clears acceptance when deleted', async () => {
    const id = await create();
    const other = await create();
    const free = await create({ category: 'FREE' });
    const response = await call('post', `/${id}/comments`, 1)
      .send({ body: '이 방법으로 풀어보세요.' })
      .expect(201);
    const commentId = response.body.id;
    await call('put', `/${other}/accepted-answer/${commentId}`, 0).expect(404);
    await call('put', `/${id}/accepted-answer/${commentId}`, 1).expect(403);
    await call('put', `/${free}/accepted-answer/${commentId}`, 0).expect(400);
    await call('put', `/${id}/accepted-answer/${commentId}`, 0).expect(200);
    expect((await call('get', `/${id}`)).body.acceptedCommentId).toBe(
      commentId,
    );
    await call('delete', `/${id}/accepted-answer`, 0).expect(200);
    expect((await call('get', `/${id}`)).body.acceptedCommentId).toBeNull();
    await call('put', `/${id}/comments/${commentId}`, 0)
      .send({ body: '다른 사람의 수정' })
      .expect(403);
    await call('put', `/${id}/comments/${commentId}`, 1)
      .send({ body: '수정한 답변' })
      .expect(200);
    const comments = await call('get', `/${id}/comments?limit=1`).expect(200);
    expect(comments.body.items[0].body).toBe('수정한 답변');
    await call('put', `/${id}/accepted-answer/${commentId}`, 0).expect(200);
    await call('delete', `/${id}/comments/${commentId}`, 2).expect(200);
    expect((await call('get', `/${id}`)).body.acceptedCommentId).toBeNull();
    expect(
      await db.query('SELECT action FROM audit_events WHERE target_id=$1', [
        commentId,
      ]),
    ).toEqual([{ action: 'community_comment.delete' }]);
    await call('post', `/${id}/comments`, 1).send({ body: '   ' }).expect(400);
  });

  it('persists notices, tags, sorting, saved posts, follows and answer votes with permissions', async () => {
    await call('post', '', 0)
      .send({ ...draft, category: 'NOTICE' })
      .expect(403);
    const marker = randomUUID();
    const notice = await create({ category: 'NOTICE', title: marker }, 2);
    const id = await create({ title: marker, tags: ['태그검색'] });
    await call('put', `/${notice}`, 0)
      .send({ ...draft, category: 'NOTICE' })
      .expect(403);
    await call('post', '', 0)
      .send({ ...draft, tags: ['x', 'x'] })
      .expect(400);
    await call('post', '', 0)
      .send({ ...draft, tags: ['x'.repeat(31)] })
      .expect(400);
    await call('get', '?sort=invalid').expect(400);
    const tagged = await call(
      'get',
      '?tag=' + encodeURIComponent('태그검색'),
    ).expect(200);
    expect(tagged.body.items.map((p: { id: string }) => p.id)).toContain(id);
    // 검색어는 제목에서만 찾으므로 태그 글자는 검색어로 찾지 않는다.
    const byKeyword = await call(
      'get',
      '?q=' + encodeURIComponent('태그검색'),
    ).expect(200);
    expect(byKeyword.body.items.map((p: { id: string }) => p.id)).not.toContain(
      id,
    );
    await call('put', `/${id}/saved`, 1).expect(200);
    await call('put', `/${id}/saved`, 1).expect(200);
    await call('put', `/${id}/follow`, 1).expect(200);
    await call('put', `/${id}/follow`, 0).expect(400);
    await call('put', `/${id}/saved`).expect(401);
    const answer = await call('post', `/${id}/comments`, 1)
      .send({ body: '답변 추천 테스트' })
      .expect(201);
    const answerId = answer.body.id;
    await Promise.all(
      Array.from({ length: 3 }, () =>
        call('put', `/${id}/comments/${answerId}/vote`, 0).expect(200),
      ),
    );
    await call('put', `/${notice}/comments/${answerId}/vote`, 0).expect(404);
    const comments = await call('get', `/${id}/comments`).expect(200);
    expect(comments.body.items[0].voteCount).toBe(1);
    const mine = await call('get', `/${id}/interaction`, 1).expect(200);
    expect(mine.body.saved).toBe(true);
    expect(mine.body.following).toBe(true);
    expect(
      (await call('get', `/${id}/interaction`, 0)).body.commentVotes,
    ).toContain(answerId);
    await call('put', `/${id}/vote`, 1).expect(200);
    await call('get', '/mine').expect(401);
    const myPosts = (await call('get', '/mine', 1).expect(200)).body;
    expect(myPosts.voted.map((p: { id: string }) => p.id)).toContain(id);
    expect(myPosts.saved.map((p: { id: string }) => p.id)).toContain(id);
    expect(myPosts.following).toEqual([users[0].id]);
    expect(myPosts.written.map((p: { id: string }) => p.id)).not.toContain(id);
    expect(
      (await call('get', '/mine', 0)).body.written.map(
        (p: { id: string }) => p.id,
      ),
    ).toContain(id);
    for (const sort of ['latest', 'votes', 'answers']) {
      const sorted = await call('get', `?q=${marker}&sort=${sort}`).expect(200);
      expect(sorted.body.items[0].id).toBe(notice);
    }
    await call('put', `/${id}/accepted-answer/${answerId}`, 0).expect(200);
    const authorStats = await call('get', `/${id}/author-stats`).expect(200);
    expect(authorStats.body.posts).toBeGreaterThan(0);
    const before = (await call('get', `/${id}`)).body.views;
    await call('post', `/${id}/view`).expect(201);
    expect((await call('get', `/${id}`)).body.views).toBe(before + 1);
    await call('delete', `/${id}/saved`, 1).expect(200);
    await call('delete', `/${id}/follow`, 1).expect(200);
    await call('delete', `/${id}/comments/${answerId}/vote`, 0).expect(200);
    const after = await call('get', `/${id}/interaction`, 1).expect(200);
    expect(after.body.saved).toBe(false);
    expect(after.body.following).toBe(false);
    expect((await call('get', `/${id}/comments`)).body.items[0].voteCount).toBe(
      0,
    );
  });

  it('supports the new multi-category, accepted-status, view sort and full-result facet counts', async () => {
    const marker = randomUUID();
    const question = await create({ title: marker, category: 'QUESTION' });
    const free = await create({ title: marker, category: 'FREE' });
    const review = await create({
      title: marker,
      category: 'REVIEW',
      code: 'print(1)',
      language: 'Python',
    });
    const notice = await create({ title: marker, category: 'NOTICE' }, 2);
    const answer = await call('post', `/${question}/comments`, 1)
      .send({ body: '채택된 답변' })
      .expect(201);
    await call(
      'put',
      `/${question}/accepted-answer/${answer.body.id}`,
      0,
    ).expect(200);
    await call('post', `/${free}/view`).expect(201);
    const selected = await call(
      'get',
      `?q=${marker}&categories=QUESTION,FREE&status=accepted&includePinned=true&limit=1`,
    ).expect(200);
    expect(selected.body.items[0].id).toBe(notice);
    expect(selected.body.total).toBe(2);
    expect(selected.body.facets.categories.QUESTION).toBe(1);
    expect(selected.body.facets.categories.FREE).toBe(0);
    expect(selected.body.facets.statuses.accepted).toBe(1);
    expect(selected.body.facets.statuses.unaccepted).toBe(1);
    // 고정 공지는 공지 칩·전체 칩·'채택 전' 칩에 들어간다.
    const all = await call('get', `?q=${marker}&includePinned=true`).expect(
      200,
    );
    expect(all.body.facets.categories['']).toBe(4);
    expect(all.body.facets.categories.NOTICE).toBe(1);
    expect(all.body.facets.statuses.unaccepted).toBe(3);
    expect(all.body.facets.statuses.accepted).toBe(1);
    const next = await call(
      'get',
      `?q=${marker}&categories=QUESTION,FREE&status=accepted&includePinned=true&limit=1&page=2`,
    ).expect(200);
    expect(next.body.items[0].id).toBe(question);
    const unaccepted = await call(
      'get',
      `?q=${marker}&categories=FREE,REVIEW&status=unaccepted&sort=views`,
    ).expect(200);
    expect(unaccepted.body.items.map((p: { id: string }) => p.id)).toEqual([
      free,
      review,
    ]);
    const both = await call(
      'get',
      `?q=${marker}&categories=QUESTION,FREE&status=accepted,unaccepted`,
    ).expect(200);
    expect(both.body.total).toBe(2);
    await call('get', '?categories=QUESTION,INVALID').expect(400);
    await call('get', '?status=invalid').expect(400);
    await call('get', '?status=accepted,accepted').expect(400);
    await call('get', '?includePinned=invalid').expect(400);
  });

  it('serializes duplicate votes and cascades replies/votes on post deletion', async () => {
    const id = await create();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        call('put', `/${id}/vote`, 1).expect(200),
      ),
    );
    expect((await call('get', `/${id}/vote`, 1)).body).toEqual({
      voted: true,
      voteCount: 1,
    });
    await call('delete', `/${id}/vote`, 1).expect(200);
    await call('delete', `/${id}/vote`, 1).expect(200);
    expect((await call('get', `/${id}`)).body.voteCount).toBe(0);
    await call('put', `/${id}/vote`, 1).expect(200);
    const res = await call('post', `/${id}/comments`, 1).send({
      body: '채택 후 게시글 삭제',
    });
    await call('put', `/${id}/accepted-answer/${res.body.id}`, 0).expect(200);
    await call('delete', `/${id}`, 0).expect(200);
    expect(
      await db.query('SELECT id FROM community_comments WHERE post_id=$1', [
        id,
      ]),
    ).toEqual([]);
    expect(
      await db.query('SELECT * FROM community_votes WHERE post_id=$1', [id]),
    ).toEqual([]);
  });
});
