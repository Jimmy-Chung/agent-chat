'use client'

import { useEffect, useMemo, useState, useCallback, type KeyboardEvent, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import type { AttentionGoalMeta, GoalAnchor, PlanItem, RawEvent, TraceNode } from '@/lib/attention'
import { attentionGoalTitle } from '@/lib/attention'
import { resolveFocusMessageId } from '@/lib/attention'
import { getWsClient } from '@/lib/ws-client'
import { Tooltip } from '@/components/ui/Tooltip'
import { projectPlanGraph } from '@/lib/attention/plan-projector'
import { buildMindMapProjection, type MindMapNode } from '@/lib/attention/mind-map-projector'
import { useMessageStore } from '@/stores/message-store'

const MindMapGraph = dynamic(() => import('./MindMapGraph'), {
  ssr: false,
  loading: () => <EmptyHint text="加载动态树…" />,
})

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-[12px]" style={{ color: 'var(--fg-dim)' }}>
      {text}
    </div>
  )
}

function eventTitle(event: RawEvent): string {
  if (event.kind === 'tool_use' || event.kind === 'todo') return String(event.payload.name ?? '工具调用')
  if (event.kind === 'thinking') return '思考'
  if (event.kind === 'plan') return '计划'
  return event.role === 'user' ? '用户消息' : '助手消息'
}

function eventPreview(event: RawEvent): string {
  const text = event.kind === 'tool_use' || event.kind === 'todo'
    ? String(event.payload.output ?? JSON.stringify(event.payload.input ?? {}))
    : String(event.payload.text ?? '')
  return text.replace(/\s+/g, ' ').trim()
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

type DetailBadgeTone = 'user' | 'assistant' | 'thinking' | 'tool' | 'todo' | 'plan'

function DetailBadge({ label, tone }: { label: string; tone: DetailBadgeTone }) {
  const styleByTone: Record<DetailBadgeTone, { background: string; border: string; color: string }> = {
    user: { background: 'rgba(111,227,154,0.12)', border: '1px solid rgba(111,227,154,0.34)', color: '#6FE39A' },
    assistant: { background: 'rgba(125,183,255,0.12)', border: '1px solid rgba(125,183,255,0.34)', color: '#7DB7FF' },
    thinking: { background: 'rgba(247,194,107,0.12)', border: '1px solid rgba(247,194,107,0.34)', color: '#F7C26B' },
    tool: { background: 'rgba(247,162,107,0.12)', border: '1px solid rgba(247,162,107,0.34)', color: '#F7A26B' },
    todo: { background: 'rgba(207,151,255,0.12)', border: '1px solid rgba(207,151,255,0.34)', color: '#CF97FF' },
    plan: { background: 'rgba(126,232,219,0.12)', border: '1px solid rgba(126,232,219,0.34)', color: '#7EE8DB' },
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

function CollapsibleText({ text, className = '' }: { text: string; className?: string }) {
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
    <div className="rounded-md p-2.5" style={{ border: '1px solid var(--hairline)', background: 'rgba(255,255,255,0.03)' }}>
      <div className="mb-1.5 flex items-center gap-2">
        <DetailBadge label={isUser ? 'U' : 'AI'} tone={isUser ? 'user' : 'assistant'} />
        <span className="text-[11px] font-medium" style={{ color: 'var(--fg-strong)' }}>
          {isUser ? '用户' : 'AI'}
        </span>
      </div>
      <CollapsibleText text={item.text} className="text-[11px]" />
    </div>
  )
}

function executionTone(kind: ExecutionDetailItem['kind']): 'thinking' | 'tool' | 'todo' | 'plan' {
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
    <div className="overflow-hidden rounded-md" style={{ border: '1px solid var(--hairline)', background: 'rgba(255,255,255,0.03)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px]"
        style={{ color: 'var(--fg-regular)' }}
      >
        <DetailBadge label={executionBadgeLabel(item.kind)} tone={executionTone(item.kind)} />
        <span className="shrink-0 font-medium">{item.title}</span>
        <span className="truncate" style={{ color: 'var(--fg-muted)' }}>{item.preview.slice(0, 120)}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2">
          <CollapsibleText
            text={typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload, null, 2)}
            className="text-[10.5px] text-[var(--fg-dim)]"
          />
        </div>
      )}
    </div>
  )
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
    <section className="mb-4">
      <div className="mb-2 text-[11px] font-semibold" style={{ color: 'var(--fg-strong)' }}>{title}</div>
      {empty ? (
        <div className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>暂无</div>
      ) : children}
    </section>
  )
}

