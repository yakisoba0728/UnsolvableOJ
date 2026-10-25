// Configuration checks only: no daemon, builds, services, or real credentials.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const required = {
  PUBLIC_ORIGIN: 'https://oj.example.test',
  TRUSTED_PROXY_CIDR: '172.30.0.0/24',
  ...Object.fromEntries([
    'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'JWT_ACCESS_SECRET',
    'JUDGE_SERVICE_TOKEN', 'GO_JUDGE_TOKEN',
  ].map((name) => [name, randomBytes(32).toString('hex')])),
};
const env = {
  ...process.env,
  COMPOSE_FILE: '',
  COMPOSE_PROJECT_NAME: 'unsolvable-production-config-check',
  COMPOSE_PROFILES: '',
  ...required,
  JUDGE_CONCURRENCY: '2',
};
const args = [
  'compose', '--env-file', 'deploy/.env.example', '-f', 'deploy/compose.yaml',
  'config', '--format', 'json',
];
const config = (overrides = {}) => JSON.parse(execFileSync('docker', args, {
  cwd: root, env: { ...env, ...overrides }, encoding: 'utf8', stdio: 'pipe',
}));

for (const name of Object.keys(required)) {
  assert.throws(() => config({ [name]: '' }), `${name} must not be empty`);
}

const plan = config();
assert.deepEqual(Object.keys(plan.services).sort(), [
  'back', 'front', 'go-judge', 'judge', 'postgres', 'redis',
]);
for (const [name, service] of Object.entries(plan.services)) {
  assert.equal(service.ports?.length ?? 0, 0, `${name} publishes a host port`);
  assert.equal(service.restart, 'unless-stopped');
  assert.ok(service.mem_limit > 0, `${name} needs a memory budget`);
  assert.equal(service.privileged ?? false, name === 'go-judge');
  assert.equal(service.logging.options['max-file'], '3');
  if (service.build) {
    assert.ok(existsSync(join(service.build.context, 'Dockerfile')), `${name} build context`);
    assert.equal(normalize(service.build.context), normalize(join(root, {
      front: 'Front', back: 'Back', judge: 'Judge', 'go-judge': 'Judge/runtime',
    }[name])));
  }
  if (!['postgres', 'redis'].includes(name)) {
    assert.equal(service.volumes?.length ?? 0, 0, `${name} mounts persistent host data`);
  } else {
    assert.equal(service.volumes.length, 1);
    assert.equal(service.volumes[0].type, 'volume');
  }
}

const { front, back, judge, redis } = plan.services;
const sandbox = plan.services['go-judge'];
assert.equal(plan.networks.sandbox.internal, true);
assert.equal(plan.networks['dokploy-network'].external, true);
assert.deepEqual(Object.keys(sandbox.networks), ['sandbox']);
assert.equal(sandbox.memswap_limit, sandbox.mem_limit);
assert.equal(sandbox.cgroup, 'private');
for (const [name, service] of Object.entries(plan.services)) {
  assert.equal('dokploy-network' in service.networks, name === 'front');
}
assert.equal(front.environment.TRUSTED_PROXY_CIDR, required.TRUSTED_PROXY_CIDR);
assert.equal(front.build.args.VITE_API_BASE_URL, '/api/v1');
assert.equal(back.environment.CORS_ORIGIN, required.PUBLIC_ORIGIN);
assert.equal(back.environment.JUDGE_SERVICE_TOKEN, judge.environment.JUDGE_SERVICE_TOKEN);
assert.equal(back.environment.REDIS_PASSWORD, judge.environment.REDIS_PASSWORD);
assert.equal(redis.environment.REDIS_PASSWORD, judge.environment.REDIS_PASSWORD);
assert.equal(sandbox.environment.ES_AUTH_TOKEN, judge.environment.GO_JUDGE_TOKEN);
assert.equal(new URL(back.environment.DATABASE_URL).password, required.POSTGRES_PASSWORD);
assert.equal(judge.environment.API_BASE_URL, 'http://back:3000/api/v1');
assert.equal(judge.environment.GO_JUDGE_URL, 'http://go-judge:5050');
assert.ok(sandbox.command.includes('-parallelism=2'));
assert.equal(judge.depends_on['go-judge'].condition, 'service_healthy');
assert.equal(judge.stop_grace_period, '2m0s');

// Changing worker parallelism also changes the sandbox's execution capacity.
const resized = config({ JUDGE_CONCURRENCY: '1' });
assert.equal(resized.services.judge.environment.JUDGE_CONCURRENCY, '1');
assert.ok(resized.services['go-judge'].command.includes('-parallelism=1'));
console.log('Production Compose: required settings, private networking, persistence, resource budgets and worker wiring passed.');
