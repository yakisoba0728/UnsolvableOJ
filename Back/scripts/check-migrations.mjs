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
  assert.equal(
    (await db.runMigrations()).length,
    configured.options.migrations.length - 1,
  );
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
  const acceptedEvidence = await db.query(
    "SELECT id, accepted_for_xp FROM submissions WHERE status = 'ACCEPTED'",
  );
  assert.equal(acceptedEvidence.length, 2);
  assert.ok(acceptedEvidence.every((row) => row.accepted_for_xp));

  // Simulate the pre-evidence schema with both known and unknowable past verdicts.
  await db.undoLastMigration();
  const evidenceFixtures = [];
  for (const [status, anchored, accepted] of [
    ['ACCEPTED', false, true],
    ['QUEUED', true, true],
    ['JUDGING', true, true],
    ['SYSTEM_ERROR', true, true],
    ['CANCELLED', true, true],
    ['SYSTEM_ERROR', false, false],
    ['WRONG_ANSWER', true, false],
    ['TIME_LIMIT_EXCEEDED', true, false],
    ['MEMORY_LIMIT_EXCEEDED', true, false],
    ['RUNTIME_ERROR', true, false],
    ['COMPILE_ERROR', true, false],
    ['OUTPUT_LIMIT_EXCEEDED', true, false],
  ]) {
    const suffix = randomUUID();
    const [solver] = await db.query(
      `INSERT INTO users (email, username, password_hash, xp)
       VALUES ($1, $2, 'unused', 37) RETURNING id`,
      [`evidence-${suffix}@example.com`, `evidence_${suffix.slice(0, 8)}`],
    );
    const [submission] = await db.query(
      `INSERT INTO submissions (user_id, problem_id, language, source_code, status)
       VALUES ($1, $2, 'PYTHON', 'print(3)', $3) RETURNING id`,
      [solver.id, problem.id, status],
    );
    if (anchored)
      await db.query(
        `INSERT INTO user_problem_solves (user_id, problem_id, accepted_submission_id, awarded_xp)
         VALUES ($1, $2, $3, 10)`,
        [solver.id, problem.id, submission.id],
      );
    evidenceFixtures.push({ userId: solver.id, id: submission.id, accepted });
  }
  const xpBeforeEvidence = await db.query(
    'SELECT id, xp, level FROM users ORDER BY id',
  );
  const solvesBeforeEvidence = await db.query(
    'SELECT * FROM user_problem_solves ORDER BY user_id, problem_id',
  );
  assert.equal((await db.runMigrations()).length, 1);
  for (const fixture of evidenceFixtures)
    assert.equal(
      (await db.query('SELECT accepted_for_xp FROM submissions WHERE id = $1', [
        fixture.id,
      ]))[0].accepted_for_xp,
      fixture.accepted,
    );
  assert.deepEqual(
    await db.query('SELECT id, xp, level FROM users ORDER BY id'),
    xpBeforeEvidence,
  );
  assert.deepEqual(
    await db.query('SELECT * FROM user_problem_solves ORDER BY user_id, problem_id'),
    solvesBeforeEvidence,
  );
  const [fresh] = await db.query(
    `INSERT INTO submissions (user_id, problem_id, language, source_code)
     VALUES ($1, $2, 'PYTHON', 'print(3)') RETURNING accepted_for_xp`,
    [evidenceFixtures[0].userId, problem.id],
  );
  assert.equal(fresh.accepted_for_xp, false);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
    evidenceFixtures.map((fixture) => fixture.userId),
  ]);
  // Even a non-ledger-anchor AC must retain its evidence across a downgrade refusal.
  const [solve] = await db.query(
    'SELECT accepted_submission_id FROM user_problem_solves',
  );
  const alternative = acceptedEvidence.find(
    (row) => row.id !== solve.accepted_submission_id,
  );
  assert.ok(alternative);
  const beforeEvidenceRefusal = await db.query(
    'SELECT name FROM migrations ORDER BY id',
  );
  for (const status of ['QUEUED', 'JUDGING', 'SYSTEM_ERROR', 'CANCELLED']) {
    await db.query('UPDATE submissions SET status = $2 WHERE id = $1', [
      alternative.id,
      status,
    ]);
    await assert.rejects(
      db.undoLastMigration(),
      /Cannot roll back submission XP evidence with retained acceptance outside ACCEPTED/,
    );
    assert.deepEqual(
      await db.query('SELECT name FROM migrations ORDER BY id'),
      beforeEvidenceRefusal,
    );
    assert.deepEqual(
      (await db.query(
        'SELECT status, accepted_for_xp FROM submissions WHERE id = $1',
        [alternative.id],
      ))[0],
      { status, accepted_for_xp: true },
    );
  }
  await db.query("UPDATE submissions SET status = 'ACCEPTED' WHERE id = $1", [
    alternative.id,
  ]);
  await verifyBackfill();

  // Backfill rollback keeps its ledger, so reapplying it cannot award XP twice.
  await db.undoLastMigration();
  await db.undoLastMigration();
  await db.undoLastMigration();
  await verifyBackfill();
  const beforeRefusal = await db.query('SELECT name FROM migrations ORDER BY id');
  await assert.rejects(
    db.undoLastMigration(),
    /Cannot roll back backend foundations with a populated solve ledger/,
  );
  assert.deepEqual(await db.query('SELECT name FROM migrations ORDER BY id'), beforeRefusal);
  for (const table of ['audit_events', 'user_problem_solves', 'problem_versions']) {
    assert.equal(
      (await db.query('SELECT to_regclass($1)::text AS name', [`public.${table}`]))[0].name,
      table,
    );
  }
  await verifyBackfill();
  assert.equal((await db.runMigrations()).length, 3);
  await verifyBackfill();

  // A full rollback is only valid for an empty ledger: use a genuinely fresh DB.
  await db.destroy();
  await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  created = false;
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = await new DataSource(options).initialize();
  assert.equal((await db.runMigrations()).length, configured.options.migrations.length);
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
    'Migrations: legacy upgrade, snapshots, solve/XP idempotency, acceptance evidence backfill/refusal, partial rollback, populated-ledger refusal and fresh install/rollback/reapply passed.',
  );
} finally {
  if (db?.isInitialized) await db.destroy();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.destroy();
}