function MindMapDetail({
  selected,
  traceNodes,
  rawEvents,
  planItems,
  onFocus,
}: {
  selected: MindMapNode | null
  traceNodes: TraceNode[]
  rawEvents: RawEvent[]
  planItems: PlanItem[]
  onFocus: (messageId: string) => void
}) {
  if (!selected) {
    return <EmptyHint text="选择一个节点查看治理过程" />
  }
  const traceById = new Map(traceNodes.map((node) => [node.id, node]))
  const sourceTraceNodes = selected.sourceNodeIds.map((id) => traceById.get(id)).filter(Boolean) as TraceNode[]
  const focusMessageId = resolveFocusMessageId(selected.sourceNodeIds, traceById)
  const eventIds = new Set(sourceTraceNodes.flatMap((node) => node.event_ids))
  const events = selected.kind === 'goal'
    ? rawEvents
    : rawEvents.filter((event) => eventIds.has(event.id))
  const toolEvents = events.filter((event) => event.kind === 'tool_use')
  const relevantPlanItems = selected.kind === 'goal'
    ? planItems
    : projectPlanGraph(planItems, sourceTraceNodes).items.filter((item) => item.nodeIds.length > 0)
  const messageItems = sourceTraceNodes.flatMap((node): MessageDetailItem[] => {
    const exchanges = node.exchanges ?? []
    if (exchanges.length) {
      return exchanges.flatMap((exchange, index): MessageDetailItem[] => {
        const items: MessageDetailItem[] = []
        if (exchange.user_message) {
          items.push({
            id: `${node.id}-${exchange.id}-user-${index}`,
            role: 'user',
            ts: exchange.ts_start,
            text: exchange.user_message,
          })
        }
        if (exchange.assistant_summary) {
          items.push({
            id: `${node.id}-${exchange.id}-assistant-${index}`,
            role: 'assistant',
            ts: exchange.ts_end,
            text: exchange.assistant_summary,
          })
        }
        return items
      })
    }
    const items: MessageDetailItem[] = []
    if (node.user_message) {
      items.push({ id: `${node.id}-user`, role: 'user', ts: node.ts_start, text: node.user_message })
    }
    if (node.conclusion) {
      items.push({ id: `${node.id}-assistant`, role: 'assistant', ts: node.ts_end ?? node.ts_start, text: node.conclusion })
    }
    return items
  }).sort((a, b) => a.ts - b.ts)
  const executionItems: ExecutionDetailItem[] = [
    ...events
      .filter((event) => event.kind === 'thinking' || event.kind === 'tool_use' || event.kind === 'todo' || event.kind === 'plan')
      .map((event): ExecutionDetailItem => ({
        id: event.id,
        kind: event.kind as ExecutionDetailItem['kind'],
        title: eventTitle(event),
        preview: eventPreview(event),
        payload: event.payload,
        ts: event.ts,
      })),
    ...relevantPlanItems.map((item, index): ExecutionDetailItem => ({
      id: `plan-item-${item.id}`,
      kind: 'plan',
      title: `Plan · ${item.status}`,
      preview: item.text,
      payload: item,
      ts: Number.MAX_SAFE_INTEGER - relevantPlanItems.length + index,
    })),
  ].sort((a, b) => a.ts - b.ts)

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col" style={{ borderLeft: '1px solid var(--hairline)', background: 'rgba(0,0,0,0.14)' }}>
      <div className="shrink-0 px-4 py-3" style={{ borderBottom: '1px solid var(--hairline)' }}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--glass-2)', color: 'var(--fg-dim)' }}>
                {selected.kind}
              </span>
              {selected.current && <span className="text-[10px]" style={{ color: '#6FE39A' }}>当前节点</span>}
              {selected.collapsed && <span className="text-[10px]" style={{ color: '#F7C26B' }}>聚合节点</span>}
            </div>
            <div className="mt-2 text-[13px] font-semibold leading-snug" style={{ color: 'var(--fg-strong)' }}>
              {selected.title}
            </div>
            <div className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--fg-dim)' }}>
              {selected.subtitle}
            </div>
          </div>
          {focusMessageId && (
            <Tooltip content="回到消息面板中的对应消息" side="top">
              <button
                type="button"
                onClick={() => onFocus(focusMessageId)}
                className="mt-0.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-opacity hover:opacity-85"
                style={{ background: 'var(--glass-2)', color: 'var(--fg-strong)', border: '1px solid var(--hairline)' }}
              >
                Focus
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {selected.aggregation && (
          <section className="mb-4 rounded-lg p-3" style={{ border: '1px solid rgba(247,194,107,0.32)', background: 'rgba(247,194,107,0.08)' }}>
            <div className="text-[11px] font-semibold" style={{ color: '#F7C26B' }}>聚合过程</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[10.5px]" style={{ color: 'var(--fg-dim)' }}>
              <div>原因：{selected.aggregation.reason ?? '手动/默认'}</div>
              <div>子节点：{selected.aggregation.childCount}</div>
              <div>回合：{selected.aggregation.turnCount}</div>
              <div>工具：{toolEvents.length}</div>
            </div>
            <div className="mt-2 flex flex-col gap-1">
              {selected.aggregation.sourceTitles.map((title) => (
                <div key={title} className="truncate text-[10.5px]" style={{ color: 'var(--fg-regular)' }}>• {title}</div>
              ))}
            </div>
          </section>
        )}

        <DetailSection title="消息明细" empty={messageItems.length === 0}>
          <div className="flex flex-col gap-2">
            {messageItems.map((item) => <MessageDetailRow key={item.id} item={item} />)}
          </div>
        </DetailSection>

        <DetailSection title={`执行明细 · ${toolEvents.length} 个工具`} empty={executionItems.length === 0}>
          <div className="flex flex-col gap-2">
            {executionItems.map((item) => <ExecutionDetailRow key={item.id} item={item} />)}
          </div>
        </DetailSection>
      </div>
    </aside>
  )
}

