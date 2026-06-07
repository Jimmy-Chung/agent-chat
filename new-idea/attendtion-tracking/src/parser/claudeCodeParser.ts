import { RawEvent, GoalAnchor, EventKind, AssistantActionKind, UserMessageKind } from '../types'

interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | ContentBlock[]
  is_error?: boolean
}

interface MessageObject {
  role?: string
  content?: string | ContentBlock[]
  id?: string
  type?: string
}

interface ClaudeCodeLine {
  type?: string
  role?: string
  operation?: string
  message?: MessageObject
  content?: string | ContentBlock[]
  ts?: string
  timestamp?: string
  uuid?: string
  leafUuid?: string
  parentUuid?: string
  sessionId?: string
  toolUseResult?: unknown
  isMeta?: boolean
}

let _counter = 0
const nextId = (prefix: string) => `${prefix}_${++_counter}`

function parseTimestamp(line: ClaudeCodeLine): number {
  const raw = line.timestamp || line.ts
  if (!raw) return Date.now()
  const parsed = new Date(raw).getTime()
  return isNaN(parsed) ? Date.now() : parsed
}

function blockToEvents(
  block: ContentBlock,
  turnId: string,
  ts: number,
  role: 'user' | 'assistant' = 'assistant',
  source?: { line: number; uuid?: string }
): RawEvent[] {
  const events: RawEvent[] = []

  if (block.type === 'thinking' && block.thinking) {
    events.push({
      id: nextId('evt'),
      ts,
      kind: 'thinking',
      role: 'assistant',
      turn_id: turnId,
      payload: { text: block.thinking },
      source_line: source?.line,
      source_uuid: source?.uuid,
    })
  } else if (block.type === 'tool_use' && block.id) {
    const isTodoTool =
      block.name === 'TodoWrite' || block.name === 'TodoRead'
    const kind: EventKind = isTodoTool ? 'todo' : 'tool_use'
    events.push({
      id: nextId('evt'),
      ts,
      kind,
      role: 'assistant',
      turn_id: turnId,
      payload: {
        name: block.name,
        input: block.input ?? {},
        tool_use_id: block.id,
        status: 'pending' as const,
        output: null,
      },
      source_line: source?.line,
      source_uuid: source?.uuid,
    })
  } else if (block.type === 'text' && block.text) {
    const text = block.text.trim()
    if (!isVisibleText(text, role)) return events
    if (!text) return events
    const kind: EventKind = looksLikePlan(text) ? 'plan' : 'message'
    events.push({
      id: nextId('evt'),
      ts,
      kind,
      role,
      turn_id: turnId,
      payload: {
        text,
        items: kind === 'plan' ? extractPlanItems(text) : [],
        user_kind: role === 'user' ? classifyUserMessage(text) : undefined,
        assistant_action: role === 'assistant' ? classifyAssistantAction(text) : undefined,
      },
      source_line: source?.line,
      source_uuid: source?.uuid,
    })
  }

  return events
}

function isVisibleText(text: string, role: 'user' | 'assistant'): boolean {
  const t = text.trim()
  if (!t) return false
  if (role === 'user') {
    if (t.startsWith('<')) return false
    if (t.startsWith('{') || t.startsWith('[')) return false
    if (isGeneratedUserPrompt(t)) return false
  }
  return true
}

function isGeneratedUserPrompt(text: string): boolean {
  return (
    /^轮询\s+AIT-\d+，检查是否有/.test(text) ||
    /^检查\s+AIT-\d+/.test(text) ||
    /如果有新评论，汇报内容；如果没有，继续等待下次轮询/.test(text)
  )
}

