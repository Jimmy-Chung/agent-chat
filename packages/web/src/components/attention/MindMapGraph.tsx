'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BezierEdge,
  Handle,
  Position,
  ReactFlow,
  applyNodeChanges,
  type EdgeProps,
  type NodeChange,
  type Node,
  type NodeProps,
  type NodeTypes,
  type EdgeTypes,
  type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { GoalAnchor, PlanItem, TraceNode } from '@/lib/attention'
import { goalDistanceColor } from '@/lib/attention'
import { buildMindMapProjection, type MindMapEdge, type MindMapNode, type MindMapProjection } from '@/lib/attention/mind-map-projector'
import { Tooltip } from '@/components/ui/Tooltip'

interface MindMapFlowNodeData extends Record<string, unknown> {
  node: MindMapNode
  onFocus?: (messageId: string) => void
  onUpdateGoal?: () => void
  remainingGoalEdits?: number
}

const WIDTH: Record<MindMapNode['kind'], number> = {
  goal: 250,
  user: 220,
  aggregate: 240,
}

const KIND_LABEL: Record<MindMapNode['kind'], string> = {
  goal: '目标',
  user: '用户',
  aggregate: '聚合',
}

function nodeDotColor(node: MindMapNode): string {
  if (node.kind === 'goal') return '#0A84FF'
  if (node.current) return '#FF9F4A'
  if (node.relation === 'branch') return '#6cb1ff'
  if (node.kind === 'aggregate') return '#0A84FF'
  return goalDistanceColor(node.goalDistance)
}

function nodeKindColor(node: MindMapNode): string {
  if (node.kind === 'goal') return '#6cb1ff'
  if (node.current) return '#FFC48A'
  if (node.relation === 'branch') return '#6cb1ff'
  if (node.kind === 'aggregate') return '#6cb1ff'
  return goalDistanceColor(node.goalDistance)
}

function nodeBorder(node: MindMapNode, selected: boolean): string {
  if (selected) return '1px solid rgba(10,132,255,0.65)'
  if (node.current) return '1px solid rgba(255,159,74,0.7)'
  if (node.kind === 'goal') return '1px solid rgba(10,132,255,0.38)'
  if (node.relation === 'branch') return '1px dashed rgba(108,177,255,0.36)'
  if (node.kind === 'aggregate') return '1px solid rgba(10,132,255,0.26)'
  return '1px solid var(--hairline-2)'
}

function nodeBackground(node: MindMapNode): string {
  if (node.current) return 'rgba(40,28,16,0.5)'
  if (node.relation === 'branch') return 'rgba(10,132,255,0.04)'
  return 'rgba(255,255,255,0.045)'
}

function nodeBoxShadow(node: MindMapNode, selected: boolean): string {
  if (node.current) return 'none' // animation handles it
  if (node.kind === 'goal') return 'inset 0 1px 0 rgba(255,255,255,.06),0 10px 28px rgba(0,0,0,.4),0 0 22px rgba(10,132,255,.12)'
  if (selected) return '0 0 0 1px rgba(10,132,255,0.35),0 10px 26px rgba(0,0,0,0.38)'
  return '0 6px 18px rgba(0,0,0,0.28)'
}

function FocusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="7"/>
      <line x1="12" y1="2" x2="12" y2="5"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
      <line x1="2" y1="12" x2="5" y2="12"/>
      <line x1="19" y1="12" x2="22" y2="12"/>
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>
    </svg>
  )
}

