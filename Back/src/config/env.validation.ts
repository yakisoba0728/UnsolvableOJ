// oxlint-disable unicorn/no-thenable -- Joi conditional schemas intentionally use the then property.
import Joi from 'joi';

// .env.example의 자리표시자는 운영에서 거절합니다. local-dev-only 값은 로컬 Compose·CI용이라 허용합니다.
const secret = Joi.string()
  .min(32)
  .required()
  .when('NODE_ENV', {
    not: 'production',
    otherwise: Joi.string().pattern(/^replace-this/, { invert: true }),
  })
  .messages({
    'string.pattern.invert.base':
      '{#label}에 .env.example의 예시 값을 쓸 수 없습니다',
  });

export const envValidationSchema = Joi.object({
  OPENAI_API_KEY: Joi.string().allow('').optional(),
  VIBE_AI_MODEL: Joi.string().valid('gpt-6-luna').default('gpt-6-luna'),
  VIBE_EXECUTION_MODE: Joi.string()
    .valid('embedded', 'dedicated')
    .default('embedded'),
  VIBE_SANDBOX_URL: Joi.string().when('VIBE_EXECUTION_MODE', {
    is: 'dedicated',
    then: Joi.string()
      .uri({ scheme: ['https'] })
      .pattern(/^https:\/\/[^/?#@\s\\]+\/?$/)
      .required()
      .messages({
        'string.pattern.base':
          '{#label} must be an HTTPS origin without credentials, path, query or fragment',
      }),
    otherwise: Joi.string()
      .uri({ scheme: ['http', 'https'] })
      .allow('')
      .default(''),
  }),
  VIBE_SANDBOX_TOKEN: Joi.string().when('VIBE_EXECUTION_MODE', {
    is: 'dedicated',
    then: Joi.string()
      .pattern(/^[A-Za-z0-9._~-]{32,512}$/)
      .pattern(/^(replace-this|local-dev-only)/i, { invert: true })
      .required()
      .messages({
        'string.pattern.base':
          '{#label} must contain 32 to 512 safe secret characters',
        'string.pattern.invert.base':
          '{#label} must not use example or development credentials',
      }),
    otherwise: Joi.string().allow('').default(''),
  }),
  ...Object.fromEntries(
    ['CA', 'CERT', 'KEY'].map((kind) => [
      `VIBE_SANDBOX_TLS_${kind}_FILE`,
      Joi.string().when('VIBE_EXECUTION_MODE', {
        is: 'dedicated',
        then: Joi.required(),
        otherwise: Joi.valid('').default(''),
      }),
    ]),
  ),
  VIBE_SANDBOX_TLS_SERVERNAME: Joi.string().when('VIBE_EXECUTION_MODE', {
    is: 'dedicated',
    then: Joi.string().hostname().allow('').optional(),
    otherwise: Joi.valid('').default(''),
  }),
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
  JWT_ACCESS_SECRET: secret,
  // 문자열 그대로 signAsync에 전달됩니다. 숫자만 쓰면 ms 단위가 되고 웹은 이 형식만 해석합니다.
  JWT_ACCESS_EXPIRES_IN: Joi.string()
    .pattern(/^[1-9]\d*[smhd]$/)
    .default('15m')
    .messages({
      'string.pattern.base':
        '{#label}은 15m처럼 양의 정수와 s·m·h·d 단위여야 합니다',
    }),
  EMAIL_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  EMAIL_WORKER_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true),
  EMAIL_API_KEY: Joi.string().when('EMAIL_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  EMAIL_FROM: Joi.string()
    .email()
    .when('EMAIL_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),
  EMAIL_APP_ORIGIN: Joi.string()
    .uri({ scheme: ['https'] })
    .pattern(/^https:\/\/[^/?#@]+$/)
    .when('EMAIL_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),
  EMAIL_TOKEN_SECRET: Joi.string()
    .min(32)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().pattern(/^replace-this/, { invert: true }),
    })
    .when('EMAIL_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),
  JUDGE_SERVICE_TOKEN: secret,
});
