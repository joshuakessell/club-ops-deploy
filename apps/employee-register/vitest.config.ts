import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@club-ops/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/vitest.setup.ts'],
    // Avoid flaky OOMs:
    // - Node worker threads often have a lower heap limit than the parent process.
    // - Use a single forked process instead of threads to get a normal Node heap.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
