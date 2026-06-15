'use client'

import type {
  AttentionGoalMeta,
  GoalAnchor,
  PlanItem,
  RawEvent,
  TraceNode,
} from '@/lib/attention'
import { resolveFocusMessageId } from '@/lib/attention'
import {
  type MindMapNode,
  buildMindMapProjection,
} from '@/lib/attention/mind-map-projector'
import { projectPlanGraph } from '@/lib/attention/plan-projector'
import { useMessageStore } from '@/stores/message-store'
import dynamic from 'next/dynamic'
import { type ReactNode, useMemo, useState } from 'react'

const MindMapGraph = dynamic(() => import('./MindMapGraph'), {
  ssr: false,
  loading: () => <EmptyHint text="加载动态树…" />,
})

function EmptyHint({ text }: { text: string }) {
  return (
    <div
      className="flex h-full items-center justify-center text-[12px]"
      style={{ color: 'var(--fg-dim)' }}
    >
      {text}
    </div>
  )
}

function eventTitle(event: RawEvent): string {
  if (event.kind === 'tool_use') return String(event.payload.name ?? '工具调用')
  if (event.kind === 'todo') return 'Todo'
  if (event.kind === 'thinking') return '思考'
  if (event.kind === 'plan') return '计划'
  return event.role === 'user' ? '用户消息' : '助手消息'
}

function eventPreview(event: RawEvent): string {
  const text =
    event.kind === 'tool_use'
      ? String(
          event.payload.output ?? JSON.stringify(event.payload.input ?? {}),
        )
      : event.kind === 'todo'
        ? todoPreview(event.payload)
        : String(event.payload.text ?? '')
  return text.replace(/\s+/g, ' ').trim()
}

function todoPreview(payload: Record<string, unknown>): string {
  const todos = (payload.input as { todos?: unknown } | undefined)?.todos
  if (!Array.isArray(todos)) return JSON.stringify(payload.input ?? {})
  return todos
    .map((item, index) => {
      const record = item as Record<string, unknown>
      const content = String(record.content ?? record.text ?? item)
      const status =
        typeof record.status === 'string' ? ` [${record.status}]` : ''
      return `${index + 1}. ${content}${status}`
    })
    .join('\n')
}

function rawMessageText(event: RawEvent): string {
  const text = typeof event.payload.text === 'string' ? event.payload.text : ''
  const options = Array.isArray(event.payload.options)
    ? event.payload.options.map((option) => String(option)).filter(Boolean)
    : []
  if (!options.length) return text
  const optionText = `候选项：${options.join('；')}`
  return text.includes(optionText)
    ? text
    : [text, optionText].filter(Boolean).join('\n')
}

type MessageDetailItem = {
  id: string
  role: 'user' | 'assistant'
  ts: number
  text: string
}

type ExecutionDetailItem = {
  id: string
  kind: 'thinking' | 'tool_use' | 'todo' | 'plan'
  title: string
  preview: string
  payload: unknown
  ts: number
}

type TimelineFilter = 'all' | 'message' | 'todo' | 'tools' | 'plan'

type TimelineItem =
  | ({ type: 'message'; filter: 'message' } & MessageDetailItem)
  | {
      type: 'execution'
      filter: 'thinking' | 'tools' | 'plan' | 'todo'
      item: ExecutionDetailItem
      ts: number
      id: string
    }

type DetailBadgeTone =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'todo'
  | 'plan'

function DetailBadge({
  label,
  tone,
}: { label: string; tone: DetailBadgeTone }) {
  const styleByTone: Record<
    DetailBadgeTone,
    { background: string; border: string; color: string }
  > = {
    user: {
      background: 'rgba(111,227,154,0.12)',
      border: '1px solid rgba(111,227,154,0.34)',
      color: '#6FE39A',
    },
    assistant: {
      background: 'rgba(125,183,255,0.12)',
      border: '1px solid rgba(125,183,255,0.34)',
      color: '#7DB7FF',
    },
    thinking: {
      background: 'rgba(247,194,107,0.12)',
      border: '1px solid rgba(247,194,107,0.34)',
      color: '#F7C26B',
    },
    tool: {
      background: 'rgba(247,162,107,0.12)',
      border: '1px solid rgba(247,162,107,0.34)',
      color: '#F7A26B',
    },
    todo: {
      background: 'rgba(207,151,255,0.12)',
      border: '1px solid rgba(207,151,255,0.34)',
      color: '#CF97FF',
    },
    plan: {
      background: 'rgba(126,232,219,0.12)',
      border: '1px solid rgba(126,232,219,0.34)',
      color: '#7EE8DB',
    },
  }
  return (
    <span
      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-[9.5px] font-semibold"
      style={styleByTone[tone]}
    >
      {label}
    </span>
  )
}

