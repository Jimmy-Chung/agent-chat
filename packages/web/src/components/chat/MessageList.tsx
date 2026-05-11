'use client'

import { useRef, useEffect } from 'react'
import type { Message, MessagePart } from '@agent-chat/protocol'
import type { ToolResultInfo } from './ToolCard'
import { MessageBubble } from './MessageBubble'

interface MessageListProps {
  messages: Message[]
  partsByMessage: Record<string, MessagePart[]>
  toolResults: Record<string, ToolResultInfo>
  usageByMessage: Record<
    string,
    { inputTokens: number; outputTokens: number; model?: string } | null
  >
  approvalsByMessage: Record<
    string,
    {
      interactionId: string
      prompt: string
      options?: string[]
      status: 'pending' | 'resolved' | 'timeout'
      response?: string
    } | null
  >
  cronByMessage: Record<
    string,
    { cronId: string; runId: string; firedAt: number } | null
  >
}

export function MessageList({
  messages,
  partsByMessage,
  toolResults,
  usageByMessage,
  approvalsByMessage,
  cronByMessage,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.status])

  if (messages.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ color: 'var(--fg-dim)' }}
      >
        <p className="text-sm">暂无消息，开始对话吧</p>
      </div>
    )
  }

  const turns = groupMessagesIntoTurns(messages, partsByMessage)

  const lastAssistantStreaming = messages.some(
    (m) => m.role === 'assistant' && m.status === 'streaming',
  )
  const lastTurn = turns[turns.length - 1]
  const lastTurnHasVisibleContent = lastTurn
    ? lastTurn.messages.some((m) => messageHasVisibleContent(m, partsByMessage))
    : false
  const shouldShowTypingIndicator = lastAssistantStreaming && !lastTurnHasVisibleContent

  return (
    <div
      ref={containerRef}
      className="flex flex-1 flex-col overflow-y-auto py-4"
    >
      {turns.map((turn, turnIdx) => {
        return (
          <div key={turn.key}>
            {turnIdx > 0 && (
              <DateDivider
                prevTs={turns[turnIdx - 1].messages[turns[turnIdx - 1].messages.length - 1].started_at}
                nextTs={turn.messages[0].started_at}
              />
            )}
            {turn.messages.map((msg, msgIdx) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                parts={partsByMessage[msg.id] ?? []}
                toolResults={toolResults}
                usage={usageByMessage[msg.id] ?? null}
                approval={approvalsByMessage[msg.id] ?? null}
                cronTriggered={cronByMessage[msg.id] ?? null}
                isLast={turnIdx === turns.length - 1 && msgIdx === turn.messages.length - 1}
              />
            ))}
          </div>
        )
      })}

      {shouldShowTypingIndicator && (
        <div className="flex justify-start px-4 py-0.5">
          <div
            className="rounded-2xl px-3.5 py-2.5"
            style={{
              backgroundColor: 'var(--role-assistant)',
              border: '1px solid var(--stroke-inner)',
            }}
          >
            <div className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full" style={{ backgroundColor: 'var(--fg-dim)', animationDelay: '0ms' }} />
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full" style={{ backgroundColor: 'var(--fg-dim)', animationDelay: '150ms' }} />
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full" style={{ backgroundColor: 'var(--fg-dim)', animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

interface Turn {
  key: string
  messages: Message[]
}

function groupMessagesIntoTurns(
  messages: Message[],
  partsByMessage: Record<string, MessagePart[]>,
): Turn[] {
  const turns: Turn[] = []
  let currentTurn: Message[] = []
  let currentTurnId: string | null = null

  for (const msg of messages) {
    if (msg.role === 'user' || msg.role === 'system' || msg.role === 'cron') {
      if (currentTurn.length > 0) {
        turns.push({ key: currentTurnId ?? currentTurn[0].id, messages: filterTransitionalMessages(currentTurn, partsByMessage) })
        currentTurn = []
        currentTurnId = null
      }
      turns.push({ key: msg.id, messages: [msg] })
      continue
    }

    if (msg.turn_id && currentTurnId && msg.turn_id !== currentTurnId) {
      turns.push({ key: currentTurnId, messages: filterTransitionalMessages(currentTurn, partsByMessage) })
      currentTurn = []
      currentTurnId = null
    }

    if (msg.turn_id) {
      currentTurnId = msg.turn_id
    }
    currentTurn.push(msg)
  }

  if (currentTurn.length > 0) {
    turns.push({ key: currentTurnId ?? currentTurn[0].id, messages: filterTransitionalMessages(currentTurn, partsByMessage) })
  }

  return turns
}

function isTransitionalMessage(msg: Message, partsByMessage: Record<string, MessagePart[]>): boolean {
  if (msg.role !== 'assistant') return false
  if (msg.stop_reason !== 'tool_use') return false

  const parts = partsByMessage[msg.id] ?? []
  const hasVisiblePart = parts.some((part) => {
    if (part.kind === 'text') {
      try {
        const parsed = JSON.parse(part.content_json) as { content?: string }
        return Boolean(parsed.content?.trim())
      } catch { return false }
    }
    if (part.kind === 'tool_use' || part.kind === 'file_diff') return true
    return false
  })

  return !hasVisiblePart
}

function filterTransitionalMessages(msgs: Message[], partsByMessage: Record<string, MessagePart[]>): Message[] {
  const nonTransitional = msgs.filter((msg) => !isTransitionalMessage(msg, partsByMessage))
  if (nonTransitional.length === 0) return msgs
  return nonTransitional
}

function messageHasVisibleContent(msg: Message, partsByMessage: Record<string, MessagePart[]>): boolean {
  if (msg.role !== 'assistant') return false
  const parts = partsByMessage[msg.id] ?? []
  return parts.some((part) => {
    if (part.kind === 'text') {
      try {
        const parsed = JSON.parse(part.content_json) as { content?: string }
        return Boolean(parsed.content?.trim())
      } catch { return false }
    }
    return part.kind === 'tool_use' || part.kind === 'tool_result' || part.kind === 'file_diff' || part.kind === 'thinking'
  })
}

function DateDivider({ prevTs, nextTs }: { prevTs: number; nextTs: number }) {
  if (!prevTs || !nextTs) return null
  if (isSameDay(prevTs, nextTs)) return null

  return (
    <div className="flex items-center px-4 py-4">
      <div style={{ height: 1, flex: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08))' }} />
      <span
        className="mx-3 rounded-full px-3 py-1 text-[11px] font-medium"
        style={{
          background: 'rgba(255,255,255,0.06)',
          color: 'var(--fg-dim)',
          border: '1px solid var(--hairline)',
          fontFeatureSettings: '"tnum"',
        }}
      >
        {formatDateDivider(nextTs)}
      </span>
      <div style={{ height: 1, flex: 1, background: 'linear-gradient(90deg, rgba(255,255,255,0.08), transparent)' }} />
    </div>
  )
}

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}

function formatDateDivider(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)

  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)

  if (isSameDay(date.getTime(), now.getTime())) {
    return `今天 · ${time}`
  }

  if (isSameDay(date.getTime(), yesterday.getTime())) {
    return `昨天 · ${time}`
  }

  const day = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(date)

  return `${day} · ${time}`
}
