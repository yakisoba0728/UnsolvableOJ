import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, release } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../', import.meta.url));
const limits = Object.freeze({ candidates: 5000, learningRows: 20000, largeSources: 256,
  sourceBytes: 32768, samples: 5, statementMs: 15000, lockMs: 2000,
  temporaryBytes: 32 * 1024 * 1024, databaseBytes: 160 * 1024 * 1024, durationMs: 180000 });
const safeError = error => ({ name: error?.name ?? 'Error', code: typeof error?.code === 'string' ? error.code : null });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** No caller-selected target, remote host, URL override or production mode. */
export function qualificationConfig(env) {
  assert.equal(env.NODE_ENV, 'test', 'NODE_ENV=test is required');
  assert.equal(env.PHASE5_DB_QUALIFICATION, 'disposable', 'Explicit disposable qualification opt-in is required');
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('Invalid PostgreSQL test connection'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL is required');
  assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'A literal loopback PostgreSQL address is required');
  assert.ok(url.username && !url.search && !url.hash, 'Plain test credentials without connection overrides are required');
  return { url, limits };
}

export function ownedDatabaseName(name) {
  assert.match(name, /^oj5_db_[a-f0-9]{32}$/, 'Refuse a non-generated database name');
  return `"${name}"`;
}

export async function qualify(env = process.env) {
  const config = qualificationConfig(env);
  await import('reflect-metadata');
  const [{ DataSource }, { default: configured }, queries, learning, csv] = await Promise.all([
    import('typeorm'), import('../dist/database/data-source.js'),
    import('../dist/modules/enterprise/enterprise-result-queries.js'),
    import('../dist/modules/users/learning.service.js'),
    import('../dist/modules/enterprise/enterprise-result-export.js'),
  ]);
  const name = `oj5_db_${randomUUID().replaceAll('-', '')}`;
  const connectionOptions = { ...configured.options, poolSize: 4,
    extra: { ...configured.options.extra, max: 4, connectionTimeoutMillis: 5000,
      statement_timeout: limits.statementMs, lock_timeout: limits.lockMs,
      idle_in_transaction_session_timeout: 15000, application_name: 'oj5-db-qualification' } };
  const admin = new DataSource({ ...connectionOptions, url: config.url.href, entities: [], migrations: [] });
  const ownedUrl = new URL(config.url); ownedUrl.pathname = `/${name}`;
  const db = new DataSource({ ...connectionOptions, url: ownedUrl.href });
  const started = performance.now();
  const sourceFiles = ['scripts/phase5-db-qualification.mjs',
    'src/modules/enterprise/enterprise-result-queries.ts', 'src/modules/enterprise/enterprise-result-export.ts',
    'src/modules/users/learning.service.ts', 'src/database/migrations/1796100000000-incremental-problem-stats.ts'];
  const report = { schemaVersion: 1, status: 'RUNNING', limits, stages: [], measurements: [],
    source: { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(),
      tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: directory, encoding: 'utf8' }).trim(),
      dirtyPaths: execFileSync('git', ['status', '--porcelain', '--', ...sourceFiles], { cwd: directory, encoding: 'utf8' }).trim(),
      hashes: Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(resolve(directory, file))).digest('hex')])) },
    methodology: { comparison: 'Current-source qualification only; no baseline/candidate optimization or speedup is claimed.',
      reads: 'One warmup then five serial complete query samples; EXPLAIN ANALYZE is separate from timed samples.',
      writes: 'One committed 256-row bulk rejudge and one deliberately rolled-back reverse transition, each with full recount oracle.',
      quantiles: 'n=5 nearest-rank p95/p99 equal the observed maximum, not population-tail estimates.',
      resources: 'Node client CPU/RSS and database size; PostgreSQL CPU/RSS/pool-saturation/IO-rate are not measured. EXPLAIN buffers/WAL and cluster-LSN WAL are scoped observations.',
      constraints: 'Fixed synthetic fixture; no HTTP/Redis/Judge/XP capacity or production migration/RTO/RPO claim.' },
    cleanup: { created: false, dropped: false } };
  let currentStage = 'connect';
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    // Cancel only this invocation's generated database queries, then let the
    // normal error/finally path preserve evidence and remove the owned database.
    if (admin.isInitialized) void admin.query(
      'SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name],
    ).catch(() => {});
  };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const deadline = setTimeout(interrupt, limits.durationMs); deadline.unref();
  const guard = async () => {
    assert.ok(!interrupted, 'Qualification interrupted or duration cap reached');
    assert.ok(performance.now() - started < limits.durationMs, 'Qualification duration cap exceeded');
    const [{ bytes }] = await db.query('SELECT pg_database_size(current_database())::text AS bytes');
    assert.ok(Number(bytes) < limits.databaseBytes, 'Owned database size cap exceeded');
    return Number(bytes);
  };
  const stage = async (label, action) => {
    currentStage = label;
    assert.ok(!interrupted, 'Qualification interrupted or duration cap reached');
    const began = performance.now();
    const value = await action();
    const databaseBytes = await guard();
    report.stages.push({ label, elapsedMs: performance.now() - began, databaseBytes });
    return value;
  };
  const explain = async (sql, params) => {
    const [row] = await db.query(`EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) ${sql}`, params);
    return row['QUERY PLAN'][0];
  };
  const sample = async (label, sql, params, oracle) => {
    await stage(label, async () => {
      oracle(await db.query(sql, params)); // warmup and correctness before measurement
      const samples = [];
      for (let i = 0; i < limits.samples; i++) {
        const cpu = process.cpuUsage(); const memory = process.memoryUsage(); const began = performance.now();
        const rows = await db.query(sql, params);
        const elapsedMs = performance.now() - began;
        const used = process.cpuUsage(cpu); const after = process.memoryUsage();
        const stable = oracle(rows);
        samples.push({ elapsedMs, rows: rows.length, resultDigest: digest(stable),
          clientCpuMs: (used.user + used.system) / 1000,
          clientRssBytesBefore: memory.rss, clientRssBytesAfter: after.rss });
      }
      const sorted = samples.map(item => item.elapsedMs).sort((a, b) => a - b);
      const plan = await explain(sql, params);
      report.measurements.push({ label, samples, p50Ms: sorted[2], p95Ms: sorted[4], p99Ms: sorted[4], plan });
    });
  };
  try {
    await admin.initialize();
    assert.ok(!interrupted, 'Qualification interrupted or duration cap reached');
    await admin.query(`CREATE DATABASE ${ownedDatabaseName(name)}`);
    report.cleanup.created = true;
    await admin.query(`ALTER DATABASE ${ownedDatabaseName(name)} SET temp_file_limit='32MB'`);
    await db.initialize();
    await stage('fresh migrations', async () => { report.migrations = (await db.runMigrations()).length; });
    const [{ version }] = await db.query('SELECT version() AS version');
    report.environment = { node: process.version, os: release(), cpu: cpus()[0]?.model,
      logicalCpus: cpus().length, postgres: version,
      settings: await db.query("SELECT name,setting,unit FROM pg_settings WHERE name IN ('shared_buffers','work_mem','max_connections','fsync','synchronous_commit','full_page_writes','wal_compression','statement_timeout','lock_timeout','temp_file_limit') ORDER BY name") };
    const owner = '00000000-0000-4000-8000-000000000001';
    const test = '00000000-0000-4000-8000-000000000002';
    const problems = Array.from({ length: 22 }, (_, i) => `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`);
    const statsProblem = problems[2];
    const bulkProblem = problems[3];
    await stage('seed bounded enterprise and learning histories', async () => {
      await db.query(`INSERT INTO users(id,email,username,password_hash)
        VALUES($1,'owner@phase5.invalid','phase5_owner','synthetic-not-a-login')`, [owner]);
      await db.query(`INSERT INTO users(id,email,username,password_hash)
        SELECT md5('oj5-user-'||n)::uuid,'candidate-'||n||'@phase5.invalid','oj5_'||n,'synthetic-not-a-login'
        FROM generate_series(1,$1::int) n`, [limits.candidates]);
      await db.query(`INSERT INTO problems(id,slug,title,statement_md,difficulty,status,author_id,tags)
        SELECT p,'oj5-'||n,'Synthetic '||n,'PRIVATE_STATEMENT','BEGINNER','PUBLISHED',$1,ARRAY['phase5','tag-'||n]
        FROM unnest($2::uuid[]) WITH ORDINALITY x(p,n)`, [owner, problems]);
      await db.query("INSERT INTO problem_versions(problem_id,version,snapshot) SELECT id,1,'{}' FROM problems WHERE id=ANY($1::uuid[])", [problems]);
      await db.query(`INSERT INTO enterprise_tests(id,owner_id,title,starts_at,ends_at,duration_min,problem_ids,invite_code)
        VALUES($1,$2,'Phase V scale','2026-01-01','2026-01-02',30,$3,'phase5-bounded-fixture')`, [test, owner, problems.slice(0, 2)]);
      await db.query(`INSERT INTO enterprise_problem_versions(test_id,problem_id,version,position)
        SELECT $1,p,1,n FROM unnest($2::uuid[]) WITH ORDINALITY x(p,n)`, [test, problems.slice(0, 2)]);
      await db.query(`INSERT INTO enterprise_attempts(id,test_id,user_id,started_at,deadline_at,finished_at)
        SELECT md5('oj5-attempt-'||n)::uuid,$1,md5('oj5-user-'||n)::uuid,
          '2026-01-01'::timestamptz+n*interval '1 millisecond','2026-01-01 00:30:00','2026-01-01 00:20:00'
        FROM generate_series(1,$2::int) n`, [test, limits.candidates]);
      await db.query(`INSERT INTO submissions(id,user_id,problem_id,attempt_id,language,source_code,status,problem_version,is_test)
        SELECT md5('oj5-exam-'||n||'-'||p)::uuid,md5('oj5-user-'||n)::uuid,($1::uuid[])[p],md5('oj5-attempt-'||n)::uuid,
          'PYTHON','PRIVATE_SOURCE',CASE WHEN n%p=0 THEN 'ACCEPTED'::submission_status ELSE 'WRONG_ANSWER'::submission_status END,1,true
        FROM generate_series(1,$2::int) n CROSS JOIN generate_series(1,2) p`, [problems, limits.candidates]);
      // The learner has 10k in-window rows and 10k out-of-window rows on 18 problems.
      await db.query(`INSERT INTO submissions(user_id,problem_id,language,source_code,status,created_at)
        SELECT $1,($2::uuid[])[1+((n-1)%18)],'PYTHON','PRIVATE_LEARNING_SOURCE',
          CASE WHEN n%2=0 THEN 'ACCEPTED'::submission_status ELSE 'WRONG_ANSWER'::submission_status END,
          statement_timestamp()-CASE WHEN n<=$3::int/2 THEN interval '1 minute' ELSE interval '120 days' END
        FROM generate_series(1,$3::int) n`, [owner, problems.slice(4), limits.learningRows]);
      for (const table of ['users','problems','enterprise_attempts','submissions']) await db.query(`ANALYZE ${table}`);
    });
    report.fixture = { candidates: limits.candidates, enterpriseSubmissions: limits.candidates * 2,
      learningSubmissions: limits.learningRows, visibleLearningSubmissions: limits.learningRows / 2,
      distinctStatsSolvers: limits.candidates, bulkRows: limits.largeSources, bulkSourceBytesPerRow: limits.sourceBytes };
    for (const offset of [0, 4950]) {
      await sample(`enterprise page offset ${offset}`, queries.enterpriseResultPageSql, [test, 50, offset], rows => {
        assert.equal(rows.length, 50);
        for (const [i, row] of rows.entries()) {
          const n = offset + i + 1;
          assert.equal(row.username, `oj5_${n}`); assert.equal(row.problems.length, 2);
          assert.equal(row.problems.filter(item => item.solved).length, n % 2 === 0 ? 2 : 1);
        }
        assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_|password_hash|@phase5/);
        return rows;
      });
    }
    await sample('whole-assessment summary 5000 candidates', queries.enterpriseResultSummarySql, [test, [], 2], rows => {
      assert.deepEqual(rows, [{ candidates: 5000, pending: 0, averageScore: 75, perfect: 2500,
        analytics: { finished: 5000, active: 0, expired: 0, scoreBands: [0, 0, 2500, 0, 2500] } }]);
      return rows;
    });
    await sample('scalar export SQL 5000 candidates', queries.enterpriseResultExportSql, [test, [], 2, 5001], rows => {
      assert.equal(rows.length, 5000);
      for (const [i, row] of rows.entries()) {
        assert.equal(row.username, `oj5_${i + 1}`); assert.equal(row.score, (i + 1) % 2 === 0 ? 100 : 50);
      }
      const exported = csv.enterpriseResultsCsv(rows, 2);
      assert.equal(exported.split('\r\n').length, 5002);
      assert.doesNotMatch(exported, /PRIVATE_|password_hash|@phase5/);
      return exported;
    });
    await sample('learning 90 days over 20000-row history', learning.LEARNING_DASHBOARD_SQL, [owner, 90], rows => {
      assert.equal(rows.length, 1);
      const dashboard = rows[0].dashboard;
      assert.deepEqual(dashboard.summary, { submissions: 10000, acceptedSubmissions: 5000,
        solvedProblems: 9, attemptedProblems: 18, activeDays: 1 });
      assert.equal(dashboard.activity.length, 90); assert.equal(dashboard.review.length, 9);
      assert.doesNotMatch(JSON.stringify(dashboard), /PRIVATE_|source_code|password_hash|@phase5/);
      const { generatedAt: _at, ...stable } = dashboard;
      return stable;
    });
    const checkStats = async problem => {
      const [oracle] = await db.query(`SELECT count(DISTINCT user_id) FILTER (WHERE status='ACCEPTED')::int AS solver_count,
        count(*) FILTER (WHERE status='ACCEPTED')::int AS accepted_count,
        count(*) FILTER (WHERE status NOT IN ('QUEUED','JUDGING','SYSTEM_ERROR','CANCELLED'))::int AS finished_count
        FROM submissions WHERE problem_id=$1 AND NOT is_test`, [problem]);
      const [actual] = await db.query('SELECT solver_count,accepted_count,finished_count FROM problem_stats WHERE problem_id=$1', [problem]);
      assert.deepEqual(actual, oracle);
      const [mismatch] = await db.query(`SELECT count(*)::int AS count FROM (
        SELECT user_id,count(*)::int AS accepted_count FROM submissions WHERE problem_id=$1 AND NOT is_test AND status='ACCEPTED' GROUP BY user_id
      ) s FULL JOIN (SELECT user_id,accepted_count FROM problem_solver_counts WHERE problem_id=$1) c USING(user_id)
      WHERE s.accepted_count IS DISTINCT FROM c.accepted_count`, [problem]);
      assert.equal(mismatch.count, 0);
      return oracle;
    };
    await stage('5000 distinct solver multiplicities', async () => {
      const began = performance.now();
      await db.query(`INSERT INTO submissions(id,user_id,problem_id,language,source_code,status)
        SELECT md5('oj5-solve-'||n)::uuid,md5('oj5-user-'||n)::uuid,$1,'PYTHON','fixture','ACCEPTED'
        FROM generate_series(1,$2::int) n`, [statsProblem, limits.candidates]);
      const insertMs = performance.now() - began;
      const oracle = await checkStats(statsProblem);
      assert.deepEqual(oracle, { solver_count: 5000, accepted_count: 5000, finished_count: 5000 });
      const [size] = await db.query("SELECT pg_total_relation_size('problem_solver_counts')::text AS bytes");
      report.measurements.push({ label: currentStage, insertMs, oracle, entireCounterRelationBytes: Number(size.bytes) });
    });
    await stage('large source bulk transition and rollback', async () => {
      // Incompressible deterministic synthetic text; 8 MiB logical source, never secret or executable.
      await db.query(`INSERT INTO submissions(id,user_id,problem_id,language,source_code,status)
        SELECT md5('oj5-bulk-'||n)::uuid,md5('oj5-user-'||n)::uuid,$1,'PYTHON',
          (SELECT string_agg(md5(n::text||':'||piece::text),'') FROM generate_series(1,$3::int/32) piece),'ACCEPTED'
        FROM generate_series(1,$2::int) n`, [bulkProblem, limits.largeSources, limits.sourceBytes]);
      const initial = await checkStats(bulkProblem);
      const runner = db.createQueryRunner(); await runner.connect();
      try {
        await runner.query("SET work_mem='64kB'; SET temp_file_limit='32MB'");
        const [{ lsn }] = await runner.query('SELECT pg_current_wal_insert_lsn()::text AS lsn');
        const began = performance.now();
        const [plan] = await runner.query(`EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)
          UPDATE submissions SET status='WRONG_ANSWER' WHERE problem_id=$1`, [bulkProblem]);
        const committedMs = performance.now() - began;
        const [{ bytes }] = await runner.query('SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),$1)::text AS bytes', [lsn]);
        assert.deepEqual(await checkStats(bulkProblem), { solver_count: 0, accepted_count: 0, finished_count: 256 });
        await runner.startTransaction();
        await runner.query("UPDATE submissions SET status='ACCEPTED' WHERE problem_id=$1", [bulkProblem]);
        const [inside] = await runner.query('SELECT solver_count,accepted_count,finished_count FROM problem_stats WHERE problem_id=$1', [bulkProblem]);
        assert.deepEqual(inside, initial);
        await runner.rollbackTransaction();
        const afterRollback = await checkStats(bulkProblem);
        assert.deepEqual(afterRollback, { solver_count: 0, accepted_count: 0, finished_count: 256 });
        report.measurements.push({ label: currentStage, committedMs, clusterWalBytes: Number(bytes),
          plan: plan['QUERY PLAN'][0], initial, afterRollback,
          caution: 'Single committed sample; cluster WAL includes concurrent/checkpoint effects if any. EXPLAIN temp blocks do not expose all trigger-internal temporary IO.' });
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.query('RESET work_mem; RESET temp_file_limit').catch(() => {});
        await runner.release();
      }
    });
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.failure = { stage: currentStage, ...safeError(error) };
    throw error;
  } finally {
    clearTimeout(deadline);
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    try {
      if (db.isInitialized) await db.destroy();
      if (report.cleanup.created) {
        await admin.query(`DROP DATABASE ${ownedDatabaseName(name)} WITH (FORCE)`);
        report.cleanup.dropped = true;
      }
    } catch (error) {
      report.status = 'FAIL'; report.cleanup.error = safeError(error);
      throw error;
    } finally {
      let disconnectError;
      try { if (admin.isInitialized) await admin.destroy(); }
      catch (error) {
        report.status = 'FAIL'; report.cleanup.adminDisconnectError = safeError(error); disconnectError = error;
      } finally {
        report.elapsedMs = performance.now() - started;
        await mkdir(resolve(directory, 'reports'), { recursive: true });
        await writeFile(resolve(directory, 'reports/phase5-database.json'), `${JSON.stringify(report, null, 2)}\n`);
        console.log(JSON.stringify({ status: report.status, measurements: report.measurements.length,
          elapsedMs: report.elapsedMs, cleanup: report.cleanup }));
      }
      if (disconnectError) throw disconnectError;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await qualify(); }
  catch (error) { console.error(JSON.stringify({ status: 'FAIL', ...safeError(error) })); process.exitCode = 1; }
}
