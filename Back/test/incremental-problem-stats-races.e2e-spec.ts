import { randomUUID } from 'node:crypto';
import db from '../src/database/data-source.js';

describe('Independent incremental-statistics boundary probes', () => {
  const users = [randomUUID(), randomUUID()];
  const problems: string[] = [];
  const insert = `INSERT INTO submissions(user_id,problem_id,language,source_code,status)
    VALUES($1,$2,'PYTHON','independent synthetic probe','ACCEPTED') RETURNING id`;
  beforeAll(async () => {
    await db.initialize();
    for (const id of users) await db.query(`INSERT INTO users(id,email,username,password_hash)
      VALUES($1,$2,$3,'synthetic')`, [id, `${id}@independent.invalid`, id.replaceAll('-', '').slice(0, 30)]);
  });
  afterAll(async () => { if (db.isInitialized) await db.destroy(); });

  async function problem() {
    const id = randomUUID();
    await db.query(`INSERT INTO problems(id,slug,title,statement_md,difficulty,status,author_id)
      VALUES($1,$2,'Independent stats','Synthetic','BEGINNER','PUBLISHED',$3)`, [id, id, users[0]]);
    problems.push(id);
    return id;
  }
  async function oracle(id: string) {
    const [expected] = await db.query(`SELECT count(DISTINCT user_id) FILTER(WHERE status='ACCEPTED')::integer AS solver_count,
      count(*) FILTER(WHERE status='ACCEPTED')::integer AS accepted_count,count(*)::integer AS finished_count
      FROM submissions WHERE problem_id=$1 AND NOT is_test
      AND status NOT IN ('QUEUED','JUDGING','SYSTEM_ERROR','CANCELLED')`, [id]);
    expect((await db.query('SELECT solver_count,accepted_count,finished_count FROM problem_stats WHERE problem_id=$1', [id]))[0]).toEqual(expected);
    expect(await db.query('SELECT user_id,accepted_count FROM problem_solver_counts WHERE problem_id=$1 ORDER BY user_id', [id]))
      .toEqual(await db.query("SELECT user_id,count(*)::integer AS accepted_count FROM submissions WHERE problem_id=$1 AND NOT is_test AND status='ACCEPTED' GROUP BY user_id ORDER BY user_id", [id]));
  }

  it('serializes creation of the first stats row across commit and rollback of its initial writer', async () => {
    for (const commit of [true, false]) {
      const id = await problem();
      expect(await db.query('SELECT 1 FROM problem_stats WHERE problem_id=$1', [id])).toEqual([]);
      const a = db.createQueryRunner(), b = db.createQueryRunner();
      await a.connect(); await b.connect();
      await a.startTransaction(); await b.startTransaction();
      await a.query("SET LOCAL lock_timeout='2500ms'");
      await b.query("SET LOCAL lock_timeout='2500ms'");
      let observed: Promise<PromiseSettledResult<unknown>[]> | undefined;
      try {
        await a.query(insert, [users[0], id]);
        const [{ pid }] = await a.query('SELECT pg_backend_pid() AS pid');
        observed = Promise.allSettled([b.query(insert, [users[1], id])]);
        await expect.poll(async () => (await db.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked', [pid]))[0].blocked).toBe(true);
        if (commit) await a.commitTransaction(); else await a.rollbackTransaction();
        expect((await observed)[0].status).toBe('fulfilled');
        await b.commitTransaction();
        await oracle(id);
        expect((await db.query('SELECT solver_count FROM problem_stats WHERE problem_id=$1', [id]))[0].solver_count).toBe(commit ? 2 : 1);
      } finally {
        if (a.isTransactionActive) await a.rollbackTransaction();
        if (b.isTransactionActive) await b.rollbackTransaction();
        await a.release(); await b.release(); await observed;
      }
    }
  });

  it('fails the verdict write atomically if a deliberately corrupted multiplicity would underflow', async () => {
    const id = await problem();
    const [submission] = await db.query(insert, [users[0], id]);
    const runner = db.createQueryRunner();
    await runner.connect(); await runner.startTransaction();
    try {
      await runner.query('DELETE FROM problem_solver_counts WHERE problem_id=$1', [id]);
      await expect(runner.query("UPDATE submissions SET status='WRONG_ANSWER' WHERE id=$1", [submission.id])).rejects.toMatchObject({ code: 'P0001' });
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    expect((await db.query('SELECT status FROM submissions WHERE id=$1', [submission.id]))[0].status).toBe('ACCEPTED');
    await oracle(id);
  });
});
