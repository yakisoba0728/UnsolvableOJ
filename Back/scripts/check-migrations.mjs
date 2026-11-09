import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import configured from '../dist/database/data-source.js';
import { InitialSchema1726916400000 } from '../dist/database/migrations/1726916400000-initial-schema.js';
import { BackfillSolves1790551000000 } from '../dist/database/migrations/1790551000000-backfill-solves.js';
import { BackendFoundations1790550000000 } from '../dist/database/migrations/1790550000000-backend-foundations.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from '../dist/modules/auth/jwt.strategy.js';
import { User } from '../dist/modules/users/user.entity.js';

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
  // 아래의 부분 되돌리기 검사는 강화 마이그레이션까지만 다룬다(마지막 것부터 되돌리므로).
  // 그 뒤에 추가된 마이그레이션은 마지막의 새 설치·전체 되돌리기·재적용에서 확인한다.
  const hardening = configured.options.migrations.findIndex(
    (migration) => migration.name === 'BackendHardening1790554000000',
  );
  assert.notEqual(hardening, -1);
  const throughHardening = configured.options.migrations.slice(0, hardening + 1);
  db = await new DataSource({ ...options, migrations: throughHardening }).initialize();
  assert.equal(
    (await db.runMigrations()).length,
    throughHardening.length - 1,
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

  // Case-only username duplicates stop the hardening migration and are listed, not renamed.
  await db.undoLastMigration();
  const [caseDuplicate] = await db.query(`INSERT INTO users (email, username, password_hash)
    VALUES ('legacy-upper@example.com', 'Legacy', 'unused') RETURNING id`);
  await assert.rejects(
    db.runMigrations(),
    /Usernames differ only by case; rename them before migrating: Legacy, legacy/,
  );
  await db.query('DELETE FROM users WHERE id = $1', [caseDuplicate.id]);

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
  assert.equal((await db.runMigrations()).length, 2);
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
  await db.undoLastMigration();
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
  assert.equal((await db.runMigrations()).length, 4);
  await verifyBackfill();

  // Independent foundations fixtures: neither has a solve ledger to mask the guard.
  await db.destroy();
  await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  created = false;
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = await new DataSource({ ...options, migrations: [InitialSchema1726916400000, BackendFoundations1790550000000] }).initialize();
  await db.runMigrations();
  const [owner] = await db.query(`INSERT INTO users(email,username,password_hash)
    VALUES('versions@fixture.invalid','versions','unused') RETURNING id`);
  const [versioned] = await db.query(`INSERT INTO problems(slug,title,statement_md,difficulty,author_id,current_version)
    VALUES('versions','v2','v2 statement','BEGINNER',$1,2) RETURNING id`, [owner.id]);
  await db.query(`INSERT INTO problem_versions(problem_id,version,snapshot) VALUES
    ($1,1,'{"statementMarkdown":"v1","testCases":[{"expectedOutput":"original"}]}'),
    ($1,2,'{"statementMarkdown":"v2","testCases":[{"expectedOutput":"changed"}]}')`, [versioned.id]);
  await db.query(`INSERT INTO submissions(user_id,problem_id,language,source_code,status,problem_version)
    VALUES($1,$2,'PYTHON','pass','WRONG_ANSWER',1)`, [owner.id, versioned.id]);
  const versionsBefore = await db.query('SELECT * FROM problem_versions ORDER BY version');
  const submissionBefore = await db.query('SELECT * FROM submissions');
  const migrationBefore = await db.query('SELECT * FROM migrations ORDER BY id');
  const unwrapped = db.createQueryRunner();
  try {
    await assert.rejects(new BackendFoundations1790550000000().down(unwrapped), /requires a transaction/);
  } finally {
    await unwrapped.release();
  }
  const locked = db.createQueryRunner();
  await locked.connect();
  await locked.startTransaction();
  try {
    const [{ pid }] = await locked.query('SELECT pg_backend_pid() AS pid');
    const query = locked.query.bind(locked);
    locked.query = async (sql, ...parameters) => {
      const boundary = sql.indexOf('DO $$');
      if (boundary < 0) return query(sql, ...parameters);
      // Observe the real migration's locks before its refusal check, in the same transaction.
      await query(sql.slice(0, boundary));
      const locks = await db.query(`SELECT c.relname FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
        WHERE l.pid=$1 AND l.mode='AccessExclusiveLock' AND l.granted`, [pid]);
      for (const table of ['users', 'problems', 'submissions', 'problem_versions', 'user_problem_solves'])
        assert.ok(locks.some((row) => row.relname === table), `${table} must be locked before checking`);
      return query(sql.slice(boundary), ...parameters);
    };
    await assert.rejects(new BackendFoundations1790550000000().down(locked), /version history/);
  } finally {
    await locked.rollbackTransaction();
    await locked.release();
  }
  await assert.rejects(db.undoLastMigration(), /Cannot roll back backend foundations with version history/);
  assert.deepEqual(await db.query('SELECT * FROM problem_versions ORDER BY version'), versionsBefore);
  assert.deepEqual(await db.query('SELECT * FROM submissions'), submissionBefore);
  assert.deepEqual(await db.query('SELECT * FROM migrations ORDER BY id'), migrationBefore);
  assert.equal((await db.query('SELECT current_version FROM problems'))[0].current_version, 2);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM user_problem_solves'))[0].n, 0);
  // Current/submission version metadata is protected even if snapshots are absent.
  await db.query('DELETE FROM problem_versions');
  await assert.rejects(db.undoLastMigration(), /version history/);
  await db.query('UPDATE problems SET current_version=1');
  await db.query('UPDATE submissions SET problem_version=2');
  await assert.rejects(db.undoLastMigration(), /version history/);
  await db.query('DELETE FROM submissions');
  await db.query('DELETE FROM problems');

  const secret = 'migration-fixture-only-secret-at-least-32-characters';
  const jwt = new JwtService({ secret });
  const oldToken = await jwt.signAsync({ sub: owner.id, tokenVersion: 0 }, { expiresIn: '5m' });
  // 현재 User 엔터티는 나중 마이그레이션의 정지 열도 읽으므로, 이 검사 동안만 그 열을 잠시 둔다.
  await db.query('ALTER TABLE users ADD COLUMN suspended_at timestamptz');
  const strategy = new JwtStrategy(new ConfigService({ JWT_ACCESS_SECRET: secret }), db.getRepository(User));
  await db.query("UPDATE users SET token_version=1,role='ADMIN' WHERE id=$1", [owner.id]);
  const payload = await jwt.verifyAsync(oldToken);
  await assert.rejects(strategy.validate(payload), /다시 로그인/);
  await assert.rejects(db.undoLastMigration(), /Cannot roll back backend foundations with revoked tokens/);
  assert.deepEqual(await db.query('SELECT * FROM migrations ORDER BY id'), migrationBefore);
  assert.deepEqual((await db.query('SELECT token_version,role FROM users WHERE id=$1', [owner.id]))[0], { token_version: 1, role: 'ADMIN' });
  await assert.rejects(strategy.validate(await jwt.verifyAsync(oldToken)), /다시 로그인/);
  await db.query('ALTER TABLE users DROP COLUMN suspended_at');
  await db.query('DELETE FROM users');
  await db.undoLastMigration();
  await db.runMigrations();

  // Learning backfill uses only current verdicts, retained AC, or the solve ledger.
  const [learner] = await db.query(`INSERT INTO users(email,username,password_hash)
    VALUES('learning@fixture.invalid','learning','unused') RETURNING id`);
  const [exercise] = await db.query(`INSERT INTO problems(slug,title,statement_md,difficulty,author_id)
    VALUES('learning','Learning','Test','BEGINNER',$1) RETURNING id`, [learner.id]);
  const learningFixtures = [];
  // Upgrade to just before the new evidence migration before inserting legacy rows.
  await db.destroy();
  const learning = configured.options.migrations.findIndex(
    (migration) => migration.name === 'LearningEvidence1793001000000',
  );
  assert.notEqual(learning, -1);
  db = await new DataSource({ ...options, migrations: configured.options.migrations.slice(0, learning) }).initialize();
  await db.runMigrations();
  for (const status of ['ACCEPTED','WRONG_ANSWER','COMPILE_ERROR','RUNTIME_ERROR','TIME_LIMIT_EXCEEDED','MEMORY_LIMIT_EXCEEDED','OUTPUT_LIMIT_EXCEEDED','QUEUED','JUDGING','SYSTEM_ERROR','CANCELLED']) {
    const [row] = await db.query(`INSERT INTO submissions(user_id,problem_id,language,source_code,status)
      VALUES($1,$2,'PYTHON','pass',$3) RETURNING id`, [learner.id, exercise.id, status]);
    learningFixtures.push({ id: row.id, completed: !['QUEUED','JUDGING','SYSTEM_ERROR','CANCELLED'].includes(status) });
  }
  for (const anchor of ['accepted_for_xp', 'ledger']) {
    const [row] = await db.query(`INSERT INTO submissions(user_id,problem_id,language,source_code,status,accepted_for_xp)
      VALUES($1,$2,'PYTHON','pass','SYSTEM_ERROR',$3) RETURNING id`, [learner.id, exercise.id, anchor === 'accepted_for_xp']);
    if (anchor === 'ledger') await db.query(`INSERT INTO user_problem_solves(user_id,problem_id,accepted_submission_id,awarded_xp)
      VALUES($1,$2,$3,10)`, [learner.id, exercise.id, row.id]);
    learningFixtures.push({ id: row.id, completed: true });
  }
  const beforeLearning = await db.query('SELECT xp,level FROM users WHERE id=$1', [learner.id]);
  const ledgerBeforeLearning = await db.query('SELECT * FROM user_problem_solves');
  await db.destroy();
  db = await new DataSource({ ...options, migrations: configured.options.migrations.slice(0, learning + 1) }).initialize();
  assert.equal((await db.runMigrations()).length, 1);
  for (const fixture of learningFixtures) assert.equal(
    (await db.query('SELECT completed_for_learning FROM submissions WHERE id=$1', [fixture.id]))[0].completed_for_learning,
    fixture.completed,
  );
  assert.deepEqual(await db.query('SELECT xp,level FROM users WHERE id=$1', [learner.id]), beforeLearning);
  assert.deepEqual(await db.query('SELECT * FROM user_problem_solves'), ledgerBeforeLearning);
  const learningMigrations = await db.query('SELECT * FROM migrations ORDER BY id');
  await assert.rejects(db.undoLastMigration(), /Cannot roll back retained learning evidence/);
  assert.deepEqual(await db.query('SELECT * FROM migrations ORDER BY id'), learningMigrations);
  assert.ok((await db.query('SELECT completed_for_learning FROM submissions WHERE id=$1', [learningFixtures[0].id]))[0].completed_for_learning);

  // 정지된 사용자가 있으면 정지 열을 지우지 않는다(되돌리면 다시 접근할 수 있게 된다).
  // 뒤에 마이그레이션이 더 붙어도 정지 마이그레이션을 마지막으로 두고 되돌린다.
  await db.destroy();
  const suspension = configured.options.migrations.findIndex(
    (migration) => migration.name === 'UserSuspension1794100000000',
  );
  assert.notEqual(suspension, -1);
  db = await new DataSource({ ...options, migrations: configured.options.migrations.slice(0, suspension + 1) }).initialize();
  await db.runMigrations();
  await db.query('UPDATE users SET suspended_at=now() WHERE id=$1', [learner.id]);
  await assert.rejects(db.undoLastMigration(), /Cannot roll back user suspension with suspended users/);
  assert.ok((await db.query('SELECT suspended_at FROM users WHERE id=$1', [learner.id]))[0].suspended_at);

  // A full rollback is only valid for a genuinely fresh DB.
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
    'Migrations: legacy upgrade, snapshots, solve/XP idempotency, acceptance and learning evidence backfill/refusal, username case refusal, partial rollback, foundations version/token refusal (signed revoked JWT remains rejected), and fresh install/rollback/reapply passed.',
  );
} finally {
  if (db?.isInitialized) await db.destroy();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.destroy();
}
