import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import configured from '../dist/database/data-source.js';
import { InitialSchema1726916400000 } from '../dist/database/migrations/1726916400000-initial-schema.js';
import { BackfillSolves1790551000000 } from '../dist/database/migrations/1790551000000-backfill-solves.js';

// Only this generated database is modified/dropped. The configured database is
// used to obtain a connection with CREATEDB permission, never as a test target.
const name = `unsolvable_migrations_${randomUUID().replaceAll('-', '')}`;
const admin = new DataSource({
  ...configured.options,
  entities: [],
  migrations: [],
});
const url = new URL(configured.options.url);
url.pathname = `/${name}`;
const options = { ...configured.options, url: url.href };
let db;
let created = false;
await admin.initialize();
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = await new DataSource({
    ...options,
    migrations: [InitialSchema1726916400000],
  }).initialize();
  await db.runMigrations();
  const [user] =
    await db.query(`INSERT INTO users (email, username, password_hash)
    VALUES ('legacy@example.com', 'legacy', 'unused') RETURNING id`);
  const [problem] = await db.query(
    `INSERT INTO problems (slug, title, statement_md, difficulty, author_id)
    VALUES ('legacy-sum', 'Legacy sum', 'Add', 'BEGINNER', $1) RETURNING id`,
    [user.id],
  );
  await db.query(
    `INSERT INTO test_cases (problem_id, input, expected_output, "order")
    VALUES ($1, '1 2', '3', 0), ($1, '5 7', '12', 1)`,
    [problem.id],
  );
  await db.query(
    `INSERT INTO submissions (user_id, problem_id, language, source_code, status)
    VALUES ($1, $2, 'PYTHON', 'print(3)', 'ACCEPTED'),
           ($1, $2, 'PYTHON', 'print(3)', 'ACCEPTED'),
           ($1, $2, 'PYTHON', 'print(3)', 'JUDGING')`,
    [user.id, problem.id],
  );
  await db.destroy();
  db = await new DataSource(options).initialize();
  assert.equal((await db.runMigrations()).length, 2);
  const [{ snapshot }] = await db.query(
    'SELECT snapshot FROM problem_versions WHERE problem_id = $1',
    [problem.id],
  );
  assert.deepEqual(
    snapshot.testCases.map((test) => test.expectedOutput),
    ['3', '12'],
  );
  assert.equal(snapshot.memoryLimitMb, 256);
  const verifyBackfill = async () => {
    assert.equal(
      (await db.query('SELECT xp FROM users WHERE id = $1', [user.id]))[0].xp,
      10,
    );
    assert.equal(
      (await db.query('SELECT * FROM user_problem_solves')).length,
      1,
    );
    const [lease] =
      await db.query(`SELECT judge_lease_expires_at < now() AS expired
      FROM submissions WHERE status = 'JUDGING'`);
    assert.equal(lease.expired, true);
  };
  await verifyBackfill();
  const runner = db.createQueryRunner();
  try {
    await new BackfillSolves1790551000000().up(runner);
    await verifyBackfill();
  } finally {
    await runner.release();
  }
  assert.deepEqual(await db.runMigrations(), []);
  for (let i = 0; i < configured.options.migrations.length; i++)
    await db.undoLastMigration();
  assert.equal(
    (await db.query("SELECT to_regclass('public.users') AS table_name"))[0]
      .table_name,
    null,
  );
  assert.equal(
    (await db.runMigrations()).length,
    configured.options.migrations.length,
  );
  assert.equal(await db.showMigrations(), false);
  console.log(
    'Migrations: legacy upgrade, ordered snapshots, solve/XP backfill, expired leases, idempotency, rollback and fresh install passed.',
  );
} finally {
  if (db?.isInitialized) await db.destroy();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.destroy();
}
