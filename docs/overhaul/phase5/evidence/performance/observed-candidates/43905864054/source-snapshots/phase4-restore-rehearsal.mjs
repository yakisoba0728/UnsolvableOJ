import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Only generated databases in an explicitly owned, loopback CI service. */
export function rehearsalConfig(env) {
  assert.equal(env.CI, 'true', 'The restore rehearsal requires disposable CI');
  assert.equal(env.NODE_ENV, 'test', 'The restore rehearsal requires NODE_ENV=test');
  assert.equal(env.PHASE4_REHEARSAL, 'disposable-ci', 'Explicit rehearsal opt-in is required');
  assert.match(env.PHASE4_POSTGRES_CONTAINER ?? '', /^[a-f0-9]{12,64}$/, 'Use the owned Actions PostgreSQL service ID');
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('Invalid test database connection'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL is required');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only loopback CI PostgreSQL is permitted');
  assert.ok(url.username && !url.search && !url.hash, 'Use a plain test connection');
  return { url, container: env.PHASE4_POSTGRES_CONTAINER, username: decodeURIComponent(url.username) };
}

export function ownedDatabaseName(value) {
  assert.match(value, /^oj4_(?:source|restore)_[a-f0-9]{32}$/, 'Refuse a non-generated database name');
  return `"${value}"`;
}

async function fingerprints(db) {
  const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const result = [];
  for (const { tablename } of tables) {
    const identifier = `"${tablename.replaceAll('"', '""')}"`;
    const [row] = await db.query(`SELECT count(*)::integer AS rows,
      md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), '')) AS digest
      FROM ${identifier} t`);
    result.push({ table: tablename, ...row });
  }
  return result;
}

const quotedIdentifier = value => `"${value.replaceAll('"', '""')}"`;

/** Reparse with PostgreSQL itself: varchar-array coercions change on dump/restore. */
export async function canonicalCheckDefinition(manager, table, definition) {
  const temporary = `oj4_check_${randomUUID().replaceAll('-', '')}`;
  const identifier = quotedIdentifier(temporary);
  await manager.query(`CREATE TEMP TABLE ${identifier} (LIKE public.${quotedIdentifier(table)}) ON COMMIT DROP`);
  const read = async () => {
    const [row] = await manager.query(`SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid=$1::regclass AND conname='oj4_probe'`, [`pg_temp.${identifier}`]);
    assert.ok(row?.definition, 'The parser probe must have its CHECK constraint');
    return row.definition;
  };
  // Both definitions are trusted catalog output from this invocation's generated database.
  await manager.query(`ALTER TABLE pg_temp.${identifier} ADD CONSTRAINT oj4_probe ${definition}`);
  const canonical = await read();
  await manager.query(`ALTER TABLE pg_temp.${identifier} DROP CONSTRAINT oj4_probe`);
  await manager.query(`ALTER TABLE pg_temp.${identifier} ADD CONSTRAINT oj4_probe ${canonical}`);
  assert.equal(await read(), canonical, 'CHECK deparse must reach a stable parser representation');
  await manager.query(`DROP TABLE pg_temp.${identifier}`);
  return canonical;
}

async function schema(db) {
  const result = {
    columns: await db.query(`SELECT c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull,a.attidentity,a.attgenerated,cn.nspname AS collation_schema,co.collname AS collation,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY c.relname,a.attnum`),
    indexes: await db.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname"),
    triggers: await db.query(`SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`),
    constraints: await db.query(`SELECT c.relname,k.conname,k.contype,k.convalidated,k.condeferrable,k.condeferred,k.connoinherit,
      pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' ORDER BY c.relname,k.conname`),
  };
  await db.transaction(async manager => {
    for (const constraint of result.constraints) {
      if (constraint.contype === 'c') {
        constraint.definition = await canonicalCheckDefinition(manager, constraint.relname, constraint.definition);
      }
    }
  });
  return result;
}

async function semantics(db) {
  const [result] = await db.query(`SELECT
    (SELECT count(*)::integer FROM users) AS users,
    (SELECT sum(xp)::text FROM users) AS xp,
    (SELECT count(*)::integer FROM submissions) AS submissions,
    (SELECT md5(string_agg(id::text||status::text||source_code, '' ORDER BY id)) FROM submissions) AS submissionsDigest,
    (SELECT sum(solver_count)::text||':'||sum(accepted_count)::text||':'||sum(finished_count)::text FROM problem_stats) AS statistics`);
  return result;
}

