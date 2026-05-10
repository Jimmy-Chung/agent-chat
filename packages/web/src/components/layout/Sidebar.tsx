'use client'

import { useState } from 'react'
import { useTopicStore } from '@/stores/topic-store'
import { useUiStore } from '@/stores/ui-store'
import { useSopTemplateStore } from '@/stores/sop-template-store'
import { TopicItem } from './TopicItem'
import { getWsClient } from '@/lib/ws-client'

type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  default: 'Default',
  acceptEdits: 'Accept Edits',
  plan: 'Plan Only',
  bypassPermissions: 'YOLO',
}

export function Sidebar() {
  const topics = useTopicStore((s) => s.topics)
  const activeTopicId = useTopicStore((s) => s.activeTopicId)
  const selectTopic = useTopicStore((s) => s.selectTopic)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const [search, setSearch] = useState('')
  const [showNewTopic, setShowNewTopic] = useState(false)
  const [newTopicName, setNewTopicName] = useState('')
  const [newTopicAgent, setNewTopicAgent] = useState<'general' | 'programming'>('general')
  const [extension, setExtension] = useState<'claude-code' | 'codex'>('claude-code')
  const [yolo, setYolo] = useState(false)
  const [cwd, setCwd] = useState('')
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const templates = useSopTemplateStore((s) => s.templates)

  const handleCreateTopic = () => {
    const name = newTopicName.trim()
    if (!name) return
    getWsClient().send({
      type: 'topic.create',
      data: {
        name,
        agentType: newTopicAgent,
        sopTemplateId: selectedTemplateId || undefined,
        ...(newTopicAgent === 'programming'
          ? { programming: { extension, yolo, ...(cwd ? { cwd } : {}), permissionMode } }
          : {}),
      },
    })
    setNewTopicName('')
    setNewTopicAgent('general')
    setYolo(false)
    setCwd('')
    setPermissionMode('default')
    setSelectedTemplateId('')
    setShowNewTopic(false)
  }

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

      {/* New topic */}
      <div className="p-3">
        {showNewTopic ? (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Topic name..."
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateTopic()
                if (e.key === 'Escape') {
                  setShowNewTopic(false)
                  setNewTopicName('')
                }
              }}
              autoFocus
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: 'var(--glass-1)',
                color: 'var(--fg-regular)',
                border: '1px solid var(--stroke-inner)',
              }}
            />

            {/* Agent type toggle */}
            <div
              className="flex gap-1 rounded-lg p-1"
              style={{ backgroundColor: 'var(--glass-1)' }}
            >
              <button
                onClick={() => setNewTopicAgent('general')}
                className="flex-1 rounded-md px-2 py-1 text-xs font-medium transition-all"
                style={{
                  backgroundColor: newTopicAgent === 'general' ? 'var(--role-user)' : 'transparent',
                  color: newTopicAgent === 'general' ? '#fff' : 'var(--fg-dim)',
                }}
              >
                General
              </button>
              <button
                onClick={() => setNewTopicAgent('programming')}
                className="flex-1 rounded-md px-2 py-1 text-xs font-medium transition-all"
                style={{
                  backgroundColor: newTopicAgent === 'programming' ? 'var(--role-user)' : 'transparent',
                  color: newTopicAgent === 'programming' ? '#fff' : 'var(--fg-dim)',
                }}
              >
                Programming
              </button>
            </div>

            {/* SOP Template selector */}
            {templates.length > 0 && (
              <label className="block">
                <span className="mb-0.5 block text-xs" style={{ color: 'var(--fg-dim)' }}>SOP 模板</span>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full rounded-md px-2 py-1.5 text-sm outline-none"
                  style={{ backgroundColor: 'var(--glass-1)', color: 'var(--fg-regular)', border: '1px solid var(--stroke-inner)' }}
                >
                  <option value="">不使用模板</option>
                  {templates
                    .filter((t) => t.agent_type === 'any' || t.agent_type === newTopicAgent)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.icon ? `${t.icon} ` : ''}{t.name}
                      </option>
                    ))}
                </select>
              </label>
            )}

            {/* Programming options */}
            {newTopicAgent === 'programming' && (
              <div className="space-y-2 rounded-lg p-2" style={{ backgroundColor: 'var(--glass-1)' }}>
                {/* Extension */}
                <label className="block">
                  <span className="mb-0.5 block text-xs" style={{ color: 'var(--fg-dim)' }}>Extension</span>
                  <select
                    value={extension}
                    onChange={(e) => setExtension(e.target.value as 'claude-code' | 'codex')}
                    className="w-full rounded-md px-2 py-1.5 text-sm outline-none"
                    style={{ backgroundColor: 'var(--bg-0)', color: 'var(--fg-regular)', border: '1px solid var(--stroke-inner)' }}
                  >
                    <option value="claude-code">Claude Code</option>
                    <option value="codex">Codex</option>
                  </select>
                </label>

                {/* Working directory */}
                <label className="block">
                  <span className="mb-0.5 block text-xs" style={{ color: 'var(--fg-dim)' }}>Working Directory (可选)</span>
                  <input
                    type="text"
                    placeholder="留空自动创建"
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                    className="w-full rounded-md px-2 py-1.5 text-sm outline-none"
                    style={{ backgroundColor: 'var(--bg-0)', color: 'var(--fg-regular)', border: '1px solid var(--stroke-inner)' }}
                  />
                </label>

                {/* Permission mode */}
                <label className="block">
                  <span className="mb-0.5 block text-xs" style={{ color: 'var(--fg-dim)' }}>Permission Mode</span>
                  <select
                    value={permissionMode}
                    onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
                    className="w-full rounded-md px-2 py-1.5 text-sm outline-none"
                    style={{ backgroundColor: 'var(--bg-0)', color: 'var(--fg-regular)', border: '1px solid var(--stroke-inner)' }}
                  >
                    {Object.entries(PERMISSION_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>

                {/* YOLO mode */}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={yolo}
                    onChange={(e) => setYolo(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-xs" style={{ color: 'var(--fg-regular)' }}>YOLO Mode</span>
                </label>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleCreateTopic}
                className="flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--role-user)', color: '#fff' }}
              >
                Create
              </button>
              <button
                onClick={() => {
                  setShowNewTopic(false)
                  setNewTopicName('')
                }}
                className="rounded-lg px-3 py-1.5 text-sm transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: 'var(--glass-1)',
                  color: 'var(--fg-dim)',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowNewTopic(true)}
            className="w-full rounded-lg px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90"
            style={{
              backgroundColor: 'var(--role-user)',
              color: '#fff',
            }}
          >
            + New Topic
          </button>
        )}
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
