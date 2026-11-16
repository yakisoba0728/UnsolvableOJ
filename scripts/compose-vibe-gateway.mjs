// Disposable CI fixture only. Reuses the existing Front image and native sandbox.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export const fixtureServername = 'vibe-executor.internal';
const ownedProject = /^unsolvable-e2e-[a-f0-9]{12}$/;

export function assertFixtureDirectory(project, directory) {
  assert.match(project, ownedProject, 'Disposable Compose project required');
  assert.ok(basename(resolve(directory)).startsWith(`${project}-`), 'Directory must belong to this disposable project');
}

export async function prepareVibeGateway({ project, directory, root, productionMode }) {
  assertFixtureDirectory(project, directory);
  const file = name => join(directory, name);
  const openssl = (...args) => execFileSync('openssl', args, {
    cwd: directory, encoding: 'utf8', stdio: 'pipe', timeout: 10_000, maxBuffer: 64 * 1024,
  });
  await chmod(directory, 0o700);
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Phase V disposable Vibe CA',
    '-keyout', 'ca.key', '-out', 'ca.crt', '-addext', 'basicConstraints=critical,CA:TRUE');
  for (const [name, commonName, extensions] of [
    ['server', fixtureServername, `subjectAltName=DNS:${fixtureServername}\nextendedKeyUsage=serverAuth\n`],
    ['client', 'phase5-disposable-api', 'extendedKeyUsage=clientAuth\n'],
  ]) {
    await writeFile(file(`${name}.ext`), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n${extensions}`, { mode: 0o600 });
    openssl('req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${commonName}`, '-keyout', `${name}.key`, '-out', `${name}.csr`);
    openssl('x509', '-req', '-days', '1', '-in', `${name}.csr`, '-CA', 'ca.crt', '-CAkey', 'ca.key',
      '-CAcreateserial', '-extfile', `${name}.ext`, '-out', `${name}.crt`);
  }
  // The parent temporary directory is 0700. Individual mounted test files are
  // readable by Back's non-root UID and nginx's master, then removed on cleanup.
  // No CA key or opposite service's identity is mounted into any container.
  for (const name of ['ca.crt', 'server.crt', 'server.key', 'client.crt', 'client.key']) await chmod(file(name), 0o444);
  const configuration = await readFile(join(root, 'Judge/deploy/vibe/gateway.conf.example'), 'utf8');
  assert.ok(configuration.includes(`server_name ${fixtureServername};`));
  assert.ok(configuration.includes('proxy_pass http://vibe-sandbox:5050;'));
  assert.ok(configuration.includes('ssl_verify_client on;'));
  assert.ok(configuration.includes('proxy_set_header Authorization $http_authorization;'));
  // Use the production example byte-for-byte. Access logs remain disabled.
  await writeFile(file('gateway.conf'), configuration, { mode: 0o444 });
  const mount = (name, target) => ({ type: 'bind', source: file(name), target, read_only: true });
  const applicationNetwork = productionMode ? 'app' : 'default';
  return {
    backNetworks: productionMode ? ['app', 'data'] : ['default'],
    backVolumes: [mount('ca.crt', '/run/secrets/vibe_ca'), mount('client.crt', '/run/secrets/vibe_client_cert'), mount('client.key', '/run/secrets/vibe_client_key')],
    gateway: {
      image: `${project}-front`, pull_policy: 'never', entrypoint: ['nginx', '-g', 'daemon off;'],
      read_only: true, security_opt: ['no-new-privileges:true'], cap_drop: ['ALL'], cap_add: ['CHOWN', 'SETGID', 'SETUID'],
      mem_limit: '128m', cpus: 0.25, pids_limit: 32,
      tmpfs: ['/tmp:rw,noexec,nosuid,nodev,size=8m', '/var/cache/nginx:rw,noexec,nosuid,nodev,size=8m', '/var/run:rw,noexec,nosuid,nodev,size=1m'],
      volumes: [mount('gateway.conf', '/etc/nginx/conf.d/default.conf'), mount('server.crt', '/run/secrets/vibe_gateway_cert'),
        mount('server.key', '/run/secrets/vibe_gateway_key'), mount('ca.crt', '/run/secrets/vibe_api_client_ca')],
      networks: { [applicationNetwork]: { aliases: [fixtureServername] }, sandbox: {} },
      depends_on: { 'go-judge': { condition: 'service_healthy' } },
      healthcheck: { test: ['CMD', 'nginx', '-t'], interval: '5s', timeout: '3s', retries: 5 },
      logging: { driver: 'json-file', options: { 'max-size': '1m', 'max-file': '2' } },
    },
    receipt: {
      mode: 'dedicated', servername: fixtureServername, templateSha256: createHash('sha256').update(configuration).digest('hex'),
      serverCertificateFingerprint: new X509Certificate(await readFile(file('server.crt'))).fingerprint256,
      clientCertificateFingerprint: new X509Certificate(await readFile(file('client.crt'))).fingerprint256,
      certificateLifetimeDays: 1, serverAndClientCertificateRequired: true,
      applicationSandboxNetwork: false, newPrivilegedExecutors: 0, providerConfigured: false,
      testOnlySharedNativeExecutor: true,
    },
  };
}

