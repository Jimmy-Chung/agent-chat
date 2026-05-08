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

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.status])

  if (messages.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ color: 'var(--fg-dim)' }}
      >
        <p className="text-sm">No messages yet. Start the conversation!</p>
      </div>
    )
  }

  const lastAssistantStreaming = messages.some(
    (m) => m.role === 'assistant' && m.status === 'streaming',
  )

  return (
    <div
      ref={containerRef}
      className="flex flex-1 flex-col overflow-y-auto py-4"
    >
      {messages.map((msg, idx) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          parts={partsByMessage[msg.id] ?? []}
          toolResults={toolResults}
          usage={usageByMessage[msg.id] ?? null}
          approval={approvalsByMessage[msg.id] ?? null}
          cronTriggered={cronByMessage[msg.id] ?? null}
          isLast={idx === messages.length - 1}
        />
      ))}

      {/* Typing indicator when assistant is thinking and has no text yet */}
      {lastAssistantStreaming && (
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
