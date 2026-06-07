import { TraceNode, RawEvent } from '../types'
import { X, ChevronDown, ChevronRight, Terminal, Brain, MessageSquare, ListTodo, BookOpen } from 'lucide-react'
import { useState } from 'react'

interface Props {
  node: TraceNode | null
  events: RawEvent[]
  onClose: () => void
}

function DistanceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = value < 0.35 ? 'text-emerald-400' : value < 0.65 ? 'text-yellow-400' : 'text-orange-400'
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">目标距离</span>
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: value < 0.35 ? '#10b981' : value < 0.65 ? '#f59e0b' : '#f97316',
          }}
        />
      </div>
      <span className={`text-xs font-mono ${color}`}>{pct}%</span>
    </div>
  )
}

function EventRow({ event }: { event: RawEvent }) {
  const [open, setOpen] = useState(false)

  const icons: Record<string, React.ReactNode> = {
    tool_use: <Terminal size={12} className="text-blue-400" />,
    thinking: <Brain size={12} className="text-purple-400" />,
    plan:     <MessageSquare size={12} className="text-emerald-400" />,
    todo:     <MessageSquare size={12} className="text-yellow-400" />,
    message:  <MessageSquare size={12} className="text-gray-400" />,
  }

  const kindLabels: Record<string, string> = {
    tool_use: '工具调用',
    thinking: '思考',
    plan:     '计划',
    todo:     'Todo',
    message:  '消息',
  }

  const title =
    event.kind === 'tool_use' || event.kind === 'todo'
      ? `${event.payload.name ?? kindLabels[event.kind]}`
      : kindLabels[event.kind] ?? event.kind

  const preview =
    event.kind === 'thinking'
      ? (event.payload.text as string | undefined)?.slice(0, 100) ?? ''
      : event.kind === 'tool_use' || event.kind === 'todo'
      ? `→ ${(event.payload.output as string | undefined)?.slice(0, 80) ?? '待返回'}`
      : (event.payload.text as string | undefined)?.slice(0, 80) ?? ''

  return (
    <div className="border border-gray-800 rounded overflow-hidden text-xs">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800/60 transition-colors text-left"
        onClick={() => setOpen(!open)}
      >
        {icons[event.kind] ?? icons.message}
        <span className="text-gray-300 font-medium">{title}</span>
        <span className="text-gray-600 truncate flex-1">{preview}</span>
        {open
          ? <ChevronDown size={12} className="text-gray-600 flex-shrink-0" />
          : <ChevronRight size={12} className="text-gray-600 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-800 bg-gray-950/60">
          {event.kind === 'thinking' && (
            <p className="text-gray-400 leading-relaxed whitespace-pre-wrap">
              {event.payload.text as string}
            </p>
          )}
          {(event.kind === 'tool_use' || event.kind === 'todo') && (
            <div className="space-y-2">
              <div>
                <span className="text-gray-600">输入</span>
                <pre className="text-gray-300 mt-1 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(event.payload.input, null, 2)}
                </pre>
              </div>
              {event.payload.output !== null && event.payload.output !== undefined && (
                <div>
                  <span className="text-gray-600">输出</span>
                  <pre className="text-gray-300 mt-1 overflow-x-auto whitespace-pre-wrap break-all max-h-48">
                    {String(event.payload.output)}
                  </pre>
                </div>
              )}
            </div>
          )}
          {(event.kind === 'message' || event.kind === 'plan') && (
            <p className="text-gray-400 leading-relaxed whitespace-pre-wrap">
              {event.payload.text as string}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const ALIGNMENT_LABELS: Record<string, string> = {
  on_track:  '符合计划',
  skipped:   '已跳过',
  unplanned: '计划外',
}

const ALIGNMENT_STYLES: Record<string, string> = {
  on_track:  'text-emerald-400 bg-emerald-900/30',
  skipped:   'text-yellow-400 bg-yellow-900/30',
  unplanned: 'text-gray-400 bg-gray-800/30',
}

const USER_KIND_LABELS: Record<string, string> = {
  question: '用户问题',
  proposal: '描述/想法',
  choice: '用户选择',
  evidence: '证据补充',
  instruction: '用户指令',
}

const ASSISTANT_ACTION_LABELS: Record<string, string> = {
  ask: '助手追问',
  options: '提供选项',
  solve: '解决/结论',
  status: '过程状态',
}

function ExchangeDetail({ exchange, events, index }: {
  exchange: NonNullable<TraceNode['exchanges']>[number]
  events: RawEvent[]
  index: number
}) {
  const [open, setOpen] = useState(false)
  const exchangeEvents = events.filter((e) => exchange.event_ids.includes(e.id))

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden bg-gray-900/40">
      <button
        className="w-full text-left px-3 py-2 hover:bg-gray-800/60 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] text-gray-600 font-mono">#{index + 1}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">
            {USER_KIND_LABELS[exchange.user_kind] ?? exchange.user_kind}
          </span>
          {exchange.tool_count > 0 && (
            <span className="text-[10px] text-gray-600">{exchange.tool_count} 个工具</span>
          )}
          <span className="ml-auto text-gray-600">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        </div>
        {/* 因果上下文：上一轮 AI 说了什么触发了本次提问 */}
        {exchange.prev_ai_summary && (
          <div className="mb-1.5 rounded bg-gray-800/60 px-2 py-1 border-l-2 border-gray-600">
            <p className="text-[10px] text-gray-500 leading-snug">
              <span className="text-gray-600 mr-1">↳ 上轮 AI：</span>
              {exchange.prev_ai_summary}
            </p>
          </div>
        )}
        <p className="text-xs text-gray-100 leading-relaxed whitespace-pre-wrap">
          {exchange.user_message}
        </p>
        <div className="mt-2 rounded border border-blue-900/40 bg-blue-950/20 px-2 py-1.5">
          <div className="text-[10px] text-blue-500 mb-0.5">AI 回复概要</div>
          <p className="text-xs text-blue-200/80 leading-relaxed">{exchange.assistant_summary}</p>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-800 space-y-1.5">
          <div className="text-[10px] text-gray-600 mb-1">
            AI 原始事件 / 工具调用（{exchangeEvents.length}）
          </div>
          {exchangeEvents.length === 0 ? (
            <p className="text-xs text-gray-600">暂无关联 AI 事件</p>
          ) : (
            exchangeEvents.map((e) => <EventRow key={e.id} event={e} />)
          )}
        </div>
      )}
    </div>
  )
}

// ── 从节点事件中提取 Todo 和 Plan 数据 ────────────────────────────────────────

type TodoItem = { content: string; status: 'pending' | 'in_progress' | 'completed' }
type PlanEntry = { text: string; status: string; depth: number }

function extractTodos(nodeEvents: RawEvent[]): TodoItem[] {
  // 取最后一个 todo 事件（最新状态），因为每次写入都是全量覆盖
  const todoEvents = nodeEvents.filter((e) => e.kind === 'todo')
  if (!todoEvents.length) return []
  const last = todoEvents[todoEvents.length - 1]
  const input = last.payload.input as Record<string, unknown> | undefined
  const raw = input?.todos as Array<{ content?: string; status?: string }> | undefined
  if (!raw?.length) return []
  return raw.map((t) => ({
    content: (t.content ?? String(t)).trim(),
    status: (t.status === 'completed' ? 'completed' : t.status === 'in_progress' ? 'in_progress' : 'pending') as TodoItem['status'],
  })).filter((t) => t.content)
}

function extractPlans(nodeEvents: RawEvent[]): PlanEntry[] {
  const planEvents = nodeEvents.filter((e) => e.kind === 'plan')
  const seen = new Set<string>()
  const entries: PlanEntry[] = []
  for (const evt of planEvents) {
    const items = evt.payload.items as Array<{ text?: string; status?: string; depth?: number }> | undefined
    if (!items?.length) continue
    for (const item of items) {
      const text = (item.text ?? '').trim()
      if (!text || seen.has(text)) continue
      seen.add(text)
      entries.push({ text, status: item.status ?? 'pending', depth: item.depth ?? 0 })
    }
  }
  return entries
}

function PlanTodoSection({ nodeEvents }: { nodeEvents: RawEvent[] }) {
  const todos = extractTodos(nodeEvents)
  const plans = extractPlans(nodeEvents)
  const [open, setOpen] = useState(true)

  if (!todos.length && !plans.length) return null

  const todoStatusStyle: Record<string, string> = {
    completed:   'text-emerald-400',
    in_progress: 'text-blue-300',
    pending:     'text-gray-500',
  }
  const todoIcon: Record<string, string> = {
    completed: '✓', in_progress: '›', pending: '○',
  }

  // 排序：进行中 → 待完成 → 已完成
  const sortedTodos = [...todos].sort((a, b) => {
    const order = { in_progress: 0, pending: 1, completed: 2 }
    return order[a.status] - order[b.status]
  })

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800/40 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <ListTodo size={12} className="text-purple-400 flex-shrink-0" />
        <span className="text-xs font-medium text-gray-300 flex-1">计划与待办</span>
        <span className="text-[10px] text-gray-600">
          {todos.length > 0 && `${todos.filter(t => t.status !== 'completed').length}/${todos.length} 待完成`}
          {todos.length > 0 && plans.length > 0 && '  '}
          {plans.length > 0 && `${plans.length} 个计划项`}
        </span>
        {open ? <ChevronDown size={12} className="text-gray-600" /> : <ChevronRight size={12} className="text-gray-600" />}
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-800 space-y-3 bg-gray-950/40">
          {/* Plan 条目 */}
          {plans.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <BookOpen size={10} className="text-emerald-500" />
                <span className="text-[10px] text-emerald-600 uppercase tracking-wider">System Plan</span>
              </div>
              <div className="space-y-1">
                {plans.map((p, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs"
                    style={{ paddingLeft: p.depth * 12 }}>
                    <span className={`mt-0.5 flex-shrink-0 ${
                      p.status === 'completed' ? 'text-emerald-500' :
                      p.status === 'in_progress' ? 'text-blue-400' : 'text-gray-600'
                    }`}>
                      {p.status === 'completed' ? '✓' : p.status === 'in_progress' ? '›' : '○'}
                    </span>
                    <span className={
                      p.status === 'completed' ? 'text-gray-600 line-through' :
                      p.status === 'in_progress' ? 'text-blue-300' : 'text-gray-400'
                    }>{p.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Todo 条目 */}
          {todos.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ListTodo size={10} className="text-yellow-500" />
                <span className="text-[10px] text-yellow-600 uppercase tracking-wider">Todo</span>
              </div>
              <div className="space-y-1">
                {sortedTodos.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 flex-shrink-0 font-medium ${todoStatusStyle[t.status]}`}>
                      {todoIcon[t.status]}
                    </span>
                    <span className={t.status === 'completed' ? 'text-gray-600 line-through' : 'text-gray-300'}>
                      {t.content}
                    </span>
                    {t.status === 'in_progress' && (
                      <span className="ml-auto text-[10px] text-blue-500 flex-shrink-0">进行中</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function NodeCard({ node, events, onClose }: Props) {
  if (!node) return null

  const nodeEvents = events.filter((e) => node.event_ids.includes(e.id))

  return (
    <div className="fixed right-0 top-14 bottom-0 w-96 bg-gray-950 border-l border-gray-800
      flex flex-col z-40 shadow-2xl">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <span className="text-sm font-medium text-gray-200 flex-1">节点详情</span>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* 用户输入 + AI 概要 */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xs text-gray-500 uppercase tracking-wider">用户输入</h3>
            {node.user_message_count && node.user_message_count > 1 && (
              <span className="text-[10px] text-gray-600">
                聚合 {node.user_message_count} 条
              </span>
            )}
          </div>
          {node.is_loading ? (
            <div className="h-20 bg-gray-900 rounded-lg animate-pulse" />
          ) : node.exchanges?.length ? (
            <div className="space-y-2">
              {node.exchanges.map((exchange, index) => (
                <ExchangeDetail
                  key={exchange.id}
                  exchange={exchange}
                  events={events}
                  index={index}
                />
              ))}
            </div>
          ) : (
            <div className="bg-gray-900/80 rounded-lg px-3 py-2.5 border border-gray-800">
              <p className="text-sm text-gray-100 font-medium leading-relaxed">
                {node.user_message || node.intent || '—'}
              </p>
            </div>
          )}
        </div>

        {/* 计划与待办 */}
        <PlanTodoSection nodeEvents={nodeEvents} />

        {/* 阶段结论 */}
        {node.conclusion && (
          <div className="bg-emerald-950/40 border border-emerald-900/40 rounded-lg px-3 py-2">
            <h3 className="text-xs text-emerald-600 uppercase tracking-wider mb-1">阶段结论</h3>
            <p className="text-sm text-emerald-300 leading-relaxed font-medium">{node.conclusion}</p>
          </div>
        )}

        {/* 原因 */}
        {node.rationale && (
          <div>
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-1">原因</h3>
            <p className="text-sm text-gray-400 leading-relaxed">{node.rationale}</p>
          </div>
        )}

        {/* 步骤数 */}
        {(node.step_count > 1 || (node.assistant_actions?.length ?? 0) > 0) && (
          <div className="flex items-center gap-2 flex-wrap">
            {node.step_count > 1 && (
              <span className="text-xs text-gray-600">包含 {node.step_count} 个工具调用步骤</span>
            )}
            {node.assistant_actions?.map((action) => (
              <span key={action} className="text-xs px-2 py-0.5 rounded bg-blue-950/40 text-blue-300">
                {ASSISTANT_ACTION_LABELS[action] ?? action}
              </span>
            ))}
          </div>
        )}

        {/* 元信息 */}
        <div className="flex items-center gap-2 flex-wrap">
          {node.alignment !== 'unplanned' && (
            <span
              className={`text-xs px-2 py-0.5 rounded font-medium ${
                ALIGNMENT_STYLES[node.alignment] ?? ALIGNMENT_STYLES.unplanned
              }`}
            >
              {ALIGNMENT_LABELS[node.alignment] ?? node.alignment}
            </span>
          )}
          <span className="text-xs text-gray-600 font-mono">
            分支：{node.branch_id}
          </span>
          <span className="text-xs text-gray-600 font-mono">
            {node.ts_start ? new Date(node.ts_start).toLocaleTimeString('zh-CN') : '—'}
          </span>
        </div>

        {/* 目标距离 */}
        <DistanceMeter value={node.goal_distance} />

        {/* 本阶段全部 AI 原始事件 */}
        <div>
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
            本阶段全部 AI 原始事件（{nodeEvents.length}）
          </h3>
          <div className="space-y-1.5">
            {nodeEvents.length === 0 ? (
              <p className="text-xs text-gray-600">暂无关联事件</p>
            ) : (
              nodeEvents.map((e) => <EventRow key={e.id} event={e} />)
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
