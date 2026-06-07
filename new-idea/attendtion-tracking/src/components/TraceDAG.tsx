import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  Node as FlowNode,
  NodeProps,
  EdgeProps,
  getStraightPath,
  getBezierPath,
  useReactFlow,
  useNodesState,
  Panel,
} from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import '@xyflow/react/dist/style.css'
import { TraceExchange, TraceNode, PlanItem } from '../types'
import { GraphData } from '../pipeline/projector'
import { Loader2, CheckCircle2, XCircle, Clock, Zap, ChevronDown, ChevronUp } from 'lucide-react'

// ── Helpers ──────────────────────────────────────────────────────────────────

function distanceColor(d: number): string {
  if (d < 0.35) return '#10b981'
  if (d < 0.65) return '#f59e0b'
  return '#f97316'
}

function statusIcon(status: string, loading?: boolean) {
  if (loading) return <Loader2 size={12} className="animate-spin text-blue-400" />
  switch (status) {
    case 'done':      return <CheckCircle2 size={12} className="text-emerald-500" />
    case 'failed':    return <XCircle size={12} className="text-red-500" />
    case 'running':   return <Zap size={12} className="text-blue-400 animate-pulse" />
    default:          return <Clock size={12} className="text-gray-500" />
  }
}

const ALIGNMENT_LABELS: Record<string, string> = {
  on_track: '符合计划',
  skipped:  '已跳过',
  unplanned: '计划外',
}

const ALIGNMENT_STYLES: Record<string, string> = {
  on_track:  'bg-emerald-900/60 text-emerald-400',
  skipped:   'bg-yellow-900/60 text-yellow-400',
  unplanned: 'bg-gray-800/60 text-gray-400',
}

const USER_KIND_LABELS: Record<string, string> = {
  question: '问题',
  proposal: '想法',
  choice: '选择',
  evidence: '证据',
  instruction: '指令',
}

