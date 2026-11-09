import { defineConfig } from 'vitest/config';
import { integrationDatabaseUrl } from './scripts/run-integration.mjs';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // 모든 파일이 같은 DB를 쓰므로, 한 파일의 정리(문제 삭제·TRUNCATE)가 다른 파일의 진행 중 쿼리를 깨지 않게 순서대로 실행한다.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: integrationDatabaseUrl(),
      REDIS_HOST: process.env.REDIS_HOST ?? 'localhost',
      REDIS_PORT: process.env.REDIS_PORT ?? '6379',
      REDIS_DB: process.env.REDIS_DB ?? '1',
      JWT_ACCESS_SECRET: 'test-jwt-secret-with-at-least-32-characters',
      JUDGE_SERVICE_TOKEN: 'test-judge-token-with-at-least-32-characters',
    },
  },
});
