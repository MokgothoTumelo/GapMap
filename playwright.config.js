import { defineConfig } from '@playwright/test';

// Behaviour-level baseline for the demo. The server is the same static server
// the app uses (serve.mjs); the tests drive the real browser, so they verify
// the demo without the tests themselves changing.
export default defineConfig({
  testDir: './tests',
  webServer: {
    command: 'node serve.mjs',
    port: 8312,
    reuseExistingServer: true,
    timeout: 30_000,
    env: { PORT: '8312' },
  },
  use: { baseURL: 'http://localhost:8312' },
});