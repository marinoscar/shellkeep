import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8323',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Start local dev server if not running
  webServer: process.env.CI ? undefined : {
    // The generated mode files (npm run platform:infra:sync): base + dev + devdb.
    // Publishes NGINX_PORT (8323 from infra/compose/app.env.example).
    command: 'cd ../../infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml up',
    url: `${process.env.BASE_URL || 'http://localhost:8323'}/api/health/live`,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
