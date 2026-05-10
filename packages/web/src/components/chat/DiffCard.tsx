'use client'

interface DiffCardProps {
  path: string
  before: string
  after: string
}

export function DiffCard({ path, before, after }: DiffCardProps) {
  return (
    <div
      className="my-1.5 rounded-xl overflow-hidden text-sm"
      style={{
        backgroundColor: 'var(--glass-1)',
        border: '1px solid var(--stroke-inner)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid var(--stroke-inner)' }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 5H11M7 2V12M5 10L7 12L9 10"
            stroke="var(--fg-dim)"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span
          className="truncate font-medium"
          style={{ color: 'var(--fg-strong)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
        >
          {path}
        </span>
      </div>

      {/* Before */}
      {before && (
        <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--stroke-inner)' }}>
          <p className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--state-danger)' }}>
            Before
          </p>
          <pre
            className="overflow-x-auto whitespace-pre-wrap break-all text-xs leading-relaxed"
            style={{ color: '#ff6b6b', fontFamily: 'var(--font-mono)' }}
          >
            {lineNumbered(before)}
          </pre>
        </div>
      )}

      {/* After */}
      {after && (
        <div className="px-3 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: '#34c759' }}>
            After
          </p>
          <pre
            className="overflow-x-auto whitespace-pre-wrap break-all text-xs leading-relaxed"
            style={{ color: '#5ae088', fontFamily: 'var(--font-mono)' }}
          >
            {lineNumbered(after)}
          </pre>
        </div>
      )}
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
