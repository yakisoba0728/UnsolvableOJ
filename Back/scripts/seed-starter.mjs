import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateProblemDto } from '../dist/modules/problems/dto/create-problem.dto.js';
import { PasswordHasher } from '../dist/modules/auth/password-hasher.service.js';
import { databaseConnectionOptions } from '../dist/config/database.config.js';
import { starterProblems } from './starter-problems.mjs';

const { values } = parseArgs({ options: {
  apply: { type: 'boolean', default: false },
  'rollback-check': { type: 'boolean', default: false },
} });
if (values.apply && values['rollback-check']) throw new Error('Choose apply or rollback-check');
const prepared = starterProblems.map(({ dto }) => {
  const errors = validateSync(plainToInstance(CreateProblemDto, dto), { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) throw new Error(`Invalid starter problem: ${dto.slug}`);
  return { dto, hash: createHash('sha256').update(JSON.stringify(dto)).digest('hex') };
});
console.log(JSON.stringify({ prepared: prepared.length,
  samples: prepared.reduce((n, p) => n + p.dto.testCases.filter((t) => t.isSample).length, 0),
  hidden: prepared.reduce((n, p) => n + p.dto.testCases.filter((t) => !t.isSample).length, 0) }));
if (!values.apply && !values['rollback-check']) process.exit(0);

const options = databaseConnectionOptions(process.env.DATABASE_URL, process.env.DATABASE_SSL === 'true');
const client = new pg.Client({ connectionString: options.url, ssl: options.ssl });
await client.connect();
const runId = randomUUID(), inserted = [];
let committed = false;
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '60s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('unsolvable-starter-seed-v1'))");
  const existing = new Map((await client.query(
    `SELECT p.id,p.slug,v.snapshot->'importMetadata' AS metadata FROM problems p
     LEFT JOIN problem_versions v ON v.problem_id=p.id AND v.version=1
     WHERE p.slug=ANY($1::text[]) FOR UPDATE OF p`,
    [prepared.map((p) => p.dto.slug)],
  )).rows.map((p) => [p.slug, p]));
  for (const { dto, hash } of prepared) {
    const old = existing.get(dto.slug);
    if (old && (old.metadata?.provider !== 'UnsolvableOJ Starter' || old.metadata?.importHash !== hash)) {
      throw new Error(`Existing slug differs; refusing overwrite: ${dto.slug}`);
    }
  }
  const pending = prepared.filter(({ dto }) => !existing.has(dto.slug));
  let author;
  if (pending.length) {
    const authors = (await client.query(
      `SELECT u.id,u.username,u.email,u.role,EXISTS (
        SELECT 1 FROM audit_events a WHERE a.actor_id IS NULL
        AND a.action='service_account.provision.starter' AND a.target_type='user' AND a.target_id=u.id
        AND a.details->>'provisioner'='scripts/seed-starter.mjs' AND a.details->>'version'='1'
        AND a.details->>'passwordHashSha256'=encode(sha256(convert_to(u.password_hash,'UTF8')),'hex')
      ) AS provisioned FROM users u
      WHERE lower(u.username)=$1 OR u.email=$2 FOR UPDATE OF u`,
      ['starter_library', 'starter-library@unsolvable.local'],
    )).rows;
    if (authors.length) {
      if (authors.length !== 1 || authors[0].username !== 'starter_library' ||
          authors[0].email !== 'starter-library@unsolvable.local' ||
          authors[0].role !== 'AUTHOR' || !authors[0].provisioned) {
        throw new Error('Starter author conflicts with an unverified account; no existing credentials or roles were changed.');
      }
      author = authors[0];
    } else {
      const passwordHash = await new PasswordHasher().hash(randomBytes(48).toString('base64url'));
      author = (await client.query(
        "INSERT INTO users(email,username,password_hash,role) VALUES($1,$2,$3,'AUTHOR') RETURNING id",
        ['starter-library@unsolvable.local', 'starter_library', passwordHash],
      )).rows[0];
      await client.query(
        `INSERT INTO audit_events(actor_id,action,target_type,target_id,details)
         VALUES(NULL,'service_account.provision.starter','user',$1,$2::jsonb)`,
        [author.id, JSON.stringify({ provisioner: 'scripts/seed-starter.mjs', version: 1,
          passwordHashSha256: createHash('sha256').update(passwordHash).digest('hex') })],
      );
    }
  }
  for (const { dto, hash } of pending) {
    const id = randomUUID();
    const cases = dto.testCases.map((t, index) => ({ ...t, id: randomUUID(), order: index + 1 }));
    const { slug, status, testCases: unused, ...content } = dto;
    const snapshot = { ...content, testCases: cases,
      importMetadata: { provider: 'UnsolvableOJ Starter', importHash: hash, runId } };
    await client.query(
      `INSERT INTO problems(id,slug,title,statement_md,input_description_md,output_description_md,
        difficulty,status,time_limit_ms,memory_limit_mb,author_id,current_version)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)`,
      [id, slug, dto.title, dto.statementMarkdown, dto.inputDescriptionMarkdown,
        dto.outputDescriptionMarkdown, dto.difficulty, status, dto.timeLimitMs, dto.memoryLimitMb, author.id],
    );
    await client.query(
      `INSERT INTO test_cases(id,problem_id,input,expected_output,is_sample,"order",score)
       SELECT id,$2,input,"expectedOutput","isSample","order",score FROM jsonb_to_recordset($1::jsonb)
       AS x(id uuid,input text,"expectedOutput" text,"isSample" boolean,"order" int,score int)`,
      [JSON.stringify(cases), id],
    );
    await client.query('INSERT INTO problem_versions(problem_id,version,snapshot) VALUES($1,1,$2::jsonb)', [id, JSON.stringify(snapshot)]);
    await client.query(
      `INSERT INTO audit_events(actor_id,action,target_type,target_id,details)
       VALUES($1,'problem.import.starter','problem',$2,$3::jsonb)`,
      [author.id, id, JSON.stringify({ runId, slug, importHash: hash, testCases: cases.length })],
    );
    inserted.push({ id, slug, title: dto.title, cases: cases.length });
  }
  const verification = (await client.query(
    `SELECT count(*)::int AS problems,
      (SELECT count(*)::int FROM problem_versions WHERE problem_id=ANY($1::uuid[]) AND version=1) AS versions,
      (SELECT count(*)::int FROM test_cases WHERE problem_id=ANY($1::uuid[])) AS cases,
      (SELECT count(*)::int FROM audit_events WHERE target_id=ANY($1::uuid[]) AND action='problem.import.starter') AS audit_events
     FROM problems WHERE id=ANY($1::uuid[]) AND status='PUBLISHED'`, [inserted.map((p) => p.id)],
  )).rows[0];
  if (verification.problems !== inserted.length || verification.versions !== inserted.length ||
      verification.audit_events !== inserted.length || verification.cases !== inserted.reduce((n, p) => n + p.cases, 0)) {
    throw new Error('Starter seed verification failed');
  }
  const mismatches = (await client.query(
    `SELECT p.slug FROM problems p JOIN problem_versions v ON v.problem_id=p.id AND v.version=1
     WHERE p.id=ANY($1::uuid[]) AND (v.snapshot->>'statementMarkdown' IS DISTINCT FROM p.statement_md OR
     v.snapshot->'testCases' IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object(
       'id',t.id,'input',t.input,'expectedOutput',t.expected_output,'isSample',t.is_sample,'score',t.score,'order',t."order") ORDER BY t."order")
       FROM test_cases t WHERE t.problem_id=p.id))`, [inserted.map((p) => p.id)],
  )).rows;
  if (mismatches.length) throw new Error(`Snapshot mismatch: ${mismatches[0].slug}`);
  await client.query(values.apply ? 'COMMIT' : 'ROLLBACK');
  committed = values.apply;
  console.log(JSON.stringify({ runId, committed, inserted: inserted.length, skipped: existing.size, verification, records: inserted }));
} catch (error) {
  if (!committed) await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