/** Synthetic rows only; exported for a real-PostgreSQL fixture proof without Docker. */
export async function seedRestoreFixture(manager) {
  await manager.query("SET LOCAL work_mem='64kB'; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s'");
  await manager.query(`INSERT INTO users(email,username,password_hash)
    SELECT 'rehearsal-'||i||'@example.invalid','rehearsal_'||i,'disposable-no-login' FROM generate_series(1,128) i`);
  const users = (await manager.query('SELECT id FROM users ORDER BY username')).map(row => row.id);
  await manager.query(`INSERT INTO problems(slug,title,statement_md,difficulty,status,author_id)
    SELECT 'restore-fixture-'||i,'Restore fixture '||i,'Disposable','BEGINNER','PUBLISHED',$1
    FROM generate_series(1,24) i`, [users[0]]);
  const problems = (await manager.query('SELECT id FROM problems ORDER BY slug')).map(row => row.id);
  await manager.query(`INSERT INTO submissions(user_id,problem_id,language,source_code,status,is_test)
    SELECT ($1::uuid[])[1+(i%128)],($2::uuid[])[1+(i%24)],'PYTHON',
      repeat('x', CASE WHEN i%16=0 THEN 16384 ELSE 256 END),
      CASE WHEN i%5=0 THEN 'WRONG_ANSWER'::submission_status ELSE 'ACCEPTED'::submission_status END,
      i%17=0 FROM generate_series(1,2048) i`, [users, problems]);
  await manager.query(`INSERT INTO problem_bookmarks(user_id,problem_id)
    SELECT ($1::uuid[])[1+(i%128)],($2::uuid[])[1+(i%24)] FROM generate_series(1,128) i`, [users, problems]);
  await manager.query(`INSERT INTO learning_goals(user_id,target_problems,days,start_date)
    SELECT ($1::uuid[])[i],10+i,CASE WHEN i%3=0 THEN 7 WHEN i%3=1 THEN 30 ELSE 90 END,'2026-11-16'
    FROM generate_series(1,12) i`, [users]);
  await manager.query(`INSERT INTO problem_versions(problem_id,version,snapshot)
    SELECT id,current_version,jsonb_build_object('title',title,'statementMarkdown',statement_md,
      'difficulty',difficulty,'timeLimitMs',time_limit_ms,'memoryLimitMb',memory_limit_mb,'testCases','[]'::jsonb)
    FROM problems`);
  await manager.query(`INSERT INTO user_problem_solves(user_id,problem_id,accepted_submission_id,awarded_xp)
    SELECT user_id,problem_id,id,10 FROM (
      SELECT DISTINCT ON(user_id,problem_id) user_id,problem_id,id
      FROM submissions WHERE status='ACCEPTED' AND NOT is_test ORDER BY user_id,problem_id,id
    ) firsts ORDER BY user_id,problem_id LIMIT 128`);
  await manager.query(`UPDATE submissions SET accepted_for_xp=true,completed_for_learning=true
    WHERE id IN (SELECT accepted_submission_id FROM user_problem_solves)`);
  await manager.query(`UPDATE users u SET xp=coalesce((SELECT sum(awarded_xp)::integer
    FROM user_problem_solves s WHERE s.user_id=u.id),0)`);
  const [version] = await manager.query('SELECT challenge_id,version FROM vibe_challenge_versions ORDER BY version LIMIT 1');
  const [{ id: testId }] = await manager.query(`INSERT INTO enterprise_tests(owner_id,title,starts_at,ends_at,
    duration_min,problem_ids,vibe_challenge_ids,invite_code,invite_only,invite_user_ids)
    VALUES($1,'Synthetic restore assessment','2026-11-16T00:00:00Z','2026-11-17T00:00:00Z',60,
      $2,$3,'restore-disposable-invite',true,$4) RETURNING id`,
  [users[0], [problems[0]], [version.challenge_id], users.slice(1, 9)]);
  await manager.query(`INSERT INTO enterprise_problem_versions(test_id,problem_id,version,position)
    VALUES($1,$2,1,1)`, [testId, problems[0]]);
  await manager.query(`INSERT INTO enterprise_vibe_versions(test_id,challenge_id,version,ai_model,position)
    VALUES($1,$2,$3,'restore-fixture-unavailable-model',1)`, [testId, version.challenge_id, version.version]);
  for (let index = 1; index <= 8; index++) {
    const done = index % 2 === 0;
    const [{ id: attemptId }] = await manager.query(`INSERT INTO enterprise_attempts(test_id,user_id,started_at,deadline_at,finished_at)
      VALUES($1,$2,'2026-11-16T00:00:00Z','2026-11-16T01:00:00Z',CASE WHEN $3 THEN '2026-11-16T00:30:00Z'::timestamptz ELSE NULL END)
      RETURNING id`, [testId, users[index], done]);
    await manager.query(`INSERT INTO submissions(user_id,problem_id,language,source_code,status,is_test,attempt_id)
      VALUES($1,$2,'PYTHON','synthetic assessment source','ACCEPTED',true,$3)`, [users[index], problems[0], attemptId]);
    const files = { 'src/search.ts': `// Synthetic restore revision ${index}\nexport const fixture = ${index};\n` };
    const state = { files, messages: [], events: [], runs: [], undo: null, aiRequests: 0, evaluations: 0,
      report: done ? { outcome: 0, passed: 0, total: 1, prompt: null, process: null, evaluationStatus: 'unavailable',
        model: 'restore-fixture-unavailable-model', reflection: 'Synthetic backup fixture; no provider call', checks: [] } : null };
    const [{ id: workspaceId }] = await manager.query(`INSERT INTO vibe_attempts(user_id,challenge_id,challenge_version,
      revision,state,model,enterprise_attempt_id,started_at,submitted_at)
      VALUES($1,$2,$3,1,$4,'restore-fixture-unavailable-model',$5,'2026-11-16T00:00:00Z',
        CASE WHEN $6 THEN '2026-11-16T00:30:00Z'::timestamptz ELSE NULL END) RETURNING id`,
    [users[index], version.challenge_id, version.version, JSON.stringify(state), attemptId, done]);
    await manager.query(`INSERT INTO vibe_revisions(attempt_id,revision,action,files,paths)
      VALUES($1,0,'baseline',$2,ARRAY['src/search.ts']),($1,1,'save',$3,ARRAY['src/search.ts'])`,
    [workspaceId, JSON.stringify({ 'src/search.ts': '// Synthetic restore baseline\n' }), JSON.stringify(files)]);
  }
}

