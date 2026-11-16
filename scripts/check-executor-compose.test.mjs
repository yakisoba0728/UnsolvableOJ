import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkExecutorCompose } from './check-executor-compose.mjs';

function fixture() {
  const common = { restart: 'unless-stopped', cpus: 1, mem_limit: 512 * 1024 ** 2,
    logging: { driver: 'json-file', options: { 'max-file': '3', 'max-size': '10m' } } };
  return {
    networks: { application: {}, sandbox: { internal: true } },
    services: {
      'go-judge': { ...structuredClone(common), privileged: true, cgroup: 'private',
        mem_limit: 10 * 1024 ** 3, memswap_limit: 10 * 1024 ** 3, networks: { sandbox: {} },
        command: ['-no-fallback', '-enable-cpu-rate', '-parallelism=2'],
        environment: { ES_AUTH_TOKEN: 'synthetic-sandbox-token-'.repeat(3) } },
      judge: { ...structuredClone(common), user: '1000:1000', init: true, pids_limit: 128, cap_drop: ['ALL'],
        security_opt: ['no-new-privileges:true'], read_only: true,
        tmpfs: ['/tmp:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000,mode=0700'],
        networks: { application: {}, sandbox: {} }, depends_on: { 'go-judge': { condition: 'service_healthy' } },
        environment: { JUDGE_DEPLOYMENT_MODE: 'dedicated', API_BASE_URL: 'https://api.example.test/api/v1',
          REDIS_TLS: 'true', REDIS_PASSWORD: 'synthetic-redis-token-'.repeat(3),
          GO_JUDGE_URL: 'http://go-judge:5050', GO_JUDGE_TOKEN: 'synthetic-sandbox-token-'.repeat(3),
          JUDGE_SERVICE_TOKEN: 'synthetic-api-token-'.repeat(3), JUDGE_CONCURRENCY: '2' } },
    },
  };
}

test('dedicated plan accepts isolated topology and optional named TLS identity files', () => {
  const plan = fixture();
  checkExecutorCompose(plan);
  plan.services.judge.secrets = ['ca', 'cert', 'key'].map(suffix => ({ source: `redis_tls_${suffix}`, target: `redis_tls_${suffix}` }));
  for (const suffix of ['ca', 'cert', 'key']) plan.services.judge.environment[`REDIS_TLS_${suffix.toUpperCase()}_FILE`] = `/run/secrets/redis_tls_${suffix}`;
  checkExecutorCompose(plan);
  for (const secret of plan.services.judge.secrets) secret.target = `/run/secrets/${secret.source}`;
  checkExecutorCompose(plan);
});

for (const target of ['/etc/redis_tls_key', '/run/secrets/../redis_tls_key', '/run/secrets/renamed', 'redis_tls_cert']) {
  test(`preflight rejects a renamed or relocated TLS key target ${target}`, () => {
    const plan = fixture();
    plan.services.judge.secrets = [{ source: 'redis_tls_key', target }];
    plan.services.judge.environment.REDIS_TLS_KEY_FILE = '/run/secrets/redis_tls_key';
    assert.throws(() => checkExecutorCompose(plan), /targets must retain/);
  });
}

for (const source of ['constructor', 'toString', '__proto__', ['redis_tls_key']]) {
  test(`preflight rejects inherited or coerced secret source ${JSON.stringify(source)}`, () => {
    const plan = fixture();
    const settings = { redis_tls_key: 'REDIS_TLS_KEY_FILE' };
    plan.services.judge.secrets = [{ source, target: `/run/secrets/${source}` }];
    // Supply the value an inherited-property lookup would otherwise accept.
    plan.services.judge.environment[String(settings[source])] = `/run/secrets/${source}`;
    assert.throws(() => checkExecutorCompose(plan), /only its named Redis TLS/);
  });
}

