// S1：把 agent-chat 的结构化 store 数据（Message[] + MessagePart[] + todos + plan）
// 转成 attention pipeline 所需的 RawEvent[]。替代原项目的 claudeCodeParser —— 无 JSONL
// 启发式，真实用户消息直接靠 Message.role 判定。
import type { Message, MessagePart } from '../domain'
import type { GoalAnchor, RawEvent, UserMessageKind } from './types'

export interface TodoSnapshotItem {
  id: string
  content: string
  status: string
  activeForm?: string
}

export interface StoreToRawEventsInput {
  /** 单个 topic 的消息（任意顺序，内部会按 started_at + id 排序）。 */
  messages: Message[]
  /** messageId → 该消息的 parts（任意顺序，内部按 ordinal 排序）。 */
  partsByMessage: Record<string, MessagePart[]>
  /** topic 下的 adapter 交互卡片（选择/审批），用于把用户选择纳入注意力轨迹。 */
  interactions?: AttentionInteraction[]
  /** topic 当前 todo 全量快照（todosByTopic[topicId]）。 */
  todos?: TodoSnapshotItem[]
  /** topic 当前 plan 文本快照（planByTopic[topicId]）。 */
  plan?: string
  /** 服务端已持久化的运行时事件，例如 adapter todo/plan update。 */
  runtimeEvents?: RawEvent[]
}

export interface AttentionInteraction {
  interactionId: string
  messageId?: string
  topicId: string
  interactionKind: string
  prompt: string
  options?: string[]
  status?: 'pending' | 'resolved' | 'timeout'
  response?: string
  defaultTimeoutMs?: number
}

interface ToolCallContent {
  toolUseId?: string
  name?: string
  input?: unknown
}
interface ToolResultContent {
  toolUseId?: string
  output?: unknown
  isError?: boolean
}

function safeParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

/** tool_result 的 output 是否承载有效信息（空串/空白/null → 无信息）。 */
function toolOutputHasContent(output: unknown): boolean {
  if (output == null) return false
  if (typeof output === 'string') return output.trim().length > 0
  return true
}

/** text / thinking part 的内容可能是裸字符串或 { content }。 */
function parseTextLike(json: string): string {
  const parsed = safeParse<unknown>(json)
  if (typeof parsed === 'string') return parsed
  if (parsed && typeof parsed === 'object') {
    const c = (parsed as Record<string, unknown>).content
    if (typeof c === 'string') return c
    const t = (parsed as Record<string, unknown>).text
    if (typeof t === 'string') return t
  }
  return ''
}

/**
 * 用户消息意图分类。role 只能告诉我们"是不是用户说的"，给不了意图类型，
 * 所以这块沿用原项目的启发式（中英文混合）。
 */
export function classifyUserKind(text: string): UserMessageKind {
  const t = text.trim()
  if (!t) return 'instruction'
  // 证据：粘贴的日志 / 报错 / 大段输出
  if (
    /(error|exception|stack trace|报错|日志|^\s*at\s)/im.test(t) &&
    t.length > 40
  )
    return 'evidence'
  // 选择 / 低信号确认
  if (/^(ok|okay|好的?|可以|是|否|yes|no|继续|对|嗯+|行|\d+|[a-d])$/i.test(t))
    return 'choice'
  // 提问
  if (
    /[?？]\s*$/.test(t) ||
    /(为什么|为啥|怎么|如何|是不是|能不能|可不可以|吗|what|why|how|whether)/i.test(
      t,
    )
  )
    return 'question'
  // 提议
  if (
    /(建议|不如|我觉得|我想|应该|要不|可以考虑|let's|let us|propose|suggest)/i.test(
      t,
    )
  )
    return 'proposal'
  return 'instruction'
}

/** 把 plan 文本快照拆成条目（按行，去掉常见 bullet / 序号前缀）。 */
export function planTextToItems(
  plan: string,
): Array<{ id: string; text: string; status: string; depth: number }> {
  return plan
    .split('\n')
    .map((line) => {
      const depth = Math.floor((line.match(/^\s*/)?.[0].length ?? 0) / 2)
      const text = line.replace(/^\s*(?:[-*+]|\d+[.)]|\[[ x]\])\s*/i, '').trim()
      return { text, depth }
    })
    .filter((x) => x.text.length > 0)
    .map((x, i) => ({
      id: `plan_${i + 1}`,
      text: x.text,
      status: 'pending',
      depth: x.depth,
    }))
}

