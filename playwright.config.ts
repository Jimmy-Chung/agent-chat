import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
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
      command: 'pnpm -F server dev',
      port: 8080,
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
