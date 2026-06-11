'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import TextareaAutosize from 'react-textarea-autosize'
import { getWsClient } from '@/lib/ws-client'
import { buildModelOptions } from '@/lib/model-mapping'
import { buildPastedName, extractImageFiles } from '@/lib/paste-image'
import { referenceRoleLabel, summarizeReference } from '@/lib/message-references'
import { useArtifactStore } from '@/stores/artifact-store'
import { useMessageStore, type PendingMessage } from '@/stores/message-store'
import { useTopicStore } from '@/stores/topic-store'
import { useWsStore } from '@/stores/ws-store'
import type { Artifact, MessageReference } from '@agent-chat/protocol'

const EMPTY_ARTIFACTS: Artifact[] = []
const EMPTY_PENDING: PendingMessage[] = []
const EMPTY_REFERENCES: MessageReference[] = []

// 单条消息的「简洁回答」开关：开启时把这条指令拼到发送内容末尾，引导 agent 简短作答。
const CONCISE_DIRECTIVE = '（请用最直接、最简洁、逻辑最清晰、术语最少的方式回答上面的问题。）'

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
  const [draftsByTopic, setDraftsByTopic] = useState<Record<string, string>>({})
  const [mentionsByTopic, setMentionsByTopic] = useState<Record<string, Mention[]>>({})
  const [uploading, setUploading] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerTab, setPickerTab] = useState<'topic' | 'pool'>('topic')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [filterType, setFilterType] = useState<FilterType>('all')
  // 单条消息的「简洁回答」开关，按 topic 维护，发送后自动关闭。
  const [conciseByTopic, setConciseByTopic] = useState<Record<string, boolean>>({})
  const conciseMode = conciseByTopic[topicId] ?? false
  const setConciseMode = useCallback(
    (next: boolean) => setConciseByTopic((prev) => ({ ...prev, [topicId]: next })),
    [topicId],
  )
  const pickerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve())
  const wsClient = getWsClient()
  const value = draftsByTopic[topicId] ?? ''
  const mentions = mentionsByTopic[topicId] ?? []

  const setTopicValue = useCallback((next: string) => {
    setDraftsByTopic((prev) => {
      if (!next) {
        const { [topicId]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [topicId]: next }
    })
  }, [topicId])

  const setTopicMentions = useCallback((next: Mention[] | ((prev: Mention[]) => Mention[])) => {
    setMentionsByTopic((prev) => {
      const current = prev[topicId] ?? []
      const resolved = typeof next === 'function' ? next(current) : next
      if (resolved.length === 0) {
        const { [topicId]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [topicId]: resolved }
    })
  }, [topicId])

  const agentStatus = useMessageStore((s) => s.agentStatusByTopic[topicId])
  const isAgentActive = agentStatus === 'processing' || agentStatus === 'aborting'
  const hasPendingUserMessage = useMessageStore((s) => {
    const msgs = s.byTopic[topicId]
    if (!msgs?.length) return false
    const last = msgs[msgs.length - 1]
    return last?.role === 'user' && last?.status === 'pending'
  })
  const pendingMessages = useMessageStore((s) => s.pendingMessagesByTopic[topicId] ?? EMPTY_PENDING)
  const composerReferences = useMessageStore((s) => s.composerReferencesByTopic[topicId] ?? EMPTY_REFERENCES)
  const sessionReady = useWsStore((s) => s.sessionReadyByTopic[topicId])
  const sessionLoading = sessionReady !== true

  const activeTopic = useTopicStore((s) => s.topics.find((t) => t.id === topicId))
  const currentModel = activeTopic?.current_model

  useEffect(() => {
    if (!hasPendingUserMessage && !isAgentActive) return
    const timer = window.setInterval(() => {
      useMessageStore.getState().reconcileAgentStatusFromMessages(topicId)
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [hasPendingUserMessage, isAgentActive, topicId])

  const providerConfigs = useWsStore((s) => s.providerConfigs)
  // Models are scoped to the provider this topic was created with (bound at creation,
  // immutable per topic). Legacy topics created before provider binding have no
  // current_provider_id — fall back to the globally-active provider's models so they
  // aren't left without a selector.
  const boundProvider = activeTopic?.current_provider_id
    ? providerConfigs.find((c) => c.id === activeTopic.current_provider_id)
    : undefined
  // Fallback provider must match the topic's agent type so PI topics never
  // pick up a Claude Code / Codex provider (which has alias models like opus).
  const isProgramming = activeTopic?.agent_type === 'programming'
  const fallbackProvider = providerConfigs.find((c) =>
    c.isActive && (isProgramming || (c.group ?? 'pi-agent') === 'pi-agent'),
  )
  const modelProvider = boundProvider ?? (activeTopic?.current_provider_id ? undefined : fallbackProvider)
  const availableModels = modelProvider?.models ?? []
  // claude-code 别名映射：下拉展示「opus → glm5.1」，但 value 仍传别名（adapter 内部解析）。
  const modelOptions = buildModelOptions(availableModels, modelProvider?.modelMapping)

  const [selectedModel, setSelectedModel] = useState<string>(currentModel ?? '')

  // Sync current model from topic
  useEffect(() => {
    setSelectedModel(currentModel ?? '')
  }, [currentModel])

  // Auto-select first model when topic has no model set yet
  useEffect(() => {
    if (!selectedModel && availableModels.length > 0) {
      const first = availableModels[0]
      setSelectedModel(first)
      getWsClient().send({
        type: 'topic.setModel',
        data: { id: topicId, model: first },
      })
    }
  }, [selectedModel, availableModels, topicId])

  // When model changes, tell server → adapter
  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model)
    getWsClient().send({
      type: 'topic.setModel',
      data: { id: topicId, model },
    })
  }, [topicId])

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

    const clientMessageId = `cm-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const outgoing = conciseMode ? `${trimmed}\n\n${CONCISE_DIRECTIVE}` : trimmed

    if (agentStatus === 'processing') {
      useMessageStore.getState().addPendingMessage(topicId, outgoing, clientMessageId, composerReferences)
      setTopicValue('')
      setTopicMentions([])
      useMessageStore.getState().clearComposerReferences(topicId)
      setConciseMode(false)
      return
    }

    const sent = wsClient.send({
      type: 'user.message',
      data: {
        topicId,
        content: outgoing,
        clientMessageId,
        mentions: mentions.map((m) => ({ id: m.id, name: m.name })),
        references: composerReferences,
      },
    })
    if (!sent) return
    setTopicValue('')
    setTopicMentions([])
    useMessageStore.getState().clearComposerReferences(topicId)
    setConciseMode(false)
  }, [value, topicId, wsClient, mentions, composerReferences, agentStatus, conciseMode, setConciseMode, setTopicValue, setTopicMentions])

  // Append `@name ` to the current topic's draft using a functional update so
  // it stays correct even when called from an async upload callback (where the
  // captured `value` may be stale).
  const appendMentionText = useCallback((name: string) => {
    setDraftsByTopic((prev) => {
      const cur = prev[topicId] ?? ''
      const sep = cur && !/\s$/.test(cur) ? ' ' : ''
      return { ...prev, [topicId]: `${cur}${sep}@${name} ` }
    })
  }, [topicId])

  // After an upload completes the artifact arrives asynchronously via the
  // `artifact.added` WS event → artifact store. Wait for the artifact whose name
  // matches the one we uploaded, so we can auto-reference it.
  const waitForArtifactByName = useCallback((name: string, timeoutMs = 8000) => {
    return new Promise<Artifact | null>((resolve) => {
      const find = () => useArtifactStore.getState().byTopic[topicId]?.find((a) => a.name === name)
      const existing = find()
      if (existing) {
        resolve(existing)
        return
      }
      const timer = setTimeout(() => {
        unsub()
        resolve(null)
      }, timeoutMs)
      const unsub = useArtifactStore.subscribe((state) => {
        const found = state.byTopic[topicId]?.find((a) => a.name === name)
        if (found) {
          clearTimeout(timer)
          unsub()
          resolve(found)
        }
      })
    })
  }, [topicId])

  const handleFileUpload = useCallback((file: File, opts?: { autoReference?: boolean }) => {
    const run = async () => {
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
        if (opts?.autoReference) {
          const artifact = await waitForArtifactByName(file.name)
          if (artifact) {
            setTopicMentions((prev) =>
              prev.find((m) => m.id === artifact.id) ? prev : [...prev, { id: artifact.id, name: artifact.name }],
            )
            appendMentionText(artifact.name)
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed'
        console.error('Artifact upload failed', error)
        window.alert(`上传失败: ${message}`)
      } finally {
        setUploading(false)
      }
    }

    const next = uploadQueueRef.current.catch(() => undefined).then(run)
    uploadQueueRef.current = next.catch(() => undefined)
    return next
  }, [topicId, wsClient, waitForArtifactByName, setTopicMentions, appendMentionText])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (sessionLoading) return
      const images = extractImageFiles(e.clipboardData)
      if (images.length === 0) return // let plain text / non-image paste behave normally
      e.preventDefault()
      images.forEach((file, i) => {
        const name = buildPastedName(file.type, Date.now() + i)
        const renamed = new File([file], name, { type: file.type || 'image/png' })
        void handleFileUpload(renamed, { autoReference: true })
      })
    },
    [sessionLoading, handleFileUpload],
  )

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setTopicValue(v)

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
    setTopicValue(newText)

    if (!mentions.find((m) => m.id === artifact.id)) {
      setTopicMentions((prev) => [...prev, { id: artifact.id, name: artifact.name }])
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
    setTopicMentions((prev) => prev.filter((m) => m.id !== id))
  }

  const removeReference = (messageId: string) => {
    useMessageStore.getState().removeComposerReference(topicId, messageId)
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

  const removePending = useCallback((id: string) => {
    useMessageStore.getState().removePendingMessage(topicId, id)
  }, [topicId])

  const clearAllPending = useCallback(() => {
    useMessageStore.getState().clearPendingMessages(topicId)
  }, [topicId])

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

      {/* Message reference chips */}
      {composerReferences.length > 0 && (
        <div className="mb-2 grid gap-1.5">
          {composerReferences.map((ref) => (
            <div
              key={ref.messageId}
              className="flex min-w-0 items-start gap-2 rounded-lg px-2.5 py-2"
              style={{
                background: 'rgba(10,132,255,0.10)',
                border: '1px solid rgba(10,132,255,0.24)',
              }}
            >
              <span
                className="mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  color: '#7CB6FF',
                  background: 'rgba(10,132,255,0.14)',
                  letterSpacing: '0.02em',
                }}
              >
                {referenceRoleLabel(ref.role)}
              </span>
              <span className="min-w-0 flex-1 text-xs leading-5" style={{ color: 'var(--fg-regular)' }}>
                {summarizeReference(ref, 220)}
              </span>
              <button
                type="button"
                onClick={() => removeReference(ref.messageId)}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-sm leading-none"
                style={{ color: 'var(--fg-dim)' }}
                aria-label="移除引用"
                title="移除引用"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pending message queue — above composer, per design spec */}
      {pendingMessages.length > 0 && (
        <div style={{ padding: '0 10px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Header */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 10.5, color: 'var(--fg-dim)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              padding: '0 4px', fontWeight: 600,
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
              background: 'var(--role-user)',
              boxShadow: '0 0 6px var(--role-user)',
              animation: 'queue-breathe 1.6s ease-in-out infinite',
              display: 'inline-block',
            }} />
            <span style={{ fontWeight: 700, color: 'var(--fg-regular)', letterSpacing: '0.04em' }}>排队中</span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: '#6cb1ff',
              background: 'rgba(10,132,255,0.12)',
              border: '1px solid rgba(10,132,255,0.30)',
              padding: '1px 6px', borderRadius: 8,
              letterSpacing: 0, textTransform: 'none',
            }}>
              {pendingMessages.length}
            </span>
            <span style={{
              marginLeft: 'auto',
              color: 'var(--fg-dim)', fontWeight: 500,
              letterSpacing: '-0.005em', textTransform: 'none', fontSize: 11,
            }}
              className="hidden sm:block"
            >
              当前消息完成后依次发送
            </span>
            <button
              onClick={clearAllPending}
              className="queue-clear-all"
              style={{
                color: 'var(--fg-dim)', fontSize: 11, fontWeight: 500,
                letterSpacing: '-0.005em', textTransform: 'none',
                padding: '2px 7px', borderRadius: 5,
              }}
            >
              全部清除
            </button>
          </div>

          {/* List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pendingMessages.map((pm, idx) => {
              const isNext = idx === 0
              return (
                <div
                  key={pm.id}
                  className="queue-item"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '22px 1fr auto auto',
                    columnGap: 10,
                    padding: '8px 8px',
                    background: isNext ? 'rgba(10,132,255,0.10)' : 'rgba(255,255,255,0.05)',
                    borderRadius: 12,
                    alignItems: 'center',
                    backdropFilter: 'blur(20px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                  }}
                >
                  {/* Sequence badge */}
                  <span style={{
                    width: 22, height: 22, borderRadius: 7,
                    background: isNext ? 'rgba(10,132,255,0.18)' : 'var(--glass-1)',
                    border: `1px solid ${isNext ? 'rgba(10,132,255,0.35)' : 'var(--hairline)'}`,
                    display: 'grid', placeItems: 'center',
                    fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600,
                    color: isNext ? '#7CB6FF' : 'var(--fg-regular)',
                    letterSpacing: 0,
                  }}>
                    {idx + 1}
                  </span>

                  {/* Message text */}
                  <span style={{
                    fontSize: 13, color: 'var(--fg-strong)',
                    letterSpacing: '-0.005em',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    lineHeight: 1.4, minWidth: 0,
                  }}>
                    {pm.content}
                  </span>

                  {/* Edit button (desktop) */}
                  <button
                    className="edit-q hidden sm:grid"
                    title="编辑"
                    style={{
                      width: 24, height: 24, placeItems: 'center',
                      borderRadius: 6, color: 'var(--fg-dim)', cursor: 'default',
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </button>

                  {/* Remove button */}
                  <button
                    className="close-q"
                    onClick={() => removePending(pm.id)}
                    title="移除"
                    style={{
                      width: 24, height: 24, display: 'grid', placeItems: 'center',
                      borderRadius: 6, color: 'var(--fg-dim)', cursor: 'default',
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
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
            if (file) void handleFileUpload(file, { autoReference: true })
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
          <div className="flex items-center gap-2">
            {availableModels.length > 0 && (
              <ProviderModelSelect
                label="Model"
                value={selectedModel}
                options={modelOptions}
                loading={false}
                onChange={handleModelChange}
              />
            )}
            <button
              type="button"
              role="switch"
              aria-checked={conciseMode}
              onClick={() => setConciseMode(!conciseMode)}
              title="豆包模式：用最直接、最简洁、术语最少的方式作答（单条生效，发送后自动关闭）"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors"
              style={{
                background: conciseMode ? 'rgba(247,194,107,0.12)' : 'var(--glass-1)',
                border: `1px solid ${conciseMode ? 'rgba(247,194,107,0.30)' : 'var(--hairline)'}`,
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', color: conciseMode ? '#F7C26B' : 'var(--fg-dim)' }}>
                DOUBAO MODE
              </span>
              <span
                style={{
                  position: 'relative',
                  width: 26,
                  height: 15,
                  flexShrink: 0,
                  borderRadius: 999,
                  background: conciseMode ? '#F7C26B' : 'var(--glass-2)',
                  border: `1px solid ${conciseMode ? 'rgba(247,194,107,0.5)' : 'var(--hairline)'}`,
                  transition: 'background 140ms ease',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 1,
                    left: conciseMode ? 12 : 1,
                    width: 11,
                    height: 11,
                    borderRadius: 999,
                    background: conciseMode ? '#1A1A1A' : 'var(--fg-dim)',
                    transition: 'left 140ms ease',
                  }}
                />
              </span>
            </button>
          </div>
          <TextareaAutosize
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={sessionLoading ? undefined : handleKeyDown}
            onPaste={handlePaste}
            placeholder={sessionLoading ? '正在连接 Agent...' : '回复 agent... 按 Enter 发送 · @ 提及文件 · 可直接粘贴图片'}
            maxRows={6}
            disabled={sessionLoading}
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
            </div>

            <div className="ml-auto flex items-center gap-2">
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

function ProviderModelSelect({
  label,
  value,
  options,
  loading,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string; group?: string }>
  loading: boolean
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  const selected = options.find((o) => o.value === value)
  // Group options
  const groups = new Map<string, Array<typeof options[0]>>()
  for (const o of options) {
    const g = o.group ?? ''
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(o)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={loading || options.length === 0}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
        style={{
          background: 'var(--glass-1)',
          border: '1px solid var(--hairline)',
          color: 'var(--fg-regular)',
          letterSpacing: '-0.005em',
        }}
      >
        <span style={{ color: 'var(--fg-dim)', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginRight: 2 }}>
          {label}
        </span>
        <span style={{ color: 'var(--fg-strong)' }}>{loading ? '…' : selected?.label ?? '—'}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--fg-dim)', marginLeft: 1 }}>
          <path d="M1.5 3L4 5.5 6.5 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && options.length > 0 && (
        <div
          className="absolute bottom-full left-0 mb-2 z-50 py-1 overflow-y-auto"
          style={{
            minWidth: 180,
            maxHeight: 240,
            borderRadius: 11,
            background: 'rgba(21,23,28,0.92)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            border: '1px solid var(--hairline-strong)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          {options.map((o) => {
            const isSelected = o.value === value
            return (
              <button
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false) }}
                className="w-full flex items-center gap-2 text-[12.5px] text-left"
                style={{
                  padding: '7px 12px',
                  color: isSelected ? 'var(--fg-strong)' : 'var(--fg-regular)',
                  background: isSelected ? 'rgba(10,132,255,.12)' : 'transparent',
                  fontWeight: isSelected ? 600 : 400,
                  letterSpacing: '-0.005em',
                }}
                onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--glass-1)' }}
                onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                {isSelected ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#0A84FF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M1.5 5l2.5 2.5 4.5-4.5" />
                  </svg>
                ) : (
                  <span style={{ width: 10, flexShrink: 0 }} />
                )}
                {o.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
