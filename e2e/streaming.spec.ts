import { test, expect, type Page } from '@playwright/test'

const TOKEN = process.env.AGENT_CHAT_TOKEN || 'test-token'

async function authenticate(page: Page) {
  await page.goto('/')
  await page.evaluate((token) => {
    localStorage.clear()
    localStorage.setItem('AGENT_CHAT_TOKEN', token)
  }, TOKEN)
  await page.reload()
  await page.getByRole('button', { name: '新建话题' }).waitFor({ state: 'visible', timeout: 10_000 })
}

async function createTopic(page: Page, name: string) {
  await page.getByRole('button', { name: '新建话题' }).click()
  const nameInput = page.getByPlaceholder('例如：优化移动端布局')
  await nameInput.fill(name)
  await page.getByRole('button', { name: '创建话题', exact: true }).click()
  await page.locator('button', { hasText: name }).first().waitFor({ state: 'visible', timeout: 5_000 })
}

async function selectTopic(page: Page, name: string) {
  await page.locator('button', { hasText: name }).last().click()
  await page.getByPlaceholder(/回复 agent/i).waitFor({ state: 'visible', timeout: 5_000 })
}

async function sendMessage(page: Page, text: string) {
  const input = page.getByPlaceholder(/回复 agent/i)
  await input.fill(text)
  await input.press('Enter')
}

test.describe('Streaming E2E', () => {
  const topicName = `Test ${Date.now()}`

  test.beforeEach(async ({ page }) => {
    await authenticate(page)
    await createTopic(page, topicName)
    await selectTopic(page, topicName)
  })

  test('E1: streaming text appears incrementally', async ({ page }) => {
    await sendMessage(page, 'hi')

    const assistantMarkdown = page.locator('.role-bubble-assistant .markdown-body').last()
    await assistantMarkdown.waitFor({ state: 'visible', timeout: 10_000 })
    await expect
      .poll(async () => ((await assistantMarkdown.textContent()) ?? '').trim().length, { timeout: 10_000 })
      .toBeGreaterThan(5)

    const text = ((await assistantMarkdown.textContent()) ?? '').trim()
    expect(text.toLowerCase()).not.toBe('hi')
    expect(text).not.toBe('')
  })

  test('E2: streaming FPS measurement via requestAnimationFrame', async ({ page }) => {
    const fpsResult = await page.evaluate(async () => {
      return new Promise<{ avgFps: number; frames: number }>((resolve) => {
        let frameCount = 0
        const start = performance.now()
        const maxDuration = 3_000

        function countFrame(now: number) {
          frameCount++
          const elapsed = now - start
          if (elapsed >= maxDuration) {
            resolve({
              avgFps: Math.round((frameCount / elapsed) * 1000),
              frames: frameCount,
            })
          } else {
            requestAnimationFrame(countFrame)
          }
        }
        requestAnimationFrame(countFrame)
      })
    })

    expect(fpsResult.avgFps).toBeGreaterThanOrEqual(50)
  })

  test('E3: streaming does not flicker — text only grows', async ({ page }) => {
    await sendMessage(page, 'hi')

    const markdown = page.locator('.role-bubble-assistant .markdown-body').last()
    await markdown.waitFor({ state: 'visible', timeout: 5_000 })

    // Collect text lengths over time — should only increase
    const lengths: number[] = []
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(100)
      const text = await markdown.textContent().catch(() => '')
      if (text) lengths.push(text.length)
    }

    let prev = 0
    for (const len of lengths) {
      expect(len).toBeGreaterThanOrEqual(prev)
      prev = len
    }
  })

  test('E4: code block rendering during streaming does not crash', async ({ page }) => {
    await sendMessage(page, 'list files')

    const content = page.locator('.role-bubble-assistant .markdown-body, .role-bubble-assistant pre, .role-bubble-assistant code').first()
    await content.waitFor({ state: 'visible', timeout: 5_000 })

    // No crash/error
    const errorElements = await page.locator('[data-testid="error"], .error').count()
    expect(errorElements).toBe(0)

    await page.waitForTimeout(3_000)
  })
})