export async function productSemantics(db) {
  const [value] = await db.query(`SELECT
    (SELECT count(*)::int FROM learning_goals) AS goals,
    (SELECT count(*)::int FROM problem_versions) AS "problemVersions",
    (SELECT count(*)::int FROM user_problem_solves) AS solves,
    NOT EXISTS(SELECT 1 FROM users u WHERE xp<>coalesce((SELECT sum(awarded_xp) FROM user_problem_solves s WHERE s.user_id=u.id),0)) AS "xpMatchesLedger",
    NOT EXISTS(SELECT 1 FROM user_problem_solves s JOIN submissions a ON a.id=s.accepted_submission_id
      WHERE a.user_id<>s.user_id OR a.problem_id<>s.problem_id OR NOT a.accepted_for_xp OR a.is_test) AS "solveEvidenceMatches",
    (SELECT count(*)::int FROM enterprise_tests) AS assessments,
    (SELECT count(*)::int FROM enterprise_attempts) AS candidates,
    (SELECT count(*)::int FROM enterprise_problem_versions) AS "algorithmPins",
    (SELECT count(*)::int FROM enterprise_vibe_versions) AS "vibePins",
    (SELECT count(*)::int FROM submissions WHERE attempt_id IS NOT NULL AND is_test) AS "assessmentSubmissions",
    NOT EXISTS(SELECT 1 FROM submissions s JOIN enterprise_attempts a ON a.id=s.attempt_id
      LEFT JOIN enterprise_problem_versions pin ON pin.test_id=a.test_id AND pin.problem_id=s.problem_id
      LEFT JOIN problem_versions v ON v.problem_id=pin.problem_id AND v.version=pin.version
      WHERE s.user_id<>a.user_id OR NOT s.is_test OR s.accepted_for_xp OR v.problem_id IS NULL) AS "assessmentSubmissionOwnershipVersionsMatch",
    (SELECT count(*)::int FROM vibe_attempts) AS workspaces,
    (SELECT count(*)::int FROM vibe_revisions) AS revisions,
    NOT EXISTS(SELECT 1 FROM vibe_attempts w JOIN enterprise_attempts a ON a.id=w.enterprise_attempt_id
      LEFT JOIN enterprise_vibe_versions v ON v.test_id=a.test_id AND v.challenge_id=w.challenge_id
      LEFT JOIN vibe_revisions r ON r.attempt_id=w.id AND r.revision=w.revision
      WHERE w.user_id<>a.user_id OR v.version IS DISTINCT FROM w.challenge_version OR v.ai_model IS DISTINCT FROM w.model
        OR r.files IS DISTINCT FROM w.state->'files') AS "workspaceOwnershipVersionsMatch"`);
  assert.deepEqual(value, { goals: 12, problemVersions: 24, solves: 128, xpMatchesLedger: true,
    solveEvidenceMatches: true, assessments: 1, candidates: 8, algorithmPins: 1, vibePins: 1,
    assessmentSubmissions: 8, assessmentSubmissionOwnershipVersionsMatch: true,
    workspaces: 8, revisions: 16, workspaceOwnershipVersionsMatch: true });
  return value;
}

