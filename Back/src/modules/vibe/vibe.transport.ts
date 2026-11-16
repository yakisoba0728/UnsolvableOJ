import { X509Certificate } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { Agent, request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  checkServerIdentity,
  createSecureContext,
  type ConnectionOptions,
} from 'node:tls';

type Environment = Readonly<Record<string, string | undefined>>;
const TLS_FILE_BYTES = 65_536;
export const VIBE_TRANSPORT_BYTES = 1_048_576;
const failed = () => new Error('Vibe sandbox transport failed');

export interface VibeTransportSettings {
  mode: 'embedded' | 'dedicated';
  origin: URL;
  token: string;
  tls?: ConnectionOptions;
}

function tlsFile(env: Environment, name: string) {
  let fd: number | undefined;
  try {
    if (!env[name]) throw new Error();
    fd = openSync(env[name], constants.O_RDONLY | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size < 1 || info.size > TLS_FILE_BYTES)
      throw new Error();
    const bytes = Buffer.alloc(TLS_FILE_BYTES + 1);
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    if (!count || count > TLS_FILE_BYTES) throw new Error();
    return bytes.subarray(0, count);
  } catch {
    // Configuration failures name a setting, never its secret path or contents.
    throw new Error(`Cannot read a bounded regular ${name} file`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function loadVibeTransportSettings(
  env: Environment,
): VibeTransportSettings {
  const mode = env.VIBE_EXECUTION_MODE ?? 'embedded';
  if (mode !== 'embedded' && mode !== 'dedicated')
    throw new Error('VIBE_EXECUTION_MODE must be embedded or dedicated');
  const value = env.VIBE_SANDBOX_URL ?? '';
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error('VIBE_SANDBOX_URL must be an absolute origin');
  }
  if (
    !/^https?:\/\/[^/?#@\s\\]+\/?$/.test(value) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (mode === 'dedicated' && origin.protocol !== 'https:')
  )
    throw new Error(
      'VIBE_SANDBOX_URL must be an origin without credentials, path, query or fragment; dedicated mode requires HTTPS',
    );
  const token = env.VIBE_SANDBOX_TOKEN ?? '';
  if (!token || /[\r\n]/.test(token))
    throw new Error('VIBE_SANDBOX_TOKEN is required');
  const names = [
    'VIBE_SANDBOX_TLS_CA_FILE',
    'VIBE_SANDBOX_TLS_CERT_FILE',
    'VIBE_SANDBOX_TLS_KEY_FILE',
  ] as const;
  if (mode === 'embedded') {
    if ([...names, 'VIBE_SANDBOX_TLS_SERVERNAME'].some((name) => env[name]))
      throw new Error(
        'Vibe TLS identity settings require VIBE_EXECUTION_MODE=dedicated',
      );
    return { mode, origin, token };
  }
  if (
    !/^[A-Za-z0-9._~-]{32,512}$/.test(token) ||
    /^(replace-this|local-dev-only)/i.test(token)
  )
    throw new Error(
      'VIBE_SANDBOX_TOKEN must be a dedicated secret of 32 to 512 safe characters',
    );
  if (
    [
      'JWT_ACCESS_SECRET',
      'JUDGE_SERVICE_TOKEN',
      'REDIS_PASSWORD',
      'GO_JUDGE_TOKEN',
    ].some((name) => env[name] === token)
  )
    throw new Error(
      'VIBE_SANDBOX_TOKEN must differ from application, Redis and algorithm-worker secrets',
    );
  const servername = env.VIBE_SANDBOX_TLS_SERVERNAME || undefined;
  if (
    servername &&
    (isIP(servername) ||
      !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(servername))
  )
    throw new Error('VIBE_SANDBOX_TLS_SERVERNAME must be a DNS hostname');
  const [ca, cert, key] = names.map((name) => tlsFile(env, name));
  const identity = servername ?? origin.hostname.replace(/^\[|\]$/g, '');
  const tls: ConnectionOptions = {
    ca,
    cert,
    key,
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
    ...((servername ?? (!isIP(identity) ? identity : undefined))
      ? { servername: servername ?? identity }
      : {}),
    checkServerIdentity: (_host, peer) => checkServerIdentity(identity, peer),
  };
  try {
    for (const bundle of [ca, cert]) {
      const certificates = bundle
        .toString('utf8')
        .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
      if (!certificates?.length) throw new Error();
      for (const pem of certificates) new X509Certificate(pem);
    }
    createSecureContext(tls); // Also rejects a mismatched client key/certificate.
  } catch {
    throw new Error('Invalid Vibe TLS CA, client certificate or private key');
  }
  return { mode, origin, token, tls };
}

export const vibeSettingNames = [
  'VIBE_EXECUTION_MODE',
  'VIBE_SANDBOX_URL',
  'VIBE_SANDBOX_TOKEN',
  'VIBE_SANDBOX_TLS_CA_FILE',
  'VIBE_SANDBOX_TLS_CERT_FILE',
  'VIBE_SANDBOX_TLS_KEY_FILE',
  'VIBE_SANDBOX_TLS_SERVERNAME',
  'JWT_ACCESS_SECRET',
  'JUDGE_SERVICE_TOKEN',
  'REDIS_PASSWORD',
  'GO_JUDGE_TOKEN',
] as const;

interface RequestOptions {
  signal: AbortSignal;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: string;
  anonymous?: boolean;
}

function checkedRequest(
  settings: VibeTransportSettings,
  path: string,
  options: RequestOptions,
) {
  const method = options.method ?? 'GET';
  const valid =
    (method === 'GET' && ['/version', '/config', '/file'].includes(path)) ||
    (method === 'POST' && path === '/run') ||
    (method === 'DELETE' && /^\/file\/[A-Za-z0-9_-]{1,200}$/.test(path));
  if (
    !valid ||
    (options.body !== undefined &&
      (method !== 'POST' ||
        Buffer.byteLength(options.body) > VIBE_TRANSPORT_BYTES))
  )
    throw failed();
  const headers = {
    ...(options.anonymous ? {} : { Authorization: `Bearer ${settings.token}` }),
    'Accept-Encoding': 'identity',
    ...(options.body === undefined
      ? {}
      : {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(options.body)),
        }),
  };
  return { url: new URL(path, settings.origin), method, headers };
}

async function boundedResponse(response: Response) {
  if (
    (response.status >= 300 && response.status < 400) ||
    Number(response.headers.get('content-length')) > VIBE_TRANSPORT_BYTES
  ) {
    await response.body?.cancel();
    throw failed();
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > VIBE_TRANSPORT_BYTES) {
          await reader.cancel();
          throw failed();
        }
        chunks.push(value);
      }
  } finally {
    reader?.releaseLock();
  }
  return new Response(
    [204, 205, 304].includes(response.status)
      ? null
      : new Uint8Array(Buffer.concat(chunks)),
    { status: response.status },
  );
}

