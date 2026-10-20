import { defineConfig, mergeConfig } from 'vitest/config';
import e2e from './vitest.config.e2e.js';

export default mergeConfig(
  e2e,
  defineConfig({
    test: {
      include: ['test/*.pipeline-spec.ts'],
      exclude: ['**/*.e2e-spec.ts'],
      fileParallelism: false,
      testTimeout: 90_000,
      hookTimeout: 30_000,
      env: {
        REDIS_DB: process.env.PIPELINE_REDIS_DB ?? '2',
        GO_JUDGE_URL: process.env.GO_JUDGE_URL ?? 'http://127.0.0.1:5050',
        GO_JUDGE_TOKEN:
          process.env.GO_JUDGE_TOKEN ?? 'local-dev-only-go-judge-token-0123456789abcdef',
      },
    },
  }),
);
