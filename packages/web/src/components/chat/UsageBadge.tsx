'use client'

interface UsageBadgeProps {
  inputTokens: number
  outputTokens: number
  model?: string
}

export function UsageBadge({ inputTokens, outputTokens, model }: UsageBadgeProps) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px]"
      style={{
        backgroundColor: 'var(--glass-1)',
        color: 'var(--fg-dim)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {model && <span className="opacity-70">{model}</span>}
      <span>{inputTokens.toLocaleString()} in</span>
      <span style={{ color: 'var(--divider)' }}>|</span>
      <span>{outputTokens.toLocaleString()} out</span>
    </div>
  )
}
