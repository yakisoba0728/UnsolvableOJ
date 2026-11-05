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
  JUDGE_SERVICE_TOKEN: secret,
});