function classifyUserMessage(text: string): UserMessageKind {
  const t = text.trim().replace(/^❯\s*/, '')
  if (/^(轮询|继续轮询|有新评论|选|选择|用|就这个|这个|对|是|不是|可以|确认|ok|OK)\b/.test(t) || t.length <= 12) {
    return 'choice'
  }
  if (/[?？]$/.test(t) || /(吗|呢|对吧|是不是|是否|为什么|怎么|需要.*吗|是什么|能不能)/.test(t)) {
    return 'question'
  }
  if (/([0-9a-f]{8}-[0-9a-f-]{20,}|^cm-\d+-|sessionId|messageId|日志|log|Logs|^\{?v:\s*1)/i.test(t)) {
    return 'evidence'
  }
  if (/(我怀疑|我觉得|我的想法|先不要改|先排查|可以|应该|如果|那其实|也就是说|意思是)/.test(t)) {
    return 'proposal'
  }
  return 'instruction'
}

function classifyAssistantAction(text: string): AssistantActionKind {
  const t = text.trim()
  if (/(可选路径|选项|方案\s*[A-D]|请选择|你可以)/.test(t)) return 'options'
  if (/[?？]$/.test(t) || /(需要.*吗|要继续.*吗|还是.*\?|我需要|请提供|能否)/.test(t)) return 'ask'
  if (/(结论|完成|已|定位|确认|找到|根因|证据链|修复|解决|通报)/.test(t)) return 'solve'
  return 'status'
}

function looksLikePlan(text: string): boolean {
  const lines = text.split('\n').filter(Boolean)
  const listLines = lines.filter((l) =>
    /^\s*(\d+\.|[-*•])\s+/.test(l)
  ).length
  return listLines >= 3 && /(计划|步骤|下一步|方案|任务|TODO|Todo|todo|执行|验证)/.test(text)
}

function extractPlanItems(text: string) {
  const items: { id: string; text: string; status: string; depth: number }[] =
    []
  let i = 0
  for (const line of text.split('\n')) {
    const m = line.match(/^(\s*)(\d+\.|[-*•])\s+(.+)/)
    if (m) {
      items.push({
        id: `pi_${++i}`,
        text: m[3].trim(),
        status: 'pending',
        depth: Math.floor(m[1].length / 2),
      })
    }
  }
  return items
}

function normalizeContent(
  raw: string | ContentBlock[] | undefined
): ContentBlock[] {
  if (!raw) return []
  if (typeof raw === 'string')
    return [{ type: 'text', text: raw }]
  return raw
}

export function parseClaudeCodeJsonl(raw: string): {
  events: RawEvent[]
  goalAnchor: GoalAnchor | null
} {
  _counter = 0
  const events: RawEvent[] = []
  let goalAnchor: GoalAnchor | null = null

  // Map from tool_use_id → event index, to patch in results later
  const toolUseIndex = new Map<string, RawEvent>()

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  let turnCounter = 0

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo]
    let parsed: ClaudeCodeLine
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    const turnId = `turn_${++turnCounter}`
    const ts = parseTimestamp(parsed)
    const source = { line: lineNo + 1, uuid: parsed.uuid ?? parsed.leafUuid }

    if (parsed.type === 'queue-operation' && parsed.operation === 'enqueue') {
      const text = typeof parsed.content === 'string' ? parsed.content.trim() : ''
      if (isVisibleText(text, 'user')) {
        if (!goalAnchor) goalAnchor = { raw_query: text, normalized_goal: text, ts }
        events.push({
          id: nextId('evt'),
          ts,
          kind: 'message',
          role: 'user',
          turn_id: turnId,
          payload: {
            text,
            items: [],
            user_kind: classifyUserMessage(text),
            source: 'queue-operation',
          },
          source_line: source.line,
          source_uuid: source.uuid,
        })
      }
      continue
    }

    // Normalize to { role, contentBlocks }
    let role: string | undefined
    let contentBlocks: ContentBlock[]

    if (parsed.message) {
      role = parsed.message.role
      contentBlocks = normalizeContent(parsed.message.content)
    } else if (parsed.role) {
      role = parsed.role
      contentBlocks = normalizeContent(parsed.content)
    } else {
      continue
    }
    if (parsed.isMeta) continue

    // 所有来自 user role 的文本块都标记为 role:'user'
    // 就算同一轮有 tool_result，用户的文字也是用户的文字
    const evtRole: 'user' | 'assistant' = role === 'user' ? 'user' : 'assistant'

    // GoalAnchor: 第一条真实人类文字（非 XML/JSON 系统注入）
    if (role === 'user' && !goalAnchor) {
      const userText = contentBlocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join(' ')
        .trim()
      // 过滤系统注入的 XML 消息
      if (isVisibleText(userText, 'user')) {
        goalAnchor = { raw_query: userText, normalized_goal: userText, ts }
      }
    }

    // Process each content block
    for (const block of contentBlocks) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        // Patch the matching tool_use event
        const toolEvt = toolUseIndex.get(block.tool_use_id)
        if (toolEvt) {
          const outputText =
            typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
              ? block.content
                  .filter((b) => b.type === 'text')
                  .map((b) => b.text ?? '')
                  .join('\n')
              : ''
          toolEvt.payload = {
            ...toolEvt.payload,
            output: outputText,
            status: block.is_error ? 'error' : 'done',
          }
        }
        continue
      }

      const blockEvents = blockToEvents(block, turnId, ts, evtRole, source)
      for (const evt of blockEvents) {
        if (evt.kind === 'tool_use' || evt.kind === 'todo') {
          const tid = evt.payload.tool_use_id as string | undefined
          if (tid) toolUseIndex.set(tid, evt)
        }
        events.push(evt)
      }
    }
  }

  return { events, goalAnchor }
}
