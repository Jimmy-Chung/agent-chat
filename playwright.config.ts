import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
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
      command: 'PI_ADAPTER_URL=ws://127.0.0.1:7331/api/agent-chat/v1/socket PI_ADAPTER_TOKEN= AGENT_CHAT_TOKEN=test-token pnpm -F server exec wrangler dev --local --port 8787',
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
