'use client'

import { useRef, useState, useDeferredValue } from 'react'
import type { Message, MessagePart } from '@agent-chat/protocol'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCard, type ToolCallInfo, type ToolResultInfo } from './ToolCard'
import { DiffCard } from './DiffCard'
import { ApprovalCard } from './ApprovalCard'
import { UsageBadge } from './UsageBadge'
import { CronIndicator } from './CronIndicator'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useMessageStore } from '@/stores/message-store'
import { formatMessageTime } from '@/lib/message-time'
import { getWsClient } from '@/lib/ws-client'

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
  const [touchTimeVisible, setTouchTimeVisible] = useState(false)
  const longPressTimerRef = useRef<number | null>(null)
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const rawStreamingText = useMessageStore(
    (s) => (message.status === 'streaming' ? s.streamingText[message.id] ?? '' : ''),
  )
  const streamingText = useDeferredValue(rawStreamingText)
  const hasPersistedTextPart = parts.some((part) => {
    if (part.kind !== 'text') return false
    const parsed = safeParseContent<unknown>(part.content_json)
    const text = typeof parsed === 'string' ? parsed : (parsed as Record<string, unknown>)?.content as string | undefined
    return Boolean(text?.trim())
  })
  const visiblePartCount = parts.filter((part) => hasVisibleContent(part, isUser)).length
  const hasStreamingContent = message.status === 'streaming' && isLast && !isUser && !hasPersistedTextPart && streamingText.trim().length > 0
  const shouldShowBubble = !isUser ? visiblePartCount > 0 || hasStreamingContent || !!approval || !!cronTriggered : true
  const time = formatMessageTime(message.started_at)

  if (!isSystem && !shouldShowBubble) {
    return null
  }

  const isStreaming = hasStreamingContent
  const showInlineStreamingPulse = message.status === 'streaming' && isLast && !isUser && !hasStreamingContent && visiblePartCount > 0
  const hasVisibleBody = visiblePartCount > 0 || hasStreamingContent
  const showTimestamp = hasVisibleBody && (hovered || touchTimeVisible)
  const showRetryDot = isUser && message.status === 'needs_retry'
  const showRetryLoading = isUser && message.status === 'retrying'

  const handleRetry = () => {
    getWsClient().send({
      type: 'user.message.retry',
      data: {
        topicId: message.topic_id,
        messageId: message.id,
      },
    })
  }

  // System messages: inline purple text, no bubble
  if (isSystem) {
    return (
      <div className="flex justify-center px-4 py-1">
        <div className="role-bubble-system text-xs">{parts.map((p) => {
          if (p.kind === 'text') {
            const parsed = safeParseContent<unknown>(p.content_json)
            const text = typeof parsed === 'string' ? parsed : (parsed as Record<string, unknown>)?.content as string | undefined
            return text ? <span key={p.id}>{text}</span> : null
          }
          return null
        })}</div>
      </div>
    )
  }

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} px-6 py-0.5`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchStart={() => {
        if (longPressTimerRef.current != null) {
          window.clearTimeout(longPressTimerRef.current)
        }
        longPressTimerRef.current = window.setTimeout(() => {
          setTouchTimeVisible(true)
        }, 420)
      }}
      onTouchEnd={() => {
        if (longPressTimerRef.current != null) {
          window.clearTimeout(longPressTimerRef.current)
          longPressTimerRef.current = null
        }
        window.setTimeout(() => {
          setTouchTimeVisible(false)
        }, 1800)
      }}
      onTouchCancel={() => {
        if (longPressTimerRef.current != null) {
          window.clearTimeout(longPressTimerRef.current)
          longPressTimerRef.current = null
        }
        setTouchTimeVisible(false)
      }}
    >
      <div className={`flex max-w-[80%] flex-col ${isUser ? 'items-end' : 'items-start'}`}>
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
        {hasVisibleBody && (
          <div className={`message-bubble-shell ${isUser ? 'is-user' : 'is-assistant'}`}>
            {showRetryDot && (
              <button
                type="button"
                className="message-retry-dot"
                onClick={handleRetry}
                aria-label="Retry message"
                title={`Retry (${message.max_retries - message.retry_count} left)`}
              />
            )}
            {showRetryLoading && <span className="message-retry-loading" />}
            <div
              className={isUser ? 'role-bubble-user' : 'role-bubble-assistant'}
              style={!isUser && message.stop_reason === 'error' ? {
                border: '1px solid rgba(255,69,58,0.40)',
                background: 'rgba(255,69,58,0.08)',
              } : undefined}
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

              {/* Streaming markdown */}
              {isStreaming && (
                <MarkdownRenderer content={streamingText} isStreaming />
              )}

              {/* Streaming indicator */}
              {showInlineStreamingPulse && (
                <span className="stream-pulse" />
              )}
            </div>

            {showTimestamp && (
              <span className="message-edge-timestamp">
                {time}
              </span>
            )}
            {usage && !isUser && hovered && (
              <div className="pointer-events-none absolute -bottom-6 left-0">
                <UsageBadge
                  inputTokens={usage.inputTokens}
                  outputTokens={usage.outputTokens}
                  model={usage.model}
                />
              </div>
            )}
          </div>
        )}

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
    const parsed = safeParseContent<unknown>(part.content_json)
    const text = typeof parsed === 'string' ? parsed : (parsed as Record<string, unknown>)?.content as string | undefined
    if (!text?.trim()) return null
    return <MarkdownRenderer content={text} />
  }

  if (part.kind === 'thinking') {
    const parsed = safeParseContent<unknown>(part.content_json)
    const content = typeof parsed === 'string' ? parsed : (parsed as Record<string, unknown>)?.content as string | undefined
    if (!content?.trim()) return null
    return <ThinkingBlock content={content} />
  }

  if (part.kind === 'tool_use') {
    const call = safeParseContent<ToolCallInfo>(part.content_json)
    if (!call?.toolUseId || !call.name) return null
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
    return null
  }

  if (part.kind === 'file_diff' && !isUser) {
    const diff = safeParseContent<{ path: string; before: string; after: string }>(part.content_json)
    if (!diff?.path) return null
    return <DiffCard path={diff.path} before={diff.before} after={diff.after} />
  }

  return null
}

function hasVisibleContent(part: MessagePart, isUser: boolean): boolean {
  if (part.kind === 'text') {
    const parsed = safeParseContent<unknown>(part.content_json)
    const text = typeof parsed === 'string' ? parsed : (parsed as Record<string, unknown>)?.content as string | undefined
    return Boolean(text?.trim())
  }

  if (part.kind === 'thinking') {
    const parsed = safeParseContent<unknown>(part.content_json)
    const content = typeof parsed === 'string' ? parsed : (parsed as Record<string, unknown>)?.content as string | undefined
    return Boolean(content?.trim())
  }

  if (part.kind === 'tool_use') {
    return true
  }

  if (part.kind === 'file_diff') {
    return !isUser
  }

  return false
}

function safeParseContent<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}
