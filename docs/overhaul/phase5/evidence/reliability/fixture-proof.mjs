// Narrow real-PostgreSQL proof of the shared synthetic fixture. This is not a
// backup/restore run and never bypasses phase4-restore-rehearsal.mjs's Docker gate.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedRestoreFixture, productSemantics } from '../../../../../Back/scripts/phase4-restore-rehearsal.mjs';

assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.PHASE5_FIXTURE_PROOF, 'disposable-local');
const connection = new URL(process.env.DATABASE_URL);
assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol));
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(connection.hostname));
assert.ok(connection.username && !connection.search && !connection.hash);
const root = new URL('../../../../../', import.meta.url);
const require = createRequire(new URL('Back/package.json', root));
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { default: configured } = await import(new URL('Back/dist/database/data-source.js', root));
const name = `oj5_fixture_${randomUUID().replaceAll('-', '')}`;
assert.match(name, /^oj5_fixture_[a-f0-9]{32}$/);
const admin = new DataSource({ ...configured.options, entities: [], migrations: [] });
const url = new URL(connection);
url.pathname = `/${name}`;
let db;
let created = false;
let report;
await admin.initialize();
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = await new DataSource({ ...configured.options, url: url.href }).initialize();
  const [{ version }] = await db.query('SELECT version() AS version');
  const migrations = await db.runMigrations();
  assert.equal(migrations.length, 31);
  await db.undoLastMigration();
  assert.equal((await db.runMigrations()).length, 1);
  await db.transaction(seedRestoreFixture);
  const products = await productSemantics(db);
  const snapshot = async () => {
    const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    return Promise.all(tables.map(async ({ tablename }) => {
      const identifier = `"${tablename.replaceAll('"', '""')}"`;
      const [value] = await db.query(`SELECT count(*)::int AS rows,
        md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), '')) AS digest FROM ${identifier} t`);
      return { table: tablename, ...value };
    }));
  };
  const before = await snapshot();
  assert.equal(before.length, 37);
  assert.equal(before.find(row => row.table === 'submissions').rows, 2056);
  await assert.rejects(db.undoLastMigration(), /Cannot roll back learning goals with saved goals/);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await productSemantics(db), products);
  const [{ bytes }] = await db.query('SELECT pg_database_size(current_database())::int AS bytes');
  assert.ok(bytes < 64 * 1024 * 1024);
  const files = ['Back/scripts/phase4-restore-rehearsal.mjs',
    'Back/src/database/migrations/1796200000000-learning-goals.ts',
    'Back/test/learning-goal-migration.e2e-spec.ts'];
  const fileSha256 = Object.fromEntries(await Promise.all(files.map(async file =>
    [file, createHash('sha256').update(await readFile(new URL(file, root))).digest('hex')])));
  report = { schemaVersion: 1, checkedAt: new Date().toISOString(), result: 'PASS',
    scope: 'fixture seed, product relationships, empty rollback/reapply, populated rollback refusal and all-table preservation only',
    postgres: version, node: process.version,
    baseHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim(),
    fileSha256, migrations: migrations.length, databaseBytes: bytes, products, tables: before,
    archiveRestore: 'NOT_EXECUTED_DOCKER_UNAVAILABLE', providerCalls: 0,
    limits: ['Synthetic fixture only; no API authorization, native judging, real award, deployment, RTO/RPO or capacity claim.',
      'The fixture proof does not call or bypass the guarded full restore entrypoint.'] };
} finally {
  if (db?.isInitialized) await db.destroy();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.destroy();
}
report.cleanup = 'generated fixture database removed';
await writeFile(new URL('fixture-proof.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`Fixture-only proof PASS: ${report.migrations} migrations, ${report.tables.length} preserved table fingerprints, ${report.products.goals} saved goals; generated database removed.`);
