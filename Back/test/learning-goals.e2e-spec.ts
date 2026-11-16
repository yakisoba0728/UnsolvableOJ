import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { LearningGoalsService } from '../src/modules/users/learning-goals.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { PasswordHasher } from '../src/modules/auth/password-hasher.service.js';
import { LearningGoals1796200000000 } from '../src/database/migrations/1796200000000-learning-goals.js';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('Private calendar learning goals (real PostgreSQL/API)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let mine: Awaited<ReturnType<typeof register>>;
  let other: Awaited<ReturnType<typeof register>>;
  const suffix = randomUUID().slice(0, 8);
  const problems: string[] = [];
  const endpoint = `${base}/users/me/learning-goal`;
  const http = () => request(app.getHttpServer());
  const get = (token = mine.accessToken) =>
    http().get(endpoint).set(bearer(token));
  const set = (targetProblems = 10, days = 7, token = mine.accessToken) =>
    http().put(endpoint).set(bearer(token)).send({ targetProblems, days });
  const actor = (account: typeof mine) => ({
    id: account.user.id,
    role: account.user.role,
    tokenVersion: app.get(JwtService).decode(account.accessToken).tokenVersion,
  });
  async function submission(
    problem: string,
    options: {
      userId?: string;
      status?: string;
      at?: Date;
      test?: boolean;
    } = {},
  ) {
    const [row] = await db.query(
      `INSERT INTO submissions(user_id,problem_id,language,source_code,status,is_test,created_at)
       VALUES($1,$2,'PYTHON','PRIVATE SOURCE',$3,$4,COALESCE($5::timestamptz,clock_timestamp())) RETURNING id`,
      [
        options.userId ?? mine.user.id,
        problem,
        options.status ?? 'ACCEPTED',
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
    mine = await register(app, 'goal_owner', suffix);
    other = await register(app, 'goal_other', suffix);
    for (let index = 0; index < 9; index++) {
      const [row] = await db.query(
        `INSERT INTO problems(slug,title,statement_md,difficulty,status,author_id)
         VALUES($1,$2,'PRIVATE STATEMENT','BEGINNER','PUBLISHED',$3) RETURNING id`,
        [`goal-${suffix}-${index}`, `Goal ${index}`, mine.user.id],
      );
      problems.push(row.id);
    }
  });
  beforeEach(async () => {
    await db.query('DELETE FROM learning_goals WHERE user_id=ANY($1::uuid[])', [
      [mine.user.id, other.user.id],
    ]);
    await db.query('DELETE FROM submissions WHERE user_id=ANY($1::uuid[])', [
      [mine.user.id, other.user.id],
    ]);
    await db.query(
      "UPDATE problems SET status='PUBLISHED',is_private=false WHERE id=ANY($1::uuid[])",
      [problems],
    );
  });
  afterAll(() => closeApp(app, []));

  it('requires authentication and validates only integer targets and supported windows', async () => {
    await http().get(endpoint).expect(401);
    await http()
      .put(endpoint)
      .send({ targetProblems: 10, days: 7 })
      .expect(401);
    for (const input of [
      {},
      { targetProblems: 0, days: 7 },
      { targetProblems: 1001, days: 7 },
      { targetProblems: 1.5, days: 7 },
      { targetProblems: '10', days: 7 },
      { targetProblems: 10, days: 8 },
      { targetProblems: 10, days: '30' },
      { targetProblems: 10, days: 7, userId: other.user.id },
      { targetProblems: 10, days: 7, solvedProblems: 999 },
      { targetProblems: 10, days: 7, startDate: '2000-01-01' },
    ])
      await http()
        .put(endpoint)
        .set(bearer(mine.accessToken))
        .send(input)
        .expect(400);
    expect((await get().expect(200)).body.goal).toBeNull();
  });

  it('persists one private goal, preserves dates on repeated PUT and deletes idempotently', async () => {
    const results = await Promise.all([
      set().expect(200),
      set().expect(200),
      set().expect(200),
    ]);
    expect(
      new Set(results.map((result) => result.body.goal.updatedAt)).size,
    ).toBe(1);
    expect(results[0].body.goal).toMatchObject({
      targetProblems: 10,
      days: 7,
      solvedProblems: 0,
      status: 'ACTIVE',
    });
    const [{ count }] = await db.query(
      'SELECT count(*)::int AS count FROM learning_goals WHERE user_id=$1',
      [mine.user.id],
    );
    expect(count).toBe(1);
    expect((await get(other.accessToken).expect(200)).body.goal).toBeNull();
    // Foreign selector is not accepted as an ownership source: the caller stays private.
    expect(
      (await get(other.accessToken).query({ userId: mine.user.id }).expect(200))
        .body.goal,
    ).toBeNull();
    await http().delete(endpoint).set(bearer(other.accessToken)).expect(200);
    expect((await get().expect(200)).body.goal.targetProblems).toBe(10);
    await db.query(
      'UPDATE learning_goals SET start_date=start_date-2 WHERE user_id=$1',
      [mine.user.id],
    );
    const prior = (await get().expect(200)).body.goal;
    expect((await set().expect(200)).body.goal).toEqual(prior);
    const changed = (await set(5, 30).expect(200)).body.goal;
    expect(changed).toMatchObject({ targetProblems: 5, days: 30 });
    expect(changed.startDate).not.toBe(prior.startDate);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await http()
            .delete(endpoint)
            .set(bearer(mine.accessToken))
            .expect(200)
        ).body.goal,
      ).toBeNull();
  });

  it('derives distinct current public ordinary solves without private/test/enterprise/source leakage', async () => {
    await set(2).expect(200);
    await submission(problems[0]);
    await submission(problems[0]);
    await submission(problems[1], { status: 'WRONG_ANSWER' });
    await submission(problems[2], { userId: other.user.id });
    await submission(problems[3], { test: true });
    await submission(problems[4]);
    await submission(problems[5]);
    await db.query('UPDATE problems SET is_private=true WHERE id=$1', [
      problems[4],
    ]);
    await db.query("UPDATE problems SET status='DRAFT' WHERE id=$1", [
      problems[5],
    ]);
    const [exam] = await db.query(
      `INSERT INTO enterprise_tests(owner_id,title,starts_at,ends_at,duration_min,problem_ids,invite_code)
       VALUES($1,'Goal exclusion',now()-interval '1 hour',now()+interval '1 hour',60,$2,$3) RETURNING id`,
      [mine.user.id, [problems[6]], `goal-${suffix}`],
    );
    const [attempt] = await db.query(
      "INSERT INTO enterprise_attempts(test_id,user_id,deadline_at) VALUES($1,$2,now()+interval '30 minutes') RETURNING id",
      [exam.id, mine.user.id],
    );
    const excluded = await submission(problems[6]);
    await db.query('UPDATE submissions SET attempt_id=$1 WHERE id=$2', [
      attempt.id,
      excluded,
    ]);
    const first = (await get().expect(200)).body;
    expect(first.goal).toMatchObject({ solvedProblems: 1, status: 'ACTIVE' });
    expect(JSON.stringify(first)).not.toMatch(
      /PRIVATE|source|email|problemId|attemptId/,
    );
    await submission(problems[1]);
    expect((await get().expect(200)).body.goal).toMatchObject({
      solvedProblems: 2,
      status: 'COMPLETED',
    });
    await db.query('UPDATE problems SET is_private=true WHERE id=$1', [
      problems[1],
    ]);
    expect((await get().expect(200)).body.goal).toMatchObject({
      solvedProblems: 1,
      status: 'ACTIVE',
    });
    await db.query(
      "UPDATE submissions SET status='WRONG_ANSWER' WHERE user_id=$1 AND problem_id=$2",
      [mine.user.id, problems[0]],
    );
    expect((await get().expect(200)).body.goal.solvedProblems).toBe(0);
  });

  it('uses inclusive KST midnight and exclusive end, with no future timestamps', async () => {
    await set(2).expect(200);
    await db.query(
      'UPDATE learning_goals SET start_date=start_date-7 WHERE user_id=$1',
      [mine.user.id],
    );
    const goal = (await get().expect(200)).body.goal;
    expect(goal.status).toBe('EXPIRED');
    expect(
      new Date(goal.endsAt).getTime() - new Date(goal.startsAt).getTime(),
    ).toBe(7 * 86400000);
    const start = new Date(goal.startsAt),
      end = new Date(goal.endsAt);
    expect(start.toISOString().slice(11)).toBe('15:00:00.000Z');
    await submission(problems[0], { at: start });
    await submission(problems[1], { at: new Date(start.getTime() - 1) });
    await submission(problems[2], { at: end });
    await submission(problems[3], { at: new Date(end.getTime() - 1) });
    expect((await get().expect(200)).body.goal).toMatchObject({
      solvedProblems: 2,
      status: 'COMPLETED',
    });
    await db.query('DELETE FROM submissions WHERE user_id=$1', [mine.user.id]);
    const reset = (
      await http()
        .post(`${endpoint}/reset`)
        .set(bearer(mine.accessToken))
        .expect(200)
    ).body.goal;
    await submission(problems[4], { at: new Date(Date.now() + 86400000) });
    expect((await get().expect(200)).body.goal).toMatchObject({
      solvedProblems: 0,
      status: 'ACTIVE',
      startDate: reset.startDate,
    });
  });

  it('restarts explicitly from today while preserving target and todays solves', async () => {
    await http()
      .post(`${endpoint}/reset`)
      .set(bearer(mine.accessToken))
      .expect(404);
    await set(15, 90).expect(200);
    await db.query(
      'UPDATE learning_goals SET start_date=start_date-20 WHERE user_id=$1',
      [mine.user.id],
    );
    const [{ yesterday }] = await db.query(
      "SELECT ((statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date-1)::timestamp AT TIME ZONE 'Asia/Seoul' AS yesterday",
    );
    await submission(problems[0], { at: yesterday });
    await submission(problems[1]);
    expect((await get().expect(200)).body.goal.solvedProblems).toBe(2);
    const restarted = (
      await http()
        .post(`${endpoint}/reset`)
        .set(bearer(mine.accessToken))
        .expect(200)
    ).body.goal;
    expect(restarted).toMatchObject({
      targetProblems: 15,
      days: 90,
      solvedProblems: 1,
    });
    expect(
      (
        await http()
          .post(`${endpoint}/reset`)
          .set(bearer(mine.accessToken))
          .expect(200)
      ).body.goal,
    ).toEqual(restarted);
  });

  it('serializes replacement and removal without duplicate goal rows', async () => {
    const responses = await Promise.all([
      set(20, 7).expect(200),
      set(30, 30).expect(200),
      http().delete(endpoint).set(bearer(mine.accessToken)).expect(200),
      set(40, 90).expect(200),
    ]);
    for (const response of responses)
      expect(response.body).toHaveProperty('goal');
    const [{ count }] = await db.query(
      'SELECT count(*)::int AS count FROM learning_goals WHERE user_id=$1',
      [mine.user.id],
    );
    expect(count).toBeLessThanOrEqual(1);
    const goal = (await get().expect(200)).body.goal;
    if (goal)
      expect([
        [20, 7],
        [30, 30],
        [40, 90],
      ]).toContainEqual([goal.targetProblems, goal.days]);
  });

  it('erases a withdrawn goal and rejects writes authenticated before withdrawal', async () => {
    const account = await register(app, 'goal_delete', suffix);
    await set(10, 7, account.accessToken).expect(200);
    const hasher = app.select(AuthModule).get(PasswordHasher, { strict: true });
    const original = hasher.verify.bind(hasher);
    let release!: () => void, entered!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const spy = vi
      .spyOn(hasher, 'verify')
      .mockImplementation(async (password, hash) => {
        const valid = await original(password, hash);
        entered();
        await pause;
        return valid;
      });
    let racing: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      const deleting = app
        .get(AuthService)
        .withdraw(actor(account), 'test-password-123');
      await locked;
      racing = Promise.allSettled([
        app
          .get(LearningGoalsService)
          .set(actor(account), { targetProblems: 30, days: 90 }),
      ]);
      await expect
        .poll(
          async () => {
            const [{ blocked }] = await db.query(`SELECT EXISTS(
          SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND query LIKE '%FROM users WHERE id = $1 AND deleted_at IS NULL%'
        ) AS blocked`);
            return blocked;
          },
          { timeout: 2500 },
        )
        .toBe(true);
      release();
      await deleting;
      expect((await racing)[0].status).toBe('rejected');
      expect(
        await db.query('SELECT * FROM learning_goals WHERE user_id=$1', [
          account.user.id,
        ]),
      ).toEqual([]);
      await get(account.accessToken).expect(401);
    } finally {
      release();
      spy.mockRestore();
      await racing;
    }
  });

  it('enforces database bounds and supports isolated rollback/reapply without changing submissions', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const migration = new LearningGoals1796200000000();
      await migration.down(runner);
      expect(
        (await runner.query("SELECT to_regclass('learning_goals') AS name"))[0]
          .name,
      ).toBeNull();
      await migration.up(runner);
      await runner.query(
        'INSERT INTO learning_goals(user_id,target_problems,days,start_date) VALUES($1,1,7,current_date)',
        [mine.user.id],
      );
      for (const change of [
        'days=8',
        'target_problems=0',
        'target_problems=1001',
      ]) {
        await runner.query('SAVEPOINT invalid_goal');
        await expect(
          runner.query(`UPDATE learning_goals SET ${change} WHERE user_id=$1`, [
            mine.user.id,
          ]),
        ).rejects.toThrow();
        await runner.query('ROLLBACK TO SAVEPOINT invalid_goal');
      }
      expect(
        (
          await runner.query(
            'SELECT target_problems,days FROM learning_goals WHERE user_id=$1',
            [mine.user.id],
          )
        )[0],
      ).toEqual({ target_problems: 1, days: 7 });
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
