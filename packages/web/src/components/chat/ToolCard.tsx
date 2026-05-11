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

  const inputObj = call.input as Record<string, unknown> | null
  const shortArg = inputObj?.file_path ?? inputObj?.path ?? inputObj?.query ?? inputObj?.command ?? ''
  const statusLabel = isRunning && !result ? '运行中' : result?.isError ? '失败' : result ? '完成' : '等待中'

  return (
    <div
      className="my-1.5 overflow-hidden rounded-[10px] text-sm"
      style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid var(--hairline)',
        display: 'grid',
        gridTemplateColumns: '4px 1fr',
      }}
    >
      <div style={{ background: 'linear-gradient(180deg, #2090FF, #0064D8)' }} />

      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-opacity hover:opacity-80"
        >
          <span style={{ color: 'var(--fg-dim)', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>
          </span>

          <span style={{ color: '#6cb1ff' }}>
            <ToolGlyph />
          </span>

          <span className="font-semibold" style={{ color: 'var(--fg-strong)', letterSpacing: '-0.01em' }}>{call.name}</span>

          {shortArg && (
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-code)', fontSize: 12 }}>{String(shortArg)}</span>
          )}

          <span className="ml-auto flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--fg-dim)', fontFeatureSettings: '"tnum"' }}>
            <StatusIcon
              isRunning={isRunning ?? false}
              isError={result?.isError ?? false}
              hasResult={!!result}
            />
            <span>{statusLabel}</span>
          </span>
        </button>

        {expanded && inputStr && (
          <div className="border-t px-3 py-2" style={{ borderColor: 'var(--hairline)' }}>
            <p className="mb-1 text-[10px] uppercase" style={{ color: 'var(--fg-dim)', letterSpacing: '0.04em' }}>Input</p>
            <pre
              className="whitespace-pre-wrap break-all text-xs leading-relaxed"
              style={{ color: 'var(--fg-code)', fontFamily: 'var(--font-mono)' }}
            >
              {inputStr}
            </pre>
          </div>
        )}

        {expanded && outputStr && (
          <div className="border-t px-3 py-2" style={{ borderColor: 'var(--hairline)' }}>
            <p className="mb-1 text-[10px] uppercase" style={{ color: result?.isError ? 'var(--state-danger)' : 'var(--fg-dim)', letterSpacing: '0.04em' }}>Output</p>
            <pre
              className="whitespace-pre-wrap break-all text-xs leading-relaxed"
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
    </div>
  )
}

function ToolGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function StatusIcon({ isRunning, isError, hasResult }: { isRunning: boolean; isError: boolean; hasResult: boolean }) {
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
      <span className="danger-pulse inline-flex h-5 w-5 items-center justify-center rounded-full" style={{ background: 'var(--state-danger-soft)' }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--state-danger)" strokeWidth="3" strokeLinecap="round"><path d="M5 5L19 19M19 5L5 19" /></svg>
      </span>
    )
  }

  if (hasResult) {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full" style={{ background: 'var(--state-ok-soft)' }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--state-ok)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      </span>
    )
  }

  return (
    <span className="inline-block h-3.5 w-3.5 rounded-full opacity-30" style={{ backgroundColor: 'var(--fg-dim)' }} />
  )
}
