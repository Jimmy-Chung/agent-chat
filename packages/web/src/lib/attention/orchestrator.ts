export {
  buildInterpretPrompt,
  buildTrace,
  candidateText,
  localSummary,
  makeInterpretKey,
  planInterpret,
} from '@agent-chat/protocol'

export type {
  AttentionInterpretResult as InterpretResult,
} from '@agent-chat/protocol'

/** 兼容旧测试/调用方；Attention 面板主路径已改为 server rebuild。 */
export async function callInterpret(
  prompt: string,
  opts: { serverBase: string; token?: string; fetchImpl?: typeof fetch; timeoutMs?: number },
) {
  const doFetch = opts.fetchImpl ?? fetch
  try {
    const res = await doFetch(`${opts.serverBase}/api/agent-chat/v1/attention/interpret`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    })
    if (!res.ok) return null
    const data = await res.json() as {
      ok?: boolean
      conclusion?: string[]
      goalAlignment?: number[]
      userSummary?: string[]
      assistantSummary?: string[]
      aggregateTitle?: string[]
      sameTopic?: boolean[]
      closeCurrentTopic?: boolean[]
      nodeReason?: string[]
      normalizedGoal?: string
    }
    if (!data.ok || !Array.isArray(data.conclusion) || !Array.isArray(data.goalAlignment)) return null
    return {
      conclusion: data.conclusion,
      goalAlignment: data.goalAlignment,
      userSummary: Array.isArray(data.userSummary) ? data.userSummary : undefined,
      assistantSummary: Array.isArray(data.assistantSummary) ? data.assistantSummary : undefined,
      aggregateTitle: Array.isArray(data.aggregateTitle) ? data.aggregateTitle : undefined,
      sameTopic: Array.isArray(data.sameTopic) ? data.sameTopic : undefined,
      closeCurrentTopic: Array.isArray(data.closeCurrentTopic) ? data.closeCurrentTopic : undefined,
      nodeReason: Array.isArray(data.nodeReason) ? data.nodeReason : undefined,
      normalizedGoal: typeof data.normalizedGoal === 'string' ? data.normalizedGoal : undefined,
    }
  } catch {
    return null
  }
}
