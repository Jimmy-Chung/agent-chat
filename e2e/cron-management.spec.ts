import { type Page, expect, test } from '@playwright/test'

const TOKEN = process.env.AGENT_CHAT_TOKEN || 'test-token'
const PI_WSS_URL = process.env.PI_WSS_URL || 'ws://127.0.0.1:7331/api/agent-chat/v1/socket'
const PI_TOKEN = process.env.PI_TOKEN || 'test-token'

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

/** Call a PI RPC directly against mock-pi (the same instance the server talks to). */
async function piRpc(page: Page, method: string, params: unknown): Promise<unknown> {
  return page.evaluate(
    async ({ wssUrl, piToken, rpcMethod, rpcParams }) => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wssUrl}?token=${piToken}`)
        const id = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const timer = setTimeout(() => {
          ws.close()
          reject(new Error(`pi rpc timeout: ${rpcMethod}`))
        }, 8_000)
        ws.onopen = () => {
          ws.send(JSON.stringify({ v: 1, t: 'rpc', id, d: { method: rpcMethod, params: rpcParams } }))
        }
        ws.onmessage = (event) => {
          const frame = JSON.parse(String(event.data)) as {
            t: string
            id?: string
            d?: { result?: unknown; code?: string; message?: string }
          }
          if (frame.id !== id) return
          clearTimeout(timer)
          ws.close()
          if (frame.t === 'rpc.result') resolve(frame.d?.result)
          else if (frame.t === 'rpc.error') reject(new Error(`${frame.d?.code}: ${frame.d?.message}`))
        }
        ws.onerror = () => {
          clearTimeout(timer)
          reject(new Error('pi rpc ws error'))
        }
      })
    },
    { wssUrl: PI_WSS_URL, piToken: PI_TOKEN, rpcMethod: method, rpcParams: params },
  )
}

async function openCronAdmin(page: Page) {
  await page.getByRole('button', { name: /定时任务管理/ }).first().click()
}

// Tests share one server/DO/D1 (workers: 1), so crons accumulate across tests.
// Scope every action to the card carrying this test's unique prompt.
function cronCard(page: Page, prompt: string) {
  return page.locator('.glass-1').filter({ hasText: prompt })
}

test.describe('Cron management E2E (AIT-263 / AIT-264)', () => {
  // TC-263-01 — edit a cron's prompt; the list reflects the new prompt.
  test('editing a cron prompt updates the list (TC-263-01)', async ({ page }) => {
    await authenticate(page)
    const originalPrompt = `E2E cron ${Date.now()}`
    const newPrompt = `${originalPrompt} EDITED`
    await piRpc(page, 'createCron', {
      originSessionId: 'e2e-edit-sess',
      cronExpr: '0 9 * * *',
      prompt: originalPrompt,
    })

    await openCronAdmin(page)
    await expect(page.getByText(originalPrompt)).toBeVisible({ timeout: 10_000 })

    await cronCard(page, originalPrompt).getByRole('button', { name: '编辑' }).click()
    const modal = page.getByText('编辑定时任务').locator('..')
    await modal.locator('textarea').fill(newPrompt)
    await page.getByRole('button', { name: '保存' }).click()

    await expect(page.getByText(newPrompt)).toBeVisible({ timeout: 10_000 })
  })

  // TC-263-04 — an invalid cron expression is rejected; original task is intact.
  test('an invalid cron expression shows an error and does not corrupt the task (TC-263-04)', async ({
    page,
  }) => {
    await authenticate(page)
    const prompt = `E2E invalid ${Date.now()}`
    await piRpc(page, 'createCron', {
      originSessionId: 'e2e-invalid-sess',
      cronExpr: '0 9 * * *',
      prompt,
    })

    await openCronAdmin(page)
    await expect(page.getByText(prompt)).toBeVisible({ timeout: 10_000 })

    await cronCard(page, prompt).getByRole('button', { name: '编辑' }).click()
    const modal = page.getByText('编辑定时任务').locator('..')
    // Cron expression input is the monospace text input in the modal.
    await modal.locator('input').first().fill('not-a-cron')
    await page.getByRole('button', { name: '保存' }).click()

    // Error toast surfaces the adapter's cron_invalid rejection.
    await expect(page.getByText('定时任务参数无效')).toBeVisible({ timeout: 10_000 })
    // Original task is untouched: its card still shows the original expression.
    await expect(cronCard(page, prompt).getByText('0 9 * * *')).toBeVisible()
  })

  // TC-264-01 — run history lists records newest-first with status/error.
  test('run history shows records newest-first (TC-264-01)', async ({ page }) => {
    await authenticate(page)
    const prompt = `E2E history ${Date.now()}`
    const created = (await piRpc(page, 'createCron', {
      originSessionId: 'e2e-hist-sess',
      cronExpr: '0 9 * * *',
      prompt,
    })) as { cronId: string }

    const now = Date.now()
    await piRpc(page, '__seedCronRuns', {
      cronId: created.cronId,
      runs: [
        { runId: 'run-new', firedAt: now, status: 'completed', success: true, durationMs: 1200 },
        { runId: 'run-old', firedAt: now - 3_600_000, status: 'failed', error: 'boom', durationMs: 500 },
      ],
    })

    await openCronAdmin(page)
    await expect(page.getByText(prompt)).toBeVisible({ timeout: 10_000 })

    const card = cronCard(page, prompt)
    await card.getByRole('button', { name: '历史' }).click()

    // Both runs render; the failed one surfaces its error.
    await expect(card.getByText('运行历史（最新在前）')).toBeVisible({ timeout: 10_000 })
    await expect(card.getByText('boom')).toBeVisible()
    await expect(card.getByText('成功')).toBeVisible()
  })
})
