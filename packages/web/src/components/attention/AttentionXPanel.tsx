'use client'

import { useMemo, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import type { GoalAnchor, PlanItem, RawEvent, TraceNode } from '@/lib/attention'
import { getWsClient } from '@/lib/ws-client'
import { projectBranches } from '@/lib/attention/branch-projector'
import { projectChoices } from '@/lib/attention/choice-projector'
import { projectPhases } from '@/lib/attention/phase-projector'
import { projectPlanGraph } from '@/lib/attention/plan-projector'
import { buildAttentionTree } from '@/lib/attention/tree-projector'
import { goalDistanceColor } from '@/lib/attention'
import { buildMindMapProjection, type MindMapNode } from '@/lib/attention/mind-map-projector'

type ViewMode = 'mind' | 'phase' | 'tree' | 'branches' | 'plan' | 'choice'

const MODES: Array<{ id: ViewMode; label: string }> = [
  { id: 'mind', label: '动态树' },
  { id: 'phase', label: '阶段聚合' },
  { id: 'tree', label: '多层树' },
  { id: 'branches', label: '目标支链' },
  { id: 'plan', label: 'Plan/Todo' },
  { id: 'choice', label: '选项决策' },
]

const MindMapGraph = dynamic(() => import('./MindMapGraph'), {
  ssr: false,
  loading: () => <EmptyHint text="加载动态树…" />,
})

function NodePill({ node, label }: { node: TraceNode; label?: string }) {
  return (
    <div
      className="min-w-[180px] max-w-[240px] rounded-lg px-3 py-2"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)' }}
    >
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: goalDistanceColor(node.goal_distance) }} />
        {label && <span className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>{label}</span>}
      </div>
      <div className="mt-1 truncate text-[12px] font-medium" style={{ color: 'var(--fg-strong)' }}>
        {node.conclusion || node.user_message}
      </div>
      <div className="mt-0.5 line-clamp-2 text-[10.5px]" style={{ color: 'var(--fg-dim)' }}>
        {node.user_message}
      </div>
    </div>
  )
}

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
}: {
  selected: MindMapNode | null
  traceNodes: TraceNode[]
  rawEvents: RawEvent[]
  planItems: PlanItem[]
}) {
  if (!selected) {
    return <EmptyHint text="选择一个节点查看治理过程" />
  }
  const traceById = new Map(traceNodes.map((node) => [node.id, node]))
  const sourceTraceNodes = selected.sourceNodeIds.map((id) => traceById.get(id)).filter(Boolean) as TraceNode[]
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

function PhaseView({ nodes }: { nodes: TraceNode[] }) {
  const projection = useMemo(() => projectPhases(nodes), [nodes])
  if (!projection.phases.length) return <EmptyHint text="暂无可聚合节点" />
  return (
    <div className="flex min-h-full gap-4 overflow-x-auto p-5">
      {projection.phases.map((phase, index) => (
        <div key={phase.id} className="flex shrink-0 flex-col gap-2">
          <NodePill node={phase} label={`Phase ${index + 1} · ${phase.children.length} 轮`} />
          <div className="ml-4 flex flex-col gap-1.5 border-l pl-3" style={{ borderColor: 'var(--hairline)' }}>
            {phase.children.slice(0, 6).map((child) => (
              <div key={child.id} className="max-w-[220px] truncate text-[10.5px]" style={{ color: 'var(--fg-dim)' }}>
                {child.conclusion || child.user_message}
              </div>
            ))}
            {phase.children.length > 6 && (
              <div className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>+{phase.children.length - 6} more</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function TreeView({ nodes, goalAnchor }: { nodes: TraceNode[]; goalAnchor: GoalAnchor | null }) {
  const expanded = useMemo(() => new Set(nodes.slice(0, 3).map((node) => `phase_${node.id}`)), [nodes])
  const tree = useMemo(() => buildAttentionTree(nodes, goalAnchor, expanded), [nodes, goalAnchor, expanded])
  const root = tree.nodes.find((node) => node.kind === 'goal')
  const phases = tree.nodes.filter((node) => node.kind === 'phase')
  if (!root) return <EmptyHint text="暂无目标树" />
  return (
    <div className="min-h-full overflow-auto p-5">
      <div className="rounded-lg px-3 py-2" style={{ background: 'var(--glass-2)', border: '1px solid var(--hairline-2)' }}>
        <div className="text-[12px] font-semibold" style={{ color: 'var(--fg-strong)' }}>{root.title}</div>
        <div className="text-[10.5px]" style={{ color: 'var(--fg-dim)' }}>{root.childCount} 个阶段</div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {phases.map((phase) => {
          const children = tree.nodes.filter((node) => node.parentId === phase.id)
          return (
            <div key={phase.id} className="rounded-lg p-3" style={{ border: '1px solid var(--hairline)', background: 'rgba(255,255,255,0.03)' }}>
              <div className="text-[12px] font-medium" style={{ color: 'var(--fg-strong)' }}>{phase.title}</div>
              <div className="mt-2 flex flex-col gap-1.5">
                {children.map((child) => (
                  <div key={child.id} className="rounded-md px-2 py-1 text-[10.5px]" style={{ background: 'var(--glass-1)', color: 'var(--fg-dim)' }}>
                    {child.title}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BranchView({ nodes }: { nodes: TraceNode[] }) {
  const projection = useMemo(() => projectBranches(nodes), [nodes])
  if (!projection.nodes.length) return <EmptyHint text="暂无目标链路" />
  const main = projection.nodes.filter((node) => node.branchKind === 'main')
  const sides = projection.nodes.filter((node) => node.branchKind === 'side')
  return (
    <div className="min-h-full overflow-auto p-5">
      <div className="flex gap-3 overflow-x-auto pb-4">
        {main.map((node) => <NodePill key={node.id} node={node} label="主目标" />)}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {sides.map((node) => (
          <div key={node.id} className="rounded-lg p-3" style={{ border: '1px solid rgba(247,162,107,0.35)', background: 'rgba(247,162,107,0.08)' }}>
            <div className="text-[10.5px]" style={{ color: '#F7A26B' }}>{node.branchLabel} · 挂在 {node.parentMainId ?? '起点'}</div>
            <div className="mt-1 text-[12px] font-medium" style={{ color: 'var(--fg-strong)' }}>{node.conclusion || node.user_message}</div>
            <div className="mt-1 text-[10.5px]" style={{ color: 'var(--fg-dim)' }}>{node.user_message}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PlanView({ nodes, planItems }: { nodes: TraceNode[]; planItems: PlanItem[] }) {
  const graph = useMemo(() => projectPlanGraph(planItems, nodes), [planItems, nodes])
  if (!planItems.length) return <EmptyHint text="当前历史里没有 plan/todo，无法生成计划骨架" />
  return (
    <div className="min-h-full overflow-auto p-5">
      <div className="grid gap-3 md:grid-cols-2">
        {graph.items.map((item) => (
          <div key={item.id} className="rounded-lg p-3" style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)' }}>
            <div className="flex items-center gap-2">
              <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--glass-2)', color: 'var(--fg-dim)' }}>{item.status}</span>
              <div className="truncate text-[12px] font-medium" style={{ color: 'var(--fg-strong)' }}>{item.text}</div>
            </div>
            <div className="mt-2 text-[10.5px]" style={{ color: 'var(--fg-dim)' }}>
              关联 {item.nodeIds.length} 个节点 · {item.evidenceCount} 条事件证据
            </div>
          </div>
        ))}
      </div>
      {graph.inboxNodeIds.length > 0 && (
        <div className="mt-4 text-[11px]" style={{ color: 'var(--fg-muted)' }}>
          未匹配节点：{graph.inboxNodeIds.join(', ')}
        </div>
      )}
    </div>
  )
}

function ChoiceView({ nodes }: { nodes: TraceNode[] }) {
  const projection = useMemo(() => projectChoices(nodes), [nodes])
  if (!projection.decisions.length) return <EmptyHint text="当前历史里没有识别到 assistant 选项 + 用户选择链路" />
  return (
    <div className="grid gap-4 overflow-auto p-5 md:grid-cols-2">
      {projection.decisions.map((decision) => (
        <div key={decision.id} className="rounded-lg p-3" style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)' }}>
          <div className="line-clamp-3 text-[12px] font-medium" style={{ color: 'var(--fg-strong)' }}>{decision.question}</div>
          <div className="mt-3 flex flex-col gap-1.5">
            {decision.options.map((option) => (
              <div
                key={option.id}
                className="rounded-md px-2 py-1.5 text-[11px]"
                style={{
                  background: option.selected ? 'rgba(111,227,154,0.14)' : 'rgba(255,255,255,0.04)',
                  border: option.selected ? '1px solid rgba(111,227,154,0.4)' : '1px solid var(--hairline)',
                  color: option.selected ? '#6FE39A' : 'var(--fg-dim)',
                }}
              >
                {option.id}. {option.label}
              </div>
            ))}
          </div>
          <div className="mt-3 text-[10.5px]" style={{ color: 'var(--fg-muted)' }}>
            影响后续节点：{decision.affectedNodeIds.join(', ')}
          </div>
        </div>
      ))}
    </div>
  )
}

export function AttentionXPanel({
  topicId,
  nodes,
  goalAnchor,
  planItems,
  rawEvents,
}: {
  topicId: string
  nodes: TraceNode[]
  goalAnchor: GoalAnchor | null
  planItems: PlanItem[]
  rawEvents: RawEvent[]
}) {
  const [mode, setMode] = useState<ViewMode>('mind')
  const [selectedMindId, setSelectedMindId] = useState<string | null>(null)
  const [expandedMindIds, setExpandedMindIds] = useState<Set<string>>(() => new Set())
  const mindProjection = useMemo(() => buildMindMapProjection(nodes, goalAnchor, planItems, expandedMindIds), [nodes, goalAnchor, planItems, expandedMindIds])
  const selectedMindNode =
    mindProjection.nodes.find((node) => node.id === selectedMindId) ??
    mindProjection.nodes.find((node) => node.current) ??
    mindProjection.nodes[0] ??
    null
  const reloadHistory = () => getWsClient().send({ type: 'messages.load', data: { topicId } })
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
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--hairline)' }}>
        <button
          onClick={reloadHistory}
          className="rounded-md px-2.5 py-1.5 text-[11px] transition-opacity hover:opacity-80"
          style={{ background: 'var(--glass-2)', color: 'var(--fg-regular)', border: '1px solid var(--hairline)' }}
        >
          重新加载历史
        </button>
        <div className="flex rounded-lg p-1" style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)' }}>
          {MODES.map((item) => (
            <button
              key={item.id}
              onClick={() => setMode(item.id)}
              className="rounded-md px-2.5 py-1 text-[11px] transition-opacity hover:opacity-80"
              style={{
                background: mode === item.id ? 'rgba(10,132,255,0.18)' : 'transparent',
                color: mode === item.id ? 'var(--fg-strong)' : 'var(--fg-dim)',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="ml-auto text-[11px]" style={{ color: 'var(--fg-muted)' }}>
          {nodes.length} nodes · {planItems.length} plan/todo
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'mind' && (
          <div className="flex h-full min-h-0">
            <div className="min-w-0 flex-1">
              <MindMapGraph
                nodes={nodes}
                goalAnchor={goalAnchor}
                planItems={planItems}
                selectedId={selectedMindNode?.id ?? null}
                onSelect={selectMindNode}
                expandedIds={expandedMindIds}
              />
            </div>
            <MindMapDetail selected={selectedMindNode} traceNodes={nodes} rawEvents={rawEvents} planItems={planItems} />
          </div>
        )}
        {mode === 'phase' && <PhaseView nodes={nodes} />}
        {mode === 'tree' && <TreeView nodes={nodes} goalAnchor={goalAnchor} />}
        {mode === 'branches' && <BranchView nodes={nodes} />}
        {mode === 'plan' && <PlanView nodes={nodes} planItems={planItems} />}
        {mode === 'choice' && <ChoiceView nodes={nodes} />}
      </div>
    </div>
  )
}