function alignmentBadge(alignment: string) {
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
        ALIGNMENT_STYLES[alignment] ?? ALIGNMENT_STYLES.unplanned
      }`}
    >
      {ALIGNMENT_LABELS[alignment] ?? alignment}
    </span>
  )
}

// ── Context: expand-toggle callback injected into node data ──────────────────

type ExecutionNodeData = TraceNode & {
  __onToggleExpand?: (id: string) => void
  __isExpanded?: boolean
}

// ── Custom Nodes ─────────────────────────────────────────────────────────────

function ExecutionNode({ data, selected }: NodeProps) {
  const node = data as unknown as ExecutionNodeData
  const [aiExpanded, setAiExpanded] = useState(false)
  const canExpand  = !node.is_loading && (node.user_message_count ?? 0) > 1
  const isExpanded = node.__isExpanded ?? false

  const borderColor = selected
    ? '#3b82f6'
    : node.is_loading
    ? '#374151'
    : distanceColor(node.goal_distance)

  return (
    <div
      className={`w-64 rounded-lg bg-gray-900 border transition-all duration-300
        ${selected ? 'shadow-lg shadow-blue-500/20' : ''}`}
      style={{ borderColor, borderWidth: selected ? 2 : 1 }}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-600 !w-2 !h-2" />

      {/* 头部 */}
      <div
        className="px-3 py-2 flex items-center gap-2 rounded-t-lg"
        style={{ borderBottom: `1px solid ${borderColor}20` }}
      >
        {statusIcon(node.status, node.is_loading)}
        <span className="text-xs text-gray-400 font-mono">
          {node.ts_start
            ? new Date(node.ts_start).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })
            : '—'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {node.user_kind && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800/80 text-gray-300">
              {USER_KIND_LABELS[node.user_kind] ?? node.user_kind}
            </span>
          )}
          {/* 只在有计划且非 unplanned 时才显示对齐标签 */}
          {node.alignment !== 'unplanned' && alignmentBadge(node.alignment)}
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: distanceColor(node.goal_distance) }}
            title={`目标距离：${(node.goal_distance * 100).toFixed(0)}%`}
          />
        </div>
      </div>

      {/* 用户消息（主体） */}
      <div className="px-3 pt-2 pb-1">
        {node.is_loading ? (
          <div className="h-4 bg-gray-800 rounded animate-pulse w-3/4" />
        ) : (
            <p className="text-sm text-gray-100 font-medium leading-snug line-clamp-3">
              {node.user_message || node.intent || 'AI 分析中…'}
            </p>
        )}
      </div>

      {/* AI 回复概要：贴在用户节点下方 */}
      <div className="px-3 pb-2">
        {node.is_loading ? (
          <div className="h-3 bg-gray-800 rounded animate-pulse w-full mt-1" />
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setAiExpanded((v) => !v)
            }}
            className="w-full text-left rounded-md border border-blue-900/50 bg-blue-950/25 px-2 py-1.5
              hover:bg-blue-950/40 transition-colors"
          >
            <div className="flex items-start gap-1.5">
              <span className="text-blue-400 text-xs mt-0.5 flex-shrink-0">AI</span>
              <p className="text-xs text-blue-200/80 leading-snug line-clamp-2">
                {node.conclusion || node.exchanges?.[0]?.assistant_summary || '点击查看 AI 回复概要'}
              </p>
            </div>
            {aiExpanded && node.exchanges && node.exchanges.length > 0 && (
              <div className="mt-2 space-y-1 max-h-44 overflow-y-auto border-t border-blue-900/40 pt-2">
                {node.exchanges.map((exchange, index) => (
                  <div key={exchange.id} className="text-[10px] leading-snug text-gray-400">
                    <span className="text-gray-600">#{index + 1}</span>{' '}
                    <span className="text-gray-300">{exchange.assistant_summary}</span>
                  </div>
                ))}
              </div>
            )}
          </button>
        )}
      </div>

      {/* 底部：工具调用数 + 钻入按钮 */}
      {!node.is_loading && (
        <div className="px-3 pb-2 flex items-center gap-2">
          {node.step_count > 0 && (
            <span className="text-[10px] text-gray-700">{node.step_count} 个工具调用</span>
          )}
          {node.user_message_count && node.user_message_count > 1 && (
            <span className="text-[10px] text-gray-700">{node.user_message_count} 条用户输入</span>
          )}
          {canExpand && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                node.__onToggleExpand?.(node.id)
              }}
              className={`ml-auto flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors
                ${isExpanded
                  ? 'bg-blue-900/40 text-blue-300 hover:bg-blue-900/60'
                  : 'bg-gray-800 text-gray-500 hover:text-blue-300 hover:bg-blue-950/50'}`}
            >
              {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              {node.user_message_count} 轮
            </button>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right}  className="!bg-gray-600 !w-2 !h-2" />
      {/* expand-down：子树展开时向下连子节点 */}
      <Handle type="source" position={Position.Bottom} id="expand-down"
        className="!bg-gray-700 !w-1.5 !h-1.5 !opacity-30" />
      {/* 分支出口：上方分支走 Top，下方分支走 Bottom */}
      <Handle type="source" position={Position.Top}    id="branch-top-out"
        className="!bg-gray-700 !w-1.5 !h-1.5 !opacity-30" />
      <Handle type="source" position={Position.Bottom} id="branch-out"
        className="!bg-gray-700 !w-1.5 !h-1.5 !opacity-30" />
    </div>
  )
}

type ExchangeNodeData = {
  exchange: TraceExchange
  index: number
  goalDistance: number
  subExchanges?: TraceExchange[]
  __isExpanded?: boolean
  __onToggleExpand?: (id: string) => void
}

function ExchangeNode({ data, selected }: NodeProps) {
  const { exchange, index, goalDistance, subExchanges, __isExpanded, __onToggleExpand } = data as unknown as ExchangeNodeData
  const canExpand   = (subExchanges?.length ?? 0) > 1
  const isExpanded  = __isExpanded ?? false
  const borderColor = selected ? '#3b82f6' : distanceColor(goalDistance)

  return (
    <div
      className={`w-60 rounded-lg bg-gray-900 border text-xs transition-all duration-200
        ${selected ? 'shadow-lg shadow-blue-500/20' : ''}`}
      style={{ borderColor, borderWidth: selected ? 2 : 1 }}
    >
      <Handle type="target" position={Position.Top}    id="top"          className="!bg-gray-600 !w-2 !h-2" />
      <Handle type="target" position={Position.Left}   id="left"         className="!bg-gray-600 !w-2 !h-2" />
      <Handle type="source" position={Position.Right}  id="right"        className="!bg-gray-600 !w-2 !h-2" />
      {/* expand-down：自身展开子级时作为源 handle，与 ExecutionNode 保持一致 */}
      <Handle type="source" position={Position.Bottom} id="expand-down"  className="!bg-gray-700 !w-1.5 !h-1.5 !opacity-30" />

      {/* 头部：编号 + 类型 + 目标距离 */}
      <div
        className="px-3 py-1.5 flex items-center gap-2 rounded-t-lg"
        style={{ borderBottom: `1px solid ${borderColor}20` }}
      >
        <span className="text-[10px] text-gray-600 font-mono">#{index + 1}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800/80 text-gray-300">
          {USER_KIND_LABELS[exchange.user_kind] ?? exchange.user_kind}
        </span>
        {exchange.tool_count > 0 && (
          <span className="text-[10px] text-gray-600">{exchange.tool_count} 工具</span>
        )}
        <div
          className="ml-auto w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: distanceColor(goalDistance) }}
          title={`子目标距离：${(goalDistance * 100).toFixed(0)}%`}
        />
      </div>

      {/* 触发上下文 */}
      {exchange.prev_ai_summary && (
        <div className="px-3 pt-1.5 pb-0">
          <p className="text-[10px] text-gray-600 leading-snug line-clamp-1 border-l-2 border-gray-700 pl-1.5">
            {exchange.prev_ai_summary}
          </p>
        </div>
      )}

      {/* 用户消息 */}
      <div className="px-3 pt-1.5 pb-1">
        <p className="text-gray-100 font-medium leading-snug line-clamp-3">
          {exchange.user_message}
        </p>
      </div>

      {/* AI 回复 */}
      <div className="px-3 pb-2.5">
        <div className="rounded border border-blue-900/40 bg-blue-950/20 px-2 py-1.5">
          <div className="flex items-start gap-1.5">
            <span className="text-blue-400 text-[10px] mt-0.5 flex-shrink-0">AI</span>
            <p className="text-[10px] text-blue-200/80 leading-snug line-clamp-2">
              {exchange.assistant_summary}
            </p>
          </div>
        </div>
      </div>

      {/* 展开/收起子步骤按钮 */}
      {canExpand && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              __onToggleExpand?.(exchange.id)
            }}
            className={`w-full flex items-center justify-center gap-1 text-[10px] py-1 rounded transition-colors
              ${isExpanded
                ? 'bg-blue-900/40 text-blue-300 hover:bg-blue-900/60'
                : 'bg-gray-800 text-gray-500 hover:text-blue-300 hover:bg-blue-950/50'}`}
          >
            {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {subExchanges!.length} 轮子步骤
          </button>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-gray-600 !w-2 !h-2" />
    </div>
  )
}

function BranchNode({ data, selected }: NodeProps) {
  const node = data as unknown as TraceNode

  return (
    <div
      className={`w-56 rounded-lg bg-gray-900/60 border border-gray-700/50 opacity-70
        hover:opacity-100 transition-opacity
        ${selected ? 'border-gray-500 opacity-100' : ''}`}
    >
      {/* 横向链：Left 进 Right 出；入口来自上方 Phase 用 Bottom，来自下方用 Top */}
      <Handle type="target" position={Position.Left}   id="branch-left-in"   className="!bg-gray-700 !w-2 !h-2" />
      <Handle type="target" position={Position.Bottom} id="branch-bottom-in" className="!bg-gray-700 !w-1.5 !h-1.5 !opacity-40" />
      <Handle type="target" position={Position.Top}    id="branch-top-in"    className="!bg-gray-700 !w-1.5 !h-1.5 !opacity-40" />
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          {statusIcon(node.status, node.is_loading)}
          <span className="text-xs text-gray-600 font-mono">
            分支：{node.branch_id}
          </span>
        </div>
        <p className="text-xs text-gray-500 line-clamp-2">
          {node.is_loading ? '加载中…' : node.user_message || node.intent || '分支步骤'}
        </p>
      </div>
      <Handle type="source" position={Position.Right}  id="branch-right-out" className="!bg-gray-700 !w-2 !h-2" />
    </div>
  )
}

function PlanNodeComponent({ data, selected }: NodeProps) {
  const item = data as unknown as PlanItem

  const statusStyles: Record<string, string> = {
    completed:   'text-emerald-400 line-through opacity-70',
    in_progress: 'text-blue-300',
    pending:     'text-gray-400',
  }

  const checkStyles: Record<string, string> = {
    completed:   'bg-emerald-500/30 text-emerald-400',
    in_progress: 'bg-blue-500/30 text-blue-400',
    pending:     'bg-gray-700 text-gray-600',
  }

  return (
    <div
      className={`w-48 rounded border bg-gray-950 px-3 py-2
        ${selected ? 'border-purple-500/60' : 'border-gray-800'}
        transition-colors`}
      style={{ marginLeft: item.depth * 12 }}
    >
      <Handle type="source" position={Position.Right} className="!bg-gray-700 !w-1.5 !h-1.5" />
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded text-[10px] flex items-center justify-center
            ${checkStyles[item.status] ?? checkStyles.pending}`}
        >
          {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '›' : '○'}
        </span>
        <p className={`text-xs leading-snug ${statusStyles[item.status] ?? statusStyles.pending}`}>
          {item.text}
        </p>
      </div>
    </div>
  )
}

