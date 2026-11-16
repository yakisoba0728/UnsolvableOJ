import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { PasswordHasher } from '../src/modules/auth/password-hasher.service.js';
import { ProblemBookmarksService } from '../src/modules/problems/problem-bookmarks.service.js';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('Private problem bookmarks (real API and PostgreSQL)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let mine: Awaited<ReturnType<typeof register>>;
  let other: Awaited<ReturnType<typeof register>>;
  const ids: Record<string, string> = {};
  const suffix = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());
  const bookmark = (id: string) => `${base}/problems/${id}/bookmark`;
  const save = (id: string, token = mine.accessToken) => http().put(bookmark(id)).set(bearer(token));
  const list = (query: Record<string, string> = {}, token = mine.accessToken) =>
    http().get(`${base}/problems`).query({ q: suffix, bookmarked: 'true', ...query }).set(bearer(token));

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    mine = await register(app, 'bookmark', suffix);
    other = await register(app, 'bookmark_other', suffix);
    for (const [key, status, difficulty, isPrivate] of [
      ['a', 'PUBLISHED', 'BEGINNER', false],
      ['b', 'PUBLISHED', 'HARD', false],
      ['c', 'PUBLISHED', 'BEGINNER', false],
      ['draft', 'DRAFT', 'BEGINNER', false],
      ['private', 'DRAFT', 'BEGINNER', true],
    ]) {
      const [p] = await db.query(
        `INSERT INTO problems(slug,title,statement_md,difficulty,status,is_private,author_id,tags)
         VALUES($1,$2,'Bookmark test',$3,$4,$5,$6,$7) RETURNING id`,
        [`bookmark-${key}-${suffix}`, `${suffix} ${key}`, difficulty, status, isPrivate, mine.user.id, key === 'a' ? ['수학'] : ['구현']],
      );
      ids[key as string] = p.id;
    }
  });
  beforeEach(async () => {
    await db.query('DELETE FROM problem_bookmarks WHERE user_id=ANY($1::uuid[])', [[mine.user.id, other.user.id]]);
    await db.query("UPDATE problems SET status='PUBLISHED',is_private=false WHERE id=$1", [ids.a]);
  });
  afterAll(() => closeApp(app, []));

  it('requires authentication and validates all bookmark identifiers and filters', async () => {
    await http().get(bookmark(ids.a)).expect(401);
    await http().put(bookmark(ids.a)).expect(401);
    await http().delete(bookmark(ids.a)).expect(401);
    await http().get(`${base}/problems?bookmarked=true`).expect(401);
    await http().put(bookmark('invalid')).set(bearer(mine.accessToken)).expect(400);
    await list({ bookmarked: 'yes' }).expect(400);
  });

  it('saves idempotently under concurrent requests, returns only my state, and deletes idempotently', async () => {
    await Promise.all([save(ids.a).expect(200), save(ids.a).expect(200), save(ids.a).expect(200)]);
    const [{ count }] = await db.query('SELECT count(*)::int AS count FROM problem_bookmarks WHERE user_id=$1 AND problem_id=$2', [mine.user.id, ids.a]);
    expect(count).toBe(1);
    expect((await http().get(bookmark(ids.a)).set(bearer(mine.accessToken)).expect(200)).body).toEqual({ bookmarked: true });
    expect((await http().get(bookmark(ids.a)).set(bearer(other.accessToken)).expect(200)).body).toEqual({ bookmarked: false });
    expect((await list({}, other.accessToken).expect(200)).body.total).toBe(0);
    await http().delete(bookmark(ids.a)).set(bearer(other.accessToken)).expect(200);
    expect((await list().expect(200)).body.total).toBe(1);
    await http().delete(bookmark(ids.a)).set(bearer(mine.accessToken)).expect(200, { bookmarked: false });
    await http().delete(bookmark(ids.a)).set(bearer(mine.accessToken)).expect(200, { bookmarked: false });
    expect((await list().expect(200)).body.total).toBe(0);
  });

  it('never discloses or stores private, draft or nonexistent problems, even for their author', async () => {
    for (const id of [ids.private, ids.draft, randomUUID()]) {
      await save(id).expect(404);
      await http().get(bookmark(id)).set(bearer(mine.accessToken)).expect(404);
    }
    expect((await list().expect(200)).body.items).toEqual([]);
  });

  it('keeps public visibility current and allows removing an inaccessible bookmark', async () => {
    await save(ids.a).expect(200);
    await db.query("UPDATE problems SET status='DRAFT',is_private=true WHERE id=$1", [ids.a]);
    const hidden = await list().expect(200);
    expect(hidden.body).toMatchObject({ items: [], total: 0 });
    expect(hidden.body.facets.difficulties['']).toBe(0);
    await http().get(bookmark(ids.a)).set(bearer(mine.accessToken)).expect(404);
    await http().delete(bookmark(ids.a)).set(bearer(mine.accessToken)).expect(200);
    const [{ count }] = await db.query('SELECT count(*)::int AS count FROM problem_bookmarks WHERE user_id=$1', [mine.user.id]);
    expect(count).toBe(0);
  });

  it('applies search, difficulty, tag, solve filters, pagination and facets inside my saved set', async () => {
    await save(ids.a).expect(200);
    await save(ids.b).expect(200);
    await save(ids.c, other.accessToken).expect(200);
    const first = await list({ sort: 'title', limit: '1' }).expect(200);
    const second = await list({ sort: 'title', limit: '1', page: '2' }).expect(200);
    expect(first.body).toMatchObject({ total: 2, totalPages: 2, items: [{ id: ids.a, bookmarked: true }] });
    expect(second.body.items).toEqual([expect.objectContaining({ id: ids.b, bookmarked: true })]);
    const difficult = await list({ difficulty: 'HARD', solve: 'none' }).expect(200);
    expect(difficult.body.items).toEqual([expect.objectContaining({ id: ids.b })]);
    expect(difficult.body.facets.difficulties).toMatchObject({ '': 2, BEGINNER: 1, HARD: 1 });
    expect(difficult.body.facets.solves).toMatchObject({ '': 1, none: 1, solved: 0 });
    expect((await list({ tag: '수학' }).expect(200)).body.items).toEqual([expect.objectContaining({ id: ids.a })]);
    expect((await list({ q: `${suffix} b` }).expect(200)).body.items).toEqual([expect.objectContaining({ id: ids.b })]);
    const publicPage = await http().get(`${base}/problems`).query({ q: suffix }).expect(200);
    expect(publicPage.body.items.every((p: { bookmarked: boolean }) => p.bookmarked === false)).toBe(true);
    const minePage = await list({ bookmarked: 'false' }).expect(200);
    expect(minePage.body.items.find((p: { id: string }) => p.id === ids.c).bookmarked).toBe(false);
  });

  it('supports keyset paging without duplicate saved rows', async () => {
    await save(ids.a).expect(200);
    await save(ids.b).expect(200);
    const first = await list({ limit: '1' }).expect(200);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const next = await list({ limit: '1', cursor: first.body.nextCursor }).expect(200);
    expect(next.body.nextCursor).toBeNull();
    expect(new Set([first.body.items[0].id, next.body.items[0].id])).toEqual(new Set([ids.a, ids.b]));
  });

  it('does not deadlock an author changing a published problem back to draft', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const [{ pid }] = await runner.query('SELECT pg_backend_pid() AS pid');
    const actor = { id: mine.user.id, role: mine.user.role, tokenVersion: app.get(JwtService).decode(mine.accessToken).tokenVersion };
    let outcome: Promise<PromiseSettledResult<{ bookmarked: boolean }>[]> | undefined;
    try {
      // This is ProblemsService.changeStatus's problem -> draft-quota user ordering.
      await runner.query('SELECT id FROM problems WHERE id=$1 FOR UPDATE', [ids.a]);
      outcome = Promise.allSettled([app.get(ProblemBookmarksService).save(ids.a, actor)]);
      await expect.poll(async () => {
        const [{ blocked }] = await db.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked', [pid]);
        return blocked;
      }, { timeout: 2500 }).toBe(true);
      await runner.query("SET LOCAL lock_timeout='1500ms'");
      await runner.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [mine.user.id]);
      await runner.query("UPDATE problems SET status='DRAFT' WHERE id=$1", [ids.a]);
      await runner.commitTransaction();
      expect((await outcome)[0].status).toBe('rejected');
      expect((await list().expect(200)).body.total).toBe(0);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await outcome;
    }
  });

  it('erases saved study data on withdrawal and fences a save already authenticated before deletion', async () => {
    const account = await register(app, 'bookmark_delete', suffix);
    await save(ids.a, account.accessToken).expect(200);
    const actor = { id: account.user.id, role: account.user.role, tokenVersion: app.get(JwtService).decode(account.accessToken).tokenVersion };
    // AdminModule has another hasher instance; pause the actual AuthService dependency.
    const hasher = app.select(AuthModule).get(PasswordHasher, { strict: true });
    const verify = hasher.verify.bind(hasher);
    let release!: () => void;
    let entered!: () => void;
    const pause = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { entered = resolve; });
    const spy = vi.spyOn(hasher, 'verify').mockImplementation(async (password, hash) => {
      const valid = await verify(password, hash);
      entered();
      await pause;
      return valid;
    });
    try {
      const deleting = app.get(AuthService).withdraw(actor, 'test-password-123');
      await locked;
      const racingSave = app.get(ProblemBookmarksService).save(ids.b, actor);
      // Attach rejection observation before releasing the deletion's user lock.
      const result = Promise.allSettled([racingSave]);
      release();
      await deleting;
      expect((await result)[0].status).toBe('rejected');
      const [{ count }] = await db.query('SELECT count(*)::int AS count FROM problem_bookmarks WHERE user_id=$1', [account.user.id]);
      expect(count).toBe(0);
      await http().get(bookmark(ids.a)).set(bearer(account.accessToken)).expect(401);
    } finally {
      release();
      spy.mockRestore();
    }
  });
});
