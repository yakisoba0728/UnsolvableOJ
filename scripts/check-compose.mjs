// Always creates its own project and RAM-backed databases; never touches the local stack.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { checkSandboxBudget } from './check-sandbox-budget.mjs';
import { checkSandboxStartupLogs } from '../Judge/runtime/check-logs.mjs';
import { checkVibeGatewayPlan, gatewayProbeSource, prepareVibeGateway } from './compose-vibe-gateway.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const productionMode = process.argv.includes('--production');
const testArgs = process.argv.slice(2).filter((arg) => arg !== '--production');
const project = `unsolvable-e2e-${randomBytes(6).toString('hex')}`;
const temporary = await mkdtemp(join(tmpdir(), `${project}-`));
const override = join(temporary, 'compose.yaml');
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  COMPOSE_FILE: [join(root, productionMode ? 'deploy/compose.yaml' : 'compose.yaml'), override].join(delimiter),
  GO_JUDGE_TOKEN: randomBytes(32).toString('hex'),
  QA_JWT_SECRET: randomBytes(32).toString('hex'),
  QA_JUDGE_TOKEN: randomBytes(32).toString('hex'),
  QA_DB_PASSWORD: randomBytes(24).toString('hex'),
  QA_UNUSED_ALGORITHM_TOKEN: randomBytes(32).toString('hex'),
  // This owned end-to-end fixture must never inherit paid-provider access.
  OPENAI_API_KEY: '',
  EMAIL_ENABLED: 'false',
  EMAIL_API_KEY: '',
};
if (productionMode) Object.assign(env, {
  PUBLIC_ORIGIN: 'http://127.0.0.1',
  TRUSTED_PROXY_CIDR: '127.0.0.1/32',
  POSTGRES_PASSWORD: env.QA_DB_PASSWORD,
  REDIS_PASSWORD: randomBytes(32).toString('hex'),
  JWT_ACCESS_SECRET: env.QA_JWT_SECRET,
  JUDGE_SERVICE_TOKEN: env.QA_JUDGE_TOKEN,
});
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: root, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 * 1024, ...options,
});
const compose = (...args) => run('docker', ['compose', '--project-name', project, ...args]);
let created = false;
const gatewayReport = { schemaVersion: 1, status: 'incomplete', source: null, fixture: null, imageId: null, probes: null, started: false, cleanup: false };

