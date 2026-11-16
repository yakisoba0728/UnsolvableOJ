import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertFixtureDirectory, checkVibeGatewayPlan, fixtureServername, prepareVibeGateway } from './compose-vibe-gateway.mjs';

const project = 'unsolvable-e2e-012345abcdef';
const directory = join(tmpdir(), `${project}-owned`);
const root = fileURLToPath(new URL('../', import.meta.url));
const mount = (name, target) => ({ type: 'bind', source: join(directory, name), target, read_only: true });
function plan() {
  return {
    networks: { app: {}, data: {}, sandbox: { internal: true } },
    services: {
      back: { networks: { app: {}, data: {} }, environment: {
        VIBE_EXECUTION_MODE: 'dedicated', VIBE_SANDBOX_URL: `https://${fixtureServername}:8443`,
        VIBE_SANDBOX_TLS_SERVERNAME: fixtureServername, OPENAI_API_KEY: '', GO_JUDGE_TOKEN: 'unused-different-owned-token',
        VIBE_SANDBOX_TOKEN: 'owned-sandbox-token',
      }, volumes: [mount('ca.crt', '/run/secrets/vibe_ca'), mount('client.crt', '/run/secrets/vibe_client_cert'), mount('client.key', '/run/secrets/vibe_client_key')] },
      front: { image: `${project}-front` },
      'go-judge': { privileged: true, networks: { sandbox: {} }, environment: { ES_AUTH_TOKEN: 'owned-sandbox-token' } },
      'vibe-gateway': { image: `${project}-front`, read_only: true, networks: { app: {}, sandbox: {} },
        cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], volumes: [
          mount('gateway.conf', '/etc/nginx/conf.d/default.conf'), mount('server.crt', '/run/secrets/vibe_gateway_cert'),
          mount('server.key', '/run/secrets/vibe_gateway_key'), mount('ca.crt', '/run/secrets/vibe_api_client_ca'),
        ] },
    },
  };
}

test('owned fixture topology accepts existing isolated executor and distinct API algorithm identity', () => {
  checkVibeGatewayPlan(plan(), project);
});

test('unrelated projects and temporary directories are refused before certificate generation', () => {
  assert.throws(() => assertFixtureDirectory('production', directory));
  assert.throws(() => assertFixtureDirectory(project, tmpdir()));
  assert.throws(() => assertFixtureDirectory(project, join(tmpdir(), 'another-project-owned')));
});

for (const [name, mutate] of [
  ['direct API sandbox access', p => p.services.back.networks.sandbox = {}],
  ['sandbox outbound access', p => p.networks.sandbox.internal = false],
  ['sandbox application access', p => p.services['go-judge'].networks.app = {}],
  ['additional privileged executor', p => p.services.extra = { privileged: true }],
  ['published gateway port', p => p.services['vibe-gateway'].ports = [{ target: 8443, published: '8443' }]],
  ['gateway privilege', p => p.services['vibe-gateway'].privileged = true],
  ['gateway data network', p => p.services['vibe-gateway'].networks.data = {}],
  ['unreviewed image', p => p.services['vibe-gateway'].image = 'unrelated-image'],
  ['writable gateway filesystem', p => p.services['vibe-gateway'].read_only = false],
  ['paid provider inherited', p => p.services.back.environment.OPENAI_API_KEY = 'unexpected-provider-key'],
  ['plain HTTP executor', p => p.services.back.environment.VIBE_SANDBOX_URL = 'http://go-judge:5050'],
  ['wrong TLS hostname', p => p.services.back.environment.VIBE_SANDBOX_TLS_SERVERNAME = 'wrong.invalid'],
  ['API algorithm credential reuse', p => p.services.back.environment.GO_JUDGE_TOKEN = p.services.back.environment.VIBE_SANDBOX_TOKEN],
  ['wrong upstream bearer', p => p.services['go-judge'].environment.ES_AUTH_TOKEN = 'other-token'],
  ['CA private key mount', p => p.services.back.volumes[0].source = join(directory, 'ca.key')],
  ['another service private key', p => p.services.back.volumes[2].source = join(directory, 'server.key')],
  ['unowned key path', p => p.services.back.volumes[2].source = '/unrelated/client.key'],
  ['writable identity', p => p.services.back.volumes[2].read_only = false],
  ['runtime identity mount', p => p.services['go-judge'].volumes = [mount('client.key', '/key')]],
]) {
  test(`fixture preflight rejects ${name}`, () => {
    const candidate = plan(); mutate(candidate); assert.throws(() => checkVibeGatewayPlan(candidate, project));
  });
}

test('ephemeral certificates validate hostname, CA signatures and matching keys; gateway template is unchanged', async t => {
  const temporary = await mkdtemp(join(tmpdir(), `${project}-`));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const fixture = await prepareVibeGateway({ project, directory: temporary, root, productionMode: true });
  const ca = new X509Certificate(await readFile(join(temporary, 'ca.crt')));
  const server = new X509Certificate(await readFile(join(temporary, 'server.crt')));
  const client = new X509Certificate(await readFile(join(temporary, 'client.crt')));
  assert.equal(ca.ca, true);
  for (const [name, certificate] of [['server', server], ['client', client]]) {
    assert.equal(certificate.verify(ca.publicKey), true);
    assert.equal(certificate.checkPrivateKey(createPrivateKey(await readFile(join(temporary, `${name}.key`)))), true);
    assert.ok(Date.parse(certificate.validTo) - Date.parse(certificate.validFrom) <= 86_400_000);
  }
  assert.equal(server.checkHost(fixtureServername), fixtureServername);
  assert.equal(server.checkHost('wrong.invalid'), undefined);
  assert.equal((await stat(temporary)).mode & 0o777, 0o700);
  assert.equal(await readFile(join(temporary, 'gateway.conf'), 'utf8'), await readFile(join(root, 'Judge/deploy/vibe/gateway.conf.example'), 'utf8'));
  assert.deepEqual(fixture.backNetworks, ['app', 'data']);
  assert.equal(fixture.gateway.image, `${project}-front`);
  assert.equal(fixture.gateway.ports, undefined);
  assert.equal(fixture.receipt.newPrivilegedExecutors, 0);
});
