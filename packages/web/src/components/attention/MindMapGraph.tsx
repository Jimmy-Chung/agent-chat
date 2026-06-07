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

function nodeKindLabel(node: MindMapNode): string {
  if (node.current) return '当前节点'
  if (node.relation === 'branch') return '支线'
  if (node.kind === 'goal') return '目标'
  if (node.kind === 'aggregate') return '聚合'
  return '用户'
}

function nodeDotColor(node: MindMapNode): string {
  if (node.kind === 'goal') return '#0A84FF'
  if (node.current) return '#FF9F4A'
  if (node.relation === 'branch') return '#6cb1ff'
  if (node.kind === 'aggregate') return '#0A84FF'
  return goalDistanceColor(node.goalDistance)
}

function nodeKindColor(node: MindMapNode): string {
  if (node.current) return '#FFC48A'
  if (node.kind === 'goal') return '#6cb1ff'
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
  return '1px solid var(--hairline)'
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
  return 'inset 0 1px 0 rgba(255,255,255,.05),0 10px 28px rgba(0,0,0,.4)'
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
  const kindLabel = nodeKindLabel(node)

  const tagText = node.kind === 'goal'
    ? node.subtitle
    : node.collapsed
      ? `已聚合 · ${node.aggregation?.turnCount ?? 0} 轮`
      : node.kind === 'aggregate'
        ? `已展开 · ${node.aggregation?.turnCount ?? 0} 轮`
        : node.relation === 'branch'
          ? '从当前分叉'
          : ''

  const isCurrent = node.current
  const focusBtnStyle: React.CSSProperties = {
    width: 22, height: 22, borderRadius: 6,
    display: 'grid', placeItems: 'center',
    color: isCurrent ? '#FFC48A' : 'var(--fg-dim)',
    background: isCurrent ? 'rgba(255,159,74,.12)' : 'rgba(255,255,255,.05)',
    border: `1px solid ${isCurrent ? 'rgba(255,159,74,.4)' : 'var(--hairline)'}`,
    cursor: 'default',
  }

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

      {/* Header: dot · kind · tag · actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <span
          style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: dotColor,
            boxShadow: `0 0 ${node.current ? '9px' : '7px'} ${dotColor}`,
            animation: node.current ? 'attn-dot-blink 1.2s ease-in-out infinite' : undefined,
          }}
        />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.02em', color: kindColor }}>
          {kindLabel}
        </span>
        {tagText && (
          <span style={{ fontSize: 10, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', letterSpacing: 0 }}>
            {tagText}
          </span>
        )}

        {/* Actions */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {focusMessageId && (
            <Tooltip content="回到消息面板中的对应消息" side="top" delayMs={180}>
              <button
                type="button"
                className="nodrag nopan"
                style={focusBtnStyle}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onFocus?.(focusMessageId) }}
              >
                <FocusIcon />
              </button>
            </Tooltip>
          )}
          {node.hasChildren && (
            <button
              type="button"
              className="nodrag nopan"
              style={{
                width: 22, height: 22, borderRadius: 6,
                display: 'grid', placeItems: 'center',
                color: '#6cb1ff',
                background: 'rgba(10,132,255,.10)',
                border: '1px solid rgba(10,132,255,.32)',
                cursor: 'default',
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
      <div style={{ fontSize: node.relation === 'branch' ? 13 : 14, fontWeight: 600, color: 'var(--fg-strong)', letterSpacing: '-.01em', lineHeight: 1.35 }}>
        {node.title}
      </div>

      {/* Subtitle */}
      {node.kind !== 'goal' && (node.subtitle || node.current) && (
        <div style={{ marginTop: 5, fontSize: 11, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', letterSpacing: 0 }}>
          {node.current ? (node.subtitle || 'user → AI · 进行中') : node.subtitle}
        </div>
      )}

      {/* 更新目标 row */}
      {node.kind === 'goal' && onUpdateGoal && (
        <button
          type="button"
          className="nodrag nopan"
          style={{
            marginTop: 11, display: 'flex', alignItems: 'center', gap: 6,
            height: 30, padding: '0 11px', borderRadius: 9,
            background: 'rgba(10,132,255,.12)', border: '1px solid rgba(10,132,255,.32)',
            color: '#6cb1ff', fontSize: 12.5, fontWeight: 600, letterSpacing: '-.005em',
            width: '100%', justifyContent: 'space-between', cursor: 'default',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onUpdateGoal() }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PencilIcon />
            更新目标
          </span>
          {remainingGoalEdits !== undefined && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: '#6cb1ff', opacity: 0.85,
              background: 'rgba(10,132,255,.12)', border: '1px solid rgba(10,132,255,.26)',
              borderRadius: 6, padding: '0 5px',
            }}>
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
  return (
    <BezierEdge
      {...props}
      style={{
        stroke: kind === 'branch' ? '#6cb1ff' : '#0A84FF',
        strokeWidth: kind === 'branch' ? 2 : 2.2,
        strokeOpacity: kind === 'branch' ? 0.55 : 0.85,
        strokeDasharray: kind === 'branch' ? '5 5' : undefined,
      }}
    />
  )
}

function CanvasLegend() {
  return (
    <div
      style={{
        position: 'absolute', left: 16, bottom: 14, zIndex: 6,
        display: 'flex', gap: 16,
        fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-dim)',
        background: 'rgba(11,12,15,.6)', border: '1px solid var(--hairline)',
        borderRadius: 9, padding: '7px 12px',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#0A84FF', boxShadow: '0 0 6px #0A84FF', display: 'inline-block' }} />
        目标/聚合
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#FF9F4A', boxShadow: '0 0 6px #FF9F4A', display: 'inline-block' }} />
        当前
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 16, height: 0, borderTop: '1.5px dashed #6cb1ff', display: 'inline-block' }} />
        支线
      </div>
    </div>
  )
}

function PanHint() {
  return (
    <div
      style={{
        position: 'absolute', right: 16, bottom: 14, zIndex: 6,
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-dim)',
        pointerEvents: 'none',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>
      </svg>
      拖拽平移 · 滚轮缩放
    </div>
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
        if (node) draggedPositionsRef.current[change.id] = node.position
      }
      return next
    })
  }, [])

  return (
    <div
      className="h-full w-full"
      style={{
        position: 'relative',
        background: `
          radial-gradient(620px 440px at 42% 42%, rgba(20,60,110,.18), transparent 70%),
          radial-gradient(460px 340px at 78% 66%, rgba(255,159,74,.07), transparent 70%)
        `,
      }}
    >
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
      <CanvasLegend />
      <PanHint />
    </div>
  )
}
