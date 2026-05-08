'use client'

import { useState } from 'react'
import type { Message, MessagePart } from '@agent-chat/protocol'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCard, type ToolCallInfo, type ToolResultInfo } from './ToolCard'
import { DiffCard } from './DiffCard'
import { ApprovalCard } from './ApprovalCard'
import { UsageBadge } from './UsageBadge'
import { CronIndicator } from './CronIndicator'

interface MessageBubbleProps {
  message: Message
  parts: MessagePart[]
  toolResults?: Record<string, ToolResultInfo>
  usage?: { inputTokens: number; outputTokens: number; model?: string } | null
  approval?: {
    interactionId: string
    prompt: string
    options?: string[]
    status: 'pending' | 'resolved' | 'timeout'
    response?: string
  } | null
  cronTriggered?: { cronId: string; runId: string; firedAt: number } | null
  isLast?: boolean
}

export function MessageBubble({
  message,
  parts,
  toolResults = {},
  usage,
  approval,
  cronTriggered,
  isLast,
}: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false)
  const isUser = message.role === 'user'
  const time = new Date(message.started_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} px-4 py-0.5`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Cron indicator */}
        {cronTriggered && !isUser && (
          <CronIndicator
            cronId={cronTriggered.cronId}
            runId={cronTriggered.runId}
            firedAt={cronTriggered.firedAt}
          />
        )}

        {/* Approval card */}
        {approval && !isUser && (
          <ApprovalCard
            interactionId={approval.interactionId}
            topicId={message.topic_id}
            prompt={approval.prompt}
            options={approval.options}
            status={approval.status}
            response={approval.response}
          />
        )}

        {/* Bubble */}
        <div
          className="rounded-2xl px-3.5 py-2.5"
          style={{
            backgroundColor: isUser
              ? 'var(--role-user)'
              : 'var(--role-assistant)',
            border: isUser ? 'none' : '1px solid var(--stroke-inner)',
          }}
        >
          {/* Message parts */}
          {parts.map((part) => (
            <MessagePartRenderer
              key={part.id}
              part={part}
              toolResults={toolResults}
              isUser={isUser}
            />
          ))}

          {/* Streaming indicator */}
          {message.status === 'streaming' && isLast && !isUser && (
            <span className="inline-block ml-1 animate-pulse" style={{ color: 'var(--fg-dim)' }}>
              ...
            </span>
          )}
        </div>

        {/* Timestamp + usage */}
        <div
          className="mt-0.5 flex items-center gap-2 transition-opacity"
          style={{ opacity: hovered ? 1 : 0 }}
        >
          <span className="text-[10px]" style={{ color: 'var(--fg-dim)' }}>
            {time}
          </span>
          {usage && !isUser && (
            <UsageBadge
              inputTokens={usage.inputTokens}
              outputTokens={usage.outputTokens}
              model={usage.model}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function MessagePartRenderer({
  part,
  toolResults,
  isUser,
}: {
  part: MessagePart
  toolResults: Record<string, ToolResultInfo>
  isUser: boolean
}) {
  if (part.kind === 'text') {
    const text = safeParseContent<string>(part.content_json)
    if (!text) return null
    return (
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
        {text}
      </div>
    )
  }

  if (part.kind === 'thinking') {
    const content = safeParseContent<string>(part.content_json)
    if (!content) return null
    return <ThinkingBlock content={content} />
  }

  if (part.kind === 'tool_use') {
    const call = safeParseContent<ToolCallInfo>(part.content_json)
    if (!call) return null
    const result = toolResults[call.toolUseId]
    return (
      <ToolCard
        call={call}
        result={result}
        isRunning={!result}
      />
    )
  }

  if (part.kind === 'tool_result') {
    // Tool results are displayed inline in their corresponding tool_use ToolCard
    return null
  }

  if (part.kind === 'file_diff' && !isUser) {
    const diff = safeParseContent<{ path: string; before: string; after: string }>(part.content_json)
    if (!diff) return null
    return <DiffCard path={diff.path} before={diff.before} after={diff.after} />
  }

  return null
}

function safeParseContent<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}
