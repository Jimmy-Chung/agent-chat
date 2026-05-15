'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import TextareaAutosize from 'react-textarea-autosize'
import { getWsClient } from '@/lib/ws-client'
import { useArtifactStore } from '@/stores/artifact-store'
import { useMessageStore } from '@/stores/message-store'
import { useWsStore } from '@/stores/ws-store'
import type { Artifact } from '@agent-chat/protocol'

const EMPTY_ARTIFACTS: Artifact[] = []

const MIME_ICON: Record<string, { bg: string; color: string; border: string; label: string }> = {
  xlsx: { bg: 'rgba(48,209,88,.16)', color: '#6FE39A', border: 'rgba(48,209,88,.30)', label: 'XLSX' },
  xls: { bg: 'rgba(48,209,88,.16)', color: '#6FE39A', border: 'rgba(48,209,88,.30)', label: 'XLS' },
  pdf: { bg: 'rgba(255,69,58,.16)', color: '#FF8B82', border: 'rgba(255,69,58,.30)', label: 'PDF' },
  png: { bg: 'rgba(142,140,255,.18)', color: '#B9B7FF', border: 'rgba(142,140,255,.34)', label: 'PNG' },
  jpg: { bg: 'rgba(142,140,255,.18)', color: '#B9B7FF', border: 'rgba(142,140,255,.34)', label: 'JPG' },
  jpeg: { bg: 'rgba(142,140,255,.18)', color: '#B9B7FF', border: 'rgba(142,140,255,.34)', label: 'JPG' },
  svg: { bg: 'rgba(142,140,255,.18)', color: '#B9B7FF', border: 'rgba(142,140,255,.34)', label: 'SVG' },
  md: { bg: 'rgba(247,194,107,.16)', color: 'var(--role-cron)', border: 'rgba(247,194,107,.32)', label: 'MD' },
  json: { bg: 'var(--glass-2)', color: 'var(--fg-regular)', border: 'var(--hairline)', label: 'JSON' },
  csv: { bg: 'rgba(48,209,88,.10)', color: '#6FE39A', border: 'rgba(48,209,88,.22)', label: 'CSV' },
  doc: { bg: 'rgba(10,132,255,.14)', color: '#7CB6FF', border: 'rgba(10,132,255,.32)', label: 'DOC' },
  docx: { bg: 'rgba(10,132,255,.14)', color: '#7CB6FF', border: 'rgba(10,132,255,.32)', label: 'DOC' },
}

function getExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTimeShort(ts: number): string {
  const diffMs = Date.now() - ts
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} 小时前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

type FilterType = 'all' | 'spreadsheet' | 'image' | 'document'

const FILTER_MAP: Record<FilterType, (ext: string) => boolean> = {
  all: () => true,
  spreadsheet: (ext) => ['xlsx', 'xls', 'csv'].includes(ext),
  image: (ext) => ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].includes(ext),
  document: (ext) => ['pdf', 'md', 'doc', 'docx', 'txt', 'json'].includes(ext),
}

interface Mention {
  id: string
  name: string
}

interface MessageInputProps {
  topicId: string
}

