import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

export function databaseConnectionOptions(url: string, ssl: boolean) {
  if (!ssl) return { url, ssl: false };
  const parsed = URL.parse(url);
  if (!parsed) throw new Error('DATABASE_URL이 유효한 URL이어야 합니다.');
  const host =
    parsed.searchParams.getAll('host').at(-1) || decodeURIComponent(parsed.hostname);
  if (!host || host.startsWith('/'))
    throw new Error('DATABASE_SSL은 인증서와 일치하는 TCP 호스트가 필요합니다.');
  // pg 8 omits the TLS host for IPs; URL TLS keys would overwrite these options.
  const options: Pick<
    ConnectionOptions,
    'rejectUnauthorized' | 'host' | 'ca' | 'cert' | 'key'
  > = { rejectUnauthorized: true, host };
  for (const [parameter, property] of [
    ['sslrootcert', 'ca'],
    ['sslcert', 'cert'],
    ['sslkey', 'key'],
  ] as const) {
    const file = parsed.searchParams.getAll(parameter).at(-1);
    if (file) options[property] = readFileSync(file);
  }
  for (const parameter of [
    'ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslnegotiation',
  ])
    parsed.searchParams.delete(parameter);
  return { url: parsed.toString(), ssl: options };
}
