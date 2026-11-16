// Owned, finite localhost TLS rehearsal. No external address, paid provider,
// Docker socket or production credential is accepted by this probe.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { ConfigService } from '@nestjs/config';
import { createVibeTransport, loadVibeTransportSettings, VIBE_TRANSPORT_BYTES } from '../dist/modules/vibe/vibe.transport.js';
import { VibeRunner } from '../dist/modules/vibe/vibe.runner.js';
import { currentVibeSnapshot, snapshotEditableFiles } from '../dist/modules/vibe/vibe.snapshot.js';

const exec = promisify(execFile);
test('dedicated Vibe verifies mTLS, authenticated direct routing, bounded replies and cleanup', { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'oj-vibe-tls-'));
  const path = (name) => join(directory, name);
  const servers = [];
  const transports = [];
  const sockets = new Set();
  const command = (args) => exec('openssl', args, { timeout: 10_000, maxBuffer: 64_000 });
  const secret = randomBytes(32).toString('hex');
  let origin;
  let behavior = 'ok';
  let attempts = 0;
  let redirected = 0;
  const deleted = [];
  async function listen(server) {
    servers.push(server);
    server.on('tlsClientError', () => {});
    server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return server.address().port;
  }
  try {
    await command(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
      '-subj', '/CN=VibeFixtureCA', '-addext', 'basicConstraints=critical,CA:TRUE',
      '-keyout', path('ca.key'), '-out', path('ca.pem')]);
    for (const kind of ['server', 'client']) {
      await command(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
        '-subj', `/CN=${kind === 'server' ? 'vibe.fixture.test' : 'api-fixture'}`,
        '-keyout', path(`${kind}.key`), '-out', path(`${kind}.csr`)]);
      await writeFile(path(`${kind}.ext`), [
        'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment',
        `extendedKeyUsage=${kind === 'server' ? 'serverAuth' : 'clientAuth'}`,
        ...(kind === 'server' ? ['subjectAltName=DNS:vibe.fixture.test,DNS:localhost'] : []),
      ].join('\n') + '\n', { mode: 0o600 });
      await command(['x509', '-req', '-in', path(`${kind}.csr`), '-CA', path('ca.pem'), '-CAkey', path('ca.key'),
        '-CAcreateserial', '-days', '1', '-sha256', '-extfile', path(`${kind}.ext`), '-out', path(`${kind}.pem`)]);
    }
    await command(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
      '-subj', '/CN=UntrustedFixture', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'extendedKeyUsage=clientAuth',
      '-keyout', path('wrong.key'), '-out', path('wrong.pem')]);
    const tls = { key: await readFile(path('server.key')), cert: await readFile(path('server.pem')),
      ca: await readFile(path('ca.pem')), requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2' };
    const sinkPort = await listen(createServer(tls, (_request, response) => { redirected++; response.end('{}'); }));
    const server = createServer(tls, async (request, response) => {
      attempts++;
      assert.equal(request.socket.authorized, true);
      if (request.headers.authorization !== `Bearer ${secret}`) {
        response.writeHead(401); response.end('fixture denial'); return;
      }
      const json = (value) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
      if (request.method === 'DELETE') {
        deleted.push(request.url);
        if (behavior === 'cleanup-stall') return;
        response.writeHead(204); response.end(); return;
      }
      if (request.url === '/version') {
        if (behavior === 'redirect') { response.writeHead(302, { location: `https://127.0.0.1:${sinkPort}/run` }); response.end(); return; }
        if (behavior === 'length') { response.writeHead(200, { 'Content-Length': VIBE_TRANSPORT_BYTES + 1 }); response.end('x'); return; }
        if (behavior === 'stream') { for (let index = 0; index < 17; index++) response.write(Buffer.alloc(65_536)); response.end(); return; }
        if (behavior === 'stall') return;
        json({ os: 'linux' }); return;
      }
      if (request.url === '/config') {
        json({ runnerConfig: { seccomp: true, cgroupType: 2, workDir: '/w', cgroupControllers: ['cpu', 'memory', 'pids'] } }); return;
      }
      if (request.url === '/file') { json([]); return; }
      if (request.url === '/run') {
        let text = '';
        for await (const chunk of request) text += chunk;
        const payload = JSON.parse(text);
        const compile = payload.cmd[0].copyOutCached.length > 0;
        if (!compile && ['run-failure', 'cleanup-stall'].includes(behavior)) {
          response.writeHead(503); response.end('fixture-private-address and fixture-private-token'); return;
        }
        json([{ status: 'Accepted', exitStatus: 0, files: { stdout: '["ok"]', stderr: '' },
          fileIds: compile ? { 'main.cjs': 'fixture-main', 'checks.cjs': 'fixture-checks' } : {} }]); return;
      }
      response.writeHead(404); response.end();
    });
    const port = await listen(server);
    origin = `https://127.0.0.1:${port}`;
    const env = { VIBE_EXECUTION_MODE: 'dedicated', VIBE_SANDBOX_URL: origin, VIBE_SANDBOX_TOKEN: secret,
      VIBE_SANDBOX_TLS_SERVERNAME: 'vibe.fixture.test', VIBE_SANDBOX_TLS_CA_FILE: path('ca.pem'),
      VIBE_SANDBOX_TLS_CERT_FILE: path('client.pem'), VIBE_SANDBOX_TLS_KEY_FILE: path('client.key') };
    await t.test('invalid PEM, unreadable key and mismatched client key fail provider construction', async () => {
      await writeFile(path('invalid.pem'), 'not a certificate', { mode: 0o600 });
      for (const override of [
        { VIBE_SANDBOX_TLS_CA_FILE: path('invalid.pem') },
        { VIBE_SANDBOX_TLS_KEY_FILE: path('absent-private.key') },
        { VIBE_SANDBOX_TLS_KEY_FILE: path('server.key') },
      ]) {
        assert.throws(() => new VibeRunner(new ConfigService({ ...env, ...override })), (error) => {
          assert.match(error.message, /Vibe TLS|VIBE_SANDBOX_TLS/);
          assert.ok(!error.message.includes(directory));
          return true;
        });
      }
    });
    const make = (overrides = {}) => {
      const value = createVibeTransport(loadVibeTransportSettings({ ...env, ...overrides }));
      transports.push(value); return value;
    };
    const transport = make();
    const get = (client = transport, options = {}) => client.request('/version', { signal: AbortSignal.timeout(1500), ...options });

    await t.test('trusted server identity and client certificate succeed', async () => {
      assert.deepEqual(await (await get()).json(), { os: 'linux' });
    });
    for (const [name, override] of [
      ['wrong CA', { VIBE_SANDBOX_TLS_CA_FILE: path('wrong.pem') }],
      ['wrong hostname', { VIBE_SANDBOX_TLS_SERVERNAME: 'wrong.fixture.test' }],
      ['untrusted client certificate', { VIBE_SANDBOX_TLS_CERT_FILE: path('wrong.pem'), VIBE_SANDBOX_TLS_KEY_FILE: path('wrong.key') }],
    ]) await t.test(`${name} refuses the connection before application requests`, async () => {
      const before = attempts;
      await assert.rejects(get(make(override)), /^Error: Vibe sandbox transport failed$/);
      assert.equal(attempts, before);
    });
    await t.test('gateway refuses an actual TLS client without a client certificate', async () => {
      const before = attempts;
      await assert.rejects(new Promise((resolve, reject) => {
        const request = httpsRequest(origin, { ca: tls.ca, servername: 'vibe.fixture.test', rejectUnauthorized: true,
          agent: false, signal: AbortSignal.timeout(1500) }, (response) => { response.resume(); resolve(response.statusCode); });
        request.on('error', reject); request.end();
      }));
      assert.equal(attempts, before);
    });
    await t.test('valid mTLS alone does not replace bearer authentication', async () => {
      assert.equal((await get(transport, { anonymous: true })).status, 401);
      assert.equal((await get(make({ VIBE_SANDBOX_TOKEN: randomBytes(32).toString('hex') }))).status, 401);
    });
    await t.test('redirects fail without sending a token or request to the target', async () => {
      behavior = 'redirect';
      await assert.rejects(get(), /transport failed/);
      assert.equal(redirected, 0);
      behavior = 'ok';
    });
    for (const value of ['length', 'stream']) await t.test(`oversized ${value} responses fail closed`, async () => {
      behavior = value;
      await assert.rejects(get(), /transport failed/);
      behavior = 'ok';
    });
    await t.test('oversized request payloads are refused before transmission', async () => {
      const before = attempts;
      await assert.rejects(transport.request('/run', { method: 'POST', body: 'x'.repeat(VIBE_TRANSPORT_BYTES + 1), signal: AbortSignal.timeout(1000) }), /transport failed/);
      assert.equal(attempts, before);
    });
    await t.test('a stalled response is aborted and later cleanup uses an independent deadline', async () => {
      behavior = 'stall';
      await assert.rejects(get(transport, { signal: AbortSignal.timeout(100) }), /transport failed/);
      behavior = 'ok';
      assert.equal((await transport.request('/file/expired-run-artifact', { method: 'DELETE', signal: AbortSignal.timeout(1000) })).status, 204);
    });
    const content = currentVibeSnapshot();
    content.publicChecks = [{ name: 'TLS fixture check', input: {}, expected: ['ok'] }];
    content.hiddenChecks = [];
    const files = snapshotEditableFiles(content);
    await t.test('the actual VibeRunner completes its protocol and removes both compiled artifacts through mTLS', async () => {
      deleted.length = 0;
      const checks = await new VibeRunner(new ConfigService(env)).run(files, false, content);
      assert.equal(checks.length, 2);
      assert.ok(checks.every((check) => check.passed));
      assert.deepEqual(deleted.sort(), ['/file/fixture-checks', '/file/fixture-main']);
    });
    await t.test('execution failures retain generic errors and still reclaim artifacts', async () => {
      deleted.length = 0;
      behavior = 'run-failure';
      await assert.rejects(new VibeRunner(new ConfigService(env)).run(files, false, content), (error) => {
        assert.match(error.message, /격리 실행기에 연결하지 못했습니다/);
        assert.doesNotMatch(error.message, /fixture-private|127\.0\.0\.1|client\.key/);
        return true;
      });
      assert.deepEqual(deleted.sort(), ['/file/fixture-checks', '/file/fixture-main']);
      behavior = 'ok';
    });
    await t.test('unresponsive artifact deletion cannot hold a failed run indefinitely', { timeout: 10_000 }, async () => {
      deleted.length = 0;
      behavior = 'cleanup-stall';
      const started = performance.now();
      await assert.rejects(new VibeRunner(new ConfigService(env)).run(files, false, content), /격리 실행기에 연결하지 못했습니다/);
      assert.ok(performance.now() - started < 8000);
      assert.deepEqual(deleted.sort(), ['/file/fixture-checks', '/file/fixture-main']);
      behavior = 'ok';
    });
  } finally {
    transports.forEach((transport) => transport.close());
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    await rm(directory, { recursive: true, force: true });
  }
});
