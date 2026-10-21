import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';
import { databaseConnectionOptions } from '../src/config/env.validation.js';
import { InitialSchema1726916400000 } from '../src/database/migrations/1726916400000-initial-schema.js';
import { BackendFoundations1790550000000 } from '../src/database/migrations/1790550000000-backend-foundations.js';
import { DebugOutputs1790552000000 } from '../src/database/migrations/1790552000000-debug-outputs.js';
import { SubmissionXpEvidence1790553000000 } from '../src/database/migrations/1790553000000-submission-xp-evidence.js';
import { PasswordHasher } from '../src/modules/auth/password-hasher.service.js';

const execFile = promisify(execFileCallback);
const sourceRecord = (id: number) => ({
  problem_id: id,
  url: `https://www.acmicpc.net/problem/${id}`,
  title: `덧셈 ${id}`,
  sections: [{ kind: 'description', html: '<p>두 정수를 더한다.</p>', text: '두 정수를 더한다.' }],
  limits: { time_seconds: 1, memory_mb: 128 },
  samples: [{ input: '1 2\n', output: '3\n' }],
  labels: [],
  classification: { tags: [] },
  difficulty: { level: 1 },
  source: { sha256: 'fixture' },
});

describe('BOJ import and demo seed CLIs (isolated schema)', () => {
  const schema = `script_fixes_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let db: DataSource;
  let directory: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    admin = await new DataSource({
      type: 'postgres',
      ...databaseConnectionOptions(process.env.DATABASE_URL!, process.env.DATABASE_SSL === 'true'),
    }).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('options', `-c search_path=${schema}`);
    env = { ...process.env, DATABASE_URL: url.href };
    db = await new DataSource({
      type: 'postgres',
      ...databaseConnectionOptions(url.href, process.env.DATABASE_SSL === 'true'),
      schema,
      migrations: [InitialSchema1726916400000, BackendFoundations1790550000000, DebugOutputs1790552000000, SubmissionXpEvidence1790553000000],
    }).initialize();
    expect((await db.query('SELECT current_schema() AS name'))[0].name).toBe(schema);
    await db.runMigrations();
    directory = await mkdtemp(join(tmpdir(), 'unsolvable-script-fixes-'));
    await mkdir(join(directory, 'audit'));
  });

  beforeEach(async () => {
    await db.query('TRUNCATE users,problems,test_cases,problem_versions,audit_events CASCADE');
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  const seed = () => execFile(process.execPath, [resolve('scripts/seed-demo.mjs')], { env });
  const importRecords = async (records: ReturnType<typeof sourceRecord>[], mode = '--apply') => {
    const jsonl = records.map((record) => JSON.stringify(record) + '\n').join('');
    await writeFile(join(directory, 'problems.jsonl'), jsonl);
    await writeFile(join(directory, 'audit/eligible_problem_ids.json'), JSON.stringify(records.map((record) => record.problem_id)));
    await writeFile(join(directory, 'audit/summary.json'), JSON.stringify({
      eligible: records.length,
      problems_jsonl_sha256: createHash('sha256').update(jsonl).digest('hex'),
      eligible_statistics: { sample_pairs: records.length },
    }));
    return execFile(process.execPath, [
      resolve('scripts/import-boj.mjs'), '--dataset', directory,
      '--audit', join(directory, 'audit'), '--output', join(directory, 'output'), mode,
    ], { env });
  };
  const author = async (email = 'boj-import@unsolvable.local') =>
    (await db.query('SELECT * FROM users WHERE email=$1', [email]))[0];
  const versions = () => db.query('SELECT * FROM problem_versions ORDER BY version');
  const savedCases = () => db.query(`SELECT id,input,expected_output AS "expectedOutput",
    is_sample AS "isSample",score,"order" FROM test_cases ORDER BY "order"`);

  it('rejects an unmarked known-password AUTHOR without changing identity or adopting ownership', async () => {
    const hash = await new PasswordHasher().hash('ordinary-known-password');
    const [account] = await db.query(`INSERT INTO users (email,username,password_hash,role)
      VALUES ('boj-import@unsolvable.local','boj_import',$1,'AUTHOR') RETURNING *`, [hash]);
    // Old problem-import audit records are not service-account creation provenance.
    await db.query(`INSERT INTO audit_events (actor_id,action,target_type,target_id)
      VALUES ($1,'problem.import.boj','problem',$2)`, [account.id, randomUUID()]);
    await expect(importRecords([sourceRecord(1000)])).rejects.toMatchObject({
      stderr: expect.stringContaining('Operator verification is required'),
    });
    expect(await author()).toEqual(account);
    expect(await db.query('SELECT * FROM problems')).toEqual([]);
    expect(await db.query("SELECT * FROM audit_events WHERE action='service_account.provision.boj'")).toEqual([]);
  });

  it('creates transactional provisioning provenance, reuses it, and refuses problem overwrites', async () => {
    await importRecords([sourceRecord(1000)], '--rollback-check');
    expect(await db.query('SELECT * FROM users')).toEqual([]);
    expect(await db.query('SELECT * FROM audit_events')).toEqual([]);
    expect(await db.query('SELECT * FROM problems')).toEqual([]);
    await importRecords([sourceRecord(1000)]);
    const account = await author();
    const [marker] = await db.query("SELECT * FROM audit_events WHERE action='service_account.provision.boj'");
    expect(marker).toMatchObject({
      actor_id: null, target_type: 'user', target_id: account.id,
      details: {
        provisioner: 'scripts/import-boj.mjs', version: 1,
        passwordHashSha256: createHash('sha256').update(account.password_hash).digest('hex'),
      },
    });
    await importRecords([sourceRecord(1000), sourceRecord(1001)]);
    expect(await author()).toEqual(account);
    const report = JSON.parse(await readFile(join(directory, 'output/import-result.json'), 'utf8'));
    expect(report).toMatchObject({ inserted: 1, skipped: 1 });
    const problems = await db.query('SELECT * FROM problems ORDER BY slug');
    await expect(importRecords([{ ...sourceRecord(1000), title: 'Changed' }])).rejects.toMatchObject({
      stderr: expect.stringContaining('Existing slug differs; refusing overwrite'),
    });
    expect(await db.query('SELECT * FROM problems ORDER BY slug')).toEqual(problems);
  });

  it('keeps identical legacy imports a no-op but refuses new imports or changed service credentials', async () => {
    await importRecords([sourceRecord(1000)]);
    const account = await author();
    await db.query("DELETE FROM audit_events WHERE action='service_account.provision.boj'");
    await importRecords([sourceRecord(1000)]);
    expect(await author()).toEqual(account);
    expect(JSON.parse(await readFile(join(directory, 'output/import-result.json'), 'utf8'))).toMatchObject({
      inserted: 0, skipped: 1,
    });
    await expect(importRecords([sourceRecord(1000), sourceRecord(1001)])).rejects.toMatchObject({
      stderr: expect.stringContaining('Operator verification is required'),
    });
    expect(await author()).toEqual(account);
    expect(await db.query('SELECT slug FROM problems')).toEqual([{ slug: 'boj-1000' }]);

    await db.query(`INSERT INTO audit_events (action,target_type,target_id,details)
      VALUES ('service_account.provision.boj','user',$1,$2::jsonb)`, [account.id, JSON.stringify({
      provisioner: 'scripts/import-boj.mjs', version: 1,
      passwordHashSha256: createHash('sha256').update(account.password_hash).digest('hex'),
    })]);
    const changedHash = await new PasswordHasher().hash('now-a-known-password');
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [changedHash, account.id]);
    await expect(importRecords([sourceRecord(1001)])).rejects.toMatchObject({
      stderr: expect.stringContaining('Operator verification is required'),
    });
    expect((await author()).password_hash).toBe(changedHash);
    expect(await db.query('SELECT slug FROM problems')).toEqual([{ slug: 'boj-1000' }]);
  });

  it('keeps seed snapshots immutable on normal reruns and on a healthy edited v2', async () => {
    await seed();
    const initial = await versions();
    expect(initial).toHaveLength(1);
    expect(initial[0].snapshot.testCases).toEqual(await savedCases());
    expect(initial[0].snapshot.testCases).toHaveLength(2);
    await seed();
    expect(await versions()).toEqual(initial);
    await db.query("UPDATE problems SET current_version=2,title='Edited version two'");
    await db.query(`INSERT INTO problem_versions (problem_id,version,snapshot)
      SELECT problem_id,2,snapshot || '{"title":"Edited version two"}'::jsonb FROM problem_versions WHERE version=1`);
    const edited = await versions();
    await seed();
    expect(await versions()).toEqual(edited);
    expect(await db.query('SELECT title,current_version FROM problems')).toEqual([
      { title: 'Edited version two', current_version: 2 },
    ]);
  });

  it('repairs an interrupted legacy seed from explicitly loaded ordered saved cases', async () => {
    await seed();
    const original = (await versions())[0];
    await db.query('DELETE FROM problem_versions');
    await seed();
    const repaired = await versions();
    expect(repaired).toHaveLength(1);
    expect(repaired[0].snapshot).toEqual(original.snapshot);
    expect(repaired[0].snapshot.testCases).toEqual(await savedCases());
    expect(repaired[0].snapshot.testCases.map((item: { order: number }) => item.order)).toEqual([1, 2]);
  });

  it('rolls back author, problem and cases if the initial snapshot cannot be saved', async () => {
    await db.query('ALTER TABLE problem_versions ADD CONSTRAINT reject_demo_snapshot CHECK (false) NOT VALID');
    try {
      await expect(seed()).rejects.toMatchObject({ stderr: expect.stringContaining('reject_demo_snapshot') });
      expect(await db.query('SELECT * FROM users')).toEqual([]);
      expect(await db.query('SELECT * FROM problems')).toEqual([]);
      expect(await db.query('SELECT * FROM test_cases')).toEqual([]);
    } finally {
      await db.query('ALTER TABLE problem_versions DROP CONSTRAINT reject_demo_snapshot');
    }
  });

  it('fails rather than inventing v1 from edited v2, preserving credentials and immutable versions', async () => {
    await seed();
    await db.query("UPDATE problems SET current_version=2,title='Edited version two'");
    await db.query(`INSERT INTO problem_versions (problem_id,version,snapshot)
      SELECT problem_id,2,snapshot || '{"title":"Edited version two"}'::jsonb FROM problem_versions WHERE version=1`);
    await db.query('DELETE FROM problem_versions WHERE version=1');
    const account = await author('demo-author@unsolvable.local');
    const history = await versions();
    await expect(seed()).rejects.toMatchObject({
      stderr: expect.stringContaining('Current content cannot reconstruct version 1'),
    });
    expect(await versions()).toEqual(history);
    expect(await author('demo-author@unsolvable.local')).toEqual(account);
  });

  it('refuses missing cases and legacy empty snapshots instead of silently enabling 0/0 judging', async () => {
    await seed();
    const [initial] = await versions();
    await db.query('DELETE FROM problem_versions');
    await db.query('DELETE FROM test_cases');
    await expect(seed()).rejects.toMatchObject({ stderr: expect.stringContaining('Demo test cases are missing') });
    expect(await versions()).toEqual([]);
    await db.query(`INSERT INTO problem_versions (problem_id,version,snapshot) VALUES ($1,1,$2::jsonb)`, [
      initial.problem_id, JSON.stringify({ ...initial.snapshot, testCases: [] }),
    ]);
    const empty = await versions();
    await expect(seed()).rejects.toMatchObject({ stderr: expect.stringContaining('Demo version history is incomplete') });
    expect(await versions()).toEqual(empty);
  });
});
