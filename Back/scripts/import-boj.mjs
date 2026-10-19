import 'dotenv/config';
import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateProblemDto } from '../dist/modules/problems/dto/create-problem.dto.js';
import { PasswordHasher } from '../dist/modules/auth/password-hasher.service.js';
import { prepareProblem } from './boj-content.mjs';

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    audit: { type: 'string' },
    output: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'rollback-check': { type: 'boolean', default: false },
    status: { type: 'string', default: 'DRAFT' },
  },
});
if (
  !values.dataset ||
  !values.audit ||
  !values.output ||
  !['DRAFT', 'PUBLISHED'].includes(values.status)
) {
  throw new Error(
    'Usage: node scripts/import-boj.mjs --dataset PATH --audit PATH --output PATH [--status PUBLISHED] [--apply | --rollback-check]',
  );
}
if (values.apply && values['rollback-check'])
  throw new Error('Choose apply or rollback-check');
const root = resolve(values.dataset),
  audit = resolve(values.audit),
  output = resolve(values.output);
await mkdir(output, { recursive: true });
const auditSummary = JSON.parse(
  await readFile(resolve(audit, 'summary.json'), 'utf8'),
);
const ids = new Set(
  JSON.parse(
    await readFile(resolve(audit, 'eligible_problem_ids.json'), 'utf8'),
  ),
);
if (ids.size !== auditSummary.eligible) throw new Error('Audit count mismatch');
const prepared = [],
  difficulties = {},
  mediaWarnings = [];
const datasetHash = createHash('sha256');
const stream = createReadStream(resolve(root, 'problems.jsonl'));
stream.on('data', (chunk) => datasetHash.update(chunk));
const seen = new Set();
for await (const line of createInterface({
  input: stream,
  crlfDelay: Infinity,
})) {
  const record = JSON.parse(line);
  if (!ids.has(record.problem_id)) continue;
  if (seen.has(record.problem_id))
    throw new Error(`Duplicate source ID: ${record.problem_id}`);
  seen.add(record.problem_id);
  let item;
  try {
    item = prepareProblem(record, values.status);
  } catch (error) {
    throw new Error(`Conversion failed for BOJ ${record.problem_id}`, {
      cause: error,
    });
  }
  const errors = validateSync(plainToInstance(CreateProblemDto, item.dto), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length)
    throw new Error(
      `Invalid ${item.dto.slug}: ${JSON.stringify(errors.map(({ property, constraints, children }) => ({ property, constraints, children })))}`,
    );
  if (JSON.stringify(item).includes('\\u0000'))
    throw new Error(`NUL in ${item.dto.slug}`);
  prepared.push(item);
  difficulties[item.dto.difficulty] =
    (difficulties[item.dto.difficulty] || 0) + 1;
  if (item.provenance.conversionWarnings.length)
    mediaWarnings.push({
      problemId: record.problem_id,
      warnings: item.provenance.conversionWarnings,
    });
  if (prepared.length % 2000 === 0)
    console.log(`Prepared ${prepared.length}/${ids.size}`);
}
if (
  datasetHash.digest('hex') !== auditSummary.problems_jsonl_sha256 ||
  seen.size !== ids.size
)
  throw new Error('Dataset changed since eligibility audit');
const sampleCount = prepared.reduce(
  (n, item) => n + item.dto.testCases.length,
  0,
);
if (sampleCount !== auditSummary.eligible_statistics.sample_pairs)
  throw new Error('Sample count mismatch');