function CollapsibleText({
  text,
  className = '',
}: { text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const isLong = text.length > 220 || text.split('\n').length > 5
  return (
    <div>
      <div
        className={`${open ? 'max-h-72 overflow-auto' : 'max-h-24 overflow-hidden'} whitespace-pre-wrap break-words leading-snug ${className}`}
        style={{ color: 'var(--fg-regular)' }}
      >
        {text}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 text-[10.5px]"
          style={{ color: '#7DB7FF' }}
        >
          {open ? '收起' : '查看详情'}
        </button>
      )}
    </div>
  )
}

function MessageDetailRow({ item }: { item: MessageDetailItem }) {
  const isUser = item.role === 'user'
  return (
    <div
      className="rounded-[12px]"
      style={{
        border: '1px solid var(--hairline)',
        background: 'rgba(255,255,255,0.03)',
        padding: '11px 12px',
      }}
    >
      <div className="flex items-center gap-2" style={{ marginBottom: 7 }}>
        <DetailBadge
          label={isUser ? 'U' : 'AI'}
          tone={isUser ? 'user' : 'assistant'}
        />
        <span
          className="text-[12px] font-semibold"
          style={{ color: 'var(--fg-strong)' }}
        >
          {isUser ? '用户' : 'AI'}
        </span>
      </div>
      <CollapsibleText text={item.text} className="text-[13px]" />
    </div>
  )
}

function executionTone(
  kind: ExecutionDetailItem['kind'],
): 'thinking' | 'tool' | 'todo' | 'plan' {
  if (kind === 'tool_use') return 'tool'
  return kind
}

function executionBadgeLabel(kind: ExecutionDetailItem['kind']): string {
  if (kind === 'thinking') return 'TH'
  if (kind === 'tool_use') return 'TOOL'
  if (kind === 'todo') return 'TODO'
  return 'PLAN'
}

function ExecutionDetailRow({ item }: { item: ExecutionDetailItem }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="overflow-hidden"
      style={{
        border: '1px solid var(--hairline)',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-[9px] text-left text-[11px]"
        style={{ color: 'var(--fg-regular)', padding: '9px 11px' }}
      >
        <DetailBadge
          label={executionBadgeLabel(item.kind)}
          tone={executionTone(item.kind)}
        />
        <span
          className="shrink-0 font-medium text-[12px]"
          style={{ color: 'var(--fg-strong)' }}
        >
          {item.title}
        </span>
        <span
          className="truncate text-[11.5px]"
          style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}
        >
          {item.preview.slice(0, 120)}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 11px 9px' }}>
          <CollapsibleText
            text={
              typeof item.payload === 'string'
                ? item.payload
                : JSON.stringify(item.payload, null, 2)
            }
            className="text-[10.5px] text-[var(--fg-dim)]"
          />
        </div>
      )}
    </div>
  )
}

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.type === 'message') return <MessageDetailRow item={item} />
  return <ExecutionDetailRow item={item.item} />
}

