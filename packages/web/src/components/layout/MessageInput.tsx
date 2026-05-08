'use client'

import { useState, useCallback } from 'react'
import TextareaAutosize from 'react-textarea-autosize'
import { getWsClient } from '@/lib/ws-client'

interface MessageInputProps {
  topicId: string
}

export function MessageInput({ topicId }: MessageInputProps) {
  const [value, setValue] = useState('')
  const wsClient = getWsClient()

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return

    wsClient.send({
      type: 'user.message',
      data: {
        topicId,
        content: trimmed,
        mentions: [],
      },
    })
    setValue('')
  }, [value, topicId, wsClient])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div
      className="px-4 pb-4 pt-2"
      style={{ borderTop: '1px solid var(--divider)' }}
    >
      <div
        className="flex items-end gap-2 rounded-xl px-3 py-2"
        style={{
          backgroundColor: 'var(--glass-1)',
          border: '1px solid var(--stroke-inner)',
        }}
      >
        <TextareaAutosize
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          maxRows={6}
          className="flex-1 resize-none bg-transparent text-sm outline-none"
          style={{ color: 'var(--fg-regular)' }}
        />
        <button
          onClick={handleSend}
          disabled={!value.trim()}
          className="rounded-lg p-1.5 transition-opacity disabled:opacity-30 hover:opacity-80"
          style={{ color: 'var(--role-user)' }}
          aria-label="Send message"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  )
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M3 9L15 3L9 15L8 10L3 9Z"
        fill="currentColor"
      />
    </svg>
  )
}