test('rendered Compose decimal byte strings retain the same finite memory and swap checks', () => {
  const plan = fixture();
  for (const service of Object.values(plan.services)) service.mem_limit = String(service.mem_limit);
  plan.services['go-judge'].memswap_limit = String(plan.services['go-judge'].memswap_limit);
  checkExecutorCompose(plan);
  plan.services['go-judge'].mem_limit = String(1024 ** 3);
  assert.throws(() => checkExecutorCompose(plan), /headroom/);
});

for (const value of ['', '0', '-1', '512m', '1.5', 'Infinity', '9007199254740992', true, 1.5, 0, -1, Infinity]) {
  test(`preflight rejects noncanonical or unbounded memory ${JSON.stringify(value)}`, () => {
    const plan = fixture();
    plan.services.judge.mem_limit = value;
    assert.throws(() => checkExecutorCompose(plan), /Finite memory/);
  });
}

for (const [name, mutate] of [
  ['plaintext Redis', p => p.services.judge.environment.REDIS_TLS = 'false'],
  ['plaintext API', p => p.services.judge.environment.API_BASE_URL = 'http://api.example.test/api/v1'],
  ['URL credentials', p => p.services.judge.environment.API_BASE_URL = 'https://a:secret@api.example.test/api/v1'],
  ['reused token', p => p.services.judge.environment.REDIS_PASSWORD = p.services.judge.environment.GO_JUDGE_TOKEN],
  ['token mismatch', p => p.services['go-judge'].environment.ES_AUTH_TOKEN = 'wrong-token'],
  ['host port', p => p.services['go-judge'].ports = [{ target: 5050, published: '5050' }]],
  ['host filesystem', p => p.services.judge.volumes = [{ type: 'bind', source: '/', target: '/host' }]],
  ['host PID namespace', p => p.services['go-judge'].pid = 'host'],
  ['external sandbox network', p => p.networks.sandbox.external = true],
  ['outbound sandbox network', p => p.networks.sandbox.internal = false],
  ['application access for sandbox', p => p.services['go-judge'].networks.application = {}],
  ['unrestricted worker capabilities', p => p.services.judge.cap_add = ['SYS_ADMIN']],
  ['root worker override', p => p.services.judge.user = 'root'],
  ['queue credentials in sandbox environment', p => p.services['go-judge'].environment.REDIS_PASSWORD = 'misplaced-secret'],
  ['writable worker root', p => p.services.judge.read_only = false],
  ['unbounded tmpfs', p => p.services.judge.tmpfs = ['/tmp']],
  ['disabled seccomp', p => p.services['go-judge'].command.push('-no-seccomp')],
  ['shared execution network', p => p.services['go-judge'].command.push('-net-share=true')],
  ['insufficient memory', p => p.services['go-judge'].mem_limit = 1024 ** 3],
  ['enabled swap', p => p.services['go-judge'].memswap_limit *= 2],
  ['unmounted TLS key', p => p.services.judge.environment.REDIS_TLS_KEY_FILE = '/some/key'],
  ['unrelated secret', p => p.services.judge.secrets = [{ source: 'database_password' }]],
  ['application keys in sandbox', p => p.services['go-judge'].secrets = [{ source: 'redis_tls_key' }]],
]) {
  test(`preflight rejects ${name}`, () => { const plan = fixture(); mutate(plan); assert.throws(() => checkExecutorCompose(plan)); });
}

test('CLI does not echo token values or invalid input fragments', () => {
  const script = new URL('./check-executor-compose.mjs', import.meta.url).pathname;
  const plan = fixture();
  plan.services['go-judge'].environment.ES_AUTH_TOKEN = 'do-not-log-this-secret';
  for (const input of [JSON.stringify(plan), '{"do-not-log-this-secret":broken', JSON.stringify({ ...plan, services: { ...plan.services,
    judge: { ...plan.services.judge, environment: { ...plan.services.judge.environment, API_BASE_URL: 'do-not-log-this-secret' } } } })]) {
    const run = spawnSync(process.execPath, [script], { input, encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.doesNotMatch(run.stderr + run.stdout, /do-not-log-this-secret/);
  }
});
