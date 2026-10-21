import { defineConfig } from 'vitest/config';

const databaseUrl = process.env.DATABASE_URL;
const databaseName = process.env.UNSOLVABLE_TEST_DATABASE;
if (
  !databaseUrl ||
  !databaseName ||
  !/^unsolvable_integration_[a-f0-9]{32}$/.test(databaseName) ||
  new URL(databaseUrl).pathname !== `/${databaseName}`
) {
  throw new Error(
    'Use npm run test:e2e or test:pipeline to create a disposable database.',
  );
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_HOST: process.env.REDIS_HOST ?? 'localhost',
      REDIS_PORT: process.env.REDIS_PORT ?? '6379',
      REDIS_DB: process.env.REDIS_DB ?? '1',
      JWT_ACCESS_SECRET: 'test-jwt-secret-with-at-least-32-characters',
      JUDGE_SERVICE_TOKEN: 'test-judge-token-with-at-least-32-characters',
    },
  },
});