function MindMapFlowNode({ data, selected }: NodeProps) {
  const { node, onFocus, onUpdateGoal, remainingGoalEdits } = data as MindMapFlowNodeData
  const dotColor = nodeDotColor(node)
  const kindColor = nodeKindColor(node)
  const focusMessageId = node.focusMessageId

  const relationLabel = node.relation === 'branch'
    ? `支线${KIND_LABEL[node.kind]}`
    : KIND_LABEL[node.kind]

  const tagText = node.kind === 'goal'
    ? node.subtitle
    : node.collapsed
      ? `已聚合 · ${node.aggregation?.turnCount ?? 0} 轮`
      : node.kind === 'aggregate'
        ? `已展开 · ${node.aggregation?.turnCount ?? 0} 轮`
        : node.status === 'running'
          ? '进行中'
          : ''

  return (
    <div
      className="rounded-[13px]"
      style={{
        width: WIDTH[node.kind],
        padding: '11px 12px 12px',
        background: nodeBackground(node),
        backdropFilter: 'blur(24px) saturate(170%)',
        WebkitBackdropFilter: 'blur(24px) saturate(170%)',
        border: nodeBorder(node, selected as boolean),
        boxShadow: nodeBoxShadow(node, selected as boolean),
        animation: node.current ? 'attn-node-cur 1.8s ease-in-out infinite' : undefined,
        cursor: 'default',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      {/* Header row: dot + kind + tag + actions */}
      <div className="mb-2 flex items-center gap-[7px]">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            background: dotColor,
            boxShadow: `0 0 7px ${dotColor}`,
            animation: node.current ? 'attn-dot-blink 1.2s ease-in-out infinite' : undefined,
          }}
        />
        <span className="text-[11px] font-semibold" style={{ color: kindColor, letterSpacing: '.02em' }}>
          {relationLabel}
        </span>
        {tagText && (
          <span className="text-[10px]" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', letterSpacing: 0 }}>
            {tagText}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          {/* Focus button */}
          {focusMessageId && (
            <Tooltip content="回到消息面板中的对应消息" side="top" delayMs={180}>
              <button
                type="button"
                className="nodrag nopan inline-flex h-[22px] w-[22px] items-center justify-center rounded-[6px]"
                style={{
                  color: 'var(--fg-dim)',
                  background: 'rgba(255,255,255,.05)',
                  border: '1px solid var(--hairline)',
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onFocus?.(focusMessageId)
                }}
              >
                <FocusIcon />
              </button>
            </Tooltip>
          )}
          {/* Expand/collapse toggle for aggregate */}
          {node.hasChildren && (
            <button
              type="button"
              className="nodrag nopan inline-flex h-[22px] w-[22px] items-center justify-center rounded-[6px] text-[12px] font-semibold"
              style={{
                color: node.collapsed ? '#6cb1ff' : '#6cb1ff',
                background: node.collapsed ? 'rgba(10,132,255,0.10)' : 'rgba(10,132,255,0.10)',
                border: '1px solid rgba(10,132,255,0.32)',
              }}
              title={node.collapsed ? '展开' : '折叠'}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {node.collapsed ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M5 12h14"/></svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="text-[14px] font-semibold leading-[1.35]" style={{ color: 'var(--fg-strong)', letterSpacing: '-.01em' }}>
        {node.title}
      </div>

      {/* Subtitle (for user node with running state) */}
      {node.kind !== 'goal' && node.subtitle && (
        <div className="mt-[5px] text-[11px]" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', letterSpacing: 0 }}>
          {node.subtitle}
        </div>
      )}

      {/* 更新目标 button — only on goal node */}
      {node.kind === 'goal' && onUpdateGoal && (
        <button
          type="button"
          className="nodrag nopan mt-[11px] flex h-[30px] w-full items-center justify-between rounded-[9px] px-[11px] text-[12.5px] font-semibold"
          style={{
            background: 'rgba(10,132,255,.12)',
            border: '1px solid rgba(10,132,255,.32)',
            color: '#6cb1ff',
            letterSpacing: '-.005em',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onUpdateGoal()
          }}
        >
          <span className="flex items-center gap-[6px]">
            <PencilIcon />
            更新目标
          </span>
          {remainingGoalEdits !== undefined && (
            <span
              className="text-[10px]"
              style={{
                fontFamily: 'var(--font-mono)',
                color: '#6cb1ff',
                opacity: 0.85,
                background: 'rgba(10,132,255,.12)',
                border: '1px solid rgba(10,132,255,.26)',
                borderRadius: 6,
                padding: '0 5px',
                letterSpacing: 0,
              }}
            >
              可改 {remainingGoalEdits}/2
            </span>
          )}
        </button>
      )}

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

function MindMapEdgeComponent(props: EdgeProps) {
  const kind = (props.data as { kind?: MindMapEdge['kind'] } | undefined)?.kind ?? 'tree'
  const stroke = kind === 'branch' ? '#6cb1ff' : '#0A84FF'
  return (
    <BezierEdge
      {...props}
      style={{
        stroke,
        strokeWidth: kind === 'branch' ? 1.7 : 2.2,
        strokeOpacity: kind === 'branch' ? 0.55 : 0.85,
        strokeDasharray: kind === 'branch' ? '5 5' : undefined,
      }}
    />
  )
}

const nodeTypes: NodeTypes = { mind: MindMapFlowNode }
const edgeTypes: EdgeTypes = { mind: MindMapEdgeComponent }
type MindFlowNode = Node<Record<string, unknown>, 'mind'>

export default function MindMapGraph({
  nodes,
  goalAnchor,
  planItems,
  selectedId,
  onSelect,
  onFocus,
  onUpdateGoal,
  remainingGoalEdits,
  expandedIds,
  focusNodeId,
  projection: providedProjection,
  fitViewCallbackRef,
}: {
  nodes: TraceNode[]
  goalAnchor: GoalAnchor | null
  planItems: PlanItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onFocus?: (messageId: string) => void
  onUpdateGoal?: () => void
  remainingGoalEdits?: number
  expandedIds: ReadonlySet<string>
  focusNodeId?: string | null
  projection?: MindMapProjection
  fitViewCallbackRef?: React.MutableRefObject<(() => void) | null>
}) {
  const didFitViewRef = useRef(false)
  const draggedPositionsRef = useRef<Record<string, XYPosition>>({})
  const projection = useMemo(
    () => providedProjection ?? buildMindMapProjection(nodes, goalAnchor, planItems, expandedIds),
    [providedProjection, nodes, goalAnchor, planItems, expandedIds],
  )
  const projectedNodes = useMemo(
    (): MindFlowNode[] => projection.nodes.map((node) => ({
      id: node.id,
      type: 'mind',
      position: draggedPositionsRef.current[node.id] ?? node.position,
      data: { node, onFocus, onUpdateGoal, remainingGoalEdits },
      selected: node.id === selectedId,
    })),
    [onFocus, onUpdateGoal, remainingGoalEdits, projection.nodes, selectedId],
  )
  const [displayNodes, setDisplayNodes] = useState<MindFlowNode[]>(projectedNodes)
  useEffect(() => {
    const visibleIds = new Set(projectedNodes.map((node) => node.id))
    draggedPositionsRef.current = Object.fromEntries(
      Object.entries(draggedPositionsRef.current).filter(([id]) => visibleIds.has(id)),
    )
    setDisplayNodes(projectedNodes)
  }, [projectedNodes])
  const rfEdges = useMemo(
    () => projection.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'mind' as const,
      data: { kind: edge.kind },
      animated: false,
    })),
    [projection.edges],
  )
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setDisplayNodes((current) => {
      const next = applyNodeChanges(changes, current) as MindFlowNode[]
      for (const change of changes) {
        if (change.type !== 'position') continue
        const node = next.find((entry) => entry.id === change.id)
        if (node) {
          draggedPositionsRef.current[change.id] = node.position
        }
      }
      return next
    })
  }, [])

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onInit={(instance) => {
        if (fitViewCallbackRef) {
          fitViewCallbackRef.current = () => instance.fitView({ padding: 0.18, maxZoom: 0.95 })
        }
        if (didFitViewRef.current) return
        didFitViewRef.current = true
        window.requestAnimationFrame(() => {
          const focused = focusNodeId ? projection.nodes.find((node) => node.id === focusNodeId) : null
          if (focused) {
            instance.setCenter(
              focused.position.x + WIDTH[focused.kind] / 2,
              focused.position.y + 70,
              { zoom: 0.9, duration: 320 },
            )
            return
          }
          instance.fitView({ padding: 0.18, maxZoom: 0.95 })
        })
      }}
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      minZoom={0.18}
      maxZoom={1.35}
      onNodesChange={onNodesChange}
      onNodeClick={(_, node) => onSelect(node.id)}
    >
      <Background gap={26} size={1} color="rgba(255,255,255,0.05)" />
    </ReactFlow>
  )
}
