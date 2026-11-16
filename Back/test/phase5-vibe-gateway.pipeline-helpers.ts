import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import type { TLSSocket } from 'node:tls';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const BYTE_LIMIT = 1_048_576;

/** Owned test gateway: real mTLS and forwarding, never a fake execution response. */
export async function nativeVibeGateway(upstreamValue: string, token: string) {
  const upstream = new URL(upstreamValue);
  if (upstream.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname)
    || upstream.pathname !== '/' || upstream.username || upstream.password || upstream.search || upstream.hash)
    throw new Error('The native Vibe gateway accepts only the disposable loopback sandbox');
  if (!token) throw new Error('The disposable native sandbox token is required');
  const directory = await mkdtemp(join(tmpdir(), 'oj-phase5-vibe-'));
  const path = (name: string) => join(directory, name);
  const sockets = new Set<Duplex>();
  const requests = new Set<AbortController>();
  const operations = new Set<Promise<void>>();
  const observations: { method: string; path: string; mtls: boolean; bearer: 'expected' | 'other' | 'absent';
    status: number; requestBytes: number; responseBytes: number }[] = [];
  let server: ReturnType<typeof createServer> | undefined;
  let attempts = 0;
  let upstreamFailures = 0;
  let closed = false;
  let stopping = false;
  const close = async () => {
    if (stopping) return;
    stopping = true;
    for (const controller of requests) controller.abort();
    for (const socket of sockets) socket.destroy();
    try {
      if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
      await Promise.allSettled(operations);
    } finally { await rm(directory, { recursive: true, force: true }); }
    closed = true;
  };
  const openssl = (args: string[]) => execute('openssl', args, { timeout: 10_000, maxBuffer: 64_000 });
  try {
    await openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
      '-subj', '/CN=Phase5DisposableCA', '-addext', 'basicConstraints=critical,CA:TRUE',
      '-keyout', path('ca.key'), '-out', path('ca.pem')]);
    for (const kind of ['server', 'client']) {
      await openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
        '-subj', `/CN=${kind === 'server' ? 'phase5.native.test' : 'phase5-api'}`,
        '-keyout', path(`${kind}.key`), '-out', path(`${kind}.csr`)]);
      await writeFile(path(`${kind}.ext`), [
        'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment',
        `extendedKeyUsage=${kind === 'server' ? 'serverAuth' : 'clientAuth'}`,
        ...(kind === 'server' ? ['subjectAltName=DNS:phase5.native.test'] : []),
      ].join('\n') + '\n', { mode: 0o600 });
      await openssl(['x509', '-req', '-in', path(`${kind}.csr`), '-CA', path('ca.pem'), '-CAkey', path('ca.key'),
        '-CAcreateserial', '-days', '1', '-sha256', '-extfile', path(`${kind}.ext`), '-out', path(`${kind}.pem`)]);
    }
    server = createServer({ key: await readFile(path('server.key')), cert: await readFile(path('server.pem')),
      ca: await readFile(path('ca.pem')), requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (incoming, outgoing) => {
      const operation = (async () => {
        const method = incoming.method ?? '';
        const target = incoming.url ?? '';
        const allowed = (method === 'GET' && ['/version', '/config', '/file'].includes(target))
          || (method === 'POST' && target === '/run') || (method === 'DELETE' && /^\/file\/[A-Za-z0-9_-]{1,200}$/.test(target));
        if (!allowed) { outgoing.writeHead(404); outgoing.end(); return; }
        if (++attempts > 128) { outgoing.writeHead(429); outgoing.end(); return; }
        const parts: Buffer[] = [];
        let requestBytes = 0;
        for await (const part of incoming) {
          requestBytes += part.length;
          if (requestBytes > BYTE_LIMIT) { outgoing.writeHead(413); outgoing.end(); return; }
          parts.push(Buffer.from(part));
        }
        const controller = new AbortController();
        requests.add(controller);
        outgoing.once('close', () => controller.abort());
        try {
          const response = await fetch(new URL(target, upstream), {
            method, redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
            // Preserve both correct and absent/incorrect bearer headers. The
            // upstream sandbox, not a canned gateway reply, must enforce auth.
            headers: { ...(incoming.headers.authorization ? { Authorization: incoming.headers.authorization } : {}),
              ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
            ...(method === 'POST' ? { body: Buffer.concat(parts) } : {}),
          });
          let responseBytes = 0;
          const chunks: Uint8Array[] = [];
          if (response.body) for await (const chunk of response.body) {
            responseBytes += chunk.length;
            if (responseBytes > BYTE_LIMIT) { await response.body.cancel().catch(() => {}); throw new Error('Oversized native response'); }
            chunks.push(chunk);
          }
          observations.push({ method, path: target.startsWith('/file/') ? '/file/:id' : target,
            mtls: (incoming.socket as TLSSocket).authorized,
            bearer: incoming.headers.authorization === `Bearer ${token}` ? 'expected' : incoming.headers.authorization ? 'other' : 'absent',
            status: response.status, requestBytes, responseBytes });
          outgoing.writeHead(response.status);
          outgoing.end(Buffer.concat(chunks));
        } finally { requests.delete(controller); }
      })().catch(() => {
        upstreamFailures++;
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      }).finally(() => operations.delete(operation));
      operations.add(operation);
    });
    server.headersTimeout = 10_000;
    server.requestTimeout = 15_000;
    server.maxConnections = 8;
    server.on('tlsClientError', () => {});
    server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test gateway port');
    return {
      settings: { VIBE_EXECUTION_MODE: 'dedicated', VIBE_SANDBOX_URL: `https://127.0.0.1:${address.port}`,
        VIBE_SANDBOX_TOKEN: token, VIBE_SANDBOX_TLS_SERVERNAME: 'phase5.native.test',
        VIBE_SANDBOX_TLS_CA_FILE: path('ca.pem'), VIBE_SANDBOX_TLS_CERT_FILE: path('client.pem'), VIBE_SANDBOX_TLS_KEY_FILE: path('client.key') },
      observations, get upstreamFailures() { return upstreamFailures; }, get closed() { return closed; }, close,
    };
  } catch (error) { await close(); throw error; }
}
