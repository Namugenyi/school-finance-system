import { defineConfig } from '@playwright/test';

const port = 4100;
const db = process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/stja_e2e';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1366, height: 900 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    // Fresh schema and data on every run; the API serves the built web app.
    command: 'npx prisma migrate deploy && npx tsx test/e2e-server.ts',
    cwd: '../api',
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: db, PORT: String(port), NODE_ENV: 'test', STATIC_DIR: '../web/dist' },
  },
});
