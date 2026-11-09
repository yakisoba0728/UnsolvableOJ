import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { base, bearer, closeApp, createApp, login, register } from './helpers.js';

describe('Public problem search (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  const jobIds: string[] = [];
  const suffix = randomUUID().slice(0, 8);
  let adminToken: string;
  let authorToken: string;
  let solverToken: string;
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const search = (params: Record<string, string>, token?: string) => {
    const call = http()
      .get(`${base}/problems`)
      .query({ limit: '1000', ...params });
    return token ? call.set(bearer(token)) : call;
  };
  const titles = (body: { items: { title: string }[] }) =>
    body.items.map((item) => item.title);

  const create = async (
    token: string,
    key: string,
    title: string,
    extra: Record<string, unknown> = {},
  ) => {
    const { body } = await http()
      .post(`${base}/problems`)
      .set(bearer(token))
      .send({
        slug: `${key}-${suffix}`,
        title,
        statementMarkdown: 'sum',
        inputDescriptionMarkdown: 'numbers',
        outputDescriptionMarkdown: 'sum',
        difficulty: 'BEGINNER',
        testCases: [{ input: '1 2\n', expectedOutput: '3\n', isSample: true }],
        ...extra,
      })
      .expect(201);
    ids[key] = body.id;
  };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    const admin = await register(app, 'psadmin', suffix);
    const author = await register(app, 'psauthor', suffix);
    solverToken = (await register(app, 'pssolver', suffix)).accessToken;
    await db.query(
      "UPDATE users SET role='ADMIN', token_version=token_version+1 WHERE id=$1",
      [admin.user.id],
    );
    adminToken = (await login(app, admin.user.email)).accessToken;
    authorToken = author.accessToken;

    // 모든 제목에 suffix를 넣어 다른 테스트 파일의 문제와 섞이지 않게 한다.
    const published = { status: 'PUBLISHED' };
    await create(adminToken, 'percent', `${suffix} 100% done`, { ...published, difficulty: 'HARD', tags: ['수학'] });
    await create(adminToken, 'apples', `${suffix} 100 apples`, { ...published, difficulty: 'MEDIUM' });
    await create(adminToken, 'under', `${suffix} a_b`, { ...published, tags: ['수학'] });
    await create(adminToken, 'axb', `${suffix} axb`, published);
    await create(adminToken, 'slash', `${suffix} back\\slash`, { ...published, difficulty: 'EXPERT' });
    await create(adminToken, 'zeta', `${suffix} Alpha`, published);
    // 기업 전용 문제와 초안은 검색어가 맞아도 나오지 않는다.
    await create(authorToken, 'private', `${suffix} 100% private`, { isPrivate: true });
    await create(authorToken, 'draft', `${suffix} 100% draft`);
  });

  afterAll(() => closeApp(app, jobIds));

  it('matches title and slug case-insensitively and escapes LIKE wildcards', async () => {
    const all = await search({ q: suffix, sort: 'title' }).expect(200);
    expect(all.body.total).toBe(6);
    expect(titles(all.body)).not.toContain(`${suffix} 100% private`);
    expect(titles(all.body)).not.toContain(`${suffix} 100% draft`);

    const upper = await search({ q: `${suffix} ALPHA` }).expect(200);
    expect(titles(upper.body)).toEqual([`${suffix} Alpha`]);
    // slug만 맞아도 찾는다.
    const bySlug = await search({ q: `ZETA-${suffix}` }).expect(200);
    expect(titles(bySlug.body)).toEqual([`${suffix} Alpha`]);

    // %·_·\는 글자 그대로 찾는다(와일드카드면 '100 apples'·'axb'도 맞는다).
    const percent = await search({ q: `${suffix} 100%` }).expect(200);
    expect(titles(percent.body)).toEqual([`${suffix} 100% done`]);
    const underscore = await search({ q: `${suffix} a_b` }).expect(200);
    expect(titles(underscore.body)).toEqual([`${suffix} a_b`]);
    const slash = await search({ q: `back\\slash` }).expect(200);
    expect(titles(slash.body)).toEqual([`${suffix} back\\slash`]);
    // 앞뒤 공백은 무시한다.
    const padded = await search({ q: `  ${suffix} a_b  ` }).expect(200);
    expect(padded.body.total).toBe(1);

    const none = await search({ q: `${suffix} nothing` }).expect(200);
    expect(none.body).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });

  it('never lists private or draft problems, even with matching filters', async () => {
    for (const params of <Record<string, string>[]>[
      { q: `${suffix} 100% p` },
      { q: `private-${suffix}` },
      { q: `draft-${suffix}` },
      { q: suffix, difficulty: 'BEGINNER', sort: 'random', seed: '7' },
    ]) {
      const { body } = await search(params).expect(200);
      const listed = body.items.map((item: { id: string }) => item.id);
      expect(listed).not.toContain(ids.private);
      expect(listed).not.toContain(ids.draft);
    }
    const { body } = await search({ q: `${suffix} 100% p` }).expect(200);
    expect(body.total).toBe(0);
  });

  it('filters by several difficulties and a tag, and counts every chip', async () => {
    const { body } = await search({
      q: suffix,
      difficulty: 'HARD,EXPERT',
      sort: 'difficulty',
    }).expect(200);
    expect(titles(body)).toEqual([`${suffix} 100% done`, `${suffix} back\\slash`]);
    // 난이도 칩 숫자는 난이도 조건만 빼고 센다.
    expect(body.facets.difficulties).toMatchObject({
      '': 6,
      BEGINNER: 3,
      MEDIUM: 1,
      HARD: 1,
      EXPERT: 1,
      EASY: 0,
    });
    expect(body.facets.solves).toBeNull();
    expect(body.facets.tags).toEqual(
      expect.arrayContaining([{ tag: '수학', count: 1 }]),
    );

    const tagged = await search({ q: suffix, tag: '수학' }).expect(200);
    expect(tagged.body.total).toBe(2);
    expect(tagged.body.facets.difficulties).toMatchObject({ '': 2, HARD: 1, BEGINNER: 1 });

    // 예전처럼 난이도 하나만 보내도 된다.
    const single = await search({ q: suffix, difficulty: 'MEDIUM' }).expect(200);
    expect(titles(single.body)).toEqual([`${suffix} 100 apples`]);
  });

  it('pages and sorts on the server', async () => {
    const page1 = await search({ q: suffix, sort: 'title', limit: '4' }).expect(200);
    const page2 = await search({ q: suffix, sort: 'title', limit: '4', page: '2' }).expect(200);
    expect(page1.body).toMatchObject({ total: 6, totalPages: 2, page: 1 });
    expect(page1.body).not.toHaveProperty('nextCursor');
    expect(page2.body.items).toHaveLength(2);
    const all = [...titles(page1.body), ...titles(page2.body)];
    expect(all).toEqual([...all].sort());
    expect(new Set(all).size).toBe(6);

    const reversed = await search({ q: suffix, sort: 'title', reverse: 'true' }).expect(200);
    expect(titles(reversed.body)).toEqual([...all].reverse());

    // 같은 seed면 같은 순서이고 쪽이 겹치지 않는다.
    const random = (page: string) =>
      search({ q: suffix, sort: 'random', seed: '42', limit: '3', page }).expect(200);
    const [r1, r1again, r2] = await Promise.all([random('1'), random('1'), random('2')]);
    expect(titles(r1.body)).toEqual(titles(r1again.body));
    expect(new Set([...titles(r1.body), ...titles(r2.body)]).size).toBe(6);

    // 최신순은 커서로 이어 읽는다.
    const first = await search({ q: suffix, limit: '4' }).expect(200);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const next = await search({ q: suffix, limit: '4', cursor: first.body.nextCursor }).expect(200);
    expect(next.body.nextCursor).toBeNull();
    expect(
      new Set([...titles(first.body), ...titles(next.body)]).size,
    ).toBe(6);
  });

  it('filters by my solve state only when logged in', async () => {
    await search({ q: suffix, solve: 'solved' }).expect(401);
    const solved = await http()
      .post(`${base}/problems/${ids.percent}/submissions`)
      .set(bearer(solverToken))
      .send({ language: 'PYTHON', sourceCode: 'print(3)' })
      .expect(202);
    jobIds.push(`${solved.body.id}-1`);
    await db.query("UPDATE submissions SET status='ACCEPTED' WHERE id=$1", [solved.body.id]);
    const tried = await http()
      .post(`${base}/problems/${ids.apples}/submissions`)
      .set(bearer(solverToken))
      .send({ language: 'PYTHON', sourceCode: 'print(1)' })
      .expect(202);
    jobIds.push(`${tried.body.id}-1`);

    const { body } = await search({ q: suffix, solve: 'solved,attempted', sort: 'title' }, solverToken).expect(200);
    expect(titles(body)).toEqual([`${suffix} 100 apples`, `${suffix} 100% done`]);
    expect(body.facets.solves).toMatchObject({ '': 6, solved: 1, attempted: 1, none: 4 });
    const fresh = await search({ q: suffix, solve: 'none' }, solverToken).expect(200);
    expect(fresh.body.total).toBe(4);
    // 다른 사람에게는 풀지 않은 문제다.
    const other = await search({ q: suffix, solve: 'none' }, adminToken).expect(200);
    expect(other.body.total).toBe(6);
  });

  it('rejects oversized or unknown list options', async () => {
    await search({ q: 'x'.repeat(101) }).expect(400);
    await search({ q: 'a\0b' }).expect(400);
    await search({ sort: 'popular' }).expect(400);
    await search({ difficulty: 'IMPOSSIBLE' }).expect(400);
    await search({ solve: 'maybe' }, solverToken).expect(400);
    await search({ sort: 'title', cursor: 'abc' }).expect(400);
    await search({ q: 'x'.repeat(100) }).expect(200);
  });
});
