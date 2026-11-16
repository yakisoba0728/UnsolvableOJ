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

async function schema(db) {
  return {
    indexes: await db.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname"),
    triggers: await db.query(`SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`),
    constraints: await db.query(`SELECT c.relname, k.conname, pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' ORDER BY c.relname,k.conname`),
  };
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
    await timed('bounded fixture with transition-table spill pressure', async () => {
      await source.transaction(async manager => {
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
      });
    });
    const before = await fingerprints(source);
    const sourceSchema = await schema(source);
    const sourceSemantics = await semantics(source);
    const archive = await timed('pg_dump custom archive', () => execFileSync('docker', [
      'exec', settings.container, 'pg_dump', '--username', settings.username, '--dbname', sourceName,
      '--format=custom', '--no-owner', '--no-acl',
    ], { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }));
    assert.ok(archive.length > 0 && archive.length < 32 * 1024 * 1024);
    await timed('pg_restore into second generated database', () => execFileSync('docker', [
      'exec', '-i', settings.container, 'pg_restore', '--username', settings.username, '--dbname', restoredName,
      '--no-owner', '--no-acl', '--exit-on-error',
    ], { input: archive, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }));
    const restored = await connect(restoredName);
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
      for (const kind of ['indexes', 'triggers', 'constraints']) {
        if (JSON.stringify(actual[kind]) !== JSON.stringify(sourceSchema[kind]))
          console.error(JSON.stringify({ kind: `safe ${kind} mismatch`,
            expectedCount: sourceSchema[kind].length, actualCount: actual[kind].length,
            expectedHash: createHash('sha256').update(JSON.stringify(sourceSchema[kind])).digest('hex'),
            actualHash: createHash('sha256').update(JSON.stringify(actual[kind])).digest('hex'),
            changedNames: sourceSchema[kind].filter((item, index) => JSON.stringify(item) !== JSON.stringify(actual[kind][index]))
              .map(item => item.indexname ?? item.tgname ?? item.conname),
          }));
      }
      assert.deepEqual(actual, sourceSchema);
    });
    await timed('restored migration ledger', async () => {
      assert.deepEqual(await restored.runMigrations(), [], 'Restored migration ledger must be complete');
    });
    await timed('last migration rollback and reapply', async () => {
      await restored.undoLastMigration();
      assert.equal((await restored.runMigrations()).length, 1);
      assert.deepEqual(await semantics(restored), sourceSemantics);
      assert.deepEqual(await schema(restored), sourceSchema);
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
    });
    report = {
      schemaVersion: 1, checkedAt: new Date().toISOString(), source: env.GITHUB_SHA ?? null,
      workflowRunId: env.GITHUB_RUN_ID ?? null, result: 'PASS', migrations: migrations.length,
      fixture: { users: 128, problems: 24, submissions: 2048, largeSourceBytes: 16384, workMem: '64kB' },
      archive: { bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') },
      tables: before, stages, elapsedMs: performance.now() - started,
      limits: ['One finite synthetic fixture, not production RTO/RPO or capacity.',
        'No production connection or existing database is modified.',
        'work_mem pressure does not establish measured spill volume or peak PostgreSQL RSS.',
        'Rollback/reapply covers the final migration; full-chain/refusal checks remain in check-migrations.mjs.',
        'No before/after performance improvement is claimed.'],
    };
  } catch (cause) {
    throw new Error(`Rehearsal stage failed: ${stage}`, { cause });
  } finally {
    const cleanupStarted = performance.now();
    const cleanupErrors = [];
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
