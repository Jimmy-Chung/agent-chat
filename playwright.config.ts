import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  // 所有用例共享同一个 server/DO/本地 D1，并行 worker 会互相干扰（session 建立竞争）。
  workers: 1,
  use: {
    // E2E_BASE_URL lets a run target an isolated web instance (e.g. one started
    // with NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8787/ws) instead of the dev server
    // on :3000, which may be configured against the production worker.
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000',
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: [
    {
      command: 'pnpm -F mock-pi dev',
      port: 7331,
      reuseExistingServer: true,
      timeout: 10_000,
    },
    {
      command: 'pnpm -F server exec wrangler dev --local --port 8787',
      port: 8787,
      reuseExistingServer: true,
      timeout: 10_000,
    },
    {
      command: 'pnpm -F web dev',
      port: 3000,
      reuseExistingServer: true,
      timeout: 10_000,
    },
  ],
})
