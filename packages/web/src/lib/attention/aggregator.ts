// 迁自 new-idea/attendtion-tracking/src/pipeline/aggregator.ts（纯函数，仅改 import 路径）
// 事件 → 候选决策节点（≤12）+ planItems。不依赖 LLM、不渲染。
import type {
  RawEvent,
  TraceNode,
  PlanItem,
  AssistantActionKind,
  UserMessageKind,
  TraceExchange,
} from './types'

export type CandidateNode = {
  id: string
  // 用户侧
  user_message: string // 用户的原话（节点的主体）
  user_messages: string[]
  user_kind: UserMessageKind
  exchanges: TraceExchange[]
  turn_id: string
  // 模型侧（为响应该用户消息所做的所有事）
  thinking: RawEvent[]
  tools: RawEvent[]
  messages: RawEvent[] // 模型的文字回复
  assistant_actions: AssistantActionKind[]
  ts_start: number
  ts_end: number
}

let _counter = 0
const nextId = () => `cand_${++_counter}`

export function aggregate(events: RawEvent[]): {
  candidates: CandidateNode[]
  planItems: PlanItem[]
} {
  _counter = 0
  const planItems: PlanItem[] = []
  let planItemCounter = 0

  // ── 提取计划条目 ──────────────────────────────────────────────────────────
  for (const evt of events) {
    if (evt.kind === 'plan' || evt.kind === 'message') {
      const items = evt.payload.items as
        | Array<{ id: string; text: string; status: string; depth: number }>
        | undefined
      if (items?.length) {
        for (const item of items) {
          planItems.push({
            id: `pi_${++planItemCounter}`,
            text: item.text,
            status: 'pending',
            depth: item.depth ?? 0,
          })
        }
      }
    }
    if (evt.kind === 'todo') {
      const input = evt.payload.input as Record<string, unknown> | undefined
      const todoItems = input?.todos as Array<{ content?: string; status?: string }> | undefined
      if (todoItems) {
        for (const item of todoItems) {
          planItems.push({
            id: `pi_${++planItemCounter}`,
            text: item.content ?? String(item),
            status:
              item.status === 'completed'
                ? 'completed'
                : item.status === 'in_progress'
                  ? 'in_progress'
                  : 'pending',
            depth: 0,
          })
        }
      }
    }
  }

  // ── 以用户消息为边界，分组所有事件 ─────────────────────────────────────────
  const userMsgEvents = events.filter(
    (e) => e.kind === 'message' && e.role === 'user' && isHumanMessage(e.payload.text as string),
  )

  if (userMsgEvents.length === 0) {
    return {
      candidates: fallbackSingleCandidate(events),
      planItems: compactPlanItems(planItems),
    }
  }

  const turns: CandidateNode[] = []

  let currentUserEvt: RawEvent | null = null
  let currentThinking: RawEvent[] = []
  let currentTools: RawEvent[] = []
  let currentMessages: RawEvent[] = []
  let groupIndex = 0
  let lastAiSummary: string | null = null

  const flushGroup = () => {
    if (!currentUserEvt) return
    const userText = (currentUserEvt.payload.text as string | undefined) ?? ''
    const allTs = [
      currentUserEvt.ts,
      ...currentThinking.map((e) => e.ts),
      ...currentTools.map((e) => e.ts),
      ...currentMessages.map((e) => e.ts),
    ]
    const exchange = buildExchange(
      currentUserEvt,
      currentThinking,
      currentTools,
      currentMessages,
      lastAiSummary,
    )
    lastAiSummary = exchange.assistant_summary
    turns.push({
      id: nextId(),
      user_message: userText,
      user_messages: [userText],
      user_kind: getUserKind(currentUserEvt),
      exchanges: [exchange],
      turn_id: currentUserEvt.turn_id ?? `user_${groupIndex}`,
      thinking: currentThinking,
      tools: currentTools,
      messages: currentMessages,
      assistant_actions: getAssistantActions(currentMessages),
      ts_start: currentUserEvt.ts,
      ts_end: Math.max(...allTs),
    })
    groupIndex++
  }

  for (const evt of events) {
    const isNewUserMsg =
      evt.kind === 'message' &&
      evt.role === 'user' &&
      isHumanMessage(evt.payload.text as string)

    if (isNewUserMsg) {
      flushGroup()
      currentUserEvt = evt
      currentThinking = []
      currentTools = []
      currentMessages = []
    } else if (currentUserEvt) {
      if (evt.kind === 'thinking') currentThinking.push(evt)
      else if (evt.kind === 'tool_use' || evt.kind === 'todo') currentTools.push(evt)
      else if (evt.kind === 'message' && evt.role === 'assistant') currentMessages.push(evt)
    }
  }
  flushGroup()

  return { candidates: compactTurnsToPhases(turns), planItems: compactPlanItems(planItems) }
}

