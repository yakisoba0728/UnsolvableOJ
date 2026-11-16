import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const root = '/workspace/scratch/3d1215725852/independent-qa/reliability-source';
const require = createRequire(`${root}/Back/package.json`);
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { default: configured } = await import(`${root}/Back/dist/database/data-source.js`);
const { LearningGoals1796200000000 } = await import(`${root}/Back/dist/database/migrations/1796200000000-learning-goals.js`);
assert.equal(process.env.NODE_ENV, 'test');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
const name = `oj5_qa_${randomUUID().replaceAll('-', '')}`;
const admin = new DataSource({ ...configured.options, entities: [], migrations: [] });
let db, created = false;
const results = [];
await admin.initialize();
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = `/${name}`;
  db = await new DataSource({ ...configured.options, url: url.href }).initialize();
  await db.runMigrations();
  const owner = randomUUID();
  await db.query("INSERT INTO users(id,email,username,password_hash) VALUES($1,$2,$3,'synthetic-no-login')", [owner, `${owner}@example.invalid`, `qa_${owner.slice(0, 8)}`]);
  for (const isolation of ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']) {
    await db.query('DELETE FROM learning_goals WHERE user_id=$1', [owner]);
    const reverting = db.createQueryRunner();
    await reverting.connect();
    await reverting.startTransaction(isolation);
    let error = null, tableAfterDown = 'not-inspected';
    try {
      await reverting.query('SET LOCAL statement_timeout=5000; SET LOCAL lock_timeout=2000');
      await reverting.query('SELECT count(*) FROM migrations');
      await db.query("INSERT INTO learning_goals(user_id,target_problems,days,start_date) VALUES($1,321,30,'2026-11-16')", [owner]);
      assert.equal((await db.query('SELECT count(*)::int AS count FROM learning_goals'))[0].count, 1);
      try {
        await new LearningGoals1796200000000().down(reverting);
        tableAfterDown = (await reverting.query("SELECT to_regclass('learning_goals') AS name"))[0].name;
      } catch (caught) { error = caught.message; }
    } finally {
      await reverting.rollbackTransaction();
      await reverting.release();
    }
    const rowsAfterRollback = (await db.query('SELECT count(*)::int AS count FROM learning_goals'))[0].count;
    assert.equal(rowsAfterRollback, 1);
    results.push({ isolation, committedRowsBeforeDown: 1, downRejected: Boolean(error), error, tableAfterDownInsideTransaction: tableAfterDown, rowsAfterSafetyRollback: rowsAfterRollback });
  }
} finally {
  if (db?.isInitialized) await db.destroy();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.destroy();
}
const path = `${root}/Back/src/database/migrations/1796200000000-learning-goals.ts`;
const report = { reviewer: 'independent_qa', checkedAt: new Date().toISOString(), sourceCommit: 'f6f11ed41865226a26a86927d1fe97a8a961915f', migrationSha256: createHash('sha256').update(await readFile(path)).digest('hex'), results, cleanup: 'Owned generated database dropped; destructive migration effects were always rolled back.' };
await writeFile('/workspace/scratch/3d1215725852/independent-qa/goal-isolation-repro.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
