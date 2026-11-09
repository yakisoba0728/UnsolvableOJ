import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  base,
  bearer,
  closeApp,
  createApp,
  login,
  register,
} from './helpers.js';

describe('Problem tags, editorial and stats (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
  });

  afterAll(() => closeApp(app, []));

  it('versions tags/editorial, filters the list by tag and reports detail stats', async () => {
    const suffix = randomUUID().slice(0, 8);
    const admin = await register(app, 'meta', suffix);
    await db.query(
      "UPDATE users SET role='ADMIN', token_version=token_version+1 WHERE id=$1",
      [admin.user.id],
    );
    const token = (await login(app, admin.user.email)).accessToken;
    const http = () => request(app.getHttpServer());
    const tag = `태그-${suffix}`;
    const content = (slug: string, tags: string[]) => ({
      slug,
      title: slug,
      statementMarkdown: 'Add',
      inputDescriptionMarkdown: '',
      outputDescriptionMarkdown: '',
      difficulty: 'BEGINNER',
      status: 'PUBLISHED',
      tags,
      testCases: [{ input: '1 2', expectedOutput: '3', isSample: true }],
    });

    const created = await http()
      .post(`${base}/problems`)
      .set(bearer(token))
      .send({ ...content(`meta-${suffix}`, [` ${tag} `, '수학']), editorialMarkdown: '# 풀이' })
      .expect(201);
    const id = created.body.id;
    expect(created.body).toMatchObject({ tags: [tag, '수학'], editorialMarkdown: '# 풀이' });
    await http()
      .post(`${base}/problems`)
      .set(bearer(token))
      .send(content(`plain-${suffix}`, []))
      .expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ tags: [], editorialMarkdown: '' }));

    // Invalid metadata is a 400 with no new version.
    for (const body of [
      { tags: ['a\0'] },
      { tags: [tag, tag] },
      { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
      { editorialMarkdown: 'x\uD800' },
    ])
      await http().patch(`${base}/problems/${id}`).set(bearer(token)).send(body).expect(400);

    await http()
      .patch(`${base}/problems/${id}`)
      .set(bearer(token))
      .send({ tags: [tag], editorialMarkdown: '## 새 풀이' })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ currentVersion: 2, tags: [tag] }));
    const versions = await db.query(
      `SELECT version, snapshot->'tags' AS tags, snapshot->>'editorialMarkdown' AS editorial
       FROM problem_versions WHERE problem_id=$1 ORDER BY version`,
      [id],
    );
    expect(versions).toEqual([
      { version: 1, tags: [tag, '수학'], editorial: '# 풀이' },
      { version: 2, tags: [tag], editorial: '## 새 풀이' },
    ]);

    const list = await http()
      .get(`${base}/problems`)
      .query({ tag, limit: 1000 })
      .expect(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([id]);
    expect(list.body.items[0].tags).toEqual([tag]);
    await http().get(`${base}/problems`).query({ tag: 'a\0' }).expect(400);
    await http().get(`${base}/problems`).query({ tag: 'x'.repeat(31) }).expect(400);

    // Two distinct solvers among three finished submissions; pending ones are not counted.
    const [solverA, solverB] = await db.query(
      `INSERT INTO users(email, username, password_hash)
       SELECT 'metasolver-' || n || '-' || $1 || '@example.com', 'metasolver_' || n || '_' || $1, 'x'
       FROM generate_series(1, 2) n RETURNING id`,
      [suffix],
    );
    await db.query(
      `INSERT INTO submissions(user_id, problem_id, language, source_code, status)
       VALUES ($1,$3,'PYTHON','a','ACCEPTED'), ($2,$3,'PYTHON','a','ACCEPTED'),
              ($2,$3,'PYTHON','a','WRONG_ANSWER'), ($2,$3,'PYTHON','a','QUEUED')`,
      [solverA.id, solverB.id, id],
    );
    const detail = await http().get(`${base}/problems/by-slug/meta-${suffix}`).expect(200);
    expect(detail.body).toMatchObject({
      tags: [tag],
      editorialMarkdown: '## 새 풀이',
      solverCount: 2,
      acceptanceRate: 66.7,
    });
  });
});
