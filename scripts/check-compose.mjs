// Always creates its own project and RAM-backed databases; never touches the local stack.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = `unsolvable-e2e-${randomBytes(6).toString('hex')}`;
const parent = join(tmpdir(), 'opencode');
await mkdir(parent, { recursive: true });
const temporary = await mkdtemp(join(parent, `${project}-`));
const override = join(temporary, 'compose.yaml');
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  COMPOSE_FILE: [join(root, 'compose.yaml'), override].join(delimiter),
  GO_JUDGE_TOKEN: randomBytes(32).toString('hex'),
  QA_JWT_SECRET: randomBytes(32).toString('hex'),
  QA_JUDGE_TOKEN: randomBytes(32).toString('hex'),
  QA_DB_PASSWORD: randomBytes(24).toString('hex'),
};
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: root, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 * 1024, ...options,
});
const compose = (...args) => run('docker', ['compose', '--project-name', project, ...args]);
let created = false;

try {
  const deployment = ['compose', '--env-file', 'Judge/deploy/.env.example', '-f', 'Judge/deploy/compose.yaml', 'config', '--format', 'json'];
  const deploymentEnv = {
    ...env,
    COMPOSE_FILE: '',
    API_BASE_URL: 'https://api.example.test/api/v1',
    JUDGE_SERVICE_TOKEN: 'test-only-judge-token-not-for-deployment',
    REDIS_HOST: 'redis.private.test',
    REDIS_PASSWORD: 'test-only-password-not-for-deployment',
    GO_JUDGE_TOKEN: 'test-only-sandbox-token-not-for-deployment',
  };
  for (const key of ['API_BASE_URL', 'JUDGE_SERVICE_TOKEN', 'REDIS_HOST', 'REDIS_PASSWORD', 'GO_JUDGE_TOKEN']) {
    assert.throws(() => run('docker', deployment, { env: { ...deploymentEnv, [key]: '' }, stdio: 'pipe' }));
  }
  const production = JSON.parse(run('docker', deployment, { env: deploymentEnv }));
  assert.deepEqual(Object.keys(production.services).sort(), ['go-judge', 'judge']);
  for (const service of Object.values(production.services)) {
    assert.equal(service.ports?.length ?? 0, 0);
    assert.equal(service.volumes?.length ?? 0, 0);
  }
  assert.equal(production.services['go-judge'].privileged, true);
  assert.notEqual(production.services.judge.privileged, true);
  assert.equal(production.services['go-judge'].environment.ES_AUTH_TOKEN, production.services.judge.environment.GO_JUDGE_TOKEN);

  await writeFile(override, `services:
  postgres:
    ports: !override ["127.0.0.1::5432"]
    volumes: !override []
    tmpfs: ["/var/lib/postgresql/data:rw,nosuid,size=256m"]
    environment:
      POSTGRES_PASSWORD: \${QA_DB_PASSWORD}
  redis:
    ports: !override ["127.0.0.1::6379"]
    volumes: !override []
    tmpfs: ["/data:rw,nosuid,size=64m"]
  back:
    ports: !override ["127.0.0.1::3000"]
    environment:
      DATABASE_URL: postgresql://unsolvable:\${QA_DB_PASSWORD}@postgres:5432/unsolvable_oj
      JWT_ACCESS_SECRET: \${QA_JWT_SECRET}
      JUDGE_SERVICE_TOKEN: \${QA_JUDGE_TOKEN}
  go-judge:
    image: ${project}-sandbox
    ports: !override ["127.0.0.1::5050"]
  judge:
    environment:
      JUDGE_SERVICE_TOKEN: \${QA_JUDGE_TOKEN}
  front:
    ports: !override ["127.0.0.1::80"]
`, { mode: 0o600 });

  const plan = JSON.parse(compose('config', '--format', 'json'));
  for (const name of ['postgres', 'redis']) assert.equal(plan.services[name].volumes?.length ?? 0, 0);
  for (const service of Object.values(plan.services)) {
    for (const port of service.ports ?? []) {
      assert.equal(port.host_ip, '127.0.0.1');
      assert.equal(port.published ?? '0', '0');
    }
  }
  console.log(`Starting isolated Compose project ${project}`);
  created = true;
  compose('up', '-d', '--build', '--wait', '--wait-timeout', '180');
  const binding = compose('port', 'front', '80').trim();
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  env.LIVE_BASE_URL = `http://${binding}`;
  for (let attempt = 0; ; attempt++) {
    try {
      assert.equal((await fetch(env.LIVE_BASE_URL, { signal: AbortSignal.timeout(2000) })).status, 200);
      break;
    } catch (error) {
      if (attempt >= 30) throw error;
      await delay(500);
    }
  }
  run('npm', ['run', 'test:live', '--prefix', 'Front', '--', ...process.argv.slice(2)], { stdio: 'inherit' });
} catch (error) {
  try {
    let logs = compose('logs', '--no-color', '--tail', '40', 'back', 'judge', 'go-judge');
    for (const key of ['GO_JUDGE_TOKEN', 'QA_JWT_SECRET', 'QA_JUDGE_TOKEN', 'QA_DB_PASSWORD']) {
      logs = logs.replaceAll(env[key], '<REDACTED>');
    }
    console.error(logs);
  } catch { /* Preserve the original test failure if Docker is unavailable. */ }
  throw error;
} finally {
  try {
    if (created) compose('down', '--volumes', '--timeout', '5');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