/** A transport belongs to one bounded run. Dedicated requests always use a
 * private verified-mTLS Agent; global agents, fetch proxy settings and redirects
 * cannot replace its trust settings. close() releases sockets after cleanup.
 */
export function createVibeTransport(settings: VibeTransportSettings) {
  const agent =
    settings.mode === 'dedicated'
      ? new Agent({ ...settings.tls, maxSockets: 4, keepAlive: false })
      : undefined;
  return {
    close: () => agent?.destroy(),
    async request(path: string, options: RequestOptions): Promise<Response> {
      try {
        const { url, method, headers } = checkedRequest(
          settings,
          path,
          options,
        );
        if (!agent)
          return await boundedResponse(
            await fetch(url, {
              method,
              headers,
              body: options.body,
              redirect: 'error',
              signal: options.signal,
            }),
          );
        return await new Promise<Response>((resolve, reject) => {
          const request = httpsRequest(
            url,
            { ...settings.tls, agent, method, headers, signal: options.signal },
            (response) => {
              const status = response.statusCode ?? 0;
              if (
                status < 200 ||
                (status >= 300 && status < 400) ||
                Number(response.headers['content-length']) >
                  VIBE_TRANSPORT_BYTES ||
                (response.headers['content-encoding'] &&
                  response.headers['content-encoding'] !== 'identity')
              ) {
                response.destroy();
                request.destroy();
                reject(failed());
                return;
              }
              const chunks: Buffer[] = [];
              let total = 0;
              response.on('data', (chunk: Buffer) => {
                total += chunk.length;
                if (total > VIBE_TRANSPORT_BYTES) {
                  response.destroy();
                  request.destroy();
                  reject(failed());
                } else chunks.push(chunk);
              });
              response.once('error', () => reject(failed()));
              response.once('aborted', () => reject(failed()));
              response.once('end', () => {
                try {
                  resolve(
                    new Response(
                      [204, 205].includes(status)
                        ? null
                        : new Uint8Array(Buffer.concat(chunks)),
                      { status },
                    ),
                  );
                } catch {
                  reject(failed());
                }
              });
            },
          );
          request.once('error', () => reject(failed()));
          request.end(options.body);
        });
      } catch {
        throw failed();
      }
    },
  };
}