function DetailSection({
  title,
  children,
  empty,
}: {
  title: string
  children: ReactNode
  empty?: boolean
}) {
  return (
    <section>
      <div
        style={{
          fontSize: 10,
          color: 'var(--fg-dim)',
          letterSpacing: '.10em',
          textTransform: 'uppercase',
          fontWeight: 600,
          margin: '4px 0 2px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {title}
      </div>
      {empty ? (
        <div className="text-[11px]" style={{ color: 'var(--fg-dim)' }}>
          暂无
        </div>
      ) : (
        children
      )}
    </section>
  )
}

function defaultMindNode(nodes: MindMapNode[]): MindMapNode | null {
  return (
    nodes.find((node) => node.current) ??
    [...nodes].reverse().find((node) => node.kind !== 'goal') ??
    nodes[0] ??
    null
  )
}

// ─── Goal Update Modal ────────────────────────────────────────────────────────

function GoalUpdateModal({
  goals,
  activeGoalId,
  customGoalCount,
  onClose,
  onSave,
  onSelectGoal,
  variant = 'desktop',
}: {
  goals: AttentionGoalMeta[]
  activeGoalId: string | null
  customGoalCount: number
  onClose: () => void
  onSave: (text: string) => void
  onSelectGoal: (goalId: string) => void
  variant?: 'desktop' | 'mobile'
}) {
  const isMobileModal = variant === 'mobile'
  const activeGoal = goals.find((g) => g.id === activeGoalId)
  const [draft, setDraft] = useState(activeGoal?.goal_text ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(activeGoalId)
  const remaining = Math.max(0, 2 - customGoalCount)

  const handleSelectHistoryItem = (goal: AttentionGoalMeta) => {
    setSelectedId(goal.id)
    setDraft(goal.goal_text)
  }

  const handleSave = () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      onClose()
      return
    }
    const matchingGoal = goals.find((g) => g.goal_text === trimmed)
    if (matchingGoal && matchingGoal.id !== activeGoalId) {
      onSelectGoal(matchingGoal.id)
    } else if (!matchingGoal || trimmed !== activeGoal?.goal_text) {
      onSave(trimmed)
    }
    onClose()
  }

  const saveDisabled =
    !draft.trim() ||
    (remaining === 0 && !goals.some((g) => g.goal_text === draft.trim()))

  return (
    <div
      className={
        isMobileModal
          ? 'absolute inset-0 z-40 flex'
          : 'absolute z-40 grid place-items-center'
      }
      style={{
        ...(isMobileModal
          ? { inset: 0 }
          : { top: 52, right: 0, bottom: 0, left: 0 }),
        background: 'rgba(5,6,8,0.5)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isMobileModal ? '100%' : 460,
          height: isMobileModal ? '100%' : undefined,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: isMobileModal ? 0 : 18,
          background: 'var(--glass-modal, rgba(20,22,27,0.82))',
          backdropFilter: 'blur(60px) saturate(200%)',
          WebkitBackdropFilter: 'blur(60px) saturate(200%)',
          border: isMobileModal ? 'none' : '1px solid var(--hairline-2)',
          boxShadow: isMobileModal
            ? 'none'
            : 'inset 0 1px 0 rgba(255,255,255,.08),0 30px 80px rgba(0,0,0,.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 18px 13px',
            borderBottom: '1px solid var(--hairline)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: '-.012em',
                color: 'var(--fg-strong)',
              }}
            >
              更新目标
            </h2>
            <p
              style={{
                marginTop: 4,
                fontSize: 12,
                color: 'var(--fg-dim)',
                lineHeight: 1.45,
                letterSpacing: '-.005em',
                margin: '4px 0 0',
              }}
            >
              默认目标取自话题首句。修改后可在历史目标间切换。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: 'var(--glass-1)',
              border: '1px solid var(--hairline)',
              color: 'var(--fg-regular)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            flex: isMobileModal ? 1 : undefined,
            minHeight: 0,
            overflowY: isMobileModal ? 'auto' : undefined,
          }}
        >
          {/* Text area */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: 'var(--fg-regular)',
                letterSpacing: '.02em',
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              目标内容
              <span
                style={{
                  marginLeft: 'auto',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: '#FFC48A',
                  background: 'rgba(255,159,74,.12)',
                  border: '1px solid rgba(255,159,74,.28)',
                  borderRadius: 6,
                  padding: '1px 6px',
                  textTransform: 'none',
                  letterSpacing: 0,
                }}
              >
                剩余 {remaining} 次
              </span>
            </div>
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setSelectedId(null)
              }}
              rows={3}
              style={{
                width: '100%',
                background: 'rgba(0,0,0,.34)',
                border: '1px solid rgba(10,132,255,.5)',
                boxShadow: '0 0 0 3px rgba(10,132,255,.14)',
                borderRadius: 10,
                padding: '10px 12px',
                fontSize: 13.5,
                color: 'var(--fg-strong)',
                lineHeight: 1.5,
                letterSpacing: '-.005em',
                minHeight: 62,
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* History list */}
          {goals.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: 'var(--fg-regular)',
                  letterSpacing: '.02em',
                  textTransform: 'uppercase',
                }}
              >
                历史目标
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {goals.map((goal) => {
                  const isSel = selectedId === goal.id
                  return (
                    <div
                      key={goal.id}
                      onClick={() => handleSelectHistoryItem(goal)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '16px 1fr',
                        gap: 9,
                        padding: '9px 11px',
                        borderRadius: 10,
                        border: `1px solid ${isSel ? 'rgba(10,132,255,.42)' : 'var(--hairline)'}`,
                        background: isSel
                          ? 'rgba(10,132,255,.10)'
                          : 'rgba(255,255,255,0.03)',
                        cursor: 'pointer',
                        alignItems: 'start',
                      }}
                    >
                      {/* Radio dot */}
                      <div
                        style={{
                          width: 15,
                          height: 15,
                          borderRadius: '50%',
                          border: `1.5px solid ${isSel ? 'var(--user-blue)' : 'var(--hairline-2)'}`,
                          marginTop: 1,
                          display: 'grid',
                          placeItems: 'center',
                          background: isSel
                            ? 'rgba(10,132,255,.2)'
                            : 'transparent',
                        }}
                      >
                        {isSel && (
                          <div
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              background: 'var(--user-blue)',
                              boxShadow: '0 0 6px var(--user-blue)',
                            }}
                          />
                        )}
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: 12.5,
                            color: 'var(--fg-strong)',
                            lineHeight: 1.4,
                            letterSpacing: '-.005em',
                          }}
                        >
                          {goal.goal_text}
                        </div>
                        <div
                          style={{
                            fontSize: 10.5,
                            color: 'var(--fg-dim)',
                            marginTop: 3,
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {goal.is_default ? '默认目标 · 首句' : '自定义目标'}
                          {goal.id === activeGoalId ? ' · 当前' : ''}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--hairline)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(0,0,0,.2)',
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--fg-dim)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            目标最多可修改 2 次 · 剩余{' '}
            <b style={{ color: '#FFC48A', fontWeight: 600 }}>{remaining} 次</b>
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                height: 32,
                padding: '0 14px',
                borderRadius: 9,
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: '-.005em',
                display: 'inline-flex',
                alignItems: 'center',
                cursor: 'pointer',
                background: 'var(--glass-1)',
                border: '1px solid var(--hairline)',
                color: 'var(--fg-regular)',
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveDisabled}
              style={{
                height: 32,
                padding: '0 14px',
                borderRadius: 9,
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: '-.005em',
                display: 'inline-flex',
                alignItems: 'center',
                cursor: saveDisabled ? 'not-allowed' : 'pointer',
                background: saveDisabled
                  ? 'rgba(10,132,255,.3)'
                  : 'linear-gradient(180deg,#2090FF,#0A84FF 55%,#0064D8)',
                color: '#fff',
                boxShadow: saveDisabled
                  ? 'none'
                  : 'inset 0 1px 0 rgba(255,255,255,.22),0 4px 14px rgba(10,132,255,.42)',
                border: 'none',
                opacity: saveDisabled ? 0.55 : 1,
              }}
            >
              保存目标
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function MindMapDetail({
  selected,
  traceNodes,
  rawEvents,
  planItems,
  onFocus,
  variant = 'aside',
  onClose,
}: {
  selected: MindMapNode | null
  traceNodes: TraceNode[]
  rawEvents: RawEvent[]
  planItems: PlanItem[]
  onFocus: (messageId: string) => void
  variant?: 'aside' | 'sheet'
  onClose?: () => void
}) {
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all')
  if (!selected) {
    return (
      <aside
        className="flex shrink-0 flex-col"
        style={{
          width: 384,
          borderLeft: '1px solid var(--hairline)',
          background: 'rgba(18,20,25,.62)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        }}
      >
        <EmptyHint text="选择一个节点查看治理过程" />
      </aside>
    )
  }
  const traceById = new Map(traceNodes.map((node) => [node.id, node]))
  const sourceTraceNodes = selected.sourceNodeIds
    .map((id) => traceById.get(id))
    .filter(Boolean) as TraceNode[]
  const focusMessageId = resolveFocusMessageId(
    selected.sourceNodeIds,
    traceById,
  )
  const eventIds = new Set(sourceTraceNodes.flatMap((node) => node.event_ids))
  const sourceMessageIds = new Set(
    sourceTraceNodes.flatMap((node) => node.source_message_ids),
  )
  const events =
    selected.kind === 'goal'
      ? rawEvents
      : rawEvents.filter(
          (event) =>
            eventIds.has(event.id) ||
            (event.message_id ? sourceMessageIds.has(event.message_id) : false),
        )
  const toolEvents = events.filter((event) => event.kind === 'tool_use')
  const relevantPlanItems =
    selected.kind === 'goal'
      ? planItems
      : projectPlanGraph(planItems, sourceTraceNodes).items.filter(
          (item) => item.nodeIds.length > 0,
        )
  const rawMessageItems = events
    .filter(
      (event) =>
        event.kind === 'message' &&
        (event.role === 'user' || event.role === 'assistant'),
    )
    .map((event): MessageDetailItem | null => {
      const text = rawMessageText(event).trim()
      if (!text) return null
      return {
        id: event.id,
        role: event.role as 'user' | 'assistant',
        ts: event.ts,
        text,
      }
    })
    .filter(Boolean) as MessageDetailItem[]
  const exchangeMessageItems = sourceTraceNodes.flatMap(
    (node): MessageDetailItem[] => {
      const exchanges = node.exchanges ?? []
      if (exchanges.length) {
        return exchanges.flatMap((exchange, index): MessageDetailItem[] => {
          const items: MessageDetailItem[] = []
          if (exchange.user_message)
            items.push({
              id: `${node.id}-${exchange.id}-user-${index}`,
              role: 'user',
              ts: exchange.ts_start,
              text: exchange.user_message,
            })
          if (exchange.assistant_summary)
            items.push({
              id: `${node.id}-${exchange.id}-assistant-${index}`,
              role: 'assistant',
              ts: exchange.ts_end,
              text: exchange.assistant_summary,
            })
          return items
        })
      }
      const items: MessageDetailItem[] = []
      if (node.user_message)
        items.push({
          id: `${node.id}-user`,
          role: 'user',
          ts: node.ts_start,
          text: node.user_message,
        })
      if (node.conclusion)
        items.push({
          id: `${node.id}-assistant`,
          role: 'assistant',
          ts: node.ts_end ?? node.ts_start,
          text: node.conclusion,
        })
      return items
    },
  )
  const messageItems = (
    rawMessageItems.length ? rawMessageItems : exchangeMessageItems
  ).sort((a, b) => a.ts - b.ts)
  const executionItems: ExecutionDetailItem[] = [
    ...events
      .filter(
        (event) =>
          event.kind === 'thinking' ||
          event.kind === 'tool_use' ||
          event.kind === 'todo' ||
          event.kind === 'plan',
      )
      .map(
        (event): ExecutionDetailItem => ({
          id: event.id,
          kind: event.kind as ExecutionDetailItem['kind'],
          title: eventTitle(event),
          preview: eventPreview(event),
          payload: event.payload,
          ts: event.ts,
        }),
      ),
    ...relevantPlanItems.map(
      (item, index): ExecutionDetailItem => ({
        id: `plan-item-${item.id}`,
        kind: 'plan',
        title: `Plan · ${item.status}`,
        preview: item.text,
        payload: item,
        ts: Number.MAX_SAFE_INTEGER - relevantPlanItems.length + index,
      }),
    ),
  ].sort((a, b) => a.ts - b.ts)
  const timelineItems: TimelineItem[] = [
    ...messageItems.map(
      (item): TimelineItem => ({ ...item, type: 'message', filter: 'message' }),
    ),
    ...executionItems.map(
      (item): TimelineItem => ({
        id: item.id,
        type: 'execution',
        filter:
          item.kind === 'tool_use'
            ? 'tools'
            : item.kind === 'todo'
              ? 'todo'
              : item.kind === 'plan'
                ? 'plan'
                : 'thinking',
        item,
        ts: item.ts,
      }),
    ),
  ].sort((a, b) => a.ts - b.ts)
  const filteredTimelineItems =
    timelineFilter === 'all'
      ? timelineItems
      : timelineItems.filter((item) => item.filter === timelineFilter)

  const tabCounts: Record<TimelineFilter, number> = {
    all: timelineItems.length,
    message: timelineItems.filter((i) => i.filter === 'message').length,
    todo: timelineItems.filter((i) => i.filter === 'todo').length,
    tools: timelineItems.filter((i) => i.filter === 'tools').length,
    plan: timelineItems.filter((i) => i.filter === 'plan').length,
  }

  const tabs: Array<{ value: TimelineFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'message', label: 'Message' },
    { value: 'todo', label: 'Todo' },
    { value: 'plan', label: 'Plan' },
    { value: 'tools', label: 'Tools' },
  ]

  const kindLabel: Record<MindMapNode['kind'], string> = {
    goal: 'goal',
    user: 'user',
    aggregate: 'aggregate',
  }

  const detailInner = (
    <>
      {/* Filter tabs */}
      <div
        style={{
          display: 'flex',
          gap: 3,
          padding: '10px 12px',
          borderBottom: '1px solid var(--hairline)',
          flexShrink: 0,
        }}
      >
        {tabs.map((tab) => {
          const active = tab.value === timelineFilter
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setTimelineFilter(tab.value)}
              style={{
                height: 28,
                padding: '0 11px',
                borderRadius: 8,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--fg-strong)' : 'var(--fg-dim)',
                background: active ? 'var(--glass-2)' : 'transparent',
                boxShadow: active ? 'inset 0 0 0 1px var(--hairline)' : 'none',
                letterSpacing: '-.005em',
                cursor: 'pointer',
                border: 'none',
                fontFamily: 'inherit',
              }}
            >
              {tab.label}
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9.5,
                  color: active ? '#6cb1ff' : 'var(--fg-dim)',
                  background: active
                    ? 'rgba(10,132,255,.22)'
                    : 'rgba(255,255,255,.08)',
                  borderRadius: 7,
                  padding: '0 4px',
                  lineHeight: '14px',
                }}
              >
                {tabCounts[tab.value]}
              </span>
            </button>
          )
        })}
      </div>

      {/* Node header */}
      <div
        style={{
          padding: '16px 16px 14px',
          borderBottom: '1px solid var(--hairline)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Role chip */}
            <span
              style={{
                height: 20,
                padding: '0 8px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                background: 'var(--glass-1)',
                border: '1px solid var(--hairline)',
                color: 'var(--fg-regular)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: 0,
              }}
            >
              {kindLabel[selected.kind]}
            </span>
            {/* Current chip */}
            {selected.current && (
              <span
                style={{
                  height: 20,
                  padding: '0 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  color: '#FFC48A',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#FF9F4A',
                    boxShadow: '0 0 6px #FF9F4A',
                    animation: 'attn-dot-blink 1.2s ease-in-out infinite',
                    flexShrink: 0,
                  }}
                />
                当前节点
              </span>
            )}
            {selected.collapsed && (
              <span
                style={{
                  height: 20,
                  padding: '0 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  color: '#F7C26B',
                }}
              >
                聚合节点
              </span>
            )}
          </div>
          {/* Focus button */}
          {focusMessageId && (
            <button
              type="button"
              onClick={() => onFocus(focusMessageId)}
              style={{
                marginLeft: 'auto',
                height: 30,
                padding: '0 13px',
                borderRadius: 9,
                background: 'var(--glass-1)',
                border: '1px solid var(--hairline-2)',
                color: 'var(--fg-strong)',
                fontSize: 12.5,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="7" />
                <line x1="12" y1="2" x2="12" y2="5" />
                <line x1="12" y1="19" x2="12" y2="22" />
                <line x1="2" y1="12" x2="5" y2="12" />
                <line x1="19" y1="12" x2="22" y2="12" />
              </svg>
              Focus
            </button>
          )}
        </div>
        <div
          style={{
            marginTop: 11,
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: '-.014em',
            color: 'var(--fg-strong)',
          }}
        >
          {selected.title}
        </div>
        {selected.subtitle && (
          <div
            style={{
              marginTop: 4,
              fontSize: 11,
              color: 'var(--fg-dim)',
              letterSpacing: '-.005em',
            }}
          >
            {selected.subtitle}
          </div>
        )}
      </div>

      {/* Scroll content */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        style={{
          padding: '14px 16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {selected.aggregation && (
          <section
            className="mb-4 rounded-lg p-3"
            style={{
              border: '1px solid rgba(247,194,107,0.32)',
              background: 'rgba(247,194,107,0.08)',
            }}
          >
            <div
              className="text-[11px] font-semibold"
              style={{ color: '#F7C26B' }}
            >
              聚合过程
            </div>
            <div
              className="mt-2 grid grid-cols-2 gap-2 text-[10.5px]"
              style={{ color: 'var(--fg-dim)' }}
            >
              <div>原因：{selected.aggregation.reason ?? '手动/默认'}</div>
              <div>子节点：{selected.aggregation.childCount}</div>
              <div>回合：{selected.aggregation.turnCount}</div>
              <div>工具：{toolEvents.length}</div>
            </div>
            <div className="mt-2 flex flex-col gap-1">
              {selected.aggregation.sourceTitles.map((title) => (
                <div
                  key={title}
                  className="truncate text-[10.5px]"
                  style={{ color: 'var(--fg-regular)' }}
                >
                  • {title}
                </div>
              ))}
            </div>
          </section>
        )}

        <DetailSection title="节点时间线">
          {filteredTimelineItems.length === 0 ? (
            <div className="text-[11px]" style={{ color: 'var(--fg-dim)' }}>
              暂无
            </div>
          ) : (
            <div className="flex flex-col" style={{ gap: 10 }}>
              {filteredTimelineItems.map((item) => (
                <TimelineRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </DetailSection>
      </div>
    </>
  )

  // 移动端：盖在流程图上的全屏浮层（S17 节点详情）
  if (variant === 'sheet') {
    return (
      <div
        className="absolute inset-0 z-40 flex flex-col"
        style={{
          background: 'var(--glass-modal, rgba(20,22,27,0.92))',
          backdropFilter: 'blur(50px) saturate(180%)',
          WebkitBackdropFilter: 'blur(50px) saturate(180%)',
          animation: 'attn-panel-slidein .26s cubic-bezier(.22,1,.36,1) both',
        }}
      >
        <div
          className="flex shrink-0 items-center"
          style={{
            height: 46,
            padding: '0 12px',
            borderBottom: '1px solid var(--hairline)',
          }}
        >
          <span
            className="text-[13px] font-semibold"
            style={{ color: 'var(--fg-strong)', letterSpacing: '-.01em' }}
          >
            节点详情
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭节点详情"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-[7px]"
            style={{
              color: 'var(--fg-dim)',
              background: 'var(--glass-1)',
              border: '1px solid var(--hairline)',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        {detailInner}
      </div>
    )
  }

  return (
    <aside
      className="flex shrink-0 flex-col"
      style={{
        width: 384,
        borderLeft: '1px solid var(--hairline)',
        background: 'rgba(18,20,25,.62)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        minHeight: 0,
      }}
    >
      {detailInner}
    </aside>
  )
}

// ─── LLM 错误原因映射 ──────────────────────────────────────────────────────────

function reasonMessage(reason: string | null): string {
  if (!reason) return 'LLM 配置异常'
  const map: Record<string, string> = {
    not_configured:
      'LLM API Key / Base URL / Model 未配置，请在 Worker 环境变量中设置 ATTENTION_LLM_*',
    upstream_429: 'LLM API 限流（429），请稍后重试或检查配额',
    upstream_401: 'LLM API Key 无效（401），请检查 ATTENTION_LLM_API_KEY',
    upstream_403: 'LLM API 权限不足（403），请检查 API Key 权限',
    upstream_500: 'LLM API 服务端异常（500），请稍后重试',
    upstream_502: 'LLM API 网关异常（502），请稍后重试',
    upstream_503: 'LLM API 服务不可用（503），请稍后重试',
    timeout: 'LLM 响应超时（45s），请尝试减少节点数或增加超时',
    fetch_error: '网络请求失败，无法连接 LLM API',
    parse_error: 'LLM 输出解析失败，可能是 JSON 格式异常',
    truncated_json: 'LLM 输出被截断（max_tokens 不足），请增加输出 token 限制',
    empty_source: '无有效消息数据，请先发送消息',
    empty_trace: '无法生成追踪节点，数据不足以分析',
  }
  if (reason in map) return map[reason]
  if (reason.startsWith('upstream_'))
    return `LLM API 返回错误（${reason.slice(9)}）`
  return `LLM 异常（${reason}）`
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function AttentionXPanel({
  topicId,
  nodes,
  goalAnchor,
  planItems,
  rawEvents,
  llmUnavailableReason = null,
  goals = [],
  activeGoalId = null,
  onCreateGoal,
  onSelectGoal,
  loadingSnapshot = false,
  focusCurrent = false,
  fitViewCallbackRef,
  mobile = false,
  onAfterFocus,
}: {
  topicId: string
  nodes: TraceNode[]
  goalAnchor: GoalAnchor | null
  planItems: PlanItem[]
  rawEvents: RawEvent[]
  llmUnavailableReason?: string | null
  goals?: AttentionGoalMeta[]
  activeGoalId?: string | null
  onCreateGoal?: (goalText?: string) => void
  onSelectGoal?: (goalId: string) => void
  loadingSnapshot?: boolean
  focusCurrent?: boolean
  fitViewCallbackRef?: React.MutableRefObject<(() => void) | null>
  mobile?: boolean
  onAfterFocus?: () => void
}) {
  const [selectedMindId, setSelectedMindId] = useState<string | null>(null)
  const [expandedMindIds, setExpandedMindIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [showGoalModal, setShowGoalModal] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const focusMessage = useMessageStore((s) => s.focusMessage)
  const mindProjection = useMemo(
    () => buildMindMapProjection(nodes, goalAnchor, planItems, expandedMindIds),
    [nodes, goalAnchor, planItems, expandedMindIds],
  )
  const selectedMindNode =
    mindProjection.nodes.find((node) => node.id === selectedMindId) ??
    defaultMindNode(mindProjection.nodes)
  const customGoalCount = goals.filter((goal) => !goal.is_default).length
  const remainingGoalEdits = Math.max(0, 2 - customGoalCount)

  const selectMindNode = (id: string) => {
    setSelectedMindId(id)
    const node = mindProjection.nodes.find((entry) => entry.id === id)
    if (!node?.hasChildren) return
    setExpandedMindIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 移动端：点节点直接弹出全屏详情浮层（展开/折叠交给节点上的 +/- 按钮）
  const selectMobileNode = (id: string) => {
    setSelectedMindId(id)
    setMobileDetailOpen(true)
  }

  const toggleMindExpand = (id: string) => {
    setExpandedMindIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSaveGoal = (text: string) => {
    onCreateGoal?.(text)
  }

  const handleSelectGoal = (goalId: string) => {
    onSelectGoal?.(goalId)
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Main content */}
      <div className="min-h-0 flex-1">
        {loadingSnapshot && nodes.length === 0 ? (
          <EmptyHint text="加载注意力节点快照…" />
        ) : llmUnavailableReason && nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6">
            <div
              className="max-w-[420px] rounded-xl px-5 py-4 text-center"
              style={{
                background: 'rgba(0,0,0,.22)',
                border: '1px solid var(--hairline)',
                color: 'var(--fg-regular)',
              }}
            >
              <div
                className="text-[14px] font-semibold"
                style={{ color: 'var(--fg-strong)' }}
              >
                注意力面板未激活
              </div>
              <div
                className="mt-2 text-[12px] leading-5"
                style={{ color: 'var(--fg-dim)' }}
              >
                {reasonMessage(llmUnavailableReason)}
              </div>
            </div>
          </div>
        ) : nodes.length === 0 ? (
          <EmptyHint text="暂无有效注意力节点" />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {llmUnavailableReason && (
              <div
                className="px-4 py-2 text-[11px]"
                style={{
                  color: '#F7C26B',
                  borderBottom: '1px solid var(--hairline)',
                }}
              >
                LLM 不可用（{reasonMessage(llmUnavailableReason)}
                ），当前展示的是已保存快照。
              </div>
            )}
            {mobile ? (
              <div className="relative flex min-h-0 flex-1">
                <div className="min-w-0 flex-1">
                  <MindMapGraph
                    mobile
                    nodes={nodes}
                    goalAnchor={goalAnchor}
                    planItems={planItems}
                    selectedId={selectedMindNode?.id ?? null}
                    onSelect={selectMobileNode}
                    onFocus={(messageId) => {
                      focusMessage(topicId, messageId)
                      onAfterFocus?.()
                    }}
                    onUpdateGoal={() => setShowGoalModal(true)}
                    remainingGoalEdits={remainingGoalEdits}
                    expandedIds={expandedMindIds}
                    focusNodeId={
                      focusCurrent ? (selectedMindNode?.id ?? null) : null
                    }
                    projection={mindProjection}
                    fitViewCallbackRef={fitViewCallbackRef}
                    onToggleExpand={toggleMindExpand}
                  />
                </div>
                {mobileDetailOpen && selectedMindNode && (
                  <MindMapDetail
                    variant="sheet"
                    selected={selectedMindNode}
                    traceNodes={nodes}
                    rawEvents={rawEvents}
                    planItems={planItems}
                    onFocus={(messageId) => {
                      focusMessage(topicId, messageId)
                      onAfterFocus?.()
                    }}
                    onClose={() => setMobileDetailOpen(false)}
                  />
                )}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1">
                <div className="min-w-0 flex-1">
                  <MindMapGraph
                    nodes={nodes}
                    goalAnchor={goalAnchor}
                    planItems={planItems}
                    selectedId={selectedMindNode?.id ?? null}
                    onSelect={selectMindNode}
                    onFocus={(messageId) => focusMessage(topicId, messageId)}
                    onUpdateGoal={() => setShowGoalModal(true)}
                    remainingGoalEdits={remainingGoalEdits}
                    expandedIds={expandedMindIds}
                    focusNodeId={
                      focusCurrent ? (selectedMindNode?.id ?? null) : null
                    }
                    projection={mindProjection}
                    fitViewCallbackRef={fitViewCallbackRef}
                  />
                </div>
                <MindMapDetail
                  selected={selectedMindNode}
                  traceNodes={nodes}
                  rawEvents={rawEvents}
                  planItems={planItems}
                  onFocus={(messageId) => focusMessage(topicId, messageId)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Goal update modal */}
      {showGoalModal && (
        <GoalUpdateModal
          goals={goals}
          activeGoalId={activeGoalId}
          customGoalCount={customGoalCount}
          onClose={() => setShowGoalModal(false)}
          onSave={handleSaveGoal}
          onSelectGoal={handleSelectGoal}
          variant={mobile ? 'mobile' : 'desktop'}
        />
      )}
    </div>
  )
}
