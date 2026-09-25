import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  webServer: {
    command: 'node serve.mjs',
    port: 8312,
    reuseExistingServer: true,
    timeout: 30_000,
    env: { PORT: '8312' },
  },
  use: { baseURL: 'http://localhost:8312', channel: 'chrome' },
});
