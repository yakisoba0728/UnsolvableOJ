import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform, release } from 'node:os';
import { DataSource } from 'typeorm';
import pg from 'pg';
import configured from '../dist/database/data-source.js';
import { IncrementalProblemStats1796100000000 } from '../dist/database/migrations/1796100000000-incremental-problem-stats.js';

// Only a generated database on an explicitly opted-in loopback server is changed.
assert.equal(process.env.UNSOLVABLE_BENCHMARK, '1', 'Set UNSOLVABLE_BENCHMARK=1 for a disposable local server.');
assert.equal(process.env.NODE_ENV, 'test', 'Use NODE_ENV=test.');
const url = new URL(configured.options.url);
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.equal(url.search, '', 'Connection query overrides are forbidden.');
assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'Use a literal loopback address.');
assert.ok(['127.0.0.1', '::1'].includes(new pg.Client({ connectionString: url.href }).connectionParameters.host));
const argument = (name) => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1];
const sizes = (argument('rows') ?? '1000,10000,50000').split(',').map(Number);
assert.ok(sizes.length > 0 && sizes.length <= 3 && sizes.every(n => Number.isInteger(n) && n >= 100 && n <= 50000), 'Use at most three fixture sizes, 100..50000 rows each.');
const name = `unsolvable_stats_bench_${randomUUID().replaceAll('-', '')}`;
const admin = await new DataSource({ ...configured.options, entities: [], migrations: [], extra: { max: 1 } }).initialize();
url.pathname = `/${name}`;
const clockTicks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
const digest = value => createHash('sha256').update(value).digest('hex');
const migration = new IncrementalProblemStats1796100000000();
let created = false;
let db;
let mode = 'incremental';
const runners = [];
const result = {
  scope: 'Committed SQL verdict updates on one hot problem; exact original recount trigger versus incremental migration on the same fixtures. No HTTP, XP-award, Judge-throughput, production-capacity or exact lock-wait claim.',
  limitations: [
    'Synthetic warmed loopback PostgreSQL, short finite run, four clients maximum; client latency includes driver, commit and row-lock waiting.',
    'Per-process CPU uses Linux /proc clock ticks, not sampled profiling; endpoint RSS is not peak memory. The Node client process is separate from PostgreSQL.',
    'WAL is the isolated cluster insert-LSN difference around measured writes; includes trigger writes. Fixture autovacuum is disabled and explicit vacuum is outside timing.',
    'Baseline/candidate/candidate/baseline order reduces order bias but does not equalize every cache/physical-page state. Exact data and operation definitions remain identical.',
    'The original row trigger did not run for heartbeat-only updates. Transition-table UPDATE triggers now execute for those statements, so their overhead is measured explicitly.',
  ],
  source: {
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    baselineMigrationSha256: digest(await readFile(new URL('../src/database/migrations/1795200000000-problem-stats.ts', import.meta.url))),
    candidateMigrationSha256: digest(await readFile(new URL('../src/database/migrations/1796100000000-incremental-problem-stats.ts', import.meta.url))),
    benchmarkSha256: digest(await readFile(new URL(import.meta.url))),
  },
  environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length, clockTicks, loadAverageStart: loadavg() },
  definitions: { users: 200, targetRows: 64, modes: ['recount', 'incremental', 'incremental', 'recount'], serialSamplesPerRound: 64, concurrentClients: 4, concurrentSamplesPerRound: 64, bulkCyclesPerRound: 7, warmupCyclesPerClient: 3 },
  fixtures: [],
};

