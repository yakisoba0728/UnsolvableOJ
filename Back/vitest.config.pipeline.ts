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
      env: { REDIS_DB: process.env.PIPELINE_REDIS_DB ?? '2' },
    },
  }),
);
