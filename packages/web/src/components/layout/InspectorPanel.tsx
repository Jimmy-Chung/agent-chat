'use client'

export function InspectorPanel() {
  return (
    <div className="flex h-full flex-col">
      <div
        className="px-4 py-3"
        style={{ borderBottom: '1px solid var(--divider)' }}
      >
        <h3
          className="text-sm font-semibold"
          style={{ color: 'var(--fg-strong)' }}
        >
          Inspector
        </h3>
      </div>
      <div
        className="flex-1 flex items-center justify-center p-4"
        style={{ color: 'var(--fg-dim)' }}
      >
        <p className="text-sm">Select a message to view details</p>
      </div>
    </div>
  )
}
