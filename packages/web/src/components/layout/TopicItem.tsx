'use client'

import { useState } from 'react'
import type { Topic } from '@agent-chat/protocol'
import { useIsMobile } from '@/hooks/use-is-mobile'

interface TopicItemProps {
  topic: Topic
  active: boolean
  onClick: () => void
  onDelete?: (id: string, name: string) => void
  badgeCount?: number
}

export function TopicItem({ topic, active, onClick, onDelete, badgeCount = 0 }: TopicItemProps) {
  const isSystem = topic.kind !== 'normal'
  const isMobile = useIsMobile()
  const [hovered, setHovered] = useState(false)
  const showDelete = !isSystem && onDelete && (hovered || isMobile)

  return (
    <button
      onClick={onClick}
      className="group/grid grid w-full grid-cols-[22px_1fr_auto] rounded-lg text-left transition-colors"
      style={{
        columnGap: 9, padding: '8px 9px 9px',
        backgroundColor: active ? 'rgba(10,132,255,0.13)' : hovered ? 'var(--glass-1)' : 'transparent',
        boxShadow: active ? 'inset 0 0 0 1px rgba(10,132,255,0.55)' : 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Icon */}
      <span
        className="flex h-[22px] w-[22px] items-center justify-center"
        style={{ color: active ? '#6cb1ff' : isSystem ? 'var(--role-cron)' : 'var(--fg-regular)', marginTop: 1 }}
      >
        <TopicIcon kind={topic.kind} agentType={topic.agent_type} />
      </span>

      {/* Body */}
      <div className="min-w-0">
        <div
          className="truncate text-[13px]"
          style={{
            color: 'var(--fg-strong)',
            fontWeight: isSystem ? 600 : 500,
            letterSpacing: '-0.01em',
          }}
        >
          {topic.name}
        </div>
        {topic.agent_type && topic.kind === 'normal' && (
          <div className="flex items-center gap-2 truncate text-[11.5px]" style={{ color: 'var(--fg-dim)', letterSpacing: '-0.005em' }}>
            <span>{topic.agent_type === 'programming' ? '编程' : '普通'}</span>
            {topic.agent_type === 'programming' && topic.plan_mode && (
              <span style={{ color: '#6cb1ff' }}>Plan</span>
            )}
          </div>
        )}
      </div>

      {/* Meta — delete icon (hover on desktop, always on mobile), else timestamp */}
      <div className="flex items-center gap-1 pt-0.5">
        {badgeCount > 0 && (
          <span
            className="inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-medium"
            style={{
              height: 18,
              background: active ? 'rgba(10,132,255,0.18)' : 'rgba(255,255,255,0.08)',
              color: active ? '#6cb1ff' : 'var(--fg-regular)',
              border: `1px solid ${active ? 'rgba(10,132,255,0.25)' : 'var(--hairline)'}`,
              fontFeatureSettings: '"tnum"',
            }}
          >
            {badgeCount}
          </span>
        )}
        {showDelete ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onDelete(topic.id, topic.name) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onDelete(topic.id, topic.name) } }}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors"
            style={{ color: 'var(--fg-dim)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--state-danger)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--fg-dim)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </span>
        ) : (
          <span className="text-[10.5px]" style={{ color: 'var(--fg-dim)', fontFeatureSettings: '"tnum"' }}>
            {formatTime(topic.updated_at)}
          </span>
        )}
      </div>
    </button>
  )
}

function TopicIcon({ kind, agentType }: { kind: Topic['kind']; agentType?: string }) {
  if (kind === 'system_cron_admin') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="13" r="7" /><path d="M12 9v4l2.5 2" /><path d="M9 2h6" /><path d="M12 2v3" />
      </svg>
    )
  }
  if (kind === 'system_artifact_pool') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4" /><path d="M12 11v10" />
      </svg>
    )
  }
  if (kind === 'system_sop_library') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    )
  }
  if (agentType === 'programming') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="8 7 3 12 8 17" /><polyline points="16 7 21 12 16 17" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </svg>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays}天前`
  return `${d.getMonth() + 1}/${d.getDate()}`
}