export function AttentionXPanel({
  topicId,
  nodes,
  goalAnchor,
  planItems,
  rawEvents,
  llmUnavailable = false,
  goals = [],
  activeGoal = null,
  activeGoalId = null,
  goalDraft = '',
  onGoalDraftChange,
  onCreateGoal,
  onSelectGoal,
  onRenameGoal,
  focusCurrent = false,
  chrome = true,
}: {
  topicId: string
  nodes: TraceNode[]
  goalAnchor: GoalAnchor | null
  planItems: PlanItem[]
  rawEvents: RawEvent[]
  llmUnavailable?: boolean
  goals?: AttentionGoalMeta[]
  activeGoal?: AttentionGoalMeta | null
  activeGoalId?: string | null
  goalDraft?: string
  onGoalDraftChange?: (value: string) => void
  onCreateGoal?: () => void
  onSelectGoal?: (goalId: string) => void
  onRenameGoal?: (goalId: string, title: string) => void
  focusCurrent?: boolean
  chrome?: boolean
}) {
  const [selectedMindId, setSelectedMindId] = useState<string | null>(null)
  const [expandedMindIds, setExpandedMindIds] = useState<Set<string>>(() => new Set())
  const focusMessage = useMessageStore((s) => s.focusMessage)
  const [renameDraft, setRenameDraft] = useState('')
  const mindProjection = useMemo(() => buildMindMapProjection(nodes, goalAnchor, planItems, expandedMindIds), [nodes, goalAnchor, planItems, expandedMindIds])
  const selectedMindNode =
    mindProjection.nodes.find((node) => node.id === selectedMindId) ??
    mindProjection.nodes.find((node) => node.current) ??
    mindProjection.nodes[0] ??
    null
  const reloadHistory = () => getWsClient().send({ type: 'messages.load', data: { topicId } })
  useEffect(() => {
    setRenameDraft(activeGoal ? attentionGoalTitle(activeGoal) : '')
  }, [activeGoal?.id, activeGoal?.title, activeGoal?.goal_text])

  const handleTargetKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onCreateGoal?.()
  }, [onCreateGoal])

  const handleRenameKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || !activeGoalId) return
    event.preventDefault()
    onRenameGoal?.(activeGoalId, renameDraft)
  }, [activeGoalId, onRenameGoal, renameDraft])
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {chrome && (
        <div className="flex shrink-0 flex-col gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--hairline)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={reloadHistory}
              className="rounded-md px-2.5 py-1.5 text-[11px] transition-opacity hover:opacity-80"
              style={{ background: 'var(--glass-2)', color: 'var(--fg-regular)', border: '1px solid var(--hairline)' }}
            >
              重新加载历史
            </button>
            <div className="rounded-md px-2.5 py-1 text-[11px] font-medium" style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', color: 'var(--fg-strong)' }}>
              动态树
            </div>
            <div className="ml-auto text-[11px]" style={{ color: 'var(--fg-muted)' }}>
              {nodes.length} nodes · {planItems.length} plan/todo
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[11px] font-medium" style={{ color: 'var(--fg-muted)' }}>当前目标</div>
            <input
              value={goalDraft}
              onChange={(event) => onGoalDraftChange?.(event.target.value)}
              onKeyDown={handleTargetKeyDown}
              placeholder="描述一个更清晰的话题目标，Enter 创建新目标"
              className="min-w-0 flex-1 rounded-md px-3 py-2 text-[12px] outline-none"
              style={{
                background: 'rgba(0,0,0,0.18)',
                border: '1px solid var(--hairline)',
                color: 'var(--fg-strong)',
              }}
            />
            <button
              type="button"
              onClick={onCreateGoal}
              className="rounded-md px-2.5 py-1.5 text-[11px] transition-opacity hover:opacity-85"
              style={{ background: 'var(--glass-2)', color: 'var(--fg-strong)', border: '1px solid var(--hairline)' }}
            >
              创建目标
            </button>
          </div>
          {goals.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {goals.map((goal) => (
                <button
                  key={goal.id}
                  type="button"
                  onClick={() => onSelectGoal?.(goal.id)}
                  className="max-w-[180px] truncate rounded-md px-2.5 py-1 text-[11px] transition-opacity hover:opacity-85"
                  title={`${attentionGoalTitle(goal)}\n${goal.goal_text}`}
                  style={{
                    background: goal.id === activeGoalId ? 'rgba(111,227,154,0.14)' : 'rgba(255,255,255,0.04)',
                    color: goal.id === activeGoalId ? '#6FE39A' : 'var(--fg-regular)',
                    border: `1px solid ${goal.id === activeGoalId ? 'rgba(111,227,154,0.36)' : 'var(--hairline)'}`,
                  }}
                >
                  {attentionGoalTitle(goal)}
                </button>
              ))}
            </div>
          )}
          {activeGoal && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[11px] font-medium" style={{ color: 'var(--fg-muted)' }}>历史名</div>
              <input
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={handleRenameKeyDown}
                placeholder="只改历史显示名，不改目标内容"
                className="min-w-0 flex-1 rounded-md px-3 py-1.5 text-[11px] outline-none"
                style={{
                  background: 'rgba(0,0,0,0.12)',
                  border: '1px solid var(--hairline)',
                  color: 'var(--fg-regular)',
                }}
              />
              <button
                type="button"
                onClick={() => activeGoalId && onRenameGoal?.(activeGoalId, renameDraft)}
                className="rounded-md px-2.5 py-1.5 text-[11px] transition-opacity hover:opacity-85"
                style={{ background: 'transparent', color: 'var(--fg-muted)', border: '1px solid var(--hairline)' }}
              >
                改名
              </button>
            </div>
          )}
          {activeGoal && (
            <div className="truncate text-[10.5px]" style={{ color: 'var(--fg-muted)' }}>
              目标内容：{activeGoal.goal_text}
            </div>
          )}
          </div>
      )}
      <div className="min-h-0 flex-1">
        {llmUnavailable && nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6">
            <div
              className="max-w-[420px] rounded-xl px-5 py-4 text-center"
              style={{
                background: 'rgba(0,0,0,.22)',
                border: '1px solid var(--hairline)',
                color: 'var(--fg-regular)',
              }}
            >
              <div className="text-[14px] font-semibold" style={{ color: 'var(--fg-strong)' }}>
                注意力面板未激活
              </div>
              <div className="mt-2 text-[12px] leading-5" style={{ color: 'var(--fg-dim)' }}>
                请进行正确的 LLM 配置以激活注意力面板。
              </div>
            </div>
          </div>
        ) : nodes.length === 0 ? (
          <EmptyHint text="暂无有效注意力节点" />
        ) : (
        <div className="flex h-full min-h-0 flex-col">
        {llmUnavailable && (
          <div className="px-4 py-2 text-[11px]" style={{ color: '#F7C26B', borderBottom: '1px solid var(--hairline)' }}>
            LLM 配置不可用，当前展示的是已保存快照；重新绘制需要正确配置 LLM。
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <MindMapGraph
              nodes={nodes}
              goalAnchor={goalAnchor}
              planItems={planItems}
              selectedId={selectedMindNode?.id ?? null}
              onSelect={selectMindNode}
              expandedIds={expandedMindIds}
              focusNodeId={focusCurrent ? selectedMindNode?.id ?? null : null}
              projection={mindProjection}
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
        </div>
        )}
      </div>
    </div>
  )
}
