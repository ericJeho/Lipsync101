import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // Point at the built package so the test run matches what webpack bundles.
      '@lipsync/shared': resolve(__dirname, '../../packages/shared/dist/index.js'),
    },
  },
});
