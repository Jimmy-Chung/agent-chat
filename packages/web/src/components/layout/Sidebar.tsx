'use client'

import { useState } from 'react'
import { useTopicStore } from '@/stores/topic-store'
import { useUiStore } from '@/stores/ui-store'
import { TopicItem } from './TopicItem'

export function Sidebar() {
  const topics = useTopicStore((s) => s.topics)
  const activeTopicId = useTopicStore((s) => s.activeTopicId)
  const selectTopic = useTopicStore((s) => s.selectTopic)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const [search, setSearch] = useState('')

  const filtered = search
    ? topics.filter((t) =>
        t.name.toLowerCase().includes(search.toLowerCase()),
      )
    : topics

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: 'var(--bg-0)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <span
          className="text-sm font-semibold"
          style={{ color: 'var(--fg-strong)' }}
        >
          Topics
        </span>
        <button
          onClick={toggleSidebar}
          className="rounded-md p-1 transition-colors hover:opacity-80"
          style={{ color: 'var(--fg-dim)' }}
          aria-label="Collapse sidebar"
        >
          <SidebarCollapseIcon />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <input
          type="text"
          placeholder="Search topics..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md px-3 py-1.5 text-sm outline-none"
          style={{
            backgroundColor: 'var(--glass-1)',
            color: 'var(--fg-regular)',
            border: '1px solid var(--stroke-inner)',
          }}
        />
      </div>

      {/* Topic list */}
      <div className="flex-1 overflow-y-auto px-2">
        {filtered.length === 0 && (
          <p
            className="px-2 py-4 text-center text-xs"
            style={{ color: 'var(--fg-dim)' }}
          >
            No topics yet
          </p>
        )}
        {filtered.map((topic) => (
          <TopicItem
            key={topic.id}
            topic={topic}
            active={topic.id === activeTopicId}
            onClick={() => selectTopic(topic.id)}
          />
        ))}
      </div>

      {/* New topic button */}
      <div className="p-3">
        <button
          className="w-full rounded-lg px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90"
          style={{
            backgroundColor: 'var(--role-user)',
            color: '#fff',
          }}
        >
          + New Topic
        </button>
      </div>
    </div>
  )
}

function SidebarCollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M10 3L5 8L10 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
