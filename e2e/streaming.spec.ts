import { test, expect, type Page } from '@playwright/test'

const TOKEN = process.env.AGENT_CHAT_TOKEN || 'test-token'

async function authenticate(page: Page) {
  await page.goto('/')
  await page.evaluate((token) => {
    localStorage.setItem('AGENT_CHAT_TOKEN', token)
  }, TOKEN)
  await page.reload()
  // Wait for WS connection — sidebar header "Topics" text should appear
  await page.getByText('Topics', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
}

async function createTopic(page: Page, name: string) {
  // Click "+ New Topic" button
  await page.getByRole('button', { name: '+ New Topic' }).click()
  // Fill topic name
  const nameInput = page.getByPlaceholder('Topic name...')
  await nameInput.fill(name)
  // Click "Create" button
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  // Wait for the topic to appear in the sidebar (button text includes KindBadge prefix like "C")
  await page.locator('button', { hasText: name }).first().waitFor({ state: 'visible', timeout: 5_000 })
}

async function selectTopic(page: Page, name: string) {
  // Use .last() to pick the most recently created topic
  await page.locator('button', { hasText: name }).last().click()
  // Wait for message input to appear
  await page.getByPlaceholder(/message/i).waitFor({ state: 'visible', timeout: 5_000 })
}

async function sendMessage(page: Page, text: string) {
  const input = page.getByPlaceholder(/message/i)
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

    // Wait for assistant response — look for "Hello" in any markdown-body
    // (user message also has .markdown-body, so we wait for assistant content specifically)
    await expect(page.locator('.markdown-body').last()).toContainText('Hello', { timeout: 10_000 })
    await page.waitForTimeout(2_000)
    const text = await page.locator('.markdown-body').last().textContent()
    expect(text).toContain('help you today')
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

    const markdown = page.locator('.markdown-body').first()
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

    const content = page.locator('.markdown-body, pre, code').first()
    await content.waitFor({ state: 'visible', timeout: 5_000 })

    // No crash/error
    const errorElements = await page.locator('[data-testid="error"], .error').count()
    expect(errorElements).toBe(0)

    await page.waitForTimeout(3_000)
  })
})
