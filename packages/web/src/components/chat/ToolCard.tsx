'use client'

import { useState } from 'react'

export interface ToolCallInfo {
  toolUseId: string
  name: string
  input: unknown
}

export interface ToolResultInfo {
  toolUseId: string
  output: unknown
  isError: boolean
}

interface ToolCardProps {
  call: ToolCallInfo
  result?: ToolResultInfo
  isRunning?: boolean
}

export function ToolCard({ call, result, isRunning }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false)
  const inputStr = JSON.stringify(call.input, null, 2)
  const outputStr = result ? JSON.stringify(result.output, null, 2) : null

  return (
    <div
      className="my-1.5 rounded-xl overflow-hidden text-sm"
      style={{
        backgroundColor: 'var(--glass-1)',
        border: '1px solid var(--stroke-inner)',
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-opacity hover:opacity-80"
      >
        <StatusIcon
          isRunning={isRunning ?? false}
          isError={result?.isError ?? false}
          hasResult={!!result}
        />
        <span className="flex-1 truncate font-medium" style={{ color: 'var(--fg-strong)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
          {call.name}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          style={{
            color: 'var(--fg-dim)',
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
      </button>

      {/* Input */}
      {expanded && inputStr && (
        <div
          className="border-t px-3 py-2"
          style={{ borderColor: 'var(--stroke-inner)' }}
        >
          <p className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--fg-dim)' }}>
            Input
          </p>
          <pre
            className="overflow-x-auto whitespace-pre-wrap break-all text-xs leading-relaxed"
            style={{ color: 'var(--fg-code)', fontFamily: 'var(--font-mono)' }}
          >
            {inputStr}
          </pre>
        </div>
      )}

      {/* Output */}
      {expanded && outputStr && (
        <div
          className="border-t px-3 py-2"
          style={{ borderColor: 'var(--stroke-inner)' }}
        >
          <p className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: result?.isError ? 'var(--state-danger)' : 'var(--fg-dim)' }}>
            Output
          </p>
          <pre
            className="overflow-x-auto whitespace-pre-wrap break-all text-xs leading-relaxed"
            style={{
              color: result?.isError ? 'var(--state-danger)' : 'var(--fg-code)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {outputStr}
          </pre>
        </div>
      )}
    </div>
  )
}

function StatusIcon({
  isRunning,
  isError,
  hasResult,
}: {
  isRunning: boolean
  isError: boolean
  hasResult: boolean
}) {
  if (isRunning && !hasResult) {
    return (
      <span
        className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent"
        style={{ borderColor: 'var(--fg-dim)', borderTopColor: 'transparent' }}
      />
    )
  }

  if (hasResult && isError) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="6" fill="var(--state-danger)" fillOpacity="0.15" />
        <path
          d="M5 5L9 9M9 5L5 9"
          stroke="var(--state-danger)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (hasResult) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="6" fill="#34c759" fillOpacity="0.15" />
        <path
          d="M4.5 7L6.5 9L9.5 5.5"
          stroke="#34c759"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  return (
    <span
      className="inline-block h-3.5 w-3.5 rounded-full"
      style={{ backgroundColor: 'var(--fg-dim)', opacity: 0.3 }}
    />
  )
}
