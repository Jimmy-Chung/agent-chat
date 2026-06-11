import { test, expect, type Page } from '@playwright/test'

// FEAT-036 的「PI Adapter 连接配置弹窗」已被设备配对流程（AIT-208）取代：
// 无配置时首屏是配对引导屏（PairingRequiredScreen），手动配置弹窗仅在
// NEXT_PUBLIC_ENABLE_PI_DEBUG_CONFIG=1 的调试构建下存在，不在 e2e 覆盖。
// 本组用例验证当前行为：配对引导屏、localStorage 配置恢复、Agent 连接状态弹窗。

const TOKEN = process.env.AGENT_CHAT_TOKEN || 'test-token'
const PI_WSS_URL = 'ws://127.0.0.1:7331/api/agent-chat/v1/socket'
const PI_TOKEN = 'test-token'

async function seedAuth(page: Page, { withPiConfig }: { withPiConfig: boolean }) {
  await page.goto('/')
  await page.evaluate(({ token, piWssUrl, piToken, withConfig }) => {
    localStorage.clear()
    localStorage.setItem('AGENT_CHAT_TOKEN', token)
    if (withConfig) {
      localStorage.setItem('PI_ADAPTER_WSS_URL', piWssUrl)
      localStorage.setItem('PI_ADAPTER_TOKEN', piToken)
    }
  }, { token: TOKEN, piWssUrl: PI_WSS_URL, piToken: PI_TOKEN, withConfig: withPiConfig })
  await page.reload()
}

async function removeDevOverlay(page: Page) {
  // Next.js dev overlay 会拦截 pointer events
  await page.evaluate(() => {
    document.querySelectorAll('nextjs-portal').forEach((el) => el.remove())
  })
}

test.describe('Adapter 配对与连接状态', () => {

  // TC-036-01（改版）：无 PI 配置 → 显示配对引导屏，不进入主界面
  test('TC-036-01: shows pairing-required screen when no PI config in localStorage', async ({ page }) => {
    await seedAuth(page, { withPiConfig: false })

    await expect(page.getByRole('heading', { name: '连接到 Helm' })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/配对二维码以完成配对流程/)).toBeVisible()
    await expect(page.getByRole('button', { name: '新建话题' })).not.toBeVisible()
  })

  // TC-036-02（改版）：localStorage 已有配对配置 → 直接进入主界面，无配对引导屏
  test('TC-036-02: existing pairing config enters main UI directly', async ({ page }) => {
    await seedAuth(page, { withPiConfig: true })

    await expect(page.getByRole('button', { name: '新建话题' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('heading', { name: '连接到 Helm' })).not.toBeVisible()
  })

  // TC-036-03（改版）：点击侧边栏状态徽章 → 打开「Agent 连接」状态弹窗
  test('TC-036-03: clicking status badge opens adapter connection modal', async ({ page }) => {
    await seedAuth(page, { withPiConfig: true })
    await expect(page.getByRole('button', { name: '新建话题' })).toBeVisible({ timeout: 10_000 })

    await removeDevOverlay(page)
    await page.locator('[title="查看 Agent 连接状态"], [title="重新配对 Agent"]').first().click()

    await expect(page.getByRole('heading', { name: 'Agent 连接' })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('连接方式')).toBeVisible()
    await expect(page.getByText('版本', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '关闭' }).click()
    await expect(page.getByRole('heading', { name: 'Agent 连接' })).not.toBeVisible()
  })

  // TC-036-04（改版）：弹窗「清除配对」→ 清空配置并回到配对引导屏
  test('TC-036-04: clearing pairing returns to pairing-required screen', async ({ page }) => {
    await seedAuth(page, { withPiConfig: true })
    // 「清除配对」按钮只在存在配对设备记录时渲染；token 交换失败会回退到已存 URL，不影响进入主界面。
    await page.evaluate((piWssUrl) => {
      localStorage.setItem('AGENT_CHAT_PAIRED_DEVICE', JSON.stringify({
        deviceCredential: 'e2e-credential',
        adapterInstanceId: 'e2e-instance',
        adapterWssUrl: piWssUrl,
      }))
    }, PI_WSS_URL)
    await page.reload()
    await expect(page.getByRole('button', { name: '新建话题' })).toBeVisible({ timeout: 10_000 })

    await removeDevOverlay(page)
    await page.locator('[title="查看 Agent 连接状态"], [title="重新配对 Agent"]').first().click()
    await expect(page.getByRole('heading', { name: 'Agent 连接' })).toBeVisible({ timeout: 5_000 })

    await page.getByRole('button', { name: '清除配对' }).click()

    // clearPairing 会清 localStorage 并整页 reload → 回到配对引导屏
    await expect(page.getByRole('heading', { name: '连接到 Helm' })).toBeVisible({ timeout: 10_000 })
    const savedUrl = await page.evaluate(() => localStorage.getItem('PI_ADAPTER_WSS_URL'))
    expect(savedUrl).toBeNull()
  })

  // TC-036-09（保留）：刷新后从 localStorage 恢复配置
  test('TC-036-09: refresh recovers config from localStorage', async ({ page }) => {
    await seedAuth(page, { withPiConfig: true })
    await expect(page.getByRole('button', { name: '新建话题' })).toBeVisible({ timeout: 10_000 })

    await page.reload()
    await expect(page.getByRole('button', { name: '新建话题' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('heading', { name: '连接到 Helm' })).not.toBeVisible()
  })
})
