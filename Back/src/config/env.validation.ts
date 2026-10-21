import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import Joi from 'joi';

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

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  HOST: Joi.string().default('127.0.0.1'),
  TRUST_PROXY: Joi.string().allow('').default(''),
  CORS_ORIGIN: Joi.string().default('http://localhost:3001'),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  DATABASE_SSL: Joi.boolean().truthy('true').falsy('false').default(false),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_USERNAME: Joi.string().allow('').optional(),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().integer().min(0).default(0),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JUDGE_SERVICE_TOKEN: Joi.string().min(32).required(),
});
