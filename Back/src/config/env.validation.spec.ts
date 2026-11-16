import { describe, expect, it } from 'vitest';
import { envValidationSchema } from './env.validation.js';

const env = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/unsolvable',
  JWT_ACCESS_SECRET: 'local-dev-only-jwt-access-secret-0123456789ab',
  JUDGE_SERVICE_TOKEN: 'local-dev-only-judge-service-token-0123456789',
};
const validate = (overrides: Record<string, string>) =>
  envValidationSchema.validate(
    { ...env, ...overrides },
    { abortEarly: false, allowUnknown: true },
  );

describe('environment validation', () => {
  it.each(['JWT_ACCESS_SECRET', 'JUDGE_SERVICE_TOKEN'])(
    'rejects the .env.example placeholder %s only in production',
    (key) => {
      const placeholder = 'replace-this-with-at-least-32-random-characters';
      expect(
        validate({ NODE_ENV: 'production', [key]: placeholder }).error?.message,
      ).toContain(key);
      for (const NODE_ENV of ['development', 'test'])
        expect(
          validate({ NODE_ENV, [key]: placeholder }).error,
        ).toBeUndefined();
    },
  );

  it('keeps accepting the local Compose secrets in production', () => {
    expect(validate({ NODE_ENV: 'production' }).error).toBeUndefined();
  });

  it.each(['15m', '30s', '12h', '7d'])('accepts expiry %s', (value) => {
    expect(validate({ JWT_ACCESS_EXPIRES_IN: value }).error).toBeUndefined();
  });

  it.each(['abc', '900', '0m', '15ms', '1.5h', '15 m', ''])(
    'rejects expiry %j that signAsync or the web cannot use',
    (value) => {
      expect(
        validate({ JWT_ACCESS_EXPIRES_IN: value }).error?.message,
      ).toContain('JWT_ACCESS_EXPIRES_IN');
    },
  );

  it('defaults the expiry to 15m', () => {
    expect(validate({}).value.JWT_ACCESS_EXPIRES_IN).toBe('15m');
  });

  it('defaults Vibe to embedded and requires complete dedicated TLS configuration', () => {
    expect(validate({}).value.VIBE_EXECUTION_MODE).toBe('embedded');
    const dedicated = {
      VIBE_EXECUTION_MODE: 'dedicated',
      VIBE_SANDBOX_URL: 'https://sandbox.test',
      VIBE_SANDBOX_TOKEN: 'dedicated-vibe-fixture-token-0123456789',
      VIBE_SANDBOX_TLS_CA_FILE: '/secrets/ca.pem',
      VIBE_SANDBOX_TLS_CERT_FILE: '/secrets/client.pem',
      VIBE_SANDBOX_TLS_KEY_FILE: '/secrets/client.key',
    };
    expect(validate(dedicated).error).toBeUndefined();
    for (const key of [
      'VIBE_SANDBOX_URL',
      'VIBE_SANDBOX_TOKEN',
      'VIBE_SANDBOX_TLS_CA_FILE',
      'VIBE_SANDBOX_TLS_CERT_FILE',
      'VIBE_SANDBOX_TLS_KEY_FILE',
    ])
      expect(validate({ ...dedicated, [key]: '' }).error?.message).toContain(
        key,
      );
    expect(
      validate({ ...dedicated, VIBE_EXECUTION_MODE: 'embedded' }).error
        ?.message,
    ).toContain('VIBE_SANDBOX_TLS');
    expect(
      validate({ ...dedicated, VIBE_SANDBOX_URL: 'http://sandbox.test' }).error
        ?.message,
    ).toContain('VIBE_SANDBOX_URL');
    for (const value of [
      'private short secret',
      'replace-this-with-a-private-long-secret',
    ]) {
      const error = validate({ ...dedicated, VIBE_SANDBOX_TOKEN: value }).error
        ?.message;
      expect(error).toContain('VIBE_SANDBOX_TOKEN');
      expect(error).not.toContain(value);
    }
    const url = 'https://user:private@sandbox.test/run';
    expect(
      validate({ ...dedicated, VIBE_SANDBOX_URL: url }).error?.message,
    ).not.toContain(url);
  });

  it('defaults email to disabled and fails closed when enabled without delivery configuration', () => {
    expect(validate({}).value.EMAIL_ENABLED).toBe(false);
    expect(validate({ EMAIL_ENABLED: 'true' }).error?.message).toContain(
      'EMAIL_API_KEY',
    );
    const mail = {
      EMAIL_ENABLED: 'true',
      EMAIL_API_KEY: 'test-provider-key',
      EMAIL_FROM: 'test@example.com',
      EMAIL_APP_ORIGIN: 'https://judge.example.com',
      EMAIL_TOKEN_SECRET: 'test-dedicated-mail-key-at-least-32-characters',
    };
    expect(validate(mail).error).toBeUndefined();
    for (const origin of [
      'http://judge.example.com',
      'https://evil.example/path',
      'https://user@judge.example.com',
      'https://judge.example.com?x=1',
    ])
      expect(
        validate({ ...mail, EMAIL_APP_ORIGIN: origin }).error?.message,
      ).toContain('EMAIL_APP_ORIGIN');
    expect(
      validate({
        ...mail,
        NODE_ENV: 'production',
        EMAIL_TOKEN_SECRET: 'replace-this-with-at-least-32-random-characters',
      }).error?.message,
    ).toContain('EMAIL_TOKEN_SECRET');
  });
});
