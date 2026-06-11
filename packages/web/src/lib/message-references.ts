import type { Message, MessagePart, MessageReference } from '@agent-chat/protocol'

const MAX_QUOTE_PREVIEW_CHARS = 180

export function parseMessageReferences(parts: MessagePart[]): MessageReference[] {
  const part = parts.find((entry) => entry.kind === 'message_ref')
  if (!part) return []
  try {
    const parsed = JSON.parse(part.content_json) as { references?: MessageReference[] }
    return Array.isArray(parsed.references) ? parsed.references : []
  } catch {
    return []
  }
}

export function extractMessageText(parts: MessagePart[]): string {
  const chunks: string[] = []
  for (const part of parts) {
    if (part.kind === 'text' || part.kind === 'thinking') {
      const content = parseContentText(part.content_json)
      if (content.trim()) chunks.push(content.trim())
      continue
    }
    if (part.kind === 'tool_use') {
      const parsed = safeParse<Record<string, unknown>>(part.content_json)
      const name = typeof parsed?.name === 'string' ? parsed.name : 'tool'
      chunks.push(`[tool_use: ${name}]`)
    }
    if (part.kind === 'tool_result') {
      chunks.push('[tool_result]')
    }
    if (part.kind === 'file_diff') {
      const parsed = safeParse<Record<string, unknown>>(part.content_json)
      const path = typeof parsed?.path === 'string' ? parsed.path : 'file'
      chunks.push(`[file_diff: ${path}]`)
    }
  }
  return chunks.join('\n\n')
}

export function buildMessageReference(message: Message, parts: MessagePart[]): MessageReference | null {
  const contentSnapshot = extractMessageText(parts).trim()
  if (!contentSnapshot) return null
  return {
    messageId: message.id,
    topicId: message.topic_id,
    role: message.role,
    contentSnapshot,
    createdAt: message.started_at,
  }
}

export function summarizeReference(ref: MessageReference, max = MAX_QUOTE_PREVIEW_CHARS): string {
  const oneLine = ref.contentSnapshot.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, Math.max(0, max - 1))}...`
}

export function referenceRoleLabel(role: MessageReference['role']): string {
  if (role === 'user') return 'User'
  if (role === 'assistant') return 'Assistant'
  if (role === 'system') return 'System'
  if (role === 'cron') return 'Cron'
  return 'Tool'
}

function parseContentText(contentJson: string): string {
  const parsed = safeParse<{ content?: unknown } | string>(contentJson)
  if (typeof parsed === 'string') return parsed
  return typeof parsed?.content === 'string' ? parsed.content : ''
}

function safeParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}