async function processStats(runner) {
  const [{ pid }] = await runner.query('SELECT pg_backend_pid() AS pid');
  assert.ok(Number.isInteger(pid) && pid > 0);
  try {
    const raw = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    return { cpuMs: (Number(fields[11]) + Number(fields[12])) * 1000 / clockTicks, rssKiB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]) };
  } catch (error) {
    return { cpuMs: null, rssKiB: null, unavailable: error.code ?? error.message };
  }
}
const quantiles = samples => {
  const sorted = samples.toSorted((a, b) => a - b);
  return Object.fromEntries([['p50', .5], ['p95', .95], ['p99', .99]].map(([key, p]) => [key, sorted[Math.ceil(sorted.length * p) - 1]]));
};
async function measure(label, clients, operation, changedRows) {
  const before = await Promise.all(clients.map(processStats));
  const [{ lsn }] = await runners[0].query('SELECT pg_current_wal_insert_lsn() AS lsn');
  const clientCpu = process.cpuUsage();
  const started = performance.now();
  const samplesMs = await operation();
  const elapsedMs = performance.now() - started;
  const cpu = process.cpuUsage(clientCpu);
  const [{ wal }] = await runners[0].query('SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),$1)::text AS wal', [lsn]);
  const after = await Promise.all(clients.map(processStats));
  return { label, mode, changedRows, elapsedMs, samplesMs, latencyMs: quantiles(samplesMs), changedRowsPerSecond: changedRows / elapsedMs * 1000,
    postgresCpuMs: before.every(p => p.cpuMs !== null) && after.every(p => p.cpuMs !== null) ? after.reduce((n, p, i) => n + p.cpuMs - before[i].cpuMs, 0) : null,
    postgresProcessesBefore: before, postgresProcessesAfter: after, clientCpuMs: (cpu.user + cpu.system) / 1000, walBytes: Number(wal) };
}
async function timed(runner, sql, parameters) {
  const started = performance.now();
  await runner.query(sql, parameters);
  return performance.now() - started;
}
async function setMode(next) {
  if (mode === next) return null;
  const started = performance.now();
  await runners[0].startTransaction();
  try {
    await migration[next === 'incremental' ? 'up' : 'down'](runners[0]);
    await runners[0].commitTransaction();
    mode = next;
  } catch (error) { await runners[0].rollbackTransaction(); throw error; }
  return performance.now() - started;
}
async function oracle() {
  const [expected] = await runners[0].query(`SELECT count(DISTINCT user_id) FILTER(WHERE status='ACCEPTED')::integer AS solver_count,
    count(*) FILTER(WHERE status='ACCEPTED')::integer AS accepted_count,count(*)::integer AS finished_count
    FROM submissions WHERE NOT is_test AND status NOT IN('QUEUED','JUDGING','SYSTEM_ERROR','CANCELLED')`);
  const [actual] = await runners[0].query('SELECT solver_count,accepted_count,finished_count FROM problem_stats');
  assert.deepEqual(actual, expected, 'Every measured mode must match the same full-recount oracle.');
  if (mode === 'incremental') assert.deepEqual(
    await runners[0].query('SELECT problem_id,user_id,accepted_count FROM problem_solver_counts ORDER BY problem_id,user_id'),
    await runners[0].query("SELECT problem_id,user_id,count(*)::integer AS accepted_count FROM submissions WHERE NOT is_test AND status='ACCEPTED' GROUP BY problem_id,user_id ORDER BY problem_id,user_id"),
  );
  return digest(JSON.stringify(expected));
}

