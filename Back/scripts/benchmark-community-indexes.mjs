import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cpus, platform, release } from 'node:os';
import { DataSource } from 'typeorm';
import pg from 'pg';
import configured from '../dist/database/data-source.js';
import { CommunityService } from '../dist/modules/community/community.service.js';
import { CommunityProfileIndexes1795700000000 } from '../dist/database/migrations/1795700000000-community-profile-indexes.js';

// Only the newly generated database is seeded, indexed or dropped. Never migrate
// the configured database; require an explicit opt-in and local disposable server.
assert.equal(process.env.UNSOLVABLE_BENCHMARK, '1', 'Set UNSOLVABLE_BENCHMARK=1 for an isolated local test server.');
const url = new URL(configured.options.url);
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Use a PostgreSQL connection URL.');
assert.equal(url.search, '', 'Connection query overrides are forbidden in this local benchmark.');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Use a local disposable PostgreSQL server.');
const effectiveHost = new pg.Client({ connectionString: url.href }).connectionParameters.host;
assert.ok(['localhost', '127.0.0.1', '::1'].includes(effectiveHost), 'The effective PostgreSQL destination must be loopback.');
const admin = await new DataSource({ ...configured.options, entities: [], migrations: [] }).initialize();
const name = `unsolvable_benchmark_${randomUUID().replaceAll('-', '')}`;
url.pathname = `/${name}`;
const includeWrites = process.argv.includes('--with-writes');
const writeCosts = {};
let db;
let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = await new DataSource({ ...configured.options, url: url.href, migrations: configured.options.migrations.filter((migration) => migration.name !== 'CommunityProfileIndexes1795700000000') }).initialize();
  await db.runMigrations();
  await db.query(`INSERT INTO users(id,email,username,password_hash)
    SELECT md5('benchmark-user-'||g)::uuid,'benchmark-'||g||'@fixture.invalid','bench_'||g,'unused'
    FROM generate_series(1,10000) g`);
  await db.query(`INSERT INTO community_posts(id,author_id,category,title,body,created_at,hidden_at)
    SELECT md5('benchmark-post-'||g)::uuid,md5('benchmark-user-'||((g%10000)+1))::uuid,
      'FREE','Benchmark post '||g,'Synthetic fixture',TIMESTAMPTZ '2026-01-01 00:00:00Z'+g*interval '1 second',
      CASE WHEN g%11=0 THEN TIMESTAMPTZ '2026-01-01 00:00:00Z' END
    FROM generate_series(1,2000) g`);
  for (const table of ['community_votes', 'community_saved']) {
    await db.query(`INSERT INTO ${table}(user_id,post_id)
      SELECT md5('benchmark-user-'||u)::uuid,md5('benchmark-post-'||(((u+slot*53)%2000)+1))::uuid
      FROM generate_series(1,10000) u CROSS JOIN generate_series(1,20) slot`);
  }
  await db.query('VACUUM (ANALYZE) community_votes');
  await db.query('VACUUM (ANALYZE) community_saved');
  await db.query('ANALYZE users');
  await db.query('ANALYZE community_posts');
  const [{ id }] = await db.query("SELECT id FROM users WHERE username='bench_137'");
  const statements = [];
  const capture = new CommunityService({ query: async (sql, params) => { statements.push({ sql, params }); return []; } });
  await capture.mine({ id, role: 'USER' });
  const targets = [['voted', statements[1]], ['saved', statements[2]]];
  const measured = {};
  const digest = (rows) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  async function writeSamples(table) {
    const samples = [];
    // Slot 37 is outside the seeded slots 1..20. Each operation inserts or
    // deletes exactly the same 1,000 distinct relationships in both modes.
    const insert = `INSERT INTO ${table}(user_id,post_id)
      SELECT md5('benchmark-user-'||u)::uuid,md5('benchmark-post-'||(((u+37*53)%2000)+1))::uuid
      FROM generate_series(1,1000) AS g(u)`;
    const remove = `DELETE FROM ${table} r USING generate_series(1,1000) AS g(u)
      WHERE r.user_id=md5('benchmark-user-'||u)::uuid
        AND r.post_id=md5('benchmark-post-'||(((u+37*53)%2000)+1))::uuid`;
    const count = async () => Number((await db.query(`SELECT count(*) AS n FROM ${table}`))[0].n);
    assert.equal(await count(), 200000);
    for (let sample = 0; sample < 10; sample++) {
      const started = performance.now();
      const [inserted] = await db.query(`EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) ${insert}`);
      const insertCallMs = performance.now() - started;
      assert.equal(await count(), 201000, 'Every measured insert must commit all 1,000 rows');
      const deleteStarted = performance.now();
      const [deleted] = await db.query(`EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) ${remove}`);
      const deleteCallMs = performance.now() - deleteStarted;
      assert.equal(await count(), 200000, 'Every measured delete must restore the original row count');
      if (sample >= 3) samples.push({ insertCallMs, deleteCallMs,
        insert: inserted['QUERY PLAN'][0], delete: deleted['QUERY PLAN'][0] });
      // Cleanup happens outside timing; no rolled-back index entries accumulate
      // between samples. This is single-writer maintenance cost, not mixed load.
      await db.query(`VACUUM (ANALYZE, INDEX_CLEANUP ON) ${table}`);
    }
    return samples;
  }
  if (includeWrites) for (const table of ['community_votes', 'community_saved'])
    writeCosts[table] = { before: await writeSamples(table) };
  for (const [label, statement] of targets) {
    for (let warmup = 0; warmup < 3; warmup++) await db.query(statement.sql, statement.params);
    const rows = await db.query(statement.sql, statement.params);
    measured[label] = { rowCount: rows.length, beforeDigest: digest(rows), before: [], after: [], sql: statement.sql };
    for (let sample = 0; sample < 7; sample++) {
      const [result] = await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`, statement.params);
      measured[label].before.push(result['QUERY PLAN'][0]);
    }
  }
  const runner = db.createQueryRunner();
  const indexBuildStarted = performance.now();
  try { await new CommunityProfileIndexes1795700000000().up(runner); } finally { await runner.release(); }
  const indexBuildMs = performance.now() - indexBuildStarted;
  await db.query('ANALYZE community_votes');
  await db.query('ANALYZE community_saved');
  for (const [label, statement] of targets) {
    for (let warmup = 0; warmup < 3; warmup++) await db.query(statement.sql, statement.params);
    measured[label].afterDigest = digest(await db.query(statement.sql, statement.params));
    assert.equal(measured[label].afterDigest, measured[label].beforeDigest, 'Indexes must preserve exact service response rows and order.');
    for (let sample = 0; sample < 7; sample++) {
      const [result] = await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`, statement.params);
      measured[label].after.push(result['QUERY PLAN'][0]);
    }
  }
  if (includeWrites) for (const table of ['community_votes', 'community_saved'])
    writeCosts[table].after = await writeSamples(table);
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = (plans) => ({ executionMs: median(plans.map((plan) => plan['Execution Time'])), sharedHitBlocks: median(plans.map((plan) => plan.Plan['Shared Hit Blocks'])), sharedReadBlocks: median(plans.map((plan) => plan.Plan['Shared Read Blocks'])) });
  const indexes = await db.query("SELECT indexname,pg_relation_size(indexname::regclass)::int AS bytes FROM pg_indexes WHERE schemaname='public' AND indexname IN ('idx_community_votes_user_post','idx_community_saved_user_post') ORDER BY indexname");
  const constraints = await db.query("SELECT conrelid::regclass::text AS table_name,conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conrelid::regclass::text,conname");
  const [{ version }] = await db.query('SELECT version() AS version');
  const settings = await db.query("SELECT name,setting,unit FROM pg_settings WHERE name IN ('shared_buffers','work_mem','max_connections','max_parallel_workers_per_gather') ORDER BY name");
  console.log(JSON.stringify({ scope: 'Exact CommunityService.mine saved/voted SQL; warmed single-connection EXPLAIN ANALYZE, no HTTP throughput claim.', baseline: 'Index-absent mode compared with production migration1795700000000 on the same fixture/current runtime; not an entire old application deployment.', dataset: { users: 10000, posts: 2000, savedRows: 200000, voteRows: 200000, warmups: 3, samples: 7, concurrency: 1 }, environment: { postgres: version, node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length, settings }, indexes, indexBuildMs, constraints, writeCosts: includeWrites ? { scope: 'Single-connection committed 1,000-row insert/delete batches, three warmups/seven samples; EXPLAIN records database execution/WAL, CallMs includes driver/plan/commit. Vacuum outside timing. No concurrent lock-wait or production build-lock claim.', tables: writeCosts } : undefined, results: Object.entries(measured).map(([name, result]) => ({ name, rowCount: result.rowCount, before: summary(result.before), after: summary(result.after), outputDigest: result.afterDigest, sql: result.sql, samples: { beforeMs: result.before.map((plan) => plan['Execution Time']), afterMs: result.after.map((plan) => plan['Execution Time']) }, beforePlan: result.before[0], afterPlan: result.after[0] })) }, null, 2));
} finally {
  if (db?.isInitialized) await db.destroy();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.destroy();
}
