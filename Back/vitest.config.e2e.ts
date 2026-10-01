import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgresql://unsolvable:local_password@localhost:5432/unsolvable_oj',
      REDIS_HOST: process.env.REDIS_HOST ?? 'localhost',
      REDIS_PORT: process.env.REDIS_PORT ?? '6379',
      REDIS_DB: process.env.REDIS_DB ?? '1',
      JWT_ACCESS_SECRET: 'test-jwt-secret-with-at-least-32-characters',
      JUDGE_SERVICE_TOKEN: 'test-judge-token-with-at-least-32-characters',
    },
  },
});
