import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseConnectionOptions } from '../../config/env.validation.js';

const { Client } = createRequire(import.meta.url)('pg') as {
  Client: new (options: { connectionString: string; ssl: unknown }) => {
    connectionParameters: { ssl: unknown; host: string };
  };
};

describe('database TLS verification', () => {
  const url = 'postgres://user:password@localhost:5432/unsolvable';

  it.each([
    '',
    '?sslmode=disable',
    '?sslmode=no-verify',
    '?ssl=no-verify',
    '?uselibpqcompat=true',
    '?sslnegotiation=direct',
    ...['disable', 'no-verify', 'prefer', 'require', 'verify-ca'].map(
      (mode) => `?sslmode=${mode}&ssl=no-verify&uselibpqcompat=true`,
    ),
  ])('keeps effective pg TLS verification enabled for URL suffix %j', (suffix) => {
    const options = databaseConnectionOptions(`${url}${suffix}`, true);
    expect(options.ssl).toEqual({ rejectUnauthorized: true, host: 'localhost' });
    const params = new URL(options.url).searchParams;
    for (const name of ['ssl', 'sslmode', 'sslnegotiation'])
      expect(params.has(name)).toBe(false);
    const client = new Client({ connectionString: options.url, ssl: options.ssl });
    const effectiveSsl = client.connectionParameters.ssl;
    expect(effectiveSsl).toBeTypeOf('object');
    expect(effectiveSsl).not.toBeNull();
    // pg 8 needs an explicit TLS host for literal-IP certificate checks.
    expect(effectiveSsl).not.toHaveProperty('rejectUnauthorized', false);
    expect(effectiveSsl).toHaveProperty('host', 'localhost');
    expect(effectiveSsl).not.toHaveProperty('checkServerIdentity');
  });

  it.each([
    ['postgres://user:password@127.0.0.2:5432/db?sslmode=no-verify', '127.0.0.2'],
    [`${url}?host=ignored.invalid&host=127.0.0.2&ssl=false`, '127.0.0.2'],
    [`${url}?host=%3A%3A1&sslnegotiation=direct`, '::1'],
    ['postgres://user:password@db%2Eexample.test:5432/db', 'db.example.test'],
  ])('preserves the effective pg host for %s', (input, host) => {
    const options = databaseConnectionOptions(input, true);
    const client = new Client({ connectionString: options.url, ssl: options.ssl });
    expect(client.connectionParameters.host).toBe(host);
    expect(client.connectionParameters.ssl).toHaveProperty('host', host);
    expect(client.connectionParameters.ssl).toHaveProperty('rejectUnauthorized', true);
  });

  it('preserves URL CA/client certificates and non-TLS options without parser overrides', () => {
    const directory = mkdtempSync(join(tmpdir(), 'unsolvable-tls-options-'));
    try {
      const input = new URL(url);
      for (const [parameter, file, contents] of [
        ['sslrootcert', 'ca.pem', 'fixture-ca'],
        ['sslcert', 'client.pem', 'fixture-cert'],
        ['sslkey', 'client.key', 'fixture-key'],
      ]) {
        const path = join(directory, file);
        writeFileSync(path, contents);
        input.searchParams.append(parameter, join(directory, 'not-the-last-value'));
        input.searchParams.append(parameter, path);
      }
      input.searchParams.set('sslmode', 'disable');
      input.searchParams.set('options', '-c search_path=fixture');
      input.searchParams.set('application_name', 'tls-fixture');
      const options = databaseConnectionOptions(input.href, true);
      const params = new URL(options.url).searchParams;
      for (const parameter of ['sslrootcert', 'sslcert', 'sslkey', 'sslmode'])
        expect(params.has(parameter)).toBe(false);
      expect(params.get('options')).toBe('-c search_path=fixture');
      expect(params.get('application_name')).toBe('tls-fixture');
      const client = new Client({ connectionString: options.url, ssl: options.ssl });
      expect(client.connectionParameters.ssl).toHaveProperty('ca', Buffer.from('fixture-ca'));
      expect(client.connectionParameters.ssl).toHaveProperty('cert', Buffer.from('fixture-cert'));
      expect(client.connectionParameters.ssl).toHaveProperty('key', Buffer.from('fixture-key'));
      expect(client.connectionParameters.ssl).toHaveProperty('host', 'localhost');
      expect(client.connectionParameters.ssl).toHaveProperty('rejectUnauthorized', true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(['postgres:///db', `${url}?host=%2Ffixture-socket`])(
    'requires a TCP peer identity for enabled TLS: %s',
    (input) => {
      expect(() => databaseConnectionOptions(input, true)).toThrow(
        'DATABASE_SSL은 인증서와 일치하는 TCP 호스트가 필요합니다.',
      );
    },
  );

  it('does not rewrite URLs when DATABASE_SSL is disabled', () => {
    const original = `${url}?sslmode=disable`;
    expect(databaseConnectionOptions(original, false)).toEqual({
      url: original,
      ssl: false,
    });
  });

  it('does not expose credentials when the URL cannot be parsed', () => {
    expect(() =>
      databaseConnectionOptions('postgres://user:secret-password@', true),
    ).toThrow(new Error('DATABASE_URL이 유효한 URL이어야 합니다.'));
  });
});
