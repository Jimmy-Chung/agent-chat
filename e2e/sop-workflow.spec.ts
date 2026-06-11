import { type Page, expect, test } from '@playwright/test'

const TOKEN = process.env.AGENT_CHAT_TOKEN || 'test-token'
const SERVER_WS_URL = process.env.E2E_WS_URL || 'ws://127.0.0.1:8787/ws'
const PI_WSS_URL = 'ws://127.0.0.1:7331/api/agent-chat/v1/socket'
const PI_TOKEN = 'test-token'

async function authenticate(page: Page) {
  await page.goto('/')
  await page.evaluate(
    ({ token, piWssUrl, piToken }) => {
      localStorage.clear()
      localStorage.setItem('AGENT_CHAT_TOKEN', token)
      localStorage.setItem('PI_ADAPTER_WSS_URL', piWssUrl)
      localStorage.setItem('PI_ADAPTER_TOKEN', piToken)
    },
    { token: TOKEN, piWssUrl: PI_WSS_URL, piToken: PI_TOKEN },
  )
  await page.reload()
  await page
    .getByRole('button', { name: '新建话题' })
    .waitFor({ state: 'visible', timeout: 10_000 })
}

/** Seed a SOP template over the app's own WS endpoint and wait for the list ack. */
async function seedSopTemplate(page: Page, name: string) {
  await page.evaluate(
    async ({ wsBase, token, sopName }) => {
      const wsUrl = `${wsBase}?token=${token}`
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl)
        const timer = setTimeout(
          () => reject(new Error('seed sop timeout')),
          8_000,
        )
        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              v: 1,
              t: 'sop_template.create',
              d: {
                name: sopName,
                agent_type: 'any',
                instruction:
                  '步骤 1：确认输入\n步骤 2：执行任务\n步骤 3：校验产出',
                output_contract: '交付可复用结果',
                plan_template: '1. 确认输入\n2. 执行任务\n3. 校验产出',
              },
            }),
          )
        }
        ws.onmessage = (event) => {
          const frame = JSON.parse(String(event.data)) as {
            t: string
            d?: { templates?: Array<{ name: string }> }
          }
          if (
            frame.t === 'sop_template.list' &&
            frame.d?.templates?.some((t) => t.name === sopName)
          ) {
            clearTimeout(timer)
            ws.close()
            resolve()
          }
        }
        ws.onerror = () => {
          clearTimeout(timer)
          reject(new Error('seed sop ws error'))
        }
      })
    },
    { wsBase: SERVER_WS_URL, token: TOKEN, sopName: name },
  )
}

// TC-249-06 — SOP 落库后在新建话题下拉可见，可选中并组合创建话题。
test.describe('SOP workflow E2E', () => {
  test('saved SOP is selectable in the new-topic modal and the topic is created with it', async ({
    page,
  }) => {
    const sopName = `E2E SOP ${Date.now()}`
    const topicName = `SOP 话题 ${Date.now()}`

    await authenticate(page)
    await seedSopTemplate(page, sopName)

    // Reload so the page WS picks up the latest template list on connect.
    await page.reload()
    await page
      .getByRole('button', { name: '新建话题' })
      .waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('button', { name: '新建话题' }).click()

    await page.getByPlaceholder('例如：优化移动端布局').fill(topicName)

    // The SOP workflow dropdown lists the seeded template; selecting it adds a chip.
    const sopSelect = page.locator('select', {
      has: page.locator('option', { hasText: '添加 SOP' }),
    })
    await expect(sopSelect).toBeVisible()
    await sopSelect.selectOption({ label: sopName })
    await expect(page.getByText(sopName)).toBeVisible()

    await page.getByRole('button', { name: '创建话题', exact: true }).click()
    await page
      .locator('button', { hasText: topicName })
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
  })
})
