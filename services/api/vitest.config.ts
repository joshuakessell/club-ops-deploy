import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/vitest.setup.ts'],
    // Integration tests share a single Postgres instance; run serially to avoid cross-test DB interference.
    minThreads: 1,
    maxThreads: 1,
    fileParallelism: false,
  },
});