export async function rehearse(env = process.env) {
  const settings = rehearsalConfig(env);
  // Assert the owned service image before executing backup tools inside it.
  const image = execFileSync('docker', ['inspect', '--format', '{{.Config.Image}}', settings.container], { encoding: 'utf8', timeout: 10_000 }).trim();
  assert.match(image, /^postgres:17\.[0-9]+$/, 'The supplied service must be the PostgreSQL 17 CI fixture');
  await import('reflect-metadata');
  const { DataSource } = await import('typeorm');
  const { default: configured } = await import('../dist/database/data-source.js');
  const admin = new DataSource({ ...configured.options, url: settings.url.href, entities: [], migrations: [] });
  const suffix = randomUUID().replaceAll('-', '');
  const sourceName = `oj4_source_${suffix}`;
  const restoredName = `oj4_restore_${suffix}`;
  const created = [];
  const connections = [];
  const stages = [];
  const started = performance.now();
  let report;
  let writerBarrier;
  let stage = 'create disposable databases';
  const timed = async (name, run) => {
    stage = name;
    const before = performance.now();
    const value = await run();
    stages.push({ name, elapsedMs: performance.now() - before });
    return value;
  };
  const connect = async (name) => {
    const url = new URL(settings.url);
    url.pathname = `/${name}`;
    const db = await new DataSource({ ...configured.options, url: url.href }).initialize();
    connections.push(db);
    return db;
  };
  await admin.initialize();
  try {
    for (const name of [sourceName, restoredName]) {
      await admin.query(`CREATE DATABASE ${ownedDatabaseName(name)}`);
      created.push(name);
    }
    const source = await connect(sourceName);
    const migrations = await timed('fresh migrations', () => source.runMigrations());
    await timed('empty final migration rollback and reapply', async () => {
      await source.undoLastMigration();
      assert.equal((await source.runMigrations()).length, 1);
    });
    await timed('bounded fixture with product history and transition pressure', () => source.transaction(seedRestoreFixture));
    const [{ bytes: sourceBytes }] = await source.query('SELECT pg_database_size(current_database())::int AS bytes');
    assert.ok(sourceBytes < 64 * 1024 * 1024, 'Synthetic source database exceeded its 64 MiB cap');
    const sourceProducts = await productSemantics(source);
    // This barrier exists only in the randomly named disposable source database.
    // SHARE permits pg_dump's reads while preventing any fixture writer.
    writerBarrier = source.createQueryRunner();
    await writerBarrier.connect();
    await writerBarrier.startTransaction();
    await writerBarrier.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s'");
    const lockedTables = await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    await writerBarrier.query(`LOCK TABLE ${lockedTables.map(({ tablename }) => `public.${quotedIdentifier(tablename)}`).join(',')} IN SHARE MODE`);
    await timed('stop-writer barrier rejects concurrent writes', async () => {
      const writer = source.createQueryRunner();
      await writer.connect();
      await writer.startTransaction();
      try {
        await writer.query("SET LOCAL lock_timeout='100ms'");
        await assert.rejects(writer.query('UPDATE users SET xp=xp'), /lock timeout/);
      } finally { await writer.rollbackTransaction(); await writer.release(); }
    });
    const before = await fingerprints(source);
    const sourceSchema = await schema(source);
    const sourceSemantics = await semantics(source);
    const archive = await timed('pg_dump custom archive', () => execFileSync('docker', [
      'exec', settings.container, 'pg_dump', '--username', settings.username, '--dbname', sourceName,
      '--format=custom', '--no-owner', '--no-acl',
    ], { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }));
    assert.ok(archive.length > 0 && archive.length < 32 * 1024 * 1024);
    await writerBarrier.rollbackTransaction();
    await writerBarrier.release();
    writerBarrier = undefined;
    await timed('pg_restore into second generated database', () => execFileSync('docker', [
      'exec', '-i', settings.container, 'pg_restore', '--username', settings.username, '--dbname', restoredName,
      '--no-owner', '--no-acl', '--exit-on-error',
    ], { input: archive, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }));
    const restored = await connect(restoredName);
    const [{ bytes: restoredBytes }] = await restored.query('SELECT pg_database_size(current_database())::int AS bytes');
    assert.ok(restoredBytes < 64 * 1024 * 1024, 'Synthetic restored database exceeded its 64 MiB cap');
    await timed('all restored table fingerprints', async () => {
      const actual = await fingerprints(restored);
      for (const expected of before) {
        const found = actual.find(table => table.table === expected.table);
        if (JSON.stringify(found) !== JSON.stringify(expected))
          console.error(JSON.stringify({ kind: 'safe table mismatch', expected, actual: found ?? null }));
      }
      assert.deepEqual(actual, before);
    });
    await timed('restored schema equality', async () => {
      const actual = await schema(restored);
      for (const kind of ['columns', 'indexes', 'triggers', 'constraints']) {
        if (JSON.stringify(actual[kind]) !== JSON.stringify(sourceSchema[kind]))
          console.error(JSON.stringify({ kind: `safe ${kind} mismatch`,
            expectedCount: sourceSchema[kind].length, actualCount: actual[kind].length,
            expectedHash: createHash('sha256').update(JSON.stringify(sourceSchema[kind])).digest('hex'),
            actualHash: createHash('sha256').update(JSON.stringify(actual[kind])).digest('hex'),
            changedNames: sourceSchema[kind].filter((item, index) => JSON.stringify(item) !== JSON.stringify(actual[kind][index]))
              .map(item => item.indexname ?? item.tgname ?? item.conname ?? `${item.relname}.${item.attname}`),
          }));
      }
      assert.deepEqual(actual, sourceSchema);
    });
    await timed('restored migration ledger', async () => {
      assert.deepEqual(await restored.runMigrations(), [], 'Restored migration ledger must be complete');
    });
    await timed('populated goal rollback refusal and product history preservation', async () => {
      await assert.rejects(restored.undoLastMigration(), /Cannot roll back learning goals with saved goals/);
      assert.deepEqual(await fingerprints(restored), before);
      assert.deepEqual(await semantics(restored), sourceSemantics);
      assert.deepEqual(await schema(restored), sourceSchema);
      assert.deepEqual(await productSemantics(restored), sourceProducts);
    });
    // Exercise restored triggers, not merely matching stored counter bytes.
    await timed('restored write and statistics integrity', async () => {
      const [sample] = await restored.query("SELECT id FROM submissions WHERE status='ACCEPTED' AND NOT is_test LIMIT 1");
      await restored.query("UPDATE submissions SET status='WRONG_ANSWER' WHERE id=$1", [sample.id]);
      const [integrity] = await restored.query(`SELECT NOT EXISTS (
        SELECT p.problem_id FROM problem_stats p LEFT JOIN LATERAL (
          SELECT count(DISTINCT user_id) FILTER (WHERE status='ACCEPTED') AS solvers,
            count(*) FILTER (WHERE status='ACCEPTED') AS accepted,count(*) AS finished
          FROM submissions s WHERE s.problem_id=p.problem_id AND NOT s.is_test
            AND status NOT IN ('QUEUED','JUDGING','SYSTEM_ERROR','CANCELLED')
        ) actual ON true
        WHERE p.solver_count<>actual.solvers OR p.accepted_count<>actual.accepted OR p.finished_count<>actual.finished
      ) AS valid`);
      assert.equal(integrity.valid, true);
      const [goal] = await restored.query('SELECT user_id,target_problems FROM learning_goals ORDER BY user_id LIMIT 1');
      await restored.query('UPDATE learning_goals SET target_problems=target_problems+1 WHERE user_id=$1', [goal.user_id]);
      assert.equal((await restored.query('SELECT target_problems FROM learning_goals WHERE user_id=$1', [goal.user_id]))[0].target_problems, goal.target_problems + 1);
      assert.deepEqual(await productSemantics(restored), sourceProducts);
    });
    report = {
      schemaVersion: 2, checkedAt: new Date().toISOString(), source: env.GITHUB_SHA ?? null,
      workflowRunId: env.GITHUB_RUN_ID ?? null, result: 'PASS', migrations: migrations.length,
      fixture: { users: 128, problems: 24, submissions: 2056, ordinaryFixtureSubmissions: 2048,
        largeSourceBytes: 16384, workMem: '64kB', products: sourceProducts },
      writerBarrier: { mode: 'SHARE', tables: lockedTables.length, concurrentWriteRefused: true, heldThroughDump: true },
      databaseBytes: { source: sourceBytes, restored: restoredBytes, capEach: 64 * 1024 * 1024 },
      archive: { bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') },
      tables: before, schemaComparison: 'Exact columns/indexes/triggers/non-CHECK definitions and flags; stable PostgreSQL-parser-normalized CHECK definitions',
      stages, elapsedMs: performance.now() - started,
      limits: ['One finite synthetic fixture, not production RTO/RPO or capacity.',
        'No production connection or existing database is modified.',
        'work_mem pressure does not establish measured spill volume or peak PostgreSQL RSS.',
        'Empty rollback/reapply and populated final-migration refusal are distinct checks; full-chain checks remain in check-migrations.mjs.',
        'Seeded product/XP history is synthetic; reference integrity is not API authorization or live award execution.',
        'No before/after performance improvement is claimed.'],
    };
  } catch (cause) {
    throw new Error(`Rehearsal stage failed: ${stage}`, { cause });
  } finally {
    const cleanupStarted = performance.now();
    const cleanupErrors = [];
    if (writerBarrier) {
      try { if (writerBarrier.isTransactionActive) await writerBarrier.rollbackTransaction(); }
      catch (error) { cleanupErrors.push(error); }
      try { await writerBarrier.release(); } catch (error) { cleanupErrors.push(error); }
    }
    for (const db of connections.reverse()) {
      try { if (db.isInitialized) await db.destroy(); } catch (error) { cleanupErrors.push(error); }
    }
    for (const name of created.reverse()) {
      try { await admin.query(`DROP DATABASE ${ownedDatabaseName(name)} WITH (FORCE)`); }
      catch (error) { cleanupErrors.push(error); }
    }
    try { await admin.destroy(); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length) throw new Error('Rehearsal stage failed: owned database cleanup');
    stages.push({ name: 'owned database cleanup', elapsedMs: performance.now() - cleanupStarted });
  }
  // A cleanup failure must never leave an apparently successful evidence file.
  report.elapsedMs = performance.now() - started;
  report.cleanup = 'both generated databases removed';
  await mkdir('reports', { recursive: true });
  await writeFile('reports/phase4-restore.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`Phase IV restore rehearsal PASS: ${report.migrations} migrations, ${report.tables.length} exact table fingerprints, ${report.archive.bytes} archive bytes; cleanup complete`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await rehearse(); }
  catch (error) {
    // Neither connection strings, dump data nor unredacted database errors belong in CI output.
    const stage = error instanceof Error && error.message.startsWith('Rehearsal stage failed: ')
      ? error.message : 'preflight or evidence recording';
    console.error(`Phase IV disposable restore rehearsal FAILED (${stage}); no success report is valid.`);
    process.exitCode = 1;
  }
}
