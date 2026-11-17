import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createVibeTransport,
  loadVibeTransportSettings,
  VIBE_TRANSPORT_BYTES,
} from './vibe.transport.js';

const embedded = {
  VIBE_SANDBOX_URL: 'http://sandbox.test',
  VIBE_SANDBOX_TOKEN: 'private-fixture-token',
};
const dedicated = {
  ...embedded,
  VIBE_EXECUTION_MODE: 'dedicated',
  VIBE_SANDBOX_URL: 'https://sandbox.test',
  VIBE_SANDBOX_TOKEN: 'dedicated-fixture-token-with-32-safe-characters',
};
afterEach(() => vi.unstubAllGlobals());

describe('Vibe runtime configuration trust boundary', () => {
  it('preserves explicit/default embedded mode without accepting ignored TLS settings', () => {
    expect(loadVibeTransportSettings(embedded).mode).toBe('embedded');
    expect(() =>
      loadVibeTransportSettings({
        ...embedded,
        VIBE_SANDBOX_TLS_CA_FILE: '/private/ca',
      }),
    ).toThrow('require VIBE_EXECUTION_MODE');
  });
  it.each([
    'http://sandbox.test',
    'https://user:private@sandbox.test',
    'https://sandbox.test/run',
    'https://sandbox.test/.',
    'https://sandbox.test/%2e/',
    'https://sandbox.test?secret=private',
    'https://sandbox.test?',
    'https://sandbox.test#private',
    'https://sandbox.test#',
    'https://sandbox.test\\private',
    'https://sandbox.test\n',
  ])('refuses dedicated origin surprises without echoing them: %s', (url) => {
    const attempt = () =>
      loadVibeTransportSettings({ ...dedicated, VIBE_SANDBOX_URL: url });
    expect(attempt).toThrow('VIBE_SANDBOX_URL');
    try {
      attempt();
    } catch (error) {
      expect(String(error)).not.toContain(url);
    }
  });
  it.each([
    'short',
    'x'.repeat(513),
    'x'.repeat(31) + ' ',
    'replace-this-secret-with-32-characters',
    'local-dev-only-private-secret-0123456789',
  ])('rejects weak/example/unsafe dedicated tokens', (token) => {
    expect(() =>
      loadVibeTransportSettings({ ...dedicated, VIBE_SANDBOX_TOKEN: token }),
    ).toThrow('VIBE_SANDBOX_TOKEN');
  });
  it.each([
    'JWT_ACCESS_SECRET',
    'JUDGE_SERVICE_TOKEN',
    'REDIS_PASSWORD',
    'GO_JUDGE_TOKEN',
  ])('refuses reuse of %s before opening a connection', (key) => {
    expect(() =>
      loadVibeTransportSettings({
        ...dedicated,
        [key]: dedicated.VIBE_SANDBOX_TOKEN,
      }),
    ).toThrow('must differ');
  });
  it('requires readable regular CA, client-certificate and key files', () => {
    expect(() => loadVibeTransportSettings(dedicated)).toThrow(
      'VIBE_SANDBOX_TLS_CA_FILE',
    );
    for (const path of ['/no-such-vibe-test-secret', '/dev/null', '/tmp']) {
      try {
        loadVibeTransportSettings({
          ...dedicated,
          VIBE_SANDBOX_TLS_CA_FILE: path,
        });
        throw new Error('Should reject the configured file');
      } catch (error) {
        expect(String(error)).toContain(
          'bounded regular VIBE_SANDBOX_TLS_CA_FILE',
        );
        expect(String(error)).not.toContain(path);
      }
    }
  });
  it('refuses an invalid identity hostname or unknown mode', () => {
    for (const name of [
      '127.0.0.1',
      'https://sandbox.test',
      'sandbox.test/path',
    ])
      expect(() =>
        loadVibeTransportSettings({
          ...dedicated,
          VIBE_SANDBOX_TLS_SERVERNAME: name,
        }),
      ).toThrow('SERVERNAME');
    expect(() =>
      loadVibeTransportSettings({
        ...embedded,
        VIBE_EXECUTION_MODE: 'unverified',
      }),
    ).toThrow('VIBE_EXECUTION_MODE');
  });
});

describe('bounded Vibe HTTP operations', () => {
  it('sets bearer authentication itself, preserves the deadline and omits only bearer for the anonymous probe', async () => {
    const calls = vi.fn(async () => Response.json({ os: 'linux' }));
    vi.stubGlobal('fetch', calls);
    const transport = createVibeTransport(loadVibeTransportSettings(embedded));
    const signal = AbortSignal.timeout(1000);
    await expect(
      (await transport.request('/version', { signal })).json(),
    ).resolves.toEqual({ os: 'linux' });
    await transport.request('/file', { signal, anonymous: true });
    expect(calls.mock.calls[0]).toEqual([
      new URL('http://sandbox.test/version'),
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${embedded.VIBE_SANDBOX_TOKEN}`,
          'Accept-Encoding': 'identity',
        },
        signal,
        redirect: 'error',
        body: undefined,
      },
    ]);
    expect((calls.mock.calls[1] as unknown[])[1]).not.toHaveProperty(
      'headers.Authorization',
    );
    transport.close();
  });
  it('rejects unexpected request paths and oversized requests before contacting the service', async () => {
    const calls = vi.fn();
    vi.stubGlobal('fetch', calls);
    const transport = createVibeTransport(loadVibeTransportSettings(embedded));
    const signal = AbortSignal.timeout(1000);
    for (const path of [
      '//external.test/run',
      '/file/..',
      '/file/a%2fb',
      '/config?token=private',
    ])
      await expect(transport.request(path, { signal })).rejects.toThrow(
        'Vibe sandbox transport failed',
      );
    await expect(
      transport.request('/run', {
        signal,
        method: 'POST',
        body: 'x'.repeat(VIBE_TRANSPORT_BYTES + 1),
      }),
    ).rejects.toThrow('transport failed');
    expect(calls).not.toHaveBeenCalled();
  });
  it('rejects redirects even when a fetch implementation returns them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'https://other.test/private' },
          }),
      ),
    );
    const transport = createVibeTransport(loadVibeTransportSettings(embedded));
    await expect(
      transport.request('/version', { signal: AbortSignal.timeout(1000) }),
    ).rejects.toThrow('transport failed');
  });
  it('bounds streamed bytes independently of Content-Length and cancels excess data', async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(VIBE_TRANSPORT_BYTES + 1));
              },
              cancel,
            }),
          ),
      ),
    );
    const transport = createVibeTransport(loadVibeTransportSettings(embedded));
    await expect(
      transport.request('/version', { signal: AbortSignal.timeout(1000) }),
    ).rejects.toThrow('transport failed');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('sanitizes upstream connection details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(
          'private-token /secret/client.pem internal-node-address',
        );
      }),
    );
    const transport = createVibeTransport(loadVibeTransportSettings(embedded));
    await expect(
      transport.request('/version', { signal: AbortSignal.timeout(1000) }),
    ).rejects.toThrow(/^Vibe sandbox transport failed$/);
  });
});
