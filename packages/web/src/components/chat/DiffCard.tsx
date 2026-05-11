'use client'

interface DiffCardProps {
  path: string
  before: string
  after: string
}

export function DiffCard({ path, before, after }: DiffCardProps) {
  const beforeLines = before.split('\n').length
  const afterLines = after.split('\n').length
  const added = Math.max(0, afterLines - beforeLines)
  const removed = Math.max(0, beforeLines - afterLines)

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
      {/* Left accent bar — system blue */}
      <div style={{ background: 'linear-gradient(180deg, #2090FF, #0064D8)' }} />

      <div>
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span style={{ color: '#6cb1ff' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </span>
          <span className="font-semibold" style={{ color: 'var(--fg-strong)', letterSpacing: '-0.01em' }}>Edit</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-code)', fontSize: 12 }}>{path}</span>
          <span className="ml-auto text-[11px]" style={{ color: 'var(--fg-dim)', fontFeatureSettings: '"tnum"' }}>
            {added > 0 && <span style={{ color: 'var(--state-ok)' }}>+{added}</span>}
            {added > 0 && removed > 0 && ' '}
            {removed > 0 && <span style={{ color: 'var(--state-danger)' }}>-{removed}</span>}
          </span>
        </div>

        {/* Diff content */}
        <div style={{ borderTop: '1px solid var(--hairline)' }}>
          {before && (
            <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--hairline)' }}>
              <p className="mb-1 text-[10px] uppercase" style={{ color: 'var(--state-danger)', letterSpacing: '0.04em' }}>Before</p>
              <pre
                className="whitespace-pre-wrap break-all text-xs leading-relaxed"
                style={{ color: '#ff6b6b', fontFamily: 'var(--font-mono)' }}
              >
                {lineNumbered(before)}
              </pre>
            </div>
          )}
          {after && (
            <div className="px-3 py-2">
              <p className="mb-1 text-[10px] uppercase" style={{ color: 'var(--state-ok)', letterSpacing: '0.04em' }}>After</p>
              <pre
                className="whitespace-pre-wrap break-all text-xs leading-relaxed"
                style={{ color: '#5ae088', fontFamily: 'var(--font-mono)' }}
              >
                {lineNumbered(after)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function lineNumbered(text: string): string {
  const lines = text.split('\n')
  const width = String(lines.length).length
  return lines
    .map((line, i) => `${String(i + 1).padStart(width, ' ')} | ${line}`)
    .join('\n')
}
