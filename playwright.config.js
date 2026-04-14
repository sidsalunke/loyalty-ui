import { defineConfig, devices } from '@playwright/test'

/**
 * Two Playwright projects mirror the two CI stages:
 *
 * fe-ci  — runs against a mocked backend (Playwright route interception).
 *           No real services needed. Runs on every PR.
 *           Tests live in tests/ci/
 *
 * fe-e2e — runs against the real mediation service + vendor-mock.
 *           Requires docker-compose stack to be up.
 *           Tests live in tests/e2e/
 */
export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list']
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // VIDEO=on   → record every test  (good for demos / showcasing)
    // VIDEO=fail → record only failures (default for CI)
    // omitted    → no recording
    video: process.env.VIDEO === 'on'   ? 'on'
         : process.env.VIDEO === 'fail' ? 'retain-on-failure'
         : 'off'
  },

  projects: [
    // ── FE CI: all backend responses are mocked by Playwright ──────────────
    {
      name: 'fe-ci',
      testDir: './tests/ci',
      use: {
        ...devices['Desktop Chrome'],
        // Use the system-installed Chrome instead of Playwright's Chromium.
        // Set channel: 'chromium' to revert to the downloaded browser once
        // cdn.playwright.dev is reachable from your network.
        channel: 'chrome'
      }
    },

    // ── FE E2E (fake mode): real FE + real BE + vendor-mock ─────────────────
    {
      name: 'fe-e2e',
      testDir: './tests/e2e',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome'
      }
    }
  ],

  // Starts the Vite dev server for both projects.
  // In the fe-e2e workflow, the BE is already running via docker-compose;
  // Vite's proxy (/api → localhost:8080) connects them automatically.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
})