try {
  const checkout = run('git', ['rev-parse', 'HEAD']).trim();
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8')) : undefined;
  gatewayReport.source = { checkout, tree: run('git', ['rev-parse', 'HEAD^{tree}']).trim(),
    sourceHead: event?.pull_request?.head?.sha ?? checkout, base: event?.pull_request?.base?.sha ?? null,
    workflowRunId: env.GITHUB_RUN_ID ?? null, workflowAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    trackedTreeClean: run('git', ['status', '--porcelain', '--untracked-files=no']).trim() === '' };
  const vibe = await prepareVibeGateway({ project, directory: temporary, root, productionMode });
  gatewayReport.fixture = vibe.receipt;
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
  checkSandboxBudget(production);
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
    networks: !override ${JSON.stringify(vibe.backNetworks)}
    volumes: !override ${JSON.stringify(vibe.backVolumes)}
    environment:
      DATABASE_URL: postgresql://unsolvable:\${QA_DB_PASSWORD}@postgres:5432/unsolvable_oj
      JWT_ACCESS_SECRET: \${QA_JWT_SECRET}
      JUDGE_SERVICE_TOKEN: \${QA_JUDGE_TOKEN}
      OPENAI_API_KEY: ""
      GO_JUDGE_TOKEN: \${QA_UNUSED_ALGORITHM_TOKEN}
      VIBE_EXECUTION_MODE: dedicated
      VIBE_SANDBOX_URL: https://vibe-executor.internal:8443
      VIBE_SANDBOX_TOKEN: \${GO_JUDGE_TOKEN}
      VIBE_SANDBOX_TLS_SERVERNAME: vibe-executor.internal
      VIBE_SANDBOX_TLS_CA_FILE: /run/secrets/vibe_ca
      VIBE_SANDBOX_TLS_CERT_FILE: /run/secrets/vibe_client_cert
      VIBE_SANDBOX_TLS_KEY_FILE: /run/secrets/vibe_client_key
  go-judge:
    image: ${project}-sandbox
    ports: !override ["127.0.0.1::5050"]
    networks: !override {sandbox: {aliases: [vibe-sandbox]}}
  judge:
    environment:
      JUDGE_SERVICE_TOKEN: \${QA_JUDGE_TOKEN}
  front:
    image: ${project}-front
    ports: !override ["127.0.0.1::80"]
  vibe-gateway: ${JSON.stringify(vibe.gateway)}
networks:
  sandbox:
    internal: true
${productionMode ? `  dokploy-network:
    external: false
    name: ${project}-edge
` : ''}
`, { mode: 0o600 });

  const plan = JSON.parse(compose('config', '--format', 'json'));
  checkVibeGatewayPlan(plan, project);
  if (productionMode) checkSandboxBudget(plan);
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
  gatewayReport.started = true;
  const image = name => run('docker', ['inspect', '--format', '{{.Image}}', compose('ps', '-q', name).trim()]).trim();
  gatewayReport.imageId = image('front');
  assert.equal(image('vibe-gateway'), gatewayReport.imageId, 'Gateway must reuse the actual Front image');
  gatewayReport.probes = JSON.parse(compose('exec', '-T', 'back', 'node', '--input-type=module', '-e', gatewayProbeSource));
  env.LIVE_VIBE_GATEWAY_RECEIPT = join(temporary, 'gateway-receipt.json');
  await writeFile(env.LIVE_VIBE_GATEWAY_RECEIPT, JSON.stringify({ ...gatewayReport, status: 'PREFLIGHT_PASS' }), { mode: 0o600 });
  checkSandboxStartupLogs(compose('logs', '--no-color', 'go-judge'), env.GO_JUDGE_TOKEN);
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
  const internal = await fetch(`${env.LIVE_BASE_URL}/api/v1/internal/judge/heartbeat`, {
    method: 'POST', signal: AbortSignal.timeout(5000),
  });
  assert.equal(internal.status, 404, 'The public frontend must block judge internals');
  // Run Node directly so Windows does not need a shell to launch npm.cmd.
  run(process.execPath, [join(root, 'Front/node_modules/@playwright/test/cli.js'),
    'test', '--config', 'playwright.live.config.ts', ...testArgs], {
    cwd: join(root, 'Front'), stdio: 'inherit',
  });
  gatewayReport.status = 'PASS';
} catch (error) {
  gatewayReport.status = 'FAIL';
  try {
    let logs = compose('logs', '--no-color', '--tail', '40', 'back', 'judge', 'go-judge', 'vibe-gateway');
    for (const key of ['GO_JUDGE_TOKEN', 'QA_UNUSED_ALGORITHM_TOKEN', 'QA_JWT_SECRET', 'QA_JUDGE_TOKEN', 'QA_DB_PASSWORD', 'REDIS_PASSWORD']) {
      if (env[key]) logs = logs.replaceAll(env[key], '<REDACTED>');
    }
    console.error(logs);
  } catch { /* Preserve the original test failure if Docker is unavailable. */ }
  throw error;
} finally {
  try {
    if (created) compose('down', '--volumes', '--timeout', '5');
    gatewayReport.cleanup = true;
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await mkdir(join(root, 'Front/reports'), { recursive: true });
    if (!gatewayReport.cleanup) gatewayReport.status = 'FAIL';
    await writeFile(join(root, 'Front/reports/phase5-vibe-compose.json'), `${JSON.stringify(gatewayReport, null, 2)}\n`);
  }
}
