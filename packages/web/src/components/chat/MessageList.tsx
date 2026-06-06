'use client'

import { useRef, useEffect, useState } from 'react'
import type { Message, MessagePart } from '@agent-chat/protocol'
import type { ToolResultInfo } from './ToolCard'
import { MessageBubble } from './MessageBubble'
import { InteractionCard } from './InteractionCard'
import { formatDateDivider, shouldShowDateDivider } from '@/lib/message-time'
import { useMessageStore } from '@/stores/message-store'

interface OrphanInteraction {
  interactionId: string
  interactionKind: 'approval' | 'choice'
  prompt: string
  options?: string[]
  status?: 'pending' | 'resolved' | 'timeout'
  response?: string
  defaultTimeoutMs?: number
}

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
      interactionKind: string
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
  orphanInteractions?: OrphanInteraction[]
  topicId?: string
}

export function MessageList({
  messages,
  partsByMessage,
  toolResults,
  usageByMessage,
  approvalsByMessage,
  cronByMessage,
  orphanInteractions = [],
  topicId = '',
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef(new Map<string, HTMLDivElement>())
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const focusTarget = useMessageStore((s) => s.focusedMessageTarget)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.status])

  useEffect(() => {
    if (!focusTarget || focusTarget.topicId !== topicId) return
    const el = messageRefs.current.get(focusTarget.messageId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedMessageId(focusTarget.messageId)
    const timer = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === focusTarget.messageId ? null : current))
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [focusTarget?.requestId, focusTarget?.messageId, focusTarget?.topicId, topicId])

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
            {turn.messages.map((msg, msgIdx) => {
              const previousMessage = msgIdx > 0
                ? turn.messages[msgIdx - 1]
                : turns[turnIdx - 1]?.messages.at(-1)

              return (
                <div
                  key={msg.id}
                  ref={(node) => {
                    if (node) messageRefs.current.set(msg.id, node)
                    else messageRefs.current.delete(msg.id)
                  }}
                  style={{
                    scrollMarginTop: '96px',
                    borderRadius: '14px',
                    transition: 'box-shadow 180ms ease, background-color 180ms ease',
                    ...(highlightedMessageId === msg.id ? {
                      boxShadow: '0 0 0 1px rgba(10,132,255,0.62), 0 0 0 6px rgba(10,132,255,0.12)',
                      background: 'rgba(10,132,255,0.06)',
                    } : {}),
                  }}
                >
                  {shouldShowDateDivider(previousMessage?.started_at ?? null, msg.started_at) && (
                    <DateDivider timestamp={msg.started_at} />
                  )}
                  <MessageBubble
                    message={msg}
                    parts={partsByMessage[msg.id] ?? []}
                    toolResults={toolResults}
                    usage={usageByMessage[msg.id] ?? null}
                    approval={approvalsByMessage[msg.id] ?? null}
                    cronTriggered={cronByMessage[msg.id] ?? null}
                    isLast={turnIdx === turns.length - 1 && msgIdx === turn.messages.length - 1}
                  />
                </div>
              )
            })}
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

      {orphanInteractions.map((inter) => (
        <div key={inter.interactionId} className="px-4 md:px-6">
          <InteractionCard
            interactionId={inter.interactionId}
            topicId={topicId}
            interactionKind={inter.interactionKind}
            prompt={inter.prompt}
            options={inter.options}
            status={inter.status ?? 'pending'}
            response={inter.response}
            defaultTimeoutMs={inter.defaultTimeoutMs}
          />
        </div>
      ))}

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

function DateDivider({ timestamp }: { timestamp: number }) {
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
        {formatDateDivider(timestamp)}
      </span>
      <div style={{ height: 1, flex: 1, background: 'linear-gradient(90deg, rgba(255,255,255,0.08), transparent)' }} />
    </div>
  )
}