try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = await new DataSource({ ...configured.options, url: url.href, extra: { max: 5, statement_timeout: 30000, lock_timeout: 10000 } }).initialize();
  assert.equal((await db.query('SELECT current_database() AS name'))[0].name, name);
  await db.runMigrations();
  for (let n = 0; n < 4; n++) { const runner = db.createQueryRunner(); await runner.connect(); runners.push(runner); }
  result.environment.postgres = (await runners[0].query('SELECT version() AS version'))[0].version;
  result.environment.settings = await runners[0].query("SELECT name,setting,unit FROM pg_settings WHERE name IN('shared_buffers','work_mem','max_connections','synchronous_commit','fsync','full_page_writes','wal_compression') ORDER BY name");
  await runners[0].query(`INSERT INTO users(id,email,username,password_hash)
    SELECT md5('stats-user-'||g)::uuid,'stats-'||g||'@fixture.invalid','stats_'||g,'synthetic' FROM generate_series(1,200) g`);
  await runners[0].query(`INSERT INTO problems(id,slug,title,statement_md,difficulty,status,author_id)
    VALUES(md5('stats-problem')::uuid,'stats-problem','Synthetic','Fixture','BEGINNER','PUBLISHED',md5('stats-user-1')::uuid)`);
  await runners[0].query('ALTER TABLE submissions SET (autovacuum_enabled=false)');
  await runners[0].query('ALTER TABLE problem_stats SET (autovacuum_enabled=false)');
  const update = "UPDATE submissions SET status=$2,updated_at=clock_timestamp() WHERE id=$1";
  for (const rows of sizes) {
    await setMode('incremental');
    await runners[0].query('TRUNCATE submissions CASCADE');
    await runners[0].query(`INSERT INTO submissions(id,user_id,problem_id,language,source_code,status)
      SELECT md5('stats-history-'||g)::uuid,md5('stats-user-'||((g%200)+1))::uuid,
        md5('stats-problem')::uuid,'PYTHON','fixture',CASE WHEN g%10<7 THEN 'ACCEPTED'::submission_status ELSE 'WRONG_ANSWER'::submission_status END
      FROM generate_series(1,$1::integer) g`, [rows]);
    const targets = (await runners[0].query(`INSERT INTO submissions(id,user_id,problem_id,language,source_code,status)
      SELECT md5('stats-target-'||g)::uuid,md5('stats-user-'||g)::uuid,md5('stats-problem')::uuid,
        'PYTHON','fixture','JUDGING' FROM generate_series(1,64) g RETURNING id`)).map(row => row.id).sort();
    const fixture = { historicalRows: rows, targetRows: targets.length, rounds: [] };
    for (let round = 0; round < result.definitions.modes.length; round++) {
      const migrationMs = await setMode(result.definitions.modes[round]);
      if (mode === 'incremental') await runners[0].query('ALTER TABLE problem_solver_counts SET (autovacuum_enabled=false)');
      const reset = async () => {
        await runners[0].query("UPDATE submissions SET status='JUDGING' WHERE id=ANY($1::uuid[])", [targets]);
        await runners[0].query('VACUUM (ANALYZE, INDEX_CLEANUP ON) submissions');
        await runners[0].query('VACUUM (ANALYZE, INDEX_CLEANUP ON) problem_stats');
        if (mode === 'incremental') await runners[0].query('VACUUM (ANALYZE, INDEX_CLEANUP ON) problem_solver_counts');
        // Compile each backend's trigger plan and warm the same target pages.
        for (let warm = 0; warm < 3; warm++) for (let client = 0; client < runners.length; client++) {
          await runners[client].query(update, [targets[client], 'ACCEPTED']);
          await runners[client].query(update, [targets[client], 'JUDGING']);
        }
        await oracle();
      };
      const measurements = [];
      await reset();
      measurements.push(await measure('serial_completion', [runners[0]], async () => {
        const samples = []; for (const id of targets) samples.push(await timed(runners[0], update, [id, 'ACCEPTED'])); return samples;
      }, targets.length));
      const serialDigest = await oracle();
      await reset();
      measurements.push(await measure('concurrent_completion', runners, async () => (await Promise.all(runners.map(async (runner, index) => {
        const samples = [];
        for (let i = index; i < targets.length; i += runners.length) samples.push(await timed(runner, update, [targets[i], 'ACCEPTED']));
        return samples;
      }))).flat(), targets.length));
      assert.equal(await oracle(), serialDigest);
      await reset();
      measurements.push(await measure('bulk_rejudge_cycle', [runners[0]], async () => {
        const samples = [];
        for (let n = 0; n < 7; n++) {
          const started = performance.now();
          await runners[0].query("UPDATE submissions SET status='ACCEPTED' WHERE id=ANY($1::uuid[])", [targets]);
          await runners[0].query("UPDATE submissions SET status='JUDGING' WHERE id=ANY($1::uuid[])", [targets]);
          samples.push(performance.now() - started);
        }
        return samples;
      }, targets.length * 2 * 7));
      const judgingDigest = await oracle();
      await reset();
      measurements.push(await measure('heartbeat_only', [runners[0]], async () => {
        const samples = [];
        for (const id of targets) samples.push(await timed(runners[0], "UPDATE submissions SET judge_lease_expires_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp() WHERE id=$1", [id]));
        return samples;
      }, targets.length));
      assert.equal(await oracle(), judgingDigest);
      const sizes = await runners[0].query(`SELECT c.relname,pg_total_relation_size(c.oid)::text AS bytes
        FROM pg_class c WHERE c.oid IN(to_regclass('problem_stats'),to_regclass('problem_solver_counts')) ORDER BY c.relname`);
      fixture.rounds.push({ round, mode, migrationMs, judgingDigest, completedDigest: serialDigest, relationSizes: sizes, measurements });
      console.error(`Stats benchmark: history=${rows}, round=${round}, mode=${mode}, oracle passed.`);
    }
    for (const label of fixture.rounds[0].measurements.map(row => row.label)) {
      const modes = Object.fromEntries(['recount', 'incremental'].map(mode => {
        const measurements = fixture.rounds.filter(row => row.mode === mode).flatMap(row => row.measurements.filter(row => row.label === label));
        return [mode, { latencyMs: quantiles(measurements.flatMap(row => row.samplesMs)), totalElapsedMs: measurements.reduce((n, row) => n + row.elapsedMs, 0), walBytes: measurements.reduce((n, row) => n + row.walBytes, 0), postgresCpuMs: measurements.every(row => row.postgresCpuMs !== null) ? measurements.reduce((n, row) => n + row.postgresCpuMs, 0) : null }];
      }));
      (fixture.summary ??= []).push({ label, ...modes });
    }
    result.fixtures.push(fixture);
  }
  result.finishedAt = new Date().toISOString();
  result.environment.loadAverageEnd = loadavg();
  const output = JSON.stringify(result, null, 2) + '\n';
  if (argument('output')) await writeFile(argument('output'), output); else console.log(output);
} finally {
  for (const runner of runners) { if (runner.isTransactionActive) await runner.rollbackTransaction(); await runner.release(); }
  if (db?.isInitialized) await db.destroy();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.destroy();
}
