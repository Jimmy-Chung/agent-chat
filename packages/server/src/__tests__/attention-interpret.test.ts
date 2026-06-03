import { describe, it, expect } from 'vitest'
import {
  interpretTrace,
  parseInterpretation,
  createAttentionRoutes,
  type AttentionLlmConfig,
} from '../routes/attention'
import type { AppConfig } from '../config'

const PATH = '/api/agent-chat/v1/attention/interpret'
const GOOD_LLM: AttentionLlmConfig = {
  apiKey: 'sk-test',
  baseUrl: 'https://llm.example.com/v1',
  model: 'test-model',
}

/** 构造一个最小 AppConfig（只有 token + attentionLlm 对本路由有意义）。 */
function cfg(over: Partial<AppConfig> = {}): AppConfig {
  return {
    token: 'secret',
    attentionLlm: { apiKey: '', baseUrl: '', model: '' },
    ...over,
  } as unknown as AppConfig
}

function openAiResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

// ── TC-AIT-220-01：未配置 secret → 降级，不 500 ──────────────────────────────
describe('TC-AIT-220-01 未配置降级', () => {
  it('interpretTrace 缺 key/baseUrl/model 时返回 degraded:not_configured', async () => {
    const r = await interpretTrace('prompt', { apiKey: '', baseUrl: '', model: '' })
    expect(r.ok).toBe(false)
    expect(r.degraded).toBe(true)
    expect(r.reason).toBe('not_configured')
  })

  it('路由未配置 LLM 时返回 200 + degraded（不 500）', async () => {
    const app = createAttentionRoutes(() => cfg())
    const res = await app.request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer secret' },
      body: JSON.stringify({ prompt: 'x' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { degraded?: boolean; reason?: string }
    expect(body.degraded).toBe(true)
    expect(body.reason).toBe('not_configured')
  })
})

// ── TC-AIT-220-02：正常 prompt → 调 OpenAI 兼容接口 → 解析返回 ────────────────
describe('TC-AIT-220-02 正常解析', () => {
  it('mock fetch 返回 JSON → conclusion/goalAlignment 正确', async () => {
    let calledUrl = ''
    let authHeader = ''
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calledUrl = String(url)
      authHeader = (init?.headers as Record<string, string>)?.Authorization ?? ''
      return openAiResponse('{"nodes":[{"conclusion":"修复端口泄漏","goalAlignment":9},{"conclusion":"跑偏查 schema","goalAlignment":3}]}')
    }) as unknown as typeof fetch

    const r = await interpretTrace('两个节点', GOOD_LLM, { fetchImpl, timeoutMs: 1000 })
    expect(r.ok).toBe(true)
    expect(r.conclusion).toEqual(['修复端口泄漏', '跑偏查 schema'])
    expect(r.goalAlignment).toEqual([9, 3])
    // 调到了正确的 OpenAI 兼容 endpoint，带 key
    expect(calledUrl).toBe('https://llm.example.com/v1/chat/completions')
    expect(authHeader).toBe('Bearer sk-test')
  })

  it('parseInterpretation 接受裸数组并对 goalAlignment 做 0-10 钳制', () => {
    const p = parseInterpretation('[{"conclusion":"a","goalAlignment":99},{"conclusion":"b","goalAlignment":-5}]')
    expect(p?.conclusion).toEqual(['a', 'b'])
    expect(p?.goalAlignment).toEqual([10, 0])
  })

  it('parseInterpretation 非法 JSON → null', () => {
    expect(parseInterpretation('not json')).toBeNull()
  })
})

// ── TC-AIT-220-03：上游超时 / 4xx → 降级 ─────────────────────────────────────
describe('TC-AIT-220-03 上游失败降级', () => {
  it('上游 4xx → degraded:upstream_429', async () => {
    const fetchImpl = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch
    const r = await interpretTrace('p', GOOD_LLM, { fetchImpl, timeoutMs: 1000 })
    expect(r.ok).toBe(false)
    expect(r.degraded).toBe(true)
    expect(r.reason).toBe('upstream_429')
  })

  it('超时 → degraded:timeout', async () => {
    const fetchImpl = (async () => {
      const e = new Error('The operation timed out')
      e.name = 'TimeoutError'
      throw e
    }) as unknown as typeof fetch
    const r = await interpretTrace('p', GOOD_LLM, { fetchImpl, timeoutMs: 1000 })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('timeout')
  })

  it('解析失败 → degraded:parse_error', async () => {
    const fetchImpl = (async () => openAiResponse('这不是 JSON')) as unknown as typeof fetch
    const r = await interpretTrace('p', GOOD_LLM, { fetchImpl, timeoutMs: 1000 })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('parse_error')
  })
})

// ── TC-AIT-220-04：无 / 错误 token → 401 ─────────────────────────────────────
describe('TC-AIT-220-04 鉴权', () => {
  it('缺 Authorization → 401', async () => {
    const app = createAttentionRoutes(() => cfg())
    const res = await app.request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  it('错误 token → 401', async () => {
    const app = createAttentionRoutes(() => cfg())
    const res = await app.request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer wrong' },
      body: JSON.stringify({ prompt: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  it('正确 token → 非 401（此处未配 LLM 故 200 degraded）', async () => {
    const app = createAttentionRoutes(() => cfg())
    const res = await app.request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer secret' },
      body: JSON.stringify({ prompt: 'x' }),
    })
    expect(res.status).toBe(200)
  })

  it('未配置 token（本地 dev）放行', async () => {
    const app = createAttentionRoutes(() => cfg({ token: '' }))
    const res = await app.request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
    })
    expect(res.status).toBe(200)
  })
})
