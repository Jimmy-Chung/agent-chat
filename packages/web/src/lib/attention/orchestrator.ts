// S3 (AIT-221) 编排核心（纯逻辑，可单测）：
// - planInterpret：决定"何时调 interpret"（turn 落定 + 缓存命中守门，守成本红线）
// - buildTrace：candidates(+可选 LLM 结果) → TraceNode[]（无 LLM 时 cosine + 本地摘要兜底）
// - buildInterpretPrompt / callInterpret：组 prompt + 调 S2 server 代理
import type { CandidateNode } from './aggregator'
import type { GoalAnchor, TraceNode } from './types'
import { computeGoalDistance, goalAlignmentToDistance } from './goal-distance'

export interface InterpretResult {
  conclusion: string[]
  goalAlignment: number[]
}

export function candidateText(c: CandidateNode): string {
  const tools = c.tools.map((t) => String((t.payload as Record<string, unknown>).name ?? '')).join(' ')
  const msgs = c.messages.map((m) => String((m.payload as Record<string, unknown>).text ?? '')).join(' ')
  return [c.user_message, msgs, tools].join(' ')
}

/** 本地兜底结论：优先该回合 AI 摘要，否则截断 user_message。 */
export function localSummary(c: CandidateNode): string {
  const ex = c.exchanges[c.exchanges.length - 1]
  const s = ex?.assistant_summary?.trim()
  if (s && s !== '无明确 AI 回复') return s
  return c.user_message.slice(0, 15)
}

export function makeInterpretKey(candidateCount: number, lastEventTs: number): string {
  return `${candidateCount}:${lastEventTs}`
}

/**
 * 何时调 interpret：只在 agent 回到 idle（turn 落定）且轨迹有变化（cacheKey 与上次不同）时调一次。
 * delta/处理中（agentStatus !== 'idle'）一律不调 → 守住"每落定一次只调一次"的成本红线。
 */
export function planInterpret(input: {
  candidateCount: number
  lastEventTs: number
  agentStatus: string
  lastInterpretedKey: string | null
}): { shouldCall: boolean; cacheKey: string } {
  const cacheKey = makeInterpretKey(input.candidateCount, input.lastEventTs)
  const idle = input.agentStatus === 'idle'
  const shouldCall = idle && input.candidateCount > 0 && cacheKey !== input.lastInterpretedKey
  return { shouldCall, cacheKey }
}

/**
 * candidates → TraceNode[]。
 * 有 LLM 结果用 conclusion + goalAlignment 映射；否则 cosine 目标距离 + 本地摘要兜底。
 * inProgress 时最后一个节点标记为「分析中」（running / is_loading）。
 */
export function buildTrace(
  candidates: CandidateNode[],
  goalAnchor: GoalAnchor | null,
  interpret: InterpretResult | null,
  opts: { inProgress?: boolean } = {},
): TraceNode[] {
  const goalText = goalAnchor?.normalized_goal ?? ''
  const lastIdx = candidates.length - 1
  return candidates.map((c, i) => {
    const llmConclusion = interpret?.conclusion[i]
    const hasLlm = typeof llmConclusion === 'string' && llmConclusion.trim().length > 0
    const conclusion = hasLlm ? (llmConclusion as string) : localSummary(c)
    const goal_distance = hasLlm
      ? goalAlignmentToDistance(interpret?.goalAlignment[i] ?? 5)
      : computeGoalDistance(goalText, candidateText(c))
    const isInProgressNode = !!opts.inProgress && i === lastIdx
    return {
      id: c.id,
      parent_id: null,
      branch_id: 'main',
      user_message: c.user_message,
      intent: '',
      rationale: null,
      conclusion,
      planned_ref: null,
      alignment: 'unplanned',
      goal_distance,
      status: isInProgressNode ? 'running' : 'done',
      event_ids: [...c.thinking, ...c.tools, ...c.messages].map((e) => e.id),
      step_count: c.tools.length,
      user_kind: c.user_kind,
      assistant_actions: c.assistant_actions,
      user_message_count: c.user_messages.length,
      exchanges: c.exchanges,
      ts_start: c.ts_start,
      ts_end: c.ts_end,
      is_loading: isInProgressNode && !hasLlm,
    }
  })
}

export function buildInterpretPrompt(candidates: CandidateNode[], goalAnchor: GoalAnchor | null): string {
  const lines: string[] = [`总目标：「${goalAnchor?.normalized_goal ?? '（未知）'}」`, '']
  candidates.forEach((c, i) => {
    const tools = c.tools
      .slice(0, 5)
      .map((t) => String((t.payload as Record<string, unknown>).name ?? ''))
      .filter(Boolean)
      .join(', ')
    const reply = c.exchanges[c.exchanges.length - 1]?.assistant_summary ?? ''
    lines.push(`[${i}] 用户：「${c.user_message.slice(0, 80)}」`)
    if (tools) lines.push(`    工具：${tools}`)
    if (reply) lines.push(`    回复：「${reply.slice(0, 80)}」`)
  })
  lines.push('', '请按节点顺序输出 JSON：{"nodes":[{"conclusion":"≤15字","goalAlignment":0-10}, ...]}')
  return lines.join('\n')
}

/** 调 S2 server 代理。任何失败（含 degraded）→ null（调用方走 cosine fallback）。 */
export async function callInterpret(
  prompt: string,
  opts: { serverBase: string; token?: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<InterpretResult | null> {
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
    const data = (await res.json()) as {
      ok?: boolean
      conclusion?: string[]
      goalAlignment?: number[]
    }
    if (!data.ok || !Array.isArray(data.conclusion) || !Array.isArray(data.goalAlignment)) return null
    return { conclusion: data.conclusion, goalAlignment: data.goalAlignment }
  } catch {
    return null
  }
}
