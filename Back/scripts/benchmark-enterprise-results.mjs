// Finite real-HTTP comparison against a newly created disposable database.
// Copy this identical harness into the baseline checkout; build each checkout first.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { stopChild } from './run-integration.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const url = new URL(process.env.DATABASE_URL);
const loopback = (host) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
assert.equal(process.env.OJ_DISPOSABLE_BENCHMARK, '1');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'A PostgreSQL protocol is required.');
assert.ok(loopback(url.hostname) && loopback(process.env.REDIS_HOST));
assert.equal(url.search, '', 'Connection query overrides are forbidden in this disposable harness.');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.EMAIL_ENABLED, 'false');
assert.equal(process.env.EMAIL_WORKER_ENABLED, 'false');
assert.equal(process.env.OPENAI_API_KEY ?? '', '');

if (process.argv.includes('--serve')) {
  assert.match(url.pathname, /^\/unsolvable_benchmark_[a-f0-9]{32}$/);
  await import('reflect-metadata');
  const [{ NestFactory }, { DataSource }, { AppModule }, { configureHttp }] = await Promise.all([
    import('@nestjs/core'), import('typeorm'), import('../dist/app.module.js'), import('../dist/configure-http.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  const database = app.get(DataSource);
  const logger = database.logger;
  const originalLog = logger.logQuery.bind(logger);
  let capture;
  logger.logQuery = (query, parameters, runner) => {
    if (capture) capture.push({ sql: query, parameters });
    originalLog(query, parameters, runner);
  };
  process.on('message', (message) => {
    if (message.type === 'capture') { capture = []; process.send({ type: 'capturing' }); }
    if (message.type === 'queries') { process.send({ type: 'queries', queries: capture }); capture = undefined; }
  });
  process.send({ type: 'ready', origin: await app.getUrl() });
  let closing = false;
  const close = async () => { if (!closing) { closing = true; await app.close(); process.exit(0); } };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
} else {
  const count = Number(process.argv.find((arg) => arg.startsWith('--candidates='))?.split('=')[1]);
  const expectedRows = Number(process.argv.find((arg) => arg.startsWith('--rows='))?.split('=')[1]);
  assert.ok([1000, 5000].includes(count), 'Choose a finite 1000/5000 candidate fixture.');
  assert.ok([50, count].includes(expectedRows), 'Explicit before/after response size required.');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--', 'src'], { cwd: directory, encoding: 'utf8' }).trim(), '',
    'Commit the measured application source before running; untracked source is not a reproducible baseline.');
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const name = `unsolvable_benchmark_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: url.href });
  assert.ok(loopback(admin.connectionParameters.host));
  const databaseUrl = new URL(url);
  databaseUrl.pathname = `/${name}`;
  let created = false;
  let database;
  let server;
  let redis;
  let interrupted = false;
  const interruption = new AbortController();
  const interrupt = (signal) => { interrupted = true; interruption.abort(); process.exitCode = signal === 'SIGINT' ? 130 : 143; };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }));
  assert.ok(Number.isSafeInteger(ticksPerSecond) && ticksPerSecond > 0);
  const resources = () => {
    const stat = readFileSync(`/proc/${server.pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const status = readFileSync(`/proc/${server.pid}/status`, 'utf8');
    return { cpuTicks: Number(fields[11]) + Number(fields[12]),
      rssKiB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]),
      peakRssKiB: Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1]) };
  };
  const message = (type) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { server.off('message', receive); reject(new Error(`API IPC timeout: ${type}`)); }, 15_000);
    const receive = (value) => { if (value.type === type) { clearTimeout(timeout); server.off('message', receive); resolve(value); } };
    server.on('message', receive);
  });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    process.env.DATABASE_URL = databaseUrl.href;
    await import('reflect-metadata');
    database = (await import('../dist/database/data-source.js')).default;
    await database.initialize();
    await database.runMigrations();
    const { Redis } = await import('ioredis');
    redis = new Redis({ host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT), db: Number(process.env.REDIS_DB) });
    assert.equal(await redis.dbsize(), 0, 'A fresh owned Redis DB is mandatory; no rate counter is cleared.');
    server = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve'], {
      cwd: directory, env: process.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let stderr = '';
    server.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    const { origin } = await message('ready').catch((error) => { throw new Error(`${error.message}: ${stderr}`); });
    const registration = await fetch(`${origin}/api/v1/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'enterprise-benchmark@example.invalid', username: 'enterprise_benchmark', password: 'benchmark-only-password-123' }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(registration.status, 201);
    const account = await registration.json();
    const testId = '00000000-0000-4000-8000-000000000100';
    const problems = ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102'];
    await database.query(`INSERT INTO users(id,email,username,password_hash)
      SELECT md5('result-user-'||n)::uuid,'result-'||n||'@example.invalid','result_'||n,'fixture-only'
      FROM generate_series(1,$1::int) n`, [count]);
    for (const [index, id] of problems.entries()) {
      await database.query(`INSERT INTO problems(id,slug,title,statement_md,difficulty,author_id)
        VALUES($1,$2,'Synthetic result fixture','Synthetic','BEGINNER',$3)`, [id,`results-${index}`,account.user.id]);
      await database.query("INSERT INTO problem_versions(problem_id,version,snapshot) VALUES($1,1,'{}')",[id]);
    }
    await database.query(`INSERT INTO enterprise_tests(id,owner_id,title,starts_at,ends_at,duration_min,problem_ids,vibe_challenge_ids,invite_code)
      VALUES($1,$2,'Results benchmark','2026-01-01','2026-01-02',30,$3,ARRAY['post-search-v1'],'results-benchmark')`, [testId,account.user.id,problems]);
    await database.query('INSERT INTO enterprise_problem_versions(test_id,problem_id,version,position) SELECT $1,id,1,n FROM unnest($2::uuid[]) WITH ORDINALITY t(id,n)',[testId,problems]);
    await database.query(`INSERT INTO enterprise_attempts(id,test_id,user_id,started_at,deadline_at,finished_at)
      SELECT md5('result-attempt-'||n)::uuid,$1,md5('result-user-'||n)::uuid,
        '2026-01-01'::timestamptz+n*interval '1 millisecond','2026-01-01 00:30:00','2026-01-01 00:20:00'
      FROM generate_series(1,$2::int) n`, [testId,count]);
    await database.query(`INSERT INTO submissions(id,user_id,problem_id,attempt_id,language,source_code,status,problem_version,is_test)
      SELECT md5('result-submission-'||n||'-'||p)::uuid,md5('result-user-'||n)::uuid,($1::uuid[])[p],md5('result-attempt-'||n)::uuid,
        'PYTHON','fixture',CASE WHEN n%(p+1)=0 THEN 'ACCEPTED'::submission_status ELSE 'WRONG_ANSWER'::submission_status END,1,true
      FROM generate_series(1,$2::int) n CROSS JOIN generate_series(1,2) p`, [problems,count]);
    await database.query(`INSERT INTO vibe_attempts(id,user_id,enterprise_attempt_id,challenge_id,model,state,submitted_at)
      SELECT md5('result-vibe-'||n)::uuid,md5('result-user-'||n)::uuid,md5('result-attempt-'||n)::uuid,'post-search-v1','fixture',
        CASE WHEN n%5=1 THEN '{}'::jsonb WHEN n%5=2 THEN '{"report":{"evaluationStatus":"unavailable"}}'::jsonb
          ELSE jsonb_build_object('report',jsonb_build_object('evaluationStatus','complete','outcome',40,
            'prompt',jsonb_build_object('score',CASE WHEN n%5=3 THEN 25 ELSE 30 END),
            'process',jsonb_build_object('score',CASE WHEN n%5=3 THEN 22 ELSE 30 END))) END,
        CASE WHEN n%5<>1 THEN '2026-01-01 00:20:00'::timestamptz END
      FROM generate_series(1,$1::int) n WHERE n%5<>0`, [count]);
    for (const table of ['users','enterprise_tests','enterprise_attempts','submissions','vibe_attempts']) await database.query(`ANALYZE ${table}`);
    const endpoint = `${origin}/api/v1/enterprise/tests/${testId}/results`;
    let example;
    let lowestRemaining = 100;
    async function requestResult() {
      interruption.signal.throwIfAborted();
      const started = performance.now();
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${account.accessToken}` },
        signal: AbortSignal.any([interruption.signal, AbortSignal.timeout(15_000)]) });
      const body = await response.text();
      const json = JSON.parse(body);
      const elapsedMs = performance.now() - started;
      lowestRemaining = Math.min(lowestRemaining, Number(response.headers.get('x-ratelimit-remaining')));
      assert.equal(Number(response.headers.get('x-ratelimit-limit')),100);
      if (response.status === 200) {
        assert.equal(json.candidates.length, expectedRows);
        assert.equal(json.summary.candidates,count);
        example ??= json;
      }
      return { status: response.status, elapsedMs, bytes: Buffer.byteLength(body), encoding: response.headers.get('content-encoding') };
    }
    for (let i=0;i<5;i++) assert.equal((await requestResult()).status,200);
    const samples = [];
    for (let repeat=0;repeat<3;repeat++) {
      const before = resources();
      const started = performance.now();
      let next = 0;
      const responses = [];
      await Promise.all(Array.from({ length: 4 }, async () => { while (next++ < 20) responses.push(await requestResult()); }));
      const elapsedMs = performance.now()-started;
      const after = resources();
      const latencies = responses.map((row) => row.elapsedMs).sort((a,b)=>a-b);
      const percentile = (p) => latencies[Math.ceil(latencies.length*p)-1];
      const errors = responses.filter((row)=>row.status!==200).length;
      const cpuMs = (after.cpuTicks-before.cpuTicks)*1000/ticksPerSecond;
      samples.push({ repeat, concurrency:4, requests:20, elapsedMs, rps:20000/elapsedMs, p50Ms:percentile(.5),
        p95Ms:percentile(.95),p99Ms:percentile(.99),errors,errorRate:errors/20,cpuMs,cpuCores:cpuMs/elapsedMs,
        before,after,responses });
      assert.equal(errors,0,'HTTP failures are retained as failures, never successful capacity.');
    }
    const startedCapture = message('capturing'); server.send({type:'capture'}); await startedCapture;
    assert.equal((await requestResult()).status,200);
    const captured = message('queries'); server.send({type:'queries'});
    const {queries} = await captured;
    const resultQueries = queries.filter(({sql})=>/^\s*(SELECT|WITH)\b/i.test(sql)&&/enterprise_(tests|attempts)|vibe_attempts/.test(sql));
    const plans=[];
    for (const query of resultQueries) {
      const [result]=await database.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`,query.parameters);
      plans.push({...query,plan:result['QUERY PLAN'][0]});
    }
    const [{version}]=await database.query('SELECT version() AS version');
    const settings=await database.query("SELECT name,setting,unit FROM pg_settings WHERE name IN ('shared_buffers','work_mem','max_connections','max_parallel_workers_per_gather') ORDER BY name");
    const normalized=example.candidates.slice(0,50).map((row)=>({...row,problems:row.problems.toSorted((a,b)=>a.problemId.localeCompare(b.problemId))}));
    console.log(JSON.stringify({schemaVersion:1,
      revision:execFileSync('git',['rev-parse','HEAD'],{cwd:directory,encoding:'utf8'}).trim(),
      applicationSourceTree:execFileSync('git',['rev-parse','HEAD:Back/src'],{cwd:directory,encoding:'utf8'}).trim(),
      harnessSha256:createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
      scope:'Real authenticated owner results HTTP including complete response body and JSON parse; a page is bounded after the change, global summaries remain equal.',
      environment:{node:process.version,os:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,postgres:version,settings,ticksPerSecond},
      fixture:{candidates:count,problems:2,vibeChallenges:1,submissions:count*2,vibeAttempts:count*4/5,responseCandidates:expectedRows},
      methodology:{warmups:5,repeats:3,requestsPerRepeat:20,concurrency:4,totalResultRequests:66,lowestRemaining,
        latency:'fetch through text decoding and JSON parse; assertions and byte counting excluded',
        resources:'Owned API child only; CPU tick differences exclude client/PostgreSQL/Redis. RSS peak includes startup/warmup.',
        limits:'20 samples per repeat: p99 is maximum; shared host; first page only; no steady-state/general production capacity claim. No throttle counters reset or policy changed.'},
      summary:example.summary,first50Digest:digest(normalized),samples,
      queryCapture:{total:queries.length,resultReads:resultQueries.length,transactionStatements:queries.filter(({sql})=>/^(START TRANSACTION|SET TRANSACTION|COMMIT)/i.test(sql)).length,plans},
    },null,2));
  } finally {
    await stopChild(server);
    if(redis) { try { await redis.quit(); } finally { redis.disconnect(); } }
    if(database?.isInitialized) await database.destroy();
    if(created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
    process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
    if(interrupted) console.error('Owned benchmark interrupted and cleaned up.');
  }
}
