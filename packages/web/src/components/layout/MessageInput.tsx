'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import TextareaAutosize from 'react-textarea-autosize'
import { getWsClient } from '@/lib/ws-client'
import { useArtifactStore } from '@/stores/artifact-store'
import { useMessageStore } from '@/stores/message-store'
import type { Artifact } from '@agent-chat/protocol'

const EMPTY_ARTIFACTS: Artifact[] = []

interface Mention {
  id: string
  name: string
}

interface MessageInputProps {
  topicId: string
}

export function MessageInput({ topicId }: MessageInputProps) {
  const [value, setValue] = useState('')
  const [mentions, setMentions] = useState<Mention[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerTab, setPickerTab] = useState<'topic' | 'pool'>('topic')
  const pickerRef = useRef<HTMLDivElement>(null)
  const wsClient = getWsClient()

  const streamingMessageId = useMessageStore((s) => s.streamingMessageId)
  const isStreaming = streamingMessageId !== null

  const topicArtifacts = useArtifactStore((s) => s.byTopic[topicId] ?? EMPTY_ARTIFACTS)
  const poolArtifacts = useArtifactStore((s) => s.poolArtifacts)

  // Close picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    if (showPicker) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return

    wsClient.send({
      type: 'user.message',
      data: {
        topicId,
        content: trimmed,
        mentions: mentions.map((m) => ({ id: m.id, name: m.name })),
      },
    })
    setValue('')
    setMentions([])
  }, [value, topicId, wsClient, mentions])

  const handleAbort = useCallback(() => {
    wsClient.send({
      type: 'user.action',
      data: { topicId, action: 'abort' },
    })
  }, [topicId, wsClient])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setValue(v)

    // Detect @ trigger
    const cursorPos = e.target.selectionStart
    const textBefore = v.slice(0, cursorPos)
    const atMatch = textBefore.match(/@(\S*)$/)
    if (atMatch) {
      setShowPicker(true)
      setPickerQuery(atMatch[1].toLowerCase())
      setPickerTab('topic')
    } else {
      setShowPicker(false)
    }
  }

  const selectArtifact = (artifact: Artifact) => {
    // Remove the @query from text and add a chip reference
    const cursorPos = value.length
    const textBeforeCursor = value.slice(0, cursorPos)
    const newText = textBeforeCursor.replace(/@\S*$/, `@${artifact.name} `) + value.slice(cursorPos)
    setValue(newText)

    if (!mentions.find((m) => m.id === artifact.id)) {
      setMentions((prev) => [...prev, { id: artifact.id, name: artifact.name }])
    }
    setShowPicker(false)
  }

  const removeMention = (id: string) => {
    setMentions((prev) => prev.filter((m) => m.id !== id))
  }

  const filteredArtifacts = (pickerTab === 'topic' ? topicArtifacts : poolArtifacts)
    .filter((a) => a.name.toLowerCase().includes(pickerQuery))

  return (
    <div className="px-4 pb-4 pt-2" style={{ borderTop: '1px solid var(--divider)' }}>
      {/* Mention chips */}
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {mentions.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              style={{ background: 'var(--surface-tertiary)', color: 'var(--fg-regular)' }}
            >
              @{m.name}
              <button onClick={() => removeMention(m.id)} className="ml-0.5 opacity-60 hover:opacity-100">&times;</button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        {/* Mention picker */}
        {showPicker && (
          <div
            ref={pickerRef}
            className="absolute bottom-full left-0 mb-1 w-64 rounded-lg shadow-lg z-10 overflow-hidden"
            style={{ background: 'var(--surface-secondary)', border: '1px solid var(--divider)' }}
          >
            <div className="flex border-b" style={{ borderColor: 'var(--divider)' }}>
              <button
                onClick={() => setPickerTab('topic')}
                className="flex-1 px-2 py-1.5 text-xs font-medium"
                style={{ color: pickerTab === 'topic' ? 'var(--fg-strong)' : 'var(--fg-dim)', borderBottom: pickerTab === 'topic' ? '2px solid var(--role-user)' : 'none' }}
              >话题产物</button>
              <button
                onClick={() => setPickerTab('pool')}
                className="flex-1 px-2 py-1.5 text-xs font-medium"
                style={{ color: pickerTab === 'pool' ? 'var(--fg-strong)' : 'var(--fg-dim)', borderBottom: pickerTab === 'pool' ? '2px solid var(--role-user)' : 'none' }}
              >产物池</button>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {filteredArtifacts.length === 0 && (
                <p className="px-3 py-2 text-xs" style={{ color: 'var(--fg-dim)' }}>无匹配产物</p>
              )}
              {filteredArtifacts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => selectArtifact(a)}
                  className="w-full text-left px-3 py-2 text-xs hover:opacity-80"
                  style={{ color: 'var(--fg-regular)' }}
                >
                  <span className="font-medium">{a.name}</span>
                  {a.mime && <span className="ml-2 opacity-60">{a.mime}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          className="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{ backgroundColor: 'var(--glass-1)', border: '1px solid var(--stroke-inner)' }}
        >
          <TextareaAutosize
            value={value}
            onChange={handleChange}
            onKeyDown={isStreaming ? undefined : handleKeyDown}
            placeholder={isStreaming ? 'Agent is responding...' : 'Type a message... (@ to mention artifacts)'}
            maxRows={6}
            disabled={isStreaming}
            className="flex-1 resize-none bg-transparent text-sm outline-none disabled:opacity-50"
            style={{ color: 'var(--fg-regular)' }}
          />
          {isStreaming ? (
            <button
              onClick={handleAbort}
              className="rounded-lg p-1.5 transition-opacity hover:opacity-80"
              style={{ color: 'var(--fg-dim)' }}
              aria-label="Stop generation"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!value.trim()}
              className="rounded-lg p-1.5 transition-opacity disabled:opacity-30 hover:opacity-80"
              style={{ color: 'var(--role-user)' }}
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M3 9L15 3L9 15L8 10L3 9Z" fill="currentColor" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="4" y="4" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  )
}
