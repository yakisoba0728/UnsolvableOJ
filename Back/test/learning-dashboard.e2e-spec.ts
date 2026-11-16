import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ProblemDifficulty } from '../src/modules/problems/problem.enums.js';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('Private bounded learning dashboard (real PostgreSQL/API)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let mine: Awaited<ReturnType<typeof register>>;
  let other: Awaited<ReturnType<typeof register>>;
  const suffix = randomUUID().slice(0, 8);
  const problems: string[] = [];
  const http = () => request(app.getHttpServer());
  const dashboard = (days = 30, token = mine.accessToken) =>
    http().get(`${base}/users/me/learning`).query({ days }).set(bearer(token));

  async function submission(
    problem: string,
    status = 'WRONG_ANSWER',
    options: { userId?: string; at?: string; test?: boolean; id?: string } = {},
  ) {
    const [row] = await db.query(
      `INSERT INTO submissions(id,user_id,problem_id,language,source_code,status,is_test,created_at)
       VALUES($1,$2,$3,'PYTHON',$4,$5,$6,COALESCE($7::timestamptz,clock_timestamp())) RETURNING id`,
      [
        options.id ?? randomUUID(),
        options.userId ?? mine.user.id,
        problem,
        'PRIVATE SOURCE '.repeat(1000),
        status,
        options.test ?? false,
        options.at ?? null,
      ],
    );
    return row.id as string;
  }

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    mine = await register(app, 'learner', suffix);
    other = await register(app, 'learn_other', suffix);
    for (let i = 0; i < 25; i++) {
      const [p] = await db.query(
        `INSERT INTO problems(slug,title,statement_md,difficulty,status,author_id,tags)
         VALUES($1,$2,'Never expose statement','BEGINNER','PUBLISHED',$3,$4) RETURNING id`,
        [
          `learn-${suffix}-${i}`,
          `Learning ${i}`,
          mine.user.id,
          ['구현', '구현', `tag-${String(i).padStart(2, '0')}`],
        ],
      );
      problems.push(p.id);
    }
  });
  beforeEach(async () => {
    const users = [mine.user.id, other.user.id];
    await db.query(
      'DELETE FROM user_problem_solves WHERE user_id=ANY($1::uuid[])',
      [users],
    );
    await db.query('DELETE FROM submissions WHERE user_id=ANY($1::uuid[])', [
      users,
    ]);
    await db.query(
      'DELETE FROM problem_bookmarks WHERE user_id=ANY($1::uuid[])',
      [users],
    );
    await db.query(
      "UPDATE problems SET status='PUBLISHED',is_private=false WHERE id=ANY($1::uuid[])",
      [problems],
    );
  });
  afterAll(() => closeApp(app, []));

  it('authenticates the caller, rejects unsupported windows and foreign selectors', async () => {
    await http().get(`${base}/users/me/learning`).expect(401);
    for (const days of ['0', '8', '91', '1.5', 'abc', '-7', ''])
      await http()
        .get(`${base}/users/me/learning`)
        .query({ days })
        .set(bearer(mine.accessToken))
        .expect(400);
    await dashboard().query({ userId: other.user.id }).expect(400);
    await http()
      .get(`${base}/users/${other.user.username}/learning`)
      .set(bearer(mine.accessToken))
      .expect(404);
  });

  it('returns a complete zero-filled KST window for an empty account', async () => {
    const { body } = await http()
      .get(`${base}/users/me/learning`)
      .set(bearer(mine.accessToken))
      .expect(200);
    expect(body).toMatchObject({
      days: 30,
      timeZone: 'Asia/Seoul',
      summary: {
        submissions: 0,
        acceptedSubmissions: 0,
        solvedProblems: 0,
        attemptedProblems: 0,
        activeDays: 0,
      },
      difficulties: Object.values(ProblemDifficulty).map((difficulty) => ({
        difficulty,
        attempted: 0,
        solved: 0,
      })),
      tags: [],
      tagsTruncated: false,
      review: [],
    });
    expect(body.activity).toHaveLength(30);
    expect(
      body.activity.every(
        (d: { submissions: number; acceptedSubmissions: number }) =>
          d.submissions === 0 && d.acceptedSubmissions === 0,
      ),
    ).toBe(true);
    expect(body.activity.map((d: { date: string }) => d.date)).toEqual(
      body.activity
        .map((d: { date: string }) => d.date)
        .sort((a: string, b: string) => a.localeCompare(b)),
    );
    const [{ today }] = await db.query(
      "SELECT to_char(statement_timestamp() AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') AS today",
    );
    expect(body.activity.at(-1).date).toBe(today);
  });

  it('counts distinct visible problems/tags without leaking private, test or another account data', async () => {
    await submission(problems[0]);
    await submission(problems[0]);
    await submission(problems[0], 'ACCEPTED');
    await submission(problems[1]);
    await submission(problems[2], 'ACCEPTED', { userId: other.user.id });
    await submission(problems[3], 'ACCEPTED', { test: true });
    await submission(problems[4], 'ACCEPTED');
    await submission(problems[5], 'ACCEPTED');
    await db.query("UPDATE problems SET status='DRAFT' WHERE id=$1", [
      problems[4],
    ]);
    await db.query('UPDATE problems SET is_private=true WHERE id=$1', [
      problems[5],
    ]);
    const { body } = await dashboard().expect(200);
    expect(body.summary).toEqual({
      submissions: 4,
      acceptedSubmissions: 1,
      solvedProblems: 1,
      attemptedProblems: 2,
      activeDays: 1,
    });
    expect(body.difficulties).toEqual(
      Object.values(ProblemDifficulty).map((difficulty) => ({
        difficulty,
        attempted: difficulty === 'BEGINNER' ? 2 : 0,
        solved: difficulty === 'BEGINNER' ? 1 : 0,
      })),
    );
    expect(body.tags.find((t: { tag: string }) => t.tag === '구현')).toEqual({
      tag: '구현',
      attempted: 2,
      solved: 1,
    });
    expect(body.review).toEqual([
      expect.objectContaining({
        id: problems[1],
        lastStatus: 'WRONG_ANSWER',
        bookmarked: false,
      }),
    ]);
    expect(JSON.stringify(body)).not.toMatch(
      /PRIVATE SOURCE|Never expose statement|sourceCode|testResults|email/,
    );
    const theirs = await dashboard(30, other.accessToken).expect(200);
    expect(theirs.body.summary).toMatchObject({
      submissions: 1,
      solvedProblems: 1,
    });
    expect(theirs.body.review).toEqual([]);
  });

  it('independently excludes enterprise submissions even with a non-test flag', async () => {
    const [exam] = await db.query(
      `INSERT INTO enterprise_tests(owner_id,title,starts_at,ends_at,duration_min,problem_ids,invite_code)
      VALUES($1,'Learning isolation',now()-interval '1 hour',now()+interval '1 hour',60,$2,$3) RETURNING id`,
      [mine.user.id, [problems[0]], `learn-${suffix}`],
    );
    const [attempt] = await db.query(
      `INSERT INTO enterprise_attempts(test_id,user_id,deadline_at)
      VALUES($1,$2,now()+interval '30 minutes') RETURNING id`,
      [exam.id, mine.user.id],
    );
    const id = await submission(problems[0], 'ACCEPTED');
    await db.query('UPDATE submissions SET attempt_id=$1 WHERE id=$2', [
      attempt.id,
      id,
    ]);
    const { body } = await dashboard().expect(200);
    expect(body.summary.submissions).toBe(0);
    expect(body.tags).toEqual([]);
    expect(body.review).toEqual([]);
  });

  it('includes the exact KST window boundary and excludes prior and future submissions', async () => {
    const [{ first, before, future }] = await db.query(`SELECT
      (((statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date-6)::timestamp AT TIME ZONE 'Asia/Seoul') AS first,
      (((statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date-6)::timestamp AT TIME ZONE 'Asia/Seoul')-interval '1 millisecond' AS before,
      statement_timestamp()+interval '1 day' AS future`);
    await submission(problems[0], 'ACCEPTED', { at: first.toISOString() });
    await submission(problems[1], 'ACCEPTED', { at: before.toISOString() });
    await submission(problems[2], 'ACCEPTED', { at: future.toISOString() });
    const { body } = await dashboard(7).expect(200);
    expect(body.activity).toHaveLength(7);
    expect(body.summary.submissions).toBe(1);
    expect(body.activity[0]).toMatchObject({
      submissions: 1,
      acceptedSubmissions: 1,
    });
    expect((await dashboard(30).expect(200)).body.summary.submissions).toBe(2);
    expect((await dashboard(90).expect(200)).body.activity).toHaveLength(90);
  });

  it('bounds review rows, excludes lifetime solves, and returns only the current caller bookmark state', async () => {
    const [{ old }] = await db.query(
      "SELECT statement_timestamp()-interval '120 days' AS old",
    );
    const accepted = await submission(problems[0], 'ACCEPTED', {
      at: old.toISOString(),
    });
    await db.query(
      'INSERT INTO user_problem_solves(user_id,problem_id,accepted_submission_id,awarded_xp) VALUES($1,$2,$3,10)',
      [mine.user.id, problems[0], accepted],
    );
    for (const p of problems.slice(0, 15)) await submission(p);
    await db.query(
      'INSERT INTO problem_bookmarks(user_id,problem_id) VALUES($1,$2),($3,$4)',
      [mine.user.id, problems[14], other.user.id, problems[13]],
    );
    const { body } = await dashboard().expect(200);
    expect(body.review).toHaveLength(10);
    expect(new Set(body.review.map((p: { id: string }) => p.id)).size).toBe(10);
    expect(body.review[0]).toMatchObject({
      id: problems[14],
      bookmarked: true,
    });
    expect(body.review[1]).toMatchObject({
      id: problems[13],
      bookmarked: false,
    });
    expect(body.review.some((p: { id: string }) => p.id === problems[0])).toBe(
      false,
    );
    expect(body.summary.solvedProblems).toBe(0); // charts are window-scoped, lifetime solve exclusion is separate
  });

  it('uses a stable ID tie-break for the latest verdict and caps tags with explicit truncation', async () => {
    const at = new Date(Date.now() - 1000).toISOString();
    await submission(problems[0], 'WRONG_ANSWER', {
      at,
      id: '00000000-0000-4000-8000-000000000001',
    });
    await submission(problems[0], 'RUNTIME_ERROR', {
      at,
      id: '00000000-0000-4000-8000-000000000002',
    });
    for (const p of problems.slice(1))
      await submission(p, 'WRONG_ANSWER', { at });
    const { body } = await dashboard().expect(200);
    expect(body.tags).toHaveLength(20);
    expect(body.tagsTruncated).toBe(true);
    expect(body.tags[0]).toEqual({ tag: '구현', attempted: 25, solved: 0 });
    const expected = [...problems]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 10);
    expect(body.review.map((p: { id: string }) => p.id)).toEqual(expected);
    // A separate narrow window is unnecessary: remove the other fixtures to inspect the tied verdict.
    await db.query(
      'DELETE FROM submissions WHERE user_id=$1 AND problem_id<>$2',
      [mine.user.id, problems[0]],
    );
    expect((await dashboard().expect(200)).body.review[0].lastStatus).toBe(
      'RUNTIME_ERROR',
    );
  });

  it('reflects visibility changes and denies a withdrawn identity', async () => {
    await submission(problems[0]);
    expect((await dashboard().expect(200)).body.summary.submissions).toBe(1);
    await db.query("UPDATE problems SET status='DRAFT' WHERE id=$1", [
      problems[0],
    ]);
    expect((await dashboard().expect(200)).body.summary.submissions).toBe(0);
    await db.query(
      'UPDATE users SET deleted_at=clock_timestamp() WHERE id=$1',
      [other.user.id],
    );
    await dashboard(30, other.accessToken).expect(401);
  });
});
