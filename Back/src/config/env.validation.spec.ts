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
});
