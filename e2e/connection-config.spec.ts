import { test, expect, type Page } from '@playwright/test'

const TOKEN = process.env.AGENT_CHAT_TOKEN || 'test-token'
const PI_WSS_URL = 'ws://127.0.0.1:7331/api/agent-chat/v1/socket'
const PI_TOKEN = 'test-token'

test.describe('FEAT-036: Connection Config Modal', () => {

  // TC-036-01: First auth shows connection config modal when no PI config
  test('TC-036-01: shows config modal when no PI config in localStorage', async ({ page }) => {
    await page.goto('/')
    await page.evaluate((token) => {
      localStorage.clear()
      localStorage.setItem('AGENT_CHAT_TOKEN', token)
      // Intentionally NOT setting PI_ADAPTER_WSS_URL or PI_ADAPTER_TOKEN
    }, TOKEN)
    await page.reload()

    // Should see the connection config modal
    await expect(page.locator('h2', { hasText: 'PI Adapter 连接配置' })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByPlaceholder(/wss:\/\//)).toBeVisible()
    await expect(page.getByPlaceholder(/Token/)).toBeVisible()
  })

  // TC-036-02: Config validation success saves and connects
  test('TC-036-02: valid config saves and closes modal', async ({ page }) => {
    await page.goto('/')
    await page.evaluate((token) => {
      localStorage.clear()
      localStorage.setItem('AGENT_CHAT_TOKEN', token)
    }, TOKEN)
    await page.reload()

    // Fill in config
    await page.getByPlaceholder(/wss:\/\//).fill(PI_WSS_URL)
    await page.getByPlaceholder(/PI Adapter 鉴权/).fill(PI_TOKEN || 'test')

    // Click verify
    const btn = page.getByRole('button', { name: '验证并保存' })
    await btn.click()

    // Should close modal and show main UI (new topic button)
    await expect(page.getByRole('button', { name: '新建话题' })).toBeVisible({ timeout: 10_000 })

    // Config should be saved in localStorage
    const savedUrl = await page.evaluate(() => localStorage.getItem('PI_ADAPTER_WSS_URL'))
    expect(savedUrl).toBe(PI_WSS_URL)
  })

  // TC-036-03: Invalid config shows error, modal stays open
  test('TC-036-03: invalid config shows error and keeps modal open', async ({ page }) => {
    await page.goto('/')
    await page.evaluate((token) => {
      localStorage.clear()
      localStorage.setItem('AGENT_CHAT_TOKEN', token)
    }, TOKEN)
    await page.reload()

    // Fill in wrong URL
    await page.getByPlaceholder(/wss:\/\//).fill('wss://nonexistent.invalid/socket')
    await page.getByPlaceholder(/PI Adapter 鉴权/).fill('wrong')

    await page.getByRole('button', { name: '验证并保存' }).click()

    // Should show error message
    await expect(page.locator('text=连接失败')).toBeVisible({ timeout: 10_000 })

    // Modal should still be visible
    await expect(page.locator('h2', { hasText: 'PI Adapter 连接配置' })).toBeVisible()
  })

  // TC-036-04: Clicking PiStatusBadge opens config modal
  test('TC-036-04: clicking status badge opens config modal', async ({ page }) => {
    // Authenticate with PI config already set
    await page.goto('/')
    await page.evaluate(({ token, piWssUrl, piToken }) => {
      localStorage.clear()
      localStorage.setItem('AGENT_CHAT_TOKEN', token)
      localStorage.setItem('PI_ADAPTER_WSS_URL', piWssUrl)
      localStorage.setItem('PI_ADAPTER_TOKEN', piToken)
    }, { token: TOKEN, piWssUrl: PI_WSS_URL, piToken: PI_TOKEN })
    await page.reload()

    // Wait for main UI
    await expect(page.getByRole('button', { name: '新建话题' })).toBeVisible({ timeout: 10_000 })

    // Remove Next.js dev overlay that intercepts pointer events
    await page.evaluate(() => {
      document.querySelectorAll('nextjs-portal').forEach((el) => el.remove())
    })
    await page.getByTitle('点击配置 PI Adapter 连接').click()

    // Config modal should appear with pre-filled values
    await expect(page.locator('h2', { hasText: 'PI Adapter 连接配置' })).toBeVisible({ timeout: 5_000 })
    const urlInput = page.getByPlaceholder(/wss:\/\//)
    await expect(urlInput).toHaveValue(PI_WSS_URL)
  })

  // TC-036-09: Refresh page recovers config from localStorage
  test('TC-036-09: refresh recovers config from localStorage', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(({ token, piWssUrl, piToken }) => {
      localStorage.clear()
      localStorage.setItem('AGENT_CHAT_TOKEN', token)
      localStorage.setItem('PI_ADAPTER_WSS_URL', piWssUrl)
      localStorage.setItem('PI_ADAPTER_TOKEN', piToken)
    }, { token: TOKEN, piWssUrl: PI_WSS_URL, piToken: PI_TOKEN })
    await page.reload()

    // Should go directly to main UI, no config modal
    await expect(page.getByRole('button', { name: '新建话题' })).toBeVisible({ timeout: 10_000 })

    // Refresh again
    await page.reload()
    await expect(page.getByRole('button', { name: '新建话题' })).toBeVisible({ timeout: 10_000 })

    // No config modal
    await expect(page.locator('h2', { hasText: 'PI Adapter 连接配置' })).not.toBeVisible()
  })

  // TC-036-10: Already configured skips modal after auth
  test('TC-036-10: existing config skips modal after auth', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(({ token, piWssUrl, piToken }) => {
      localStorage.clear()
      localStorage.setItem('AGENT_CHAT_TOKEN', token)
      localStorage.setItem('PI_ADAPTER_WSS_URL', piWssUrl)
      localStorage.setItem('PI_ADAPTER_TOKEN', piToken)
    }, { token: TOKEN, piWssUrl: PI_WSS_URL, piToken: PI_TOKEN })
    await page.reload()

    // Should go directly to main UI
    await expect(page.getByRole('button', { name: '新建话题' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('h2', { hasText: 'PI Adapter 连接配置' })).not.toBeVisible()
  })
})
