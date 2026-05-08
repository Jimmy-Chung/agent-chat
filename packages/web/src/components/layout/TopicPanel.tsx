'use client'

import { useTopicStore } from '@/stores/topic-store'
import { useUiStore } from '@/stores/ui-store'
import { EmptyState } from './EmptyState'
import { MessageInput } from './MessageInput'

export function TopicPanel() {
  const activeTopicId = useTopicStore((s) => s.activeTopicId)
  const topics = useTopicStore((s) => s.topics)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  const activeTopic = topics.find((t) => t.id === activeTopicId)

  if (!activeTopic) {
    return <EmptyState onToggleSidebar={toggleSidebar} />
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: '1px solid var(--divider)' }}
      >
        <button
          onClick={toggleSidebar}
          className="rounded-md p-1 lg:hidden"
          style={{ color: 'var(--fg-dim)' }}
          aria-label="Toggle sidebar"
        >
          <MenuIcon />
        </button>
        <div className="flex-1 min-w-0">
          <h2
            className="truncate text-sm font-semibold"
            style={{ color: 'var(--fg-strong)' }}
          >
            {activeTopic.name}
          </h2>
          <p className="text-xs" style={{ color: 'var(--fg-dim)' }}>
            {activeTopic.agent_type} / {activeTopic.current_model ?? 'default'}
          </p>
        </div>
      </div>

      {/* Message area — placeholder */}
      <div
        className="flex-1 flex items-center justify-center"
        style={{ color: 'var(--fg-dim)' }}
      >
        <p className="text-sm">Messages will appear here</p>
      </div>

      {/* Input */}
      <MessageInput topicId={activeTopic.id} />
    </div>
  )
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M3 5H15M3 9H15M3 13H15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
