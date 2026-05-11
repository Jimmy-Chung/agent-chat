'use client'

interface EmptyStateProps {
  onToggleSidebar: () => void
}

export function EmptyState({ onToggleSidebar }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{
          background: 'var(--glass-1)',
          WebkitBackdropFilter: 'blur(28px) saturate(180%)',
          backdropFilter: 'blur(28px) saturate(180%)',
          border: '1px solid var(--hairline)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <ChatIcon />
      </div>
      <div className="text-center">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--fg-strong)' }}>
          agent-chat
        </h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--fg-dim)' }}>
          选择或创建一个话题开始对话
        </p>
      </div>
      <button
        onClick={onToggleSidebar}
        className="mt-2 rounded-lg px-4 py-2 text-sm font-medium lg:hidden"
        style={{
          background: 'var(--glass-2)',
          color: 'var(--fg-regular)',
        }}
      >
        浏览话题
      </button>
    </div>
  )
}

function ChatIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <path
        d="M6 8C6 6.89543 6.89543 6 8 6H24C25.1046 6 26 6.89543 26 8V20C26 21.1046 25.1046 22 24 22H18L12 27V22H8C6.89543 22 6 21.1046 6 20V8Z"
        stroke="var(--fg-dim)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}