// 判断是否是真实的人类输入（兜底过滤系统注入文本；主判定靠 role，见 store-adapter）
function isHumanMessage(text: string | undefined): boolean {
  if (!text?.trim()) return false
  const t = text.trim()
  if (t.startsWith('<')) return false
  if (t.startsWith('{') || t.startsWith('[')) return false
  return true
}

function fallbackSingleCandidate(events: RawEvent[]): CandidateNode[] {
  if (events.length === 0) return []
  const allTs = events.map((e) => e.ts)
  return [
    {
      id: nextId(),
      user_message: '（无用户消息）',
      user_messages: ['（无用户消息）'],
      user_kind: 'instruction',
      exchanges: [
        {
          id: 'exchange_unknown',
          user_message: '（无用户消息）',
          user_kind: 'instruction',
          assistant_summary: summarizeAssistantActivity(
            events.filter((e) => e.kind === 'message'),
            events.filter((e) => e.kind === 'tool_use' || e.kind === 'todo'),
          ),
          assistant_actions: getAssistantActions(events.filter((e) => e.kind === 'message')),
          event_ids: events.filter((e) => e.role !== 'user').map((e) => e.id),
          tool_count: events.filter((e) => e.kind === 'tool_use' || e.kind === 'todo').length,
          ts_start: Math.min(...allTs),
          ts_end: Math.max(...allTs),
        },
      ],
      turn_id: 'unknown',
      thinking: events.filter((e) => e.kind === 'thinking'),
      tools: events.filter((e) => e.kind === 'tool_use' || e.kind === 'todo'),
      messages: events.filter((e) => e.kind === 'message'),
      assistant_actions: getAssistantActions(events.filter((e) => e.kind === 'message')),
      ts_start: Math.min(...allTs),
      ts_end: Math.max(...allTs),
    },
  ]
}

function buildExchange(
  userEvt: RawEvent,
  thinking: RawEvent[],
  tools: RawEvent[],
  messages: RawEvent[],
  prevAiSummary: string | null = null,
): TraceExchange {
  const userMessage = (userEvt.payload.text as string | undefined) ?? ''
  const eventIds = [
    ...thinking.map((e) => e.id),
    ...tools.map((e) => e.id),
    ...messages.map((e) => e.id),
  ]
  const allTs = [
    userEvt.ts,
    ...thinking.map((e) => e.ts),
    ...tools.map((e) => e.ts),
    ...messages.map((e) => e.ts),
  ]
  return {
    id: `ex_${userEvt.id}`,
    user_message: userMessage,
    user_kind: getUserKind(userEvt),
    prev_ai_summary: prevAiSummary ?? undefined,
    assistant_summary: summarizeAssistantActivity(messages, tools),
    assistant_actions: getAssistantActions(messages),
    event_ids: eventIds,
    tool_count: tools.length,
    ts_start: Math.min(...allTs),
    ts_end: Math.max(...allTs),
  }
}

function summarizeAssistantActivity(messages: RawEvent[], tools: RawEvent[]): string {
  const texts = messages
    .map((m) => (m.payload.text as string | undefined) ?? '')
    .filter((t) => t.trim().length > 0)
  if (texts.length > 0) {
    const combined = texts.join(' ')
    return compactText(combined, 520)
  }
  if (tools.length) {
    const names = tools
      .slice(0, 3)
      .map((t) => (t.payload.name as string | undefined) ?? '工具')
      .join('、')
    return `调用 ${names}${tools.length > 3 ? ` 等 ${tools.length} 个工具` : ''}`
  }
  return '无明确 AI 回复'
}

