// Read rendered Compose JSON only. Never contacts hosts or prints credentials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSandboxBudget } from './check-sandbox-budget.mjs';

export function checkExecutorCompose(plan) {
  assert.deepEqual(Object.keys(plan.services).sort(), ['go-judge', 'judge'], 'Executor must contain only worker and sandbox services');
  const sandbox = plan.services['go-judge'];
  const worker = plan.services.judge;
  assert.deepEqual(Object.keys(plan.networks).sort(), ['application', 'sandbox'], 'Executor requires separate application and sandbox networks');
  assert.equal(plan.networks.sandbox.internal, true, 'Sandbox network must be internal');
  assert.ok(!plan.networks.sandbox.external, 'Sandbox network must not be external');
  for (const network of Object.values(plan.networks)) {
    assert.ok(!network.driver || network.driver === 'bridge', 'Executor networks must use isolated bridge networking');
  }
  assert.deepEqual(Object.keys(sandbox.networks), ['sandbox'], 'Only the worker may reach the application network');
  assert.deepEqual(Object.keys(worker.networks).sort(), ['application', 'sandbox']);
  for (const [name, service] of Object.entries(plan.services)) {
    assert.equal(service.ports?.length ?? 0, 0, 'Executor services must not publish host ports');
    assert.equal(service.volumes?.length ?? 0, 0, 'Executor services must not mount host data or volumes');
    assert.equal(service.devices?.length ?? 0, 0, 'Executor must not add host devices');
    assert.ok(!service.network_mode && !service.pid && !service.userns_mode && service.ipc !== 'host', 'Host namespaces are prohibited');
    assert.equal(service.privileged ?? false, name === 'go-judge', 'Only go-judge requires privileged mode');
    assert.ok(service.cpus > 0 && Number.isFinite(service.cpus), 'Finite CPU ceilings are required');
    assert.ok(service.mem_limit > 0 && Number.isSafeInteger(service.mem_limit), 'Finite memory ceilings are required');
    assert.equal(service.restart, 'unless-stopped');
    assert.equal(service.logging?.driver, 'json-file');
    assert.equal(service.logging?.options?.['max-file'], '3');
    assert.equal(service.logging?.options?.['max-size'], '10m');
  }
  assert.equal(sandbox.cgroup, 'private');
  for (const flag of ['-no-fallback', '-enable-cpu-rate']) assert.ok(sandbox.command.includes(flag), 'Sandbox must preserve mandatory isolation flags');
  assert.ok(!sandbox.command.some(value => /^-(no-seccomp|net-share)(=|$)/.test(value)), 'Sandbox must not disable seccomp or share networking');
  assert.deepEqual(worker.cap_drop, ['ALL']);
  assert.equal(worker.user, '1000:1000', 'Worker must run as the unprivileged image UID/GID');
  assert.equal(worker.cap_add?.length ?? 0, 0, 'Worker must not regain capabilities');
  assert.deepEqual(worker.security_opt, ['no-new-privileges:true']);
  assert.ok(worker.pids_limit > 0 && Number.isSafeInteger(worker.pids_limit), 'Worker needs a process ceiling');
  assert.equal(worker.init, true);
  assert.equal(worker.read_only, true, 'Worker root filesystem must be read-only');
  assert.deepEqual(worker.tmpfs, ['/tmp:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000,mode=0700']);
  assert.equal(worker.depends_on['go-judge']?.condition, 'service_healthy');
  const env = worker.environment;
  assert.equal(env.JUDGE_DEPLOYMENT_MODE, 'dedicated');
  assert.equal(env.REDIS_TLS, 'true', 'Remote Redis requires verified TLS');
  const api = new URL(env.API_BASE_URL);
  assert.ok(api.protocol === 'https:' && !api.username && !api.password && !api.search && !api.hash, 'Dedicated API requires a credential-free HTTPS URL');
  assert.equal(env.GO_JUDGE_URL, 'http://go-judge:5050');
  for (const name of ['JUDGE_SERVICE_TOKEN', 'GO_JUDGE_TOKEN', 'REDIS_PASSWORD']) {
    assert.ok(typeof env[name] === 'string' && env[name].length >= 32 && !/\s/.test(env[name]), 'Dedicated credentials need at least 32 non-whitespace characters');
  }
  assert.ok(new Set([env.JUDGE_SERVICE_TOKEN, env.GO_JUDGE_TOKEN, env.REDIS_PASSWORD]).size === 3, 'API, sandbox and Redis credentials must be distinct');
  assert.ok(sandbox.environment.ES_AUTH_TOKEN === env.GO_JUDGE_TOKEN, 'Sandbox and worker authentication must agree');
  assert.deepEqual(Object.keys(sandbox.environment), ['ES_AUTH_TOKEN'], 'Sandbox must not receive application or queue credentials');
  assert.equal(sandbox.secrets?.length ?? 0, 0, 'Sandbox must not receive Redis TLS identity files');
  assert.equal(sandbox.configs?.length ?? 0, 0, 'Sandbox must not receive application configuration files');
  assert.equal(worker.configs?.length ?? 0, 0, 'Use only the named Redis TLS secrets');
  const secretSettings = { redis_tls_ca: 'REDIS_TLS_CA_FILE', redis_tls_cert: 'REDIS_TLS_CERT_FILE', redis_tls_key: 'REDIS_TLS_KEY_FILE' };
  for (const secret of worker.secrets ?? []) {
    assert.ok(secretSettings[secret.source], 'Worker may mount only its named Redis TLS identity files');
    const target = secret.target ?? secret.source;
    assert.ok(target === secret.source, 'Redis TLS secret targets must retain their names');
    assert.ok(env[secretSettings[secret.source]] === `/run/secrets/${target}`, 'TLS file settings must match their read-only secret mounts');
  }
  for (const [source, setting] of Object.entries(secretSettings)) {
    if (env[setting]) assert.ok(worker.secrets?.some(secret => secret.source === source), 'Configured TLS files must be mounted as named secrets');
  }
  checkSandboxBudget(plan);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkExecutorCompose(JSON.parse(readFileSync(0, 'utf8')));
    console.log('Executor configuration passed. Dedicated-host, firewall and kernel validation remain required.');
  } catch (error) {
    // JSON/URL parse errors can quote source fragments containing credentials.
    console.error(`Executor configuration rejected: ${error instanceof assert.AssertionError ? error.message : 'invalid configuration input'}`);
    process.exitCode = 1;
  }
}