// ── Custom Edges ──────────────────────────────────────────────────────────────

function MainLineEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <path
      d={path}
      fill="none"
      stroke={(style?.stroke as string) ?? '#3b82f6'}
      strokeWidth={(style?.strokeWidth as number) ?? 2}
      markerEnd={markerEnd}
    />
  )
}

function BranchEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <path
      d={path}
      fill="none"
      stroke={(style?.stroke as string) ?? '#6b7280'}
      strokeWidth={(style?.strokeWidth as number) ?? 1.5}
      strokeDasharray="4 4"
      opacity={0.6}
    />
  )
}

function AlignmentEdge({ sourceX, sourceY, targetX, targetY, style }: EdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  return (
    <path
      d={path}
      fill="none"
      stroke={(style?.stroke as string) ?? '#8b5cf6'}
      strokeWidth={(style?.strokeWidth as number) ?? 1}
      strokeDasharray="6 3"
      opacity={(style?.opacity as number) ?? 0.5}
    />
  )
}

function ExpandEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <path
      d={path}
      fill="none"
      stroke={(style?.stroke as string) ?? '#374151'}
      strokeWidth={(style?.strokeWidth as number) ?? 1}
      strokeDasharray="3 3"
      opacity={0.7}
    />
  )
}

// 父→子 落边（垂直下落，带弧度）
function ChildDropEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <path d={path} fill="none"
      stroke={(style?.stroke as string) ?? '#4b5563'}
      strokeWidth={(style?.strokeWidth as number) ?? 1.5}
      strokeDasharray="5 3" opacity={0.8} />
  )
}