function compactText(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function compactPlanItems(items: PlanItem[], maxItems = 80): PlanItem[] {
  const seen = new Set<string>()
  const compacted: PlanItem[] = []
  for (const item of items) {
    const text = item.text.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    compacted.push({ ...item, text })
    if (compacted.length >= maxItems) break
  }
  return compacted.map((item, index) => ({ ...item, id: `pi_${index + 1}` }))
}

function getUserKind(evt: RawEvent): UserMessageKind {
  return (evt.payload.user_kind as UserMessageKind | undefined) ?? 'instruction'
}

function getAssistantActions(messages: RawEvent[]): AssistantActionKind[] {
  const actions = new Set<AssistantActionKind>()
  for (const msg of messages) {
    const action = msg.payload.assistant_action as AssistantActionKind | undefined
    if (action) actions.add(action)
  }
  return [...actions]
}

function isLowSignalUserMessage(text: string, kind: UserMessageKind): boolean {
  const t = text.trim()
  if (kind === 'choice' || kind === 'evidence') return true
  if (t.length <= 18) return true
  if (/^(轮询|继续|有新评论|现在应该可以了|Logs?|ok|OK)$/i.test(t)) return true
  if (/^[0-9a-f-]{20,}$/i.test(t)) return true
  return false
}

function isNewDecisionBoundary(prev: CandidateNode, next: CandidateNode): boolean {
  const gapMs = next.ts_start - prev.ts_end
  if (isLowSignalUserMessage(next.user_message, next.user_kind)) return false
  if (next.user_kind === 'question') return true
  if (next.user_kind === 'proposal') return true
  if (gapMs > 20 * 60 * 1000) return true
  return prev.tools.length + prev.messages.length > 12
}

function mergeCandidates(a: CandidateNode, b: CandidateNode): CandidateNode {
  const userMessages = [...a.user_messages, ...b.user_messages]
  const assistantActions = new Set<AssistantActionKind>([
    ...a.assistant_actions,
    ...b.assistant_actions,
  ])
  return {
    ...a,
    user_message: summarizeUserMessages(userMessages),
    user_messages: userMessages,
    user_kind: mergeUserKind(a.user_kind, b.user_kind),
    thinking: [...a.thinking, ...b.thinking],
    tools: [...a.tools, ...b.tools],
    messages: [...a.messages, ...b.messages],
    assistant_actions: [...assistantActions],
    exchanges: [...a.exchanges, ...b.exchanges],
    ts_end: Math.max(a.ts_end, b.ts_end),
  }
}

function mergeUserKind(a: UserMessageKind, b: UserMessageKind): UserMessageKind {
  const rank: Record<UserMessageKind, number> = {
    question: 5,
    proposal: 4,
    choice: 3,
    instruction: 2,
    evidence: 1,
  }
  return rank[b] > rank[a] ? b : a
}

function summarizeUserMessages(messages: string[]): string {
  if (messages.length <= 3) return messages.join('\n↳ ')
  const head = messages.slice(0, 2).join('\n↳ ')
  const tail = messages[messages.length - 1]
  return `${head}\n↳ …另外 ${messages.length - 3} 条用户补充/选择\n↳ ${tail}`
}

function compactTurnsToPhases(turns: CandidateNode[], maxPhases = 12): CandidateNode[] {
  if (turns.length <= maxPhases) return turns

  const initialPhases: CandidateNode[] = []
  for (const turn of turns) {
    const prev = initialPhases[initialPhases.length - 1]
    if (!prev || isNewDecisionBoundary(prev, turn)) {
      initialPhases.push(turn)
    } else {
      initialPhases[initialPhases.length - 1] = mergeCandidates(prev, turn)
    }
  }

  if (initialPhases.length <= maxPhases) {
    return initialPhases.map((p, i) => ({ ...p, id: `cand_${i + 1}` }))
  }

  const phases: CandidateNode[] = []
  for (let i = 0; i < maxPhases; i++) {
    const start = Math.floor((i * initialPhases.length) / maxPhases)
    const end = Math.floor(((i + 1) * initialPhases.length) / maxPhases)
    const bucket = initialPhases.slice(start, Math.max(start + 1, end))
    phases.push(bucket.reduce((acc, item) => mergeCandidates(acc, item)))
  }

  return phases.map((p, i) => ({ ...p, id: `cand_${i + 1}` }))
}

// ── Exchange grouping for recursive drill-down ────────────────────────────────

export type ExchangeGroup = {
  id: string
  exchanges: TraceExchange[]
  user_message: string
  user_kind: UserMessageKind
  assistant_summary: string
  tool_count: number
  ts_start: number
  ts_end: number
  prev_ai_summary?: string
}

function mergeUserKindForGroup(kinds: UserMessageKind[]): UserMessageKind {
  const rank: Record<UserMessageKind, number> = {
    question: 5,
    proposal: 4,
    choice: 3,
    instruction: 2,
    evidence: 1,
  }
  return kinds.reduce((a, b) => (rank[b] > rank[a] ? b : a))
}

export function groupExchanges(exchanges: TraceExchange[], maxGroups = 12): ExchangeGroup[] {
  if (!exchanges.length) return []

  const semanticGroups: TraceExchange[][] = []
  let current: TraceExchange[] = []

  for (const ex of exchanges) {
    const isNewBoundary =
      (ex.user_kind === 'question' || ex.user_kind === 'proposal') && current.length > 0
    if (isNewBoundary && semanticGroups.length < maxGroups - 1) {
      semanticGroups.push(current)
      current = [ex]
    } else {
      current.push(ex)
    }
  }
  if (current.length) semanticGroups.push(current)

  const rawGroups =
    semanticGroups.length <= maxGroups
      ? semanticGroups
      : Array.from({ length: maxGroups }, (_, i) => {
          const start = Math.floor((i * exchanges.length) / maxGroups)
          const end = Math.floor(((i + 1) * exchanges.length) / maxGroups)
          return exchanges.slice(start, Math.max(start + 1, end))
        })

  return rawGroups.map((group, i) => {
    const representative = [...group].sort((a, b) => {
      const rank: Record<UserMessageKind, number> = {
        question: 5,
        proposal: 4,
        instruction: 3,
        choice: 2,
        evidence: 1,
      }
      return rank[b.user_kind] - rank[a.user_kind]
    })[0]

    return {
      id: `grp_${i}_${group[0].id}`,
      exchanges: group,
      user_message: representative.user_message,
      user_kind: mergeUserKindForGroup(group.map((e) => e.user_kind)),
      assistant_summary: group[group.length - 1].assistant_summary,
      tool_count: group.reduce((s, e) => s + e.tool_count, 0),
      ts_start: group[0].ts_start,
      ts_end: group[group.length - 1].ts_end,
      prev_ai_summary: group[0].prev_ai_summary,
    }
  })
}

// ── Loading placeholder ───────────────────────────────────────────────────────

export function candidatesToLoadingNodes(candidates: CandidateNode[]): TraceNode[] {
  const allEventIds = candidates.flatMap((c) => [
    ...c.thinking.map((e) => e.id),
    ...c.tools.map((e) => e.id),
    ...c.messages.map((e) => e.id),
  ])
  const allTs = candidates.flatMap((c) => [c.ts_start, c.ts_end])
  return [
    {
      id: 'loading_placeholder',
      parent_id: null,
      branch_id: 'main',
      user_message: candidates[0]?.user_message ?? '',
      intent: '',
      rationale: null,
      conclusion: null,
      planned_ref: null,
      alignment: 'unplanned' as const,
      goal_distance: 0.5,
      status: 'running' as const,
      event_ids: allEventIds,
      step_count: candidates.length,
      user_kind: candidates[0]?.user_kind,
      assistant_actions: [...new Set(candidates.flatMap((c) => c.assistant_actions))],
      user_message_count: candidates.reduce((sum, c) => sum + c.user_messages.length, 0),
      exchanges: candidates.flatMap((c) => c.exchanges),
      ts_start: Math.min(...allTs),
      ts_end: Math.max(...allTs),
      is_loading: true,
    },
  ]
}