const manifest = {
  generatedAt: new Date().toISOString(),
  datasetSha256: auditSummary.problems_jsonl_sha256,
  problems: prepared.length,
  samplePairs: sampleCount,
  status: values.status,
  difficulties,
  unratedMappedToMedium: prepared.filter(
    (p) => !p.provenance.originalDifficulty?.level,
  ).length,
  mediaWarnings,
};
await writeFile(
  resolve(output, 'prepared-summary.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
const file = await open(resolve(output, 'prepared.jsonl'), 'w');
try {
  for (const item of prepared) await file.write(JSON.stringify(item) + '\n');
} finally {
  await file.close();
}
console.log(
  JSON.stringify({
    prepared: manifest.problems,
    samples: sampleCount,
    difficulties,
    mediaLinkedProblems: mediaWarnings.length,
  }),
);
if (!values.apply && !values['rollback-check']) process.exit(0);

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});
await client.connect();
const runId = randomUUID();
const inserted = [],
  skipped = [];
let committed = false;
try {
  await client.query('BEGIN');
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('unsolvable-boj-import-v1'))",
  );
  const existing = new Map(
    (
      await client.query(
        `SELECT p.id,p.slug,p.current_version,v.snapshot->'importMetadata' AS metadata
    FROM problems p LEFT JOIN problem_versions v ON v.problem_id=p.id AND v.version=1 WHERE p.slug=ANY($1::text[])`,
        [prepared.map((p) => p.dto.slug)],
      )
    ).rows.map((r) => [r.slug, r]),
  );
  for (const item of prepared) {
    const old = existing.get(item.dto.slug);
    if (old) {
      if (old.metadata?.importHash !== item.provenance.importHash)
        throw new Error(
          `Existing slug differs; refusing overwrite: ${item.dto.slug}`,
        );
      skipped.push({ slug: item.dto.slug, id: old.id });
    }
  }
  const pending = prepared.filter((p) => !existing.has(p.dto.slug));
  let author;
  if (pending.length) {
    const authors = (
      await client.query(
        'SELECT id,username,email,role FROM users WHERE username=$1 OR email=$2',
        ['boj_import', 'boj-import@unsolvable.local'],
      )
    ).rows;
    if (authors.length) {
      if (
        authors.length !== 1 ||
        authors[0].username !== 'boj_import' ||
        authors[0].email !== 'boj-import@unsolvable.local' ||
        authors[0].role !== 'AUTHOR'
      )
        throw new Error('Import author identity conflict');
      author = authors[0];
    } else {
      const hash = await new PasswordHasher().hash(
        randomBytes(48).toString('base64url'),
      );
      author = (
        await client.query(
          "INSERT INTO users (email,username,password_hash,role) VALUES ($1,$2,$3,'AUTHOR') RETURNING id",
          ['boj-import@unsolvable.local', 'boj_import', hash],
        )
      ).rows[0];
    }
  }
  for (let start = 0; start < pending.length; start += 200) {
    const batch = pending
      .slice(start, start + 200)
      .map(({ dto, provenance }) => {
        const id = randomUUID();
        const testCases = dto.testCases.map((test, index) => ({
          ...test,
          id: randomUUID(),
          order: index + 1,
        }));
        const { slug, status, ...content } = dto;
        const snapshot = {
          ...content,
          testCases,
          importMetadata: {
            ...provenance,
            runId,
            datasetSha256: manifest.datasetSha256,
          },
        };
        return { id, slug, status, ...content, testCases, snapshot };
      });
    await client.query(
      `INSERT INTO problems (id,slug,title,statement_md,input_description_md,output_description_md,difficulty,status,time_limit_ms,memory_limit_mb,author_id,current_version)
      SELECT id,slug,title,"statementMarkdown","inputDescriptionMarkdown","outputDescriptionMarkdown",difficulty::problem_difficulty,status::problem_status,"timeLimitMs","memoryLimitMb",$2,1
      FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,slug text,title text,"statementMarkdown" text,"inputDescriptionMarkdown" text,"outputDescriptionMarkdown" text,difficulty text,status text,"timeLimitMs" int,"memoryLimitMb" int)`,
      [JSON.stringify(batch), author.id],
    );
    const cases = batch.flatMap((p) =>
      p.testCases.map((t) => ({ ...t, problemId: p.id })),
    );
    await client.query(
      `INSERT INTO test_cases (id,problem_id,input,expected_output,is_sample,"order",score)
      SELECT id,"problemId",input,"expectedOutput","isSample","order",score FROM jsonb_to_recordset($1::jsonb)
      AS x(id uuid,"problemId" uuid,input text,"expectedOutput" text,"isSample" boolean,"order" int,score int)`,
      [JSON.stringify(cases)],
    );
    await client.query(
      `INSERT INTO problem_versions (problem_id,version,snapshot)
      SELECT id,1,snapshot FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,snapshot jsonb)`,
      [JSON.stringify(batch.map(({ id, snapshot }) => ({ id, snapshot })))],
    );
    await client.query(
      `INSERT INTO audit_events (actor_id,action,target_type,target_id,details)
      SELECT $2,'problem.import.boj','problem',id,jsonb_build_object('runId',$3::text,'slug',slug,'sampleOnly',true)
      FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,slug text)`,
      [
        JSON.stringify(batch.map(({ id, slug }) => ({ id, slug }))),
        author.id,
        runId,
      ],
    );
    inserted.push(
      ...batch.map(({ id, slug, testCases }) => ({
        id,
        slug,
        sampleCount: testCases.length,
      })),
    );
    if (inserted.length % 2000 === 0 || inserted.length === pending.length)
      console.log(`Staged ${inserted.length}/${pending.length}`);
  }
  const verification = (
    await client.query(
      `SELECT count(*)::int AS problems,
    (SELECT count(*)::int FROM test_cases WHERE problem_id=ANY($1::uuid[])) AS samples,
    (SELECT count(*)::int FROM problem_versions WHERE problem_id=ANY($1::uuid[]) AND version=1) AS versions,
    (SELECT count(*)::int FROM audit_events WHERE target_id=ANY($1::uuid[]) AND action='problem.import.boj') AS audit_events,
    count(*) FILTER (WHERE status::text=$2)::int AS expected_status
    FROM problems WHERE id=ANY($1::uuid[])`,
      [inserted.map((p) => p.id), values.status],
    )
  ).rows[0];
  const expectedSamples = inserted.reduce((n, p) => n + p.sampleCount, 0);
  if (
    verification.problems !== inserted.length ||
    verification.samples !== expectedSamples ||
    verification.versions !== inserted.length ||
    verification.audit_events !== inserted.length ||
    verification.expected_status !== inserted.length
  )
    throw new Error(`Verification failed: ${JSON.stringify(verification)}`);
  const mismatches = (
    await client.query(
      `SELECT p.slug FROM problems p JOIN problem_versions v ON v.problem_id=p.id AND v.version=p.current_version
    WHERE p.id=ANY($1::uuid[]) AND (v.snapshot->>'statementMarkdown' IS DISTINCT FROM p.statement_md OR
    v.snapshot->'testCases' IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('id',t.id,'input',t.input,'expectedOutput',t.expected_output,'isSample',t.is_sample,'score',t.score,'order',t."order") ORDER BY t."order") FROM test_cases t WHERE t.problem_id=p.id))`,
      [inserted.map((p) => p.id)],
    )
  ).rows;
  if (mismatches.length)
    throw new Error(`Snapshot mismatch: ${mismatches[0].slug}`);
  await client.query(values.apply ? 'COMMIT' : 'ROLLBACK');
  committed = values.apply;
  const result = {
    ...manifest,
    runId,
    committed,
    inserted: inserted.length,
    skipped: skipped.length,
    verification,
    records: inserted,
    existing: skipped,
  };
  await writeFile(
    resolve(output, committed ? 'import-result.json' : 'rollback-check.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      committed,
      inserted: inserted.length,
      skipped: skipped.length,
      verification,
    }),
  );
} catch (error) {
  if (!committed) await client.query('ROLLBACK');
  else
    console.error(
      'Database commit succeeded; rerun safely to recover the result report.',
    );
  throw error;
} finally {
  await client.end();
}
