import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { base, bearer, closeApp, createApp, login, register } from './helpers.js';

describe('Enterprise-only (private) problems (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  const jobIds: string[] = [];
  const suffix = randomUUID().slice(0, 8);
  let adminToken: string;
  let authorToken: string;
  let solverToken: string;
  const http = () => request(app.getHttpServer());
  const body = (slug: string, extra: Record<string, unknown> = {}) => ({
    slug: `${slug}-${suffix}`,
    title: slug,
    statementMarkdown: 'sum',
    inputDescriptionMarkdown: 'numbers',
    outputDescriptionMarkdown: 'sum',
    difficulty: 'BEGINNER',
    testCases: [{ input: '1 2\n', expectedOutput: '3\n', isSample: true }],
    ...extra,
  });

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    const admin = await register(app, 'ppadmin', suffix);
    const author = await register(app, 'ppauthor', suffix);
    solverToken = (await register(app, 'ppsolver', suffix)).accessToken;
    await db.query("UPDATE users SET role='ADMIN', token_version=token_version+1 WHERE id=$1", [admin.user.id]);
    await db.query("UPDATE users SET role='AUTHOR', token_version=token_version+1 WHERE id=$1", [author.user.id]);
    adminToken = (await login(app, admin.user.email)).accessToken;
    authorToken = (await login(app, author.user.email)).accessToken;
  });

  afterAll(() => closeApp(app, jobIds));

  it('keeps private problems out of public pages, blocks publishing, and allows owner test submissions', async () => {
    await http()
      .post(`${base}/problems`)
      .set(bearer(adminToken))
      .send(body('private-published', { isPrivate: true, status: 'PUBLISHED' }))
      .expect(400);
    const created = await http()
      .post(`${base}/problems`)
      .set(bearer(authorToken))
      .send(body('company', { isPrivate: true }))
      .expect(201);
    const id = created.body.id as string;
    expect(created.body.isPrivate).toBe(true);

    await http()
      .patch(`${base}/problems/${id}/status`)
      .set(bearer(adminToken))
      .send({ status: 'PUBLISHED' })
      .expect(400);
    await http().get(`${base}/problems/company-${suffix}`).expect(404);
    const list = await http().get(`${base}/problems?limit=1000`).expect(200);
    expect(list.body.items.some((item: { id: string }) => item.id === id)).toBe(false);
    const mine = await http().get(`${base}/problems/mine`).set(bearer(authorToken)).expect(200);
    expect(mine.body.find((item: { id: string }) => item.id === id)).toMatchObject({ isPrivate: true });

    await http()
      .post(`${base}/problems/${id}/submissions`)
      .set(bearer(solverToken))
      .send({ language: 'PYTHON', sourceCode: 'print(3)' })
      .expect(404);
    const test = await http()
      .post(`${base}/problems/${id}/submissions`)
      .set(bearer(authorToken))
      .send({ language: 'PYTHON', sourceCode: 'print(3)' })
      .expect(202);
    jobIds.push(`${test.body.id}-1`);
    expect(test.body.isTest).toBe(true);

    // 기업 전용을 해제하면 일반 문제처럼 검수 후 공개할 수 있다.
    const unlocked = await http()
      .patch(`${base}/problems/${id}`)
      .set(bearer(authorToken))
      .send({ isPrivate: false })
      .expect(200);
    expect(unlocked.body.isPrivate).toBe(false);
    await http()
      .patch(`${base}/problems/${id}/status`)
      .set(bearer(adminToken))
      .send({ status: 'PUBLISHED' })
      .expect(200);
    // 공개 문제를 기업 전용으로 바꾸면 관리자가 바꿔도 공개 목록에서 내려간다.
    const relocked = await http()
      .patch(`${base}/problems/${id}`)
      .set(bearer(adminToken))
      .send({ isPrivate: true })
      .expect(200);
    expect(relocked.body).toMatchObject({ isPrivate: true, status: 'DRAFT' });
    await http().get(`${base}/problems/company-${suffix}`).expect(404);
  });
});
