'use client'

import { useState } from 'react'

interface ThinkingBlockProps {
  content: string
}

export function ThinkingBlock({ content }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-80"
        style={{ color: 'var(--fg-dim)' }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          style={{
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        >
          <path
            d="M4.5 2L8.5 6L4.5 10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Thinking...
      </button>
      {expanded && (
        <div
          className="mt-1.5 rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap"
          style={{
            backgroundColor: 'var(--glass-1)',
            border: '1px solid var(--stroke-inner)',
            color: 'var(--fg-dim)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {content}
        </div>
      )}
    </div>
  )
}