// 子节点横向链（同层兄弟连接）
function ChildLineEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <path d={path} fill="none"
      stroke={(style?.stroke as string) ?? '#4b5563'}
      strokeWidth={(style?.strokeWidth as number) ?? 1.5}
      opacity={0.7} />
  )
}

function TimelineEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <path
      d={path}
      fill="none"
      stroke={(style?.stroke as string) ?? '#3b82f6'}
      strokeWidth={(style?.strokeWidth as number) ?? 1.5}
      opacity={(style?.opacity as number) ?? 0.5}
    />
  )
}

// ── Timeline node types ───────────────────────────────────────────────────────

function TimelineNode({ data, selected }: NodeProps) {
  const node = data as unknown as TraceNode & { __sessionColor: string }
  const color = node.__sessionColor ?? '#3b82f6'

  return (
    <div
      className={`w-44 rounded bg-gray-900 border transition-all duration-200
        ${selected ? 'shadow-lg' : 'border-gray-700/60'}`}
      style={{
        borderColor: selected ? color : undefined,
        borderLeftColor: color,
        borderLeftWidth: 3,
        boxShadow: selected ? `0 0 12px ${color}40` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-600 !w-1.5 !h-1.5 !opacity-0" />
      <div className="px-2 py-1.5">
        {node.is_loading ? (
          <div className="h-3 bg-gray-800 rounded animate-pulse w-full" />
        ) : (
          <>
            <p className="text-xs text-gray-200 leading-snug line-clamp-2 font-medium">
              {node.user_message || node.intent || '…'}
            </p>
            {node.conclusion && (
              <p className="text-[10px] text-gray-500 mt-1 leading-snug line-clamp-1">
                {node.conclusion}
              </p>
            )}
          </>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-gray-600 !w-1.5 !h-1.5 !opacity-0" />
    </div>
  )
}

function LaneLabelNode({ data }: NodeProps) {
  const { label, color } = data as unknown as { label: string; color: string }
  return (
    <div className="w-40 flex items-center justify-end gap-2 pr-3 pointer-events-none select-none">
      <span className="text-xs text-gray-400 truncate">{label}</span>
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
    </div>
  )
}

// ── Node / Edge type maps ─────────────────────────────────────────────────────

const nodeTypes = {
  executionNode: ExecutionNode,
  branchNode:    BranchNode,
  planNode:      PlanNodeComponent,
  exchangeNode:  ExchangeNode,
  timelineNode:  TimelineNode,
  laneLabel:     LaneLabelNode,
}

const edgeTypes = {
  mainLineEdge:  MainLineEdge,
  branchEdge:    BranchEdge,
  alignmentEdge: AlignmentEdge,
  childDropEdge: ChildDropEdge,
  childLineEdge: ChildLineEdge,
  timelineEdge:  TimelineEdge,
}

// ── Main Component ────────────────────────────────────────────────────────────

interface TraceDAGProps {
  graphData: GraphData | null
  selectedNodeId: string | null
  onNodeClick: (nodeId: string) => void
  onToggleExpand?: (nodeId: string) => void
  expandedNodes?: Set<string>
}

function FitButton() {
  const { fitView } = useReactFlow()
  return (
    <button
      onClick={() => fitView({ padding: 0.1, duration: 400 })}
      className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded
        bg-gray-800 hover:bg-gray-700 transition-colors border border-gray-700"
    >
      适应视图
    </button>
  )
}

export default function TraceDAG({
  graphData,
  selectedNodeId,
  onNodeClick,
  onToggleExpand,
  expandedNodes,
}: TraceDAGProps) {
  const { fitView } = useReactFlow()

  // ── 用 useNodesState 管理节点，让 React Flow 每帧直接写入位置 ────────────────
  // 不再手动管理 draggedPos：useNodesState 内部用 applyNodeChanges 处理拖拽，
  // 每帧位置变化立即进入局部 state，不依赖外部 re-render，拖拽零延迟。
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<FlowNode>([])

  // 当 graphData 结构变化时（展开/收起/新数据加载）同步节点，但保留已拖拽的位置
  useEffect(() => {
    if (!graphData) { setRfNodes([]); return }
    setRfNodes((prev) => {
      const posMap = new Map(prev.map((n) => [n.id, n.position]))
      return graphData.nodes.map((n) => ({
        ...n,
        // 有记录的拖拽位置就用，否则用 projector 计算的初始位置
        position: posMap.get(n.id) ?? n.position,
      }))
    })
  // graphData 变化时触发（expandedNodes 的变化已经体现在 graphData 里了）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData])

  // 只在数据首次加载（从0变为有节点）时 fitView，展开/收起不触发
  const hasNodes = rfNodes.length > 0
  const prevHasNodes = useRef(false)
  useEffect(() => {
    if (hasNodes && !prevHasNodes.current) {
      const timer = window.setTimeout(() => fitView({ padding: 0.18, duration: 300 }), 50)
      prevHasNodes.current = true
      return () => window.clearTimeout(timer)
    }
    if (!hasNodes) prevHasNodes.current = false
  }, [fitView, hasNodes])

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => onNodeClick(node.id),
    [onNodeClick]
  )

  if (!graphData) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        暂无轨迹数据
      </div>
    )
  }

  // 在 rfNodes（含实时拖拽位置）上叠加选中状态和回调
  const displayNodes = rfNodes.map((n) => {
    if (n.type === 'executionNode' || n.type === 'exchangeNode') {
      return {
        ...n,
        selected: n.id === selectedNodeId,
        data: {
          ...n.data,
          __onToggleExpand: onToggleExpand,
          __isExpanded: expandedNodes?.has(n.id) ?? false,
        },
      }
    }
    return { ...n, selected: n.id === selectedNodeId }
  })

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={graphData.edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={handleNodeClick}
      onNodesChange={onNodesChange}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#1f2937" gap={24} size={1} />
      <Controls className="!bg-gray-900 !border-gray-700" />
      <MiniMap
        nodeColor={(n) => {
          if (n.type === 'planNode') return '#7c3aed'
          const d = n.data as unknown as TraceNode
          return distanceColor(d.goal_distance ?? 0.5)
        }}
        className="!bg-gray-950 !border-gray-800"
        maskColor="rgba(0,0,0,0.5)"
      />
      <Panel position="top-right">
        <FitButton />
      </Panel>
    </ReactFlow>
  )
}
