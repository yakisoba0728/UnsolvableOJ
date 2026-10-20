// Requires migrated local PostgreSQL/Redis and a running go-judge service.
// Run after building Back and Judge. Uses Redis DB 2 and port 3100 by default.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { Queue } from 'bullmq';

const back = fileURLToPath(new URL('../', import.meta.url));
const judge = fileURLToPath(new URL('../../Judge/', import.meta.url));
const port = process.env.JUDGE_TEST_PORT || '3100';
const base = `http://127.0.0.1:${port}/api/v1`;
const env = {
  ...process.env,
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: port,
  DATABASE_URL:
    process.env.DATABASE_URL ||
    'postgresql://unsolvable:local_password@localhost:5432/unsolvable_oj',
  REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
  REDIS_PORT: process.env.REDIS_PORT || '6379',
  REDIS_DB: process.env.PIPELINE_REDIS_DB || '2',
  JWT_ACCESS_SECRET: randomUUID() + randomUUID(),
  JUDGE_SERVICE_TOKEN: randomUUID() + randomUUID(),
  API_BASE_URL: base,
  GO_JUDGE_URL: process.env.GO_JUDGE_URL || 'http://127.0.0.1:5050',
  GO_JUDGE_TOKEN:
    process.env.GO_JUDGE_TOKEN || 'local-dev-only-go-judge-token-0123456789abcdef',
};
const database = new pg.Client({ connectionString: env.DATABASE_URL });
const children = [];
const submissions = [];
let problemId;
let userId;
let queue;

function start(cwd, script) {
  const child = spawn(process.execPath, [script], {
    cwd,
    env,
    stdio: 'inherit',
  });
  children.push(child);
  return child;
}
async function api(path, method = 'GET', body, token) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  assert.ok(
    response.ok,
    `${method} ${path}: ${response.status} ${JSON.stringify(result)}`,
  );
  return result;
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const closed = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([closed, delay(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

try {
  await database.connect();
  start(back, 'dist/main.js');
  let healthy = false;
  for (let retry = 0; retry < 60; retry++) {
    try {
      await api('/health');
      healthy = true;
      break;
    } catch {
      await delay(500);
    }
  }
  assert.ok(healthy, 'Test API did not become healthy');
  start(judge, 'dist/worker.js');
  queue = new Queue('judge-submissions', {
    connection: {
      host: env.REDIS_HOST,
      port: Number(env.REDIS_PORT),
      db: Number(env.REDIS_DB),
      username: env.REDIS_USERNAME || undefined,
      password: env.REDIS_PASSWORD || undefined,
    },
  });
  const suffix = randomUUID().slice(0, 8);
  const email = `judge-flow-${suffix}@example.com`;
  const password = randomUUID();
  const registered = await api('/auth/register', 'POST', {
    email,
    password,
    username: `flow_${suffix}`,
  });
  userId = registered.user.id;
  await database.query("UPDATE users SET role = 'ADMIN' WHERE id = $1", [
    userId,
  ]);
  const { accessToken: token } = await api('/auth/login', 'POST', {
    email,
    password,
  });
  const problem = await api(
    '/problems',
    'POST',
    {
      slug: `judge-flow-${suffix}`,
      title: 'Judge flow check',
      statementMarkdown: 'Add two numbers.',
      difficulty: 'BEGINNER',
      status: 'PUBLISHED',
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      inputDescriptionMarkdown: 'Two integers',
      outputDescriptionMarkdown: 'Their sum',
      testCases: [
        { input: '1 2\n', expectedOutput: '3\n', isSample: true },
        { input: '5 7\n', expectedOutput: '12\n', isSample: false },
      ],
    },
    token,
  );
  problemId = problem.id;
  const checks = [
    [
      'ACCEPTED',
      'import sys\nprint(sum(map(int,input().split())))\nprint("debug", file=sys.stderr)',
      '3\n',
    ],
    ['WRONG_ANSWER', 'print(4)', '4\n'],
    [
      'RUNTIME_ERROR',
      'print("before error", flush=True)\nraise RuntimeError("sample error")',
      'before error\n',
    ],
    [
      'TIME_LIMIT_EXCEEDED',
      'print("before timeout", flush=True)\nwhile True: pass',
      'before timeout\n',
    ],
    ['OUTPUT_LIMIT_EXCEEDED', 'print("x" * 1000001)', 'x'.repeat(1000)],
    [
      'RUNTIME_ERROR',
      'a,b=map(int,input().split())\nif a==5: raise RuntimeError("hidden-secret")\nprint(a+b)',
      '3\n',
    ],
    ['COMPILE_ERROR', 'int main( {', undefined, 'C'],
  ];
  for (const [expected, sourceCode, stdout, language = 'PYTHON'] of checks) {
    const submitted = await api(
      `/problems/${problemId}/submissions`,
      'POST',
      { language, sourceCode },
      token,
    );
    submissions.push(submitted.id);
    let result;
    for (let retry = 0; retry < 120; retry++) {
      result = await api(
        `/submissions/${submitted.id}`,
        'GET',
        undefined,
        token,
      );
      if (!['QUEUED', 'JUDGING'].includes(result.status)) break;
      await delay(500);
    }
    assert.equal(result.status, expected, JSON.stringify(result));
    if (stdout !== undefined)
      assert.equal(result.debugOutputs[0]?.stdout, stdout);
    else assert.deepEqual(result.debugOutputs, []);
    if (expected === 'ACCEPTED')
      assert.equal(result.debugOutputs[0].stderr, 'debug\n');
    if (expected === 'OUTPUT_LIMIT_EXCEEDED')
      assert.equal(result.debugOutputs[0].stdoutTruncated, true);
    assert.ok(
      !JSON.stringify([result.debugOutputs, result.judgeMessage]).includes(
        'hidden-secret',
      ),
    );
    console.log(
      `PASS real API -> queue -> go-judge -> stored result: ${expected}`,
    );
  }
} finally {
  for (const child of [...children].reverse()) await stop(child);
  if (queue) {
    for (const id of submissions) {
      const job = await queue.getJob(`${id}-1`);
      if (job) await job.remove();
    }
    await queue.close();
  }
  if (problemId) {
    await database.query('DELETE FROM submissions WHERE problem_id = $1', [
      problemId,
    ]);
    await database.query('DELETE FROM problems WHERE id = $1', [problemId]);
  }
  if (userId) await database.query('DELETE FROM users WHERE id = $1', [userId]);
  await database.end();
}