/** Message.role → RawEvent.role：只有真实用户消息记为 'user'；system/cron 不记为 user/assistant。 */
function mapRole(role: Message['role']): 'user' | 'assistant' | undefined {
  if (role === 'user') return 'user'
  if (role === 'assistant') return 'assistant'
  return undefined // system / cron：不算真实用户，也不混进 assistant 回复
}

/**
 * 目标锚点 = topic 第一条 role='user' 消息的文本。
 * normalized_goal 首版直接取原文（LLM 归一化在 S2/S3）。
 */
export function extractGoalAnchor(
  input: StoreToRawEventsInput,
): GoalAnchor | null {
  const sorted = [...input.messages].sort(sortMessages)
  for (const msg of sorted) {
    if (msg.role !== 'user') continue
    const parts = (input.partsByMessage[msg.id] ?? [])
      .filter((p) => p.kind === 'text')
      .sort((a, b) => a.ordinal - b.ordinal)
    const text = parts
      .map((p) => parseTextLike(p.content_json))
      .join('\n')
      .trim()
    if (text)
      return { raw_query: text, normalized_goal: text, ts: msg.started_at }
  }
  return null
}

function sortMessages(a: Message, b: Message): number {
  if (a.started_at !== b.started_at) return a.started_at - b.started_at
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function compactText(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
}

function interactionAction(kind: string): string {
  if (kind === 'choice') return 'options'
  if (kind === 'approval') return 'ask'
  return 'ask'
}

export function storeToRawEvents(input: StoreToRawEventsInput): RawEvent[] {
  const events: RawEvent[] = []
  const toolUseById = new Map<string, RawEvent>()
  const messages = [...input.messages].sort(sortMessages)
  const messageTsById = new Map<string, number>()
  const messageTurnById = new Map<string, string | null>()
  let maxTs = 0

  for (const msg of messages) {
    const role = mapRole(msg.role)
    const baseTs = msg.started_at
    maxTs = Math.max(maxTs, baseTs, msg.finished_at ?? 0)
    messageTsById.set(msg.id, baseTs)
    messageTurnById.set(msg.id, msg.turn_id)
    const parts = [...(input.partsByMessage[msg.id] ?? [])].sort(
      (a, b) => a.ordinal - b.ordinal,
    )

    for (const part of parts) {
      // 同一消息内用 ordinal 做亚序，保证 ts 单调、turn 内顺序稳定
      const ts = baseTs + part.ordinal

      if (part.kind === 'text') {
        const text = parseTextLike(part.content_json)
        if (!text.trim()) continue
        const payload: Record<string, unknown> = { text, role: msg.role }
        if (role === 'user') payload.user_kind = classifyUserKind(text)
        events.push({
          id: part.id,
          ts,
          kind: 'message',
          role,
          message_id: msg.id,
          turn_id: msg.turn_id ?? undefined,
          payload,
        })
      } else if (part.kind === 'thinking') {
        const text = parseTextLike(part.content_json)
        if (!text.trim()) continue
        events.push({
          id: part.id,
          ts,
          kind: 'thinking',
          role,
          message_id: msg.id,
          turn_id: msg.turn_id ?? undefined,
          payload: { text },
        })
      } else if (part.kind === 'tool_use') {
        const call = safeParse<ToolCallContent>(part.content_json)
        // 跳过未完成的 tool_input 流式片段（{kind:'tool_input',toolUseId,partial}）：
        // 它没有 name/input，只是残留片段，落进来会变成 name:'工具' 的空工具事件，
        // 污染注意力节点生成（与聊天里的空气泡同源）。
        if (!call?.name) continue
        const evt: RawEvent = {
          id: part.id,
          ts,
          kind: 'tool_use',
          role,
          message_id: msg.id,
          turn_id: msg.turn_id ?? undefined,
          payload: {
            name: call.name,
            input: call.input,
            toolUseId: call.toolUseId,
          },
        }
        events.push(evt)
        if (call.toolUseId) toolUseById.set(call.toolUseId, evt)
      } else if (part.kind === 'tool_result') {
        // 不单独成事件：output 归并到对应 tool_use 事件（按 toolUseId 配对）
        const res = safeParse<ToolResultContent>(part.content_json)
        const target = res?.toolUseId
          ? toolUseById.get(res.toolUseId)
          : undefined
        if (target) {
          target.payload.output = res?.output
          target.payload.isError = res?.isError ?? false
        } else if (res && (res.isError || toolOutputHasContent(res.output))) {
          // 孤儿结果（无匹配 tool_use）：补一个工具事件承载，避免丢信息。
          // 但空 output 且非错误的孤儿（多半来自被跳过的 tool_input 片段）无信息可承载，丢弃。
          events.push({
            id: part.id,
            ts,
            kind: 'tool_use',
            role,
            message_id: msg.id,
            turn_id: msg.turn_id ?? undefined,
            payload: {
              name: '(result)',
              output: res.output,
              isError: res.isError ?? false,
              toolUseId: res.toolUseId,
            },
          })
        }
      } else if (part.kind === 'file_diff') {
        const diff = safeParse<{ path?: string }>(part.content_json)
        events.push({
          id: part.id,
          ts,
          kind: 'tool_use',
          role,
          message_id: msg.id,
          turn_id: msg.turn_id ?? undefined,
          payload: { name: 'FileDiff', input: { path: diff?.path } },
        })
      }
    }
  }

  const snapshotTs = maxTs || Date.now()

  for (const inter of input.interactions ?? []) {
    const baseTs =
      (inter.messageId ? messageTsById.get(inter.messageId) : undefined) ??
      snapshotTs
    const turnId = inter.messageId
      ? (messageTurnById.get(inter.messageId) ?? undefined)
      : undefined
    const options =
      inter.options
        ?.map((option) => compactText(option, 160))
        .filter(Boolean) ?? []
    events.push({
      id: `interaction_request_${inter.interactionId}`,
      ts: baseTs + 0.25,
      kind: 'message',
      role: 'assistant',
      message_id: inter.messageId ?? inter.interactionId,
      turn_id: turnId,
      payload: {
        text: [
          `需要用户${inter.interactionKind === 'choice' ? '选择' : '确认'}：${compactText(inter.prompt, 300)}`,
          options.length ? `候选项：${options.join('；')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        assistant_action: interactionAction(inter.interactionKind),
        interaction_id: inter.interactionId,
        interaction_kind: inter.interactionKind,
        options: inter.options ?? [],
        status: inter.status ?? 'pending',
      },
    })
    if (inter.status === 'resolved' && inter.response?.trim()) {
      events.push({
        id: `interaction_response_${inter.interactionId}`,
        ts: baseTs + 0.5,
        kind: 'message',
        role: 'user',
        message_id: inter.messageId ?? inter.interactionId,
        turn_id: turnId,
        payload: {
          text: `用户选择：${compactText(inter.response, 240)}`,
          user_kind: 'choice',
          interaction_id: inter.interactionId,
          interaction_prompt: inter.prompt,
          interaction_kind: inter.interactionKind,
        },
      })
    }
  }

  // todo / plan 取最新全量快照（store 里本就是覆盖式的最新状态）
  if (input.todos && input.todos.length > 0) {
    events.push({
      id: 'todo_snapshot',
      ts: snapshotTs,
      kind: 'todo',
      message_id: messages[messages.length - 1]?.id,
      payload: { input: { todos: input.todos } },
    })
  }
  if (input.plan && input.plan.trim()) {
    events.push({
      id: 'plan_snapshot',
      ts: snapshotTs,
      kind: 'plan',
      message_id: messages[messages.length - 1]?.id,
      payload: { text: input.plan, items: planTextToItems(input.plan) },
    })
  }
  if (input.runtimeEvents?.length) {
    events.push(...input.runtimeEvents)
  }

  return events.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}