export function checkVibeGatewayPlan(plan, project) {
  assert.match(project, ownedProject);
  const { back, front, 'go-judge': sandbox, 'vibe-gateway': gateway } = plan.services;
  assert.ok(back && front && sandbox && gateway, 'Fixture services missing');
  assert.equal(back.environment.VIBE_EXECUTION_MODE, 'dedicated');
  assert.equal(back.environment.VIBE_SANDBOX_URL, `https://${fixtureServername}:8443`);
  assert.equal(back.environment.VIBE_SANDBOX_TLS_SERVERNAME, fixtureServername);
  assert.ok(back.environment.OPENAI_API_KEY === '', 'Paid provider must remain unavailable');
  assert.ok(back.environment.GO_JUDGE_TOKEN !== back.environment.VIBE_SANDBOX_TOKEN, 'API algorithm identity must remain distinct');
  assert.ok(back.environment.VIBE_SANDBOX_TOKEN === sandbox.environment.ES_AUTH_TOKEN, 'Owned sandbox bearer must match');
  assert.equal(Object.hasOwn(back.networks, 'sandbox'), false);
  assert.deepEqual(Object.keys(sandbox.networks), ['sandbox']);
  assert.equal(plan.networks.sandbox.internal, true);
  assert.equal(gateway.image, front.image);
  assert.equal(front.image, `${project}-front`);
  assert.equal(gateway.privileged ?? false, false);
  assert.equal(gateway.ports?.length ?? 0, 0);
  assert.equal(gateway.read_only, true);
  assert.ok(gateway.cap_drop.includes('ALL'));
  assert.ok(gateway.security_opt.includes('no-new-privileges:true'));
  assert.equal(Object.values(plan.services).filter(service => service.privileged).length, 1);
  assert.deepEqual(Object.keys(gateway.networks).sort(), Object.hasOwn(back.networks, 'app') ? ['app', 'sandbox'] : ['default', 'sandbox']);
  const expected = [
    [back, { 'ca.crt': '/run/secrets/vibe_ca', 'client.crt': '/run/secrets/vibe_client_cert', 'client.key': '/run/secrets/vibe_client_key' }],
    [gateway, { 'gateway.conf': '/etc/nginx/conf.d/default.conf', 'server.crt': '/run/secrets/vibe_gateway_cert',
      'server.key': '/run/secrets/vibe_gateway_key', 'ca.crt': '/run/secrets/vibe_api_client_ca' }],
  ];
  for (const [service, files] of expected) {
    assert.deepEqual(service.volumes.map(volume => volume.target).sort(), Object.values(files).sort());
    for (const volume of service.volumes) {
      assertFixtureDirectory(project, dirname(volume.source));
      assert.equal(files[basename(volume.source)], volume.target, 'Identity mount must retain its intended source and target');
    }
  }
  for (const service of [back, gateway]) {
    assert.ok(service.volumes.every(volume => volume.type === 'bind' && volume.read_only), 'Only read-only fixture identity/config mounts allowed');
    assert.ok(service.volumes.every(volume => !volume.source.endsWith('/ca.key')), 'CA private key must not be mounted');
  }
  assert.equal(sandbox.volumes?.length ?? 0, 0);
  assert.equal(sandbox.secrets?.length ?? 0, 0);
}

// Executed only inside the owned Back container. No key/token/body is printed.
export const gatewayProbeSource = `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
const env = process.env;
assert.ok(env.OPENAI_API_KEY === '', 'Paid provider must remain unavailable');
const identity = {ca: readFileSync(env.VIBE_SANDBOX_TLS_CA_FILE), cert: readFileSync(env.VIBE_SANDBOX_TLS_CERT_FILE),
  key: readFileSync(env.VIBE_SANDBOX_TLS_KEY_FILE), servername: env.VIBE_SANDBOX_TLS_SERVERNAME, rejectUnauthorized: true};
const probe = (path, settings = {}, bearer = env.VIBE_SANDBOX_TOKEN) => new Promise(resolve => {
  const started = performance.now();
  const call = request(new URL(path, env.VIBE_SANDBOX_URL), {...identity, ...settings,
    signal: AbortSignal.timeout(4000), headers: bearer ? {Authorization: 'Bearer '+bearer} : {}}, response => {
    response.resume(); response.on('end', () => resolve({status: response.statusCode, elapsedMs: performance.now() - started}));
  });
  call.on('error', error => resolve({errorCode: error.code ?? 'UNKNOWN', elapsedMs: performance.now() - started})); call.end();
});
const positive = await probe('/version'); assert.equal(positive.status, 200);
const noClient = await probe('/version', {cert: undefined, key: undefined});
assert.ok([400, 495, 496].includes(noClient.status) || ['ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED', 'ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE'].includes(noClient.errorCode));
const wrongBearer = await probe('/file', {}, 'different-owned-test-token-0123456789'); assert.ok([401, 403].includes(wrongBearer.status));
const anonymous = await probe('/file', {}, ''); assert.ok([401, 403].includes(anonymous.status));
const wrongHostname = await probe('/version', {servername: 'wrong-owned-name.invalid'}); assert.equal(wrongHostname.errorCode, 'ERR_TLS_CERT_ALTNAME_INVALID');
const disallowed = await probe('/not-a-vibe-operation'); assert.equal(disallowed.status, 404);
const query = await probe('/version?unexpected=1'); assert.equal(query.status, 400);
console.log(JSON.stringify({positive, noClient, wrongBearer, anonymous, wrongHostname, disallowed, query, requests: 7, perRequestTimeoutMs: 4000}));
`;
