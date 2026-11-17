import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, type QueryRunner } from 'typeorm';
import { IncrementalProblemStats1796100000000 } from '../src/database/migrations/1796100000000-incremental-problem-stats.js';
import { SubmissionStatus } from '../src/modules/submissions/submission.enums.js';
import { closeApp, createApp, register } from './helpers.js';

describe('Incremental problem statistics (real PostgreSQL)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let owner: string;
  const users: string[] = [];
  const problems: string[] = [];
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    owner = (await register(app, 'stats_owner', suffix)).user.id;
    for (let n = 0; n < 3; n++) {
      const [user] = await db.query(`INSERT INTO users(email,username,password_hash)
        VALUES($1,$2,'synthetic') RETURNING id`, [`stats-${suffix}-${n}@example.invalid`, `stats_${suffix}_${n}`]);
      users.push(user.id);
      const [problem] = await db.query(`INSERT INTO problems(slug,title,statement_md,difficulty,status,author_id)
        VALUES($1,'Stats test','Synthetic','BEGINNER','PUBLISHED',$2) RETURNING id`, [`stats-${suffix}-${n}`, owner]);
      problems.push(problem.id);
    }
  });
  beforeEach(async () => {
    await db.query('DELETE FROM submissions WHERE problem_id=ANY($1::uuid[])', [problems]);
  });
  afterAll(() => closeApp(app, []));

  async function insert(count: number, status = 'ACCEPTED', user = users[0], problem = problems[0], test = false, executor: DataSource | QueryRunner = db) {
    return executor.query(`INSERT INTO submissions(user_id,problem_id,language,source_code,status,is_test)
      SELECT $1,$2,'PYTHON','fixture',$3,$4 FROM generate_series(1,$5::integer) RETURNING id`, [user, problem, status, test, count]) as Promise<{ id: string }[]>;
  }
  async function consistent(executor: DataSource | QueryRunner = db) {
    const expected = await executor.query(`SELECT p.id AS problem_id,
      count(DISTINCT s.user_id) FILTER(WHERE s.status='ACCEPTED')::integer AS solver_count,
      count(*) FILTER(WHERE s.status='ACCEPTED')::integer AS accepted_count,
      count(s.id)::integer AS finished_count
      FROM problems p LEFT JOIN submissions s ON s.problem_id=p.id AND NOT s.is_test
        AND s.status NOT IN ('QUEUED','JUDGING','SYSTEM_ERROR','CANCELLED')
      WHERE p.id=ANY($1::uuid[]) GROUP BY p.id ORDER BY p.id`, [problems]);
    const actual = await executor.query(`SELECT p.id AS problem_id,COALESCE(s.solver_count,0) AS solver_count,
      COALESCE(s.accepted_count,0) AS accepted_count,COALESCE(s.finished_count,0) AS finished_count
      FROM problems p LEFT JOIN problem_stats s ON s.problem_id=p.id WHERE p.id=ANY($1::uuid[]) ORDER BY p.id`, [problems]);
    expect(actual).toEqual(expected);
    expect(await executor.query(`SELECT problem_id,user_id,accepted_count FROM problem_solver_counts
      WHERE problem_id=ANY($1::uuid[]) ORDER BY problem_id,user_id`, [problems])).toEqual(
      await executor.query(`SELECT problem_id,user_id,count(*)::integer AS accepted_count FROM submissions
        WHERE problem_id=ANY($1::uuid[]) AND NOT is_test AND status='ACCEPTED'
        GROUP BY problem_id,user_id ORDER BY problem_id,user_id`, [problems]),
    );
  }
  async function transaction() {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query("SET LOCAL lock_timeout='2500ms'");
    return runner;
  }
  async function finish(runner: QueryRunner) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }

  it('preserves all verdict/test policies and distinct users across multirow rejudges and deletions', async () => {
    for (const status of Object.values(SubmissionStatus)) {
      await insert(3, status);
      await insert(2, status, users[1]);
      await insert(2, status, users[2], problems[1], true);
      await consistent();
    }
    await db.query("UPDATE submissions SET status='JUDGING' WHERE problem_id=$1", [problems[0]]);
    await consistent();
    await db.query("UPDATE submissions SET status='ACCEPTED' WHERE problem_id=$1", [problems[0]]);
    await consistent();
    await db.query('UPDATE submissions SET is_test=NOT is_test WHERE problem_id=ANY($1::uuid[])', [problems]);
    await consistent();
    await db.query('DELETE FROM submissions WHERE user_id=$1 AND problem_id=ANY($2::uuid[])', [users[0], problems]);
    await consistent();
  });

  it('matches a full-recount oracle through deterministic mixed/bulk mutations', async () => {
    let state = 0x12ab34cd;
    const random = (max: number) => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % max; };
    const statuses = Object.values(SubmissionStatus);
    let ids: string[] = [];
    for (let step = 0; step < 160; step++) {
      const selected = [...ids].sort().filter((_, i) => i % 3 === step % 3).slice(0, 5);
      if (step % 3 === 0 || !ids.length) {
        const added = await insert(1 + random(5), statuses[random(statuses.length)], users[random(users.length)], problems[random(problems.length)], random(4) === 0);
        ids.push(...added.map(row => row.id));
      } else if (step % 3 === 1) {
        await db.query(`UPDATE submissions SET status=$1,is_test=$2,user_id=$3,problem_id=$4 WHERE id=ANY($5::uuid[])`,
          [statuses[random(statuses.length)], random(4) === 0, users[random(users.length)], problems[random(problems.length)], selected]);
      } else {
        await db.query('DELETE FROM submissions WHERE id=ANY($1::uuid[])', [selected]);
        const removed = new Set(selected); ids = ids.filter(id => !removed.has(id));
      }
      await consistent();
    }
  }, 20_000);

  it('does not rewrite aggregates for lease updates or count-equivalent terminal verdict changes', async () => {
    const [{ id }] = await insert(1, 'WRONG_ANSWER');
    const before = await db.query('SELECT xmin::text,ctid::text FROM problem_stats WHERE problem_id=$1', [problems[0]]);
    await db.query("UPDATE submissions SET judge_lease_expires_at=now()+interval '1 minute',updated_at=now() WHERE id=$1", [id]);
    await db.query("UPDATE submissions SET status='COMPILE_ERROR' WHERE id=$1", [id]);
    expect(await db.query('SELECT xmin::text,ctid::text FROM problem_stats WHERE problem_id=$1', [problems[0]])).toEqual(before);
    await consistent();
  });

  it('serializes concurrent completions without losing a distinct solver', async () => {
    const [a] = await insert(1, 'JUDGING');
    const [b] = await insert(1, 'JUDGING', users[1]);
    const first = await transaction();
    const second = await transaction();
    let pending: Promise<unknown> | undefined;
    try {
      await first.query("UPDATE submissions SET status='ACCEPTED' WHERE id=$1", [a.id]);
      const [{ pid }] = await first.query('SELECT pg_backend_pid() AS pid');
      pending = second.query("UPDATE submissions SET status='ACCEPTED' WHERE id=$1", [b.id]);
      const observed = Promise.allSettled([pending]);
      await expect.poll(async () => (await db.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked', [pid]))[0].blocked).toBe(true);
      await first.commitTransaction();
      expect((await observed)[0].status).toBe('fulfilled');
      await second.commitTransaction();
      await consistent();
      expect((await db.query('SELECT solver_count FROM problem_stats WHERE problem_id=$1', [problems[0]]))[0].solver_count).toBe(2);
    } finally { await finish(first); await finish(second); await pending?.catch(() => {}); }
  });

  it('locks multi-problem statement targets in stable order and rolls back all derived changes', async () => {
    const first = await transaction();
    const second = await transaction();
    let pending: Promise<unknown> | undefined;
    try {
      const bulk = `INSERT INTO submissions(user_id,problem_id,language,source_code,status)
        SELECT $1,p,'PYTHON','fixture','ACCEPTED' FROM unnest($2::uuid[]) p`;
      await first.query(bulk, [users[0], [...problems].reverse()]);
      const [{ pid }] = await first.query('SELECT pg_backend_pid() AS pid');
      pending = second.query(bulk, [users[1], [...problems]]);
      const observed = Promise.allSettled([pending]);
      await expect.poll(async () => (await db.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked', [pid]))[0].blocked).toBe(true);
      await first.rollbackTransaction();
      expect((await observed)[0].status).toBe('fulfilled');
      await second.commitTransaction();
      await consistent();
    } finally { await finish(first); await finish(second); await pending?.catch(() => {}); }
  });

  it('preserves one distinct solver across a blocked same-user insert versus delete, with commit or rollback', async () => {
    for (const commit of [true, false]) {
      await db.query('DELETE FROM submissions WHERE problem_id=$1', [problems[0]]);
      const [old] = await insert(1);
      const deleting = await transaction();
      const inserting = await transaction();
      let pending: Promise<unknown> | undefined;
      try {
        await deleting.query('DELETE FROM submissions WHERE id=$1', [old.id]);
        const [{ pid }] = await deleting.query('SELECT pg_backend_pid() AS pid');
        pending = insert(3, 'ACCEPTED', users[0], problems[0], false, inserting);
        const observed = Promise.allSettled([pending]);
        await expect.poll(async () => (await db.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked', [pid]))[0].blocked).toBe(true);
        if (commit) await deleting.commitTransaction(); else await deleting.rollbackTransaction();
        expect((await observed)[0].status).toBe('fulfilled');
        await inserting.commitTransaction();
        await consistent();
        expect((await db.query('SELECT solver_count,accepted_count FROM problem_stats WHERE problem_id=$1', [problems[0]]))[0]).toEqual({ solver_count: 1, accepted_count: commit ? 3 : 4 });
      } finally { await finish(deleting); await finish(inserting); await pending?.catch(() => {}); }
    }
  });

  it('does not introduce a stats-to-user lock and cleans multiplicities on physical user deletion', async () => {
    const [user] = await db.query("INSERT INTO users(email,username,password_hash) VALUES($1,$2,'synthetic') RETURNING id", [`cascade-${suffix}@example.invalid`, `cascade_${suffix}`]);
    const rows = await insert(3, 'JUDGING', user.id);
    const deleting = await transaction();
    const judging = await transaction();
    try {
      await deleting.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
      // The cache must not acquire a user FK lock while holding problem statistics.
      await judging.query("UPDATE submissions SET status='ACCEPTED' WHERE id=ANY($1::uuid[])", [rows.map(row => row.id)]);
      await judging.commitTransaction();
      await deleting.query('DELETE FROM users WHERE id=$1', [user.id]);
      await deleting.commitTransaction();
      await consistent();
      expect(await db.query('SELECT 1 FROM problem_solver_counts WHERE user_id=$1', [user.id])).toEqual([]);
    } finally { await finish(deleting); await finish(judging); }
  });

  it('does not introduce a stats-to-problem lock when a new solver completes an existing problem', async () => {
    await insert(1, 'ACCEPTED');
    const [submission] = await insert(1, 'JUDGING', users[1]);
    const editing = await transaction();
    const judging = await transaction();
    try {
      await editing.query('SELECT id FROM problems WHERE id=$1 FOR UPDATE', [problems[0]]);
      // A new solver counter references the already locked stats row, not the
      // problem row held by a separate author/admin transaction.
      await judging.query("UPDATE submissions SET status='ACCEPTED' WHERE id=$1", [submission.id]);
      await judging.commitTransaction();
      await editing.commitTransaction();
      await consistent();
    } finally { await finish(editing); await finish(judging); }
  });

  it('clears derived data on TRUNCATE and preserves it when the truncate is rolled back', async () => {
    await insert(4);
    const runner = await transaction();
    try {
      await runner.query('TRUNCATE submissions CASCADE');
      expect(await runner.query('SELECT 1 FROM problem_stats')).toEqual([]);
      expect(await runner.query('SELECT 1 FROM problem_solver_counts')).toEqual([]);
    } finally { await finish(runner); }
    await consistent();
  });

  it('preserves problem-history deletion restrictions and removes derived rows after explicit history cleanup', async () => {
    const [problem] = await db.query(`INSERT INTO problems(slug,title,statement_md,difficulty,status,author_id)
      VALUES($1,'Cascade','Synthetic','BEGINNER','PUBLISHED',$2) RETURNING id`, [`cascade-${suffix}`, owner]);
    await insert(3, 'ACCEPTED', users[0], problem.id);
    await insert(2, 'WRONG_ANSWER', users[1], problem.id);
    await expect(db.query('DELETE FROM problems WHERE id=$1', [problem.id])).rejects.toMatchObject({ code: '23503' });
    expect((await db.query('SELECT solver_count,accepted_count,finished_count FROM problem_stats WHERE problem_id=$1', [problem.id]))[0]).toEqual({ solver_count: 1, accepted_count: 3, finished_count: 5 });
    await db.query('DELETE FROM submissions WHERE problem_id=$1', [problem.id]);
    await db.query('DELETE FROM problems WHERE id=$1', [problem.id]);
    for (const table of ['submissions', 'problem_stats', 'problem_solver_counts']) {
      expect(await db.query(`SELECT 1 FROM ${table} WHERE problem_id=$1`, [problem.id])).toEqual([]);
    }
    await consistent();
  });

  it('backfills and rolls back with populated history, while refusing nontransactional DDL', async () => {
    const migration = new IncrementalProblemStats1796100000000();
    const runner = await transaction();
    try {
      await migration.down(runner);
      await insert(4, 'ACCEPTED', users[0], problems[0], false, runner);
      await insert(2, 'ACCEPTED', users[1], problems[0], false, runner);
      await insert(3, 'WRONG_ANSWER', users[1], problems[1], false, runner);
      // Reconcile missing legacy parent stats before adding derived counters.
      await runner.query('DELETE FROM problem_stats WHERE problem_id=$1', [problems[0]]);
      await migration.up(runner);
      await consistent(runner);
      const stats = await runner.query('SELECT * FROM problem_stats ORDER BY problem_id');
      await migration.down(runner);
      expect(await runner.query('SELECT * FROM problem_stats ORDER BY problem_id')).toEqual(stats);
      expect((await runner.query("SELECT to_regclass('problem_solver_counts') AS name"))[0].name).toBeNull();
      await migration.up(runner);
      await consistent(runner);
    } finally { await finish(runner); }
    const plain = db.createQueryRunner();
    try {
      await expect(migration.up(plain)).rejects.toThrow(/requires a transaction/);
      await expect(migration.down(plain)).rejects.toThrow(/requires a transaction/);
    } finally { await plain.release(); }
  });
});