export function MessageInput({ topicId }: MessageInputProps) {
  const [value, setValue] = useState('')
  const [mentions, setMentions] = useState<Mention[]>([])
  const [uploading, setUploading] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerTab, setPickerTab] = useState<'topic' | 'pool'>('topic')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [filterType, setFilterType] = useState<FilterType>('all')
  const pickerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wsClient = getWsClient()

  const streamingTopicId = useMessageStore((s) => s.streamingTopicId)
  const isStreaming = streamingTopicId === topicId
  const agentStatus = useMessageStore((s) => s.agentStatusByTopic[topicId])
  const isAgentActive = ['thinking', 'tool', 'streaming', 'aborting'].includes(agentStatus ?? '')
  const hasPendingUserMessage = useMessageStore((s) => {
    const msgs = s.byTopic[topicId]
    if (!msgs?.length) return false
    const last = msgs[msgs.length - 1]
    return last?.role === 'user' && last?.status === 'pending'
  })
  const showStopButton = isStreaming || isAgentActive || hasPendingUserMessage
  const sessionReady = useWsStore((s) => s.sessionReadyByTopic[topicId])
  const sessionLoading = sessionReady !== true

  const topicArtifacts = useArtifactStore((s) => s.byTopic[topicId] ?? EMPTY_ARTIFACTS)
  const poolArtifacts = useArtifactStore((s) => s.poolArtifacts)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    if (showPicker) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return

    const sent = wsClient.send({
      type: 'user.message',
      data: {
        topicId,
        content: trimmed,
        clientMessageId: `cm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        mentions: mentions.map((m) => ({ id: m.id, name: m.name })),
      },
    })
    if (!sent) return
    setValue('')
    setMentions([])
  }, [value, topicId, wsClient, mentions])

  const handleAbort = useCallback(() => {
    wsClient.send({
      type: 'user.action',
      data: { topicId, action: 'abort' },
    })
  }, [topicId, wsClient])

  const handleFileUpload = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const ready = await new Promise<{ uploadId: string; uploadUrl: string; method: 'PUT' }>((resolve, reject) => {
        const onReady = (event: MessageEvent | Event) => {
          const detail = (event as CustomEvent).detail as { uploadId: string; uploadUrl: string; method: 'PUT' }
          cleanup()
          resolve(detail)
        }
        const onError = (event: MessageEvent | Event) => {
          const detail = (event as CustomEvent).detail as { code?: string; message?: string }
          cleanup()
          reject(new Error(detail.message ?? detail.code ?? 'Upload init failed'))
        }
        const cleanup = () => {
          window.removeEventListener('agent-chat:artifact-upload-ready', onReady)
          window.removeEventListener('agent-chat:error', onError)
        }
        window.addEventListener('agent-chat:artifact-upload-ready', onReady, { once: true })
        window.addEventListener('agent-chat:error', onError, { once: true })
        wsClient.send({
          type: 'artifact.upload.init',
          data: {
            topicId,
            name: file.name,
            mime: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          },
        })
      })
      const response = await fetch(ready.uploadUrl, {
        method: ready.method,
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
      wsClient.send({
        type: 'artifact.upload.complete',
        data: { uploadId: ready.uploadId, topicId },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      console.error('Artifact upload failed', error)
      window.alert(`上传失败: ${message}`)
    } finally {
      setUploading(false)
    }
  }, [topicId, wsClient])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setValue(v)

    const cursorPos = e.target.selectionStart
    const textBefore = v.slice(0, cursorPos)
    const atMatch = textBefore.match(/@(\S*)$/)
    if (atMatch) {
      setShowPicker(true)
      setPickerQuery(atMatch[1].toLowerCase())
      setPickerTab('topic')
      setHighlightIndex(0)
    } else {
      setShowPicker(false)
    }
  }

  const selectArtifact = (artifact: Artifact) => {
    const cursorPos = value.length
    const textBeforeCursor = value.slice(0, cursorPos)
    const replaced = textBeforeCursor.replace(/@\S*$/, `@${artifact.name} `)
    const newText = replaced + value.slice(cursorPos)
    setValue(newText)

    if (!mentions.find((m) => m.id === artifact.id)) {
      setMentions((prev) => [...prev, { id: artifact.id, name: artifact.name }])
    }
    setShowPicker(false)

    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      const caret = replaced.length
      el.setSelectionRange(caret, caret)
    })
  }

  const removeMention = (id: string) => {
    setMentions((prev) => prev.filter((m) => m.id !== id))
  }

  // Build filtered artifact list
  const filteredArtifacts = useMemo(() => {
    const source = pickerTab === 'topic' ? topicArtifacts : poolArtifacts
    return source
      .filter((a) => {
        if ((a.upload_status ?? 'uploaded') !== 'uploaded') return false
        if (pickerQuery && !a.name.toLowerCase().includes(pickerQuery)) return false
        const ext = getExt(a.name)
        return FILTER_MAP[filterType](ext)
      })
      .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
  }, [pickerTab, topicArtifacts, poolArtifacts, pickerQuery, filterType])

  // Group artifacts
  const { recent, older } = useMemo(() => {
    const thirtyMinAgo = Date.now() - 30 * 60 * 1000
    const recent = filteredArtifacts.filter((a) => (a.created_at ?? 0) > thirtyMinAgo)
    const older = filteredArtifacts.filter((a) => (a.created_at ?? 0) <= thirtyMinAgo)
    return { recent, older }
  }, [filteredArtifacts])

  // Keyboard navigation for picker
  useEffect(() => {
    if (!showPicker) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightIndex((i) => (i + 1) % filteredArtifacts.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightIndex((i) => (i - 1 + filteredArtifacts.length) % filteredArtifacts.length)
      } else if (e.key === 'Enter' && filteredArtifacts[highlightIndex]) {
        e.preventDefault()
        selectArtifact(filteredArtifacts[highlightIndex])
      } else if (e.key === 'Tab') {
        e.preventDefault()
        setPickerTab((t) => (t === 'topic' ? 'pool' : 'topic'))
        setHighlightIndex(0)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setShowPicker(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showPicker, filteredArtifacts, highlightIndex])

  const topicCount = topicArtifacts.length
  const poolCount = poolArtifacts.length

  return (
    <div className="px-6 pb-5 pt-2">
      {/* Mention chips */}
      {mentions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {mentions.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              style={{ background: 'var(--glass-2)', color: 'var(--fg-regular)' }}
            >
              @{m.name}
              <button onClick={() => removeMention(m.id)} className="ml-0.5 opacity-60 hover:opacity-100">&times;</button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".txt,.md,.json,.csv,.html,.css,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf,.doc,.docx,.xls,.xlsx"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.currentTarget.value = ''
            if (file) void handleFileUpload(file)
          }}
        />
        {/* Artifact selector popover (S6) */}
        {showPicker && (
          <div
            ref={pickerRef}
            className="absolute bottom-full left-0 z-20 flex flex-col overflow-hidden"
            style={{
              width: 'min(640px, 100%)',
              maxHeight: 400,
              marginBottom: 8,
              borderRadius: 'var(--r-modal, 20px)',
              background: 'var(--glass-modal, rgba(20,22,27,0.72))',
              WebkitBackdropFilter: 'blur(60px) saturate(200%)',
              backdropFilter: 'blur(60px) saturate(200%)',
              border: '1px solid var(--hairline-2, rgba(255,255,255,0.14))',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.6)',
            }}
          >
            {/* Tab bar */}
            <div
              className="flex shrink-0 items-center gap-3.5"
              style={{ padding: '14px 16px 0', borderBottom: '1px solid var(--hairline)' }}
            >
              <div className="flex gap-0 flex-1">
                <button
                  onClick={() => { setPickerTab('topic'); setHighlightIndex(0) }}
                  className="relative inline-flex items-center gap-1.5"
                  style={{
                    height: 36,
                    padding: '0 14px',
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: pickerTab === 'topic' ? 'var(--fg-strong)' : 'var(--fg-dim)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                  </svg>
                  当前话题
                  <span
                    className="inline-flex items-center gap-0.5"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      padding: '1px 6px',
                      borderRadius: 8,
                      background: pickerTab === 'topic' ? 'rgba(10,132,255,.12)' : 'var(--glass-1)',
                      border: pickerTab === 'topic' ? '1px solid rgba(10,132,255,.35)' : '1px solid var(--hairline)',
                      color: pickerTab === 'topic' ? '#6cb1ff' : 'var(--fg-dim)',
                    }}
                  >
                    {topicCount}
                  </span>
                  {pickerTab === 'topic' && (
                    <span style={{ position: 'absolute', left: 8, right: 8, bottom: -1, height: 2, background: 'var(--role-user)', borderRadius: '2px 2px 0 0' }} />
                  )}
                </button>
                <button
                  onClick={() => { setPickerTab('pool'); setHighlightIndex(0) }}
                  className="relative inline-flex items-center gap-1.5"
                  style={{
                    height: 36,
                    padding: '0 14px',
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: pickerTab === 'pool' ? 'var(--fg-strong)' : 'var(--fg-dim)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4" /><path d="M12 11v10" />
                  </svg>
                  产物池
                  <span
                    className="inline-flex items-center gap-0.5"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      padding: '1px 6px',
                      borderRadius: 8,
                      background: pickerTab === 'pool' ? 'rgba(10,132,255,.12)' : 'var(--glass-1)',
                      border: pickerTab === 'pool' ? '1px solid rgba(10,132,255,.35)' : '1px solid var(--hairline)',
                      color: pickerTab === 'pool' ? '#6cb1ff' : 'var(--fg-dim)',
                    }}
                  >
                    {poolCount}
                  </span>
                  {pickerTab === 'pool' && (
                    <span style={{ position: 'absolute', left: 8, right: 8, bottom: -1, height: 2, background: 'var(--role-user)', borderRadius: '2px 2px 0 0' }} />
                  )}
                </button>
              </div>
            </div>

            {/* Search + filter */}
            <div className="flex shrink-0 items-center gap-2" style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--hairline)' }}>
              <div
                className="flex flex-1 items-center gap-2"
                style={{ height: 32, padding: '0 10px', background: 'rgba(0,0,0,.32)', border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 13 }}
              >
                <span style={{ color: 'var(--fg-dim)', display: 'inline-flex' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                </span>
                <input
                  value={pickerQuery}
                  onChange={(e) => { setPickerQuery(e.target.value.toLowerCase()); setHighlightIndex(0) }}
                  placeholder="搜索产物..."
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color: 'var(--fg-strong)', letterSpacing: '-0.005em' }}
                  autoFocus
                />
              </div>

              {/* Wide: pill buttons */}
              <div className="hidden sm:flex items-center gap-1.5">
                {(['all', 'spreadsheet', 'image', 'document'] as FilterType[]).map((ft) => (
                  <button
                    key={ft}
                    onClick={() => { setFilterType(ft); setHighlightIndex(0) }}
                    className="inline-flex items-center"
                    style={{
                      height: 24,
                      padding: '0 9px',
                      borderRadius: 8,
                      fontSize: 11.5,
                      background: filterType === ft ? 'rgba(10,132,255,.14)' : 'var(--glass-1)',
                      border: filterType === ft ? '1px solid rgba(10,132,255,.32)' : '1px solid var(--hairline)',
                      color: filterType === ft ? '#7CB6FF' : 'var(--fg-regular)',
                    }}
                  >
                    {ft === 'all' ? '全部' : ft === 'spreadsheet' ? '表格' : ft === 'image' ? '图片' : '文档'}
                  </button>
                ))}
              </div>

              {/* Narrow: dropdown select */}
              <select
                className="sm:hidden"
                value={filterType}
                onChange={(e) => { setFilterType(e.target.value as FilterType); setHighlightIndex(0) }}
                style={{
                  height: 28,
                  padding: '0 6px',
                  borderRadius: 8,
                  fontSize: 12,
                  flexShrink: 0,
                  background: 'var(--glass-1)',
                  border: '1px solid var(--hairline)',
                  color: 'var(--fg-regular)',
                  outline: 'none',
                }}
              >
                <option value="all">全部</option>
                <option value="spreadsheet">表格</option>
                <option value="image">图片</option>
                <option value="document">文档</option>
              </select>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,.18) transparent' }}>
              {filteredArtifacts.length === 0 && (
                <p className="px-4 py-6 text-center text-xs" style={{ color: 'var(--fg-dim)' }}>无匹配产物</p>
              )}

              {recent.length > 0 && (
                <>
                  <div className="flex items-center gap-2" style={{ padding: '8px 16px 4px', fontSize: 10, color: 'var(--fg-dim)', letterSpacing: '.10em', textTransform: 'uppercase', fontWeight: 600 }}>
                    <span>最近用过</span>
                    <span style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
                  </div>
                  {recent.map((a, idx) => {
                    const globalIdx = idx
                    return (
                      <ArtifactRow
                        key={a.id}
                        artifact={a}
                        highlighted={globalIdx === highlightIndex}
                        onClick={() => selectArtifact(a)}
                        onHover={() => setHighlightIndex(globalIdx)}
                      />
                    )
                  })}
                </>
              )}

              {older.length > 0 && (
                <>
                  <div className="flex items-center gap-2" style={{ padding: '8px 16px 4px', fontSize: 10, color: 'var(--fg-dim)', letterSpacing: '.10em', textTransform: 'uppercase', fontWeight: 600 }}>
                    <span>本话题其它</span>
                    <span style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
                  </div>
                  {older.map((a, idx) => {
                    const globalIdx = recent.length + idx
                    return (
                      <ArtifactRow
                        key={a.id}
                        artifact={a}
                        highlighted={globalIdx === highlightIndex}
                        onClick={() => selectArtifact(a)}
                        onHover={() => setHighlightIndex(globalIdx)}
                      />
                    )
                  })}
                </>
              )}
            </div>

            {/* Footer — hide on narrow viewports */}
            <div
              className="hidden sm:flex shrink-0 items-center gap-3.5"
              style={{ height: 36, borderTop: '1px solid var(--hairline)', padding: '0 14px', fontSize: 11.5, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}
            >
              <span className="inline-flex items-center gap-1">
                <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', borderRadius: 4, padding: '1px 5px', fontFamily: 'inherit', fontSize: 10, color: 'var(--fg-regular)' }}>↑</kbd>
                <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', borderRadius: 4, padding: '1px 5px', fontFamily: 'inherit', fontSize: 10, color: 'var(--fg-regular)' }}>↓</kbd>
                {' '}移动
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', borderRadius: 4, padding: '1px 5px', fontFamily: 'inherit', fontSize: 10, color: 'var(--fg-regular)' }}>↵</kbd>
                {' '}引用
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', borderRadius: 4, padding: '1px 5px', fontFamily: 'inherit', fontSize: 10, color: 'var(--fg-regular)' }}>Tab</kbd>
                {' '}切 Tab
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', borderRadius: 4, padding: '1px 5px', fontFamily: 'inherit', fontSize: 10, color: 'var(--fg-regular)' }}>Esc</kbd>
                {' '}关闭
              </span>
              {filteredArtifacts[highlightIndex] && (
                <span className="ml-auto" style={{ color: 'var(--fg-regular)' }}>
                  已选中 <b style={{ color: 'var(--fg-strong)', fontWeight: 600 }}>{filteredArtifacts[highlightIndex].name}</b>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Composer */}
        <div
          className="grid gap-2.5 rounded-2xl px-3.5 py-3"
          style={{
            background: 'var(--glass-1)',
            border: '1px solid var(--hairline-2)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            backdropFilter: 'blur(40px) saturate(180%)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          <TextareaAutosize
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={isStreaming || sessionLoading ? undefined : handleKeyDown}
            placeholder={sessionLoading ? '正在连接 Agent...' : isStreaming ? 'Agent 正在回复...' : '回复 agent…  按 ⌘↩ 发送 · @ 提及文件 · / 触发命令'}
            maxRows={6}
            disabled={isStreaming || sessionLoading}
            className="min-h-[22px] flex-1 resize-none bg-transparent text-sm outline-none disabled:opacity-50"
            style={{ color: 'var(--fg-strong)', lineHeight: 1.5, letterSpacing: '-0.005em' }}
          />

          {/* Toolbar */}
          <div className="flex items-center gap-1.5">
            <div className="flex gap-1">
              <button
                title="附件"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors disabled:opacity-50"
                style={{ color: uploading ? 'var(--role-user)' : 'var(--fg-dim)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
              </button>
              <button title="提及" onClick={() => { setShowPicker(true); setPickerQuery(''); setHighlightIndex(0) }} className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors" style={{ color: 'var(--fg-dim)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" /></svg>
              </button>
              <button title="命令" className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors" style={{ color: 'var(--fg-dim)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-12" /></svg>
              </button>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {showStopButton ? (
                <button
                  onClick={handleAbort}
                  className="flex h-7 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ color: 'var(--state-danger)', background: 'var(--glass-1)', border: '1px solid var(--hairline)' }}
                >
                  <StopIcon />
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!value.trim() || sessionLoading}
                  className="flex h-7 w-7 items-center justify-center rounded-full transition-opacity disabled:opacity-30"
                  style={{
                    background: value.trim()
                      ? 'linear-gradient(180deg, #2090FF, #0A84FF 60%, #0064D8)'
                      : 'var(--glass-2)',
                    color: value.trim() ? '#fff' : 'var(--fg-dim)',
                    boxShadow: value.trim()
                      ? 'inset 0 1px 0 rgba(255,255,255,0.30), 0 4px 12px rgba(10,132,255,0.45)'
                      : 'inset 0 0 0 1px var(--hairline)',
                  }}
                  aria-label="Send message"
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ArtifactRow({ artifact, highlighted, onClick, onHover }: {
  artifact: Artifact
  highlighted: boolean
  onClick: () => void
  onHover: () => void
}) {
  const ext = getExt(artifact.name)
  const icon = MIME_ICON[ext]

  return (
    <div
      onClick={onClick}
      onMouseEnter={onHover}
      className="grid cursor-default items-center"
      style={{
        gridTemplateColumns: '32px 1fr auto auto',
        columnGap: 12,
        padding: '8px 16px',
        fontSize: 13,
        background: highlighted ? 'rgba(10,132,255,.16)' : 'transparent',
        boxShadow: highlighted ? 'inset 0 0 0 1px rgba(10,132,255,.35)' : 'none',
      }}
    >
      {/* Mime icon */}
      <div
        className="grid place-items-center"
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          fontFamily: 'var(--font-mono)',
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '.04em',
          background: icon?.bg ?? 'var(--glass-2)',
          color: icon?.color ?? 'var(--fg-regular)',
          border: `1px solid ${icon?.border ?? 'var(--hairline)'}`,
        }}
      >
        {icon?.label ?? ext.toUpperCase().slice(0, 3)}
      </div>

      {/* Name + meta */}
      <div className="flex min-w-0 flex-col gap-px">
        <div className="truncate" style={{ color: 'var(--fg-strong)', fontWeight: 500, letterSpacing: '-0.01em', fontSize: 13.5 }}>
          {artifact.name}
        </div>
        <div className="flex items-center gap-2" style={{ color: 'var(--fg-dim)', fontSize: 11.5 }}>
          <span className="inline-flex items-center gap-1" style={{ color: 'var(--fg-regular)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
            </svg>
            {artifact.topic_id ? '本话题' : '产物池'}
          </span>
          <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'var(--fg-dim)' }} />
          <span>{formatTimeShort(artifact.created_at)}</span>
        </div>
      </div>

      {/* Size */}
      <span style={{ color: highlighted ? 'var(--fg-regular)' : 'var(--fg-dim)', fontFamily: 'var(--font-mono)', fontSize: 11.5, fontFeatureSettings: '"tnum"' }}>
        {formatSize(artifact.size_bytes)}
      </span>

      {/* Enter hint */}
      {highlighted && (
        <span className="inline-flex items-center gap-1" style={{ color: 'var(--fg-dim)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', borderRadius: 4, padding: '1px 5px', fontFamily: 'inherit', fontSize: 10, color: 'var(--fg-regular)' }}>↵</kbd>
          {' '}引用
        </span>
      )}
    </div>
  )
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" /><polyline points="6 11 12 5 18 11" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" />
    </svg>
  )
}
