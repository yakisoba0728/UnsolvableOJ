import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, type QueryRunner } from 'typeorm';
import { EnterpriseProblemVersions1795800000000 } from '../src/database/migrations/1795800000000-enterprise-problem-versions.js';
import { closeApp, createApp, register } from './helpers.js';

describe('Enterprise version binding migration (real PostgreSQL)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let userId: string;
  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    userId = (await register(app, 'version_migration', randomUUID().slice(0, 8))).user.id;
  });
  afterAll(() => closeApp(app, []));

  async function rolledBack(work: (runner: QueryRunner) => Promise<void>) {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('DROP TABLE enterprise_problem_versions');
      // The integration runner shares a database between sequential files. Model
      // a fresh legacy fixture inside this rollback-only transaction, excluding
      // other suites' deliberately synthetic assessment references.
      await runner.query('DELETE FROM enterprise_tests');
      await work(runner);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    expect((await db.query("SELECT to_regclass('enterprise_problem_versions')::text AS name"))[0].name).toBe('enterprise_problem_versions');
  }
  async function problem(runner: QueryRunner, version: number, snapshot = true) {
    const [row]: { id: string }[] = await runner.query(
      `INSERT INTO problems(slug,title,statement_md,difficulty,author_id,current_version)
       VALUES($1,'migration','statement','BEGINNER',$2,$3) RETURNING id`,
      [`migration-${randomUUID()}`, userId, version],
    );
    if (snapshot) await runner.query('INSERT INTO problem_versions(problem_id,version,snapshot) VALUES($1,$2,\'{}\')', [row.id, version]);
    return row.id;
  }
  async function assessment(runner: QueryRunner, ids: string[]) {
    const [row]: { id: string }[] = await runner.query(
      `INSERT INTO enterprise_tests(owner_id,title,starts_at,ends_at,duration_min,problem_ids,invite_code,vibe_challenge_ids)
       VALUES($1,'migration',clock_timestamp(),clock_timestamp()+interval '1 hour',30,$2,$3,$4) RETURNING id`,
      [userId, ids, randomUUID().replaceAll('-', ''), ids.length ? [] : ['post-search-v1']],
    );
    return row.id;
  }

  it('binds existing assessments in order at the migration cutoff without rewriting historical submissions', async () => {
    await rolledBack(async (runner) => {
      const first = await problem(runner, 3);
      const second = await problem(runner, 2);
      const testId = await assessment(runner, [second, first]);
      const vibeOnly = await assessment(runner, []);
      const [submission]: { id: string }[] = await runner.query(
        "INSERT INTO submissions(user_id,problem_id,language,source_code,status,problem_version,is_test) VALUES($1,$2,'PYTHON','pass','WRONG_ANSWER',1,true) RETURNING id",
        [userId, first],
      );
      await new EnterpriseProblemVersions1795800000000().up(runner);
      expect(await runner.query('SELECT problem_id,version,position FROM enterprise_problem_versions WHERE test_id=$1 ORDER BY position', [testId])).toEqual([
        { problem_id: second, version: 2, position: 1 }, { problem_id: first, version: 3, position: 2 },
      ]);
      expect(await runner.query('SELECT 1 FROM enterprise_problem_versions WHERE test_id=$1', [vibeOnly])).toEqual([]);
      expect((await runner.query('SELECT problem_version FROM submissions WHERE id=$1', [submission.id]))[0].problem_version).toBe(1);
      await new EnterpriseProblemVersions1795800000000().down(runner);
      expect((await runner.query("SELECT to_regclass('enterprise_problem_versions') AS name"))[0].name).toBeNull();
    });
  });

  it('fails atomically when an existing assessment references a missing problem', async () => {
    await rolledBack(async (runner) => {
      await assessment(runner, [randomUUID()]);
      await expect(new EnterpriseProblemVersions1795800000000().up(runner)).rejects.toThrow(/missing problems/);
    });
  });

  it('refuses a missing immutable version instead of silently selecting another version', async () => {
    await rolledBack(async (runner) => {
      await assessment(runner, [await problem(runner, 99, false)]);
      await expect(new EnterpriseProblemVersions1795800000000().up(runner)).rejects.toThrow(/foreign key/i);
    });
  });
});
