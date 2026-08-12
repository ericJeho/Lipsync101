import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The suite covers pure domain logic and HTTP wiring; nothing here talks to
    // Postgres or Redis, so it runs on a clean checkout with no services up.
    env: {
      NODE_ENV: 'test',
      ENABLE_QUEUE: 'false',
      JWT_ACCESS_SECRET: 'test-access-secret-not-a-real-one',
      JWT_REFRESH_SECRET: 'test-refresh-secret-not-a-real-one',
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_PATH: './.test-storage',
    },
  },
});
