'use client'

import { useMemo } from 'react'
import {
  Background,
  BezierEdge,
  Handle,
  Position,
  ReactFlow,
  type EdgeProps,
  type NodeProps,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { GoalAnchor, PlanItem, TraceNode } from '@/lib/attention'
import { goalDistanceColor } from '@/lib/attention'
import { buildMindMapProjection, type MindMapEdge, type MindMapNode } from '@/lib/attention/mind-map-projector'

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

function MindMapFlowNode({ data, selected }: NodeProps) {
  const node = data as unknown as MindMapNode
  const color = node.kind === 'goal'
    ? '#6FE39A'
    : node.relation === 'branch'
      ? '#F7A26B'
      : goalDistanceColor(node.goalDistance)

  return (
    <div
      className="rounded-lg px-3 py-2"
      style={{
        width: WIDTH[node.kind],
        background: node.kind === 'goal'
          ? 'rgba(111,227,154,0.12)'
          : node.kind === 'aggregate'
            ? 'rgba(255,255,255,0.055)'
            : 'var(--glass-modal, rgba(20,22,27,0.92))',
        border: selected ? '1px solid rgba(10,132,255,0.65)' : `1px solid ${node.relation === 'branch' ? 'rgba(247,162,107,0.42)' : 'var(--hairline-2)'}`,
        boxShadow: node.current
          ? '0 0 0 2px rgba(111,227,154,0.5), 0 0 24px rgba(111,227,154,0.22), 0 10px 26px rgba(0,0,0,0.38)'
          : selected
            ? '0 0 0 1px rgba(10,132,255,0.35), 0 10px 26px rgba(0,0,0,0.38)'
            : '0 6px 18px rgba(0,0,0,0.28)',
        animation: node.current ? 'attention-pulse 1.6s ease-in-out infinite' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-[10px]" style={{ color }}>
          {node.relation === 'branch' ? `支线${KIND_LABEL[node.kind]}` : KIND_LABEL[node.kind]}
        </span>
        {node.collapsed && <span className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>已聚合</span>}
        {node.current && <span className="text-[10px]" style={{ color: '#6FE39A' }}>当前</span>}
        {node.status === 'running' && <span className="ml-auto text-[10px]" style={{ color: '#F7C26B' }}>运行中</span>}
        {node.hasChildren && (
          <span
            className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-[13px] font-semibold"
            style={{
              background: node.collapsed ? 'rgba(10,132,255,0.18)' : 'rgba(111,227,154,0.16)',
              border: node.collapsed ? '1px solid rgba(10,132,255,0.45)' : '1px solid rgba(111,227,154,0.38)',
              color: node.collapsed ? '#7DB7FF' : '#6FE39A',
            }}
            title={node.collapsed ? '展开聚合节点' : '收起聚合节点'}
          >
            {node.collapsed ? '+' : '-'}
          </span>
        )}
      </div>
      <div className="mt-1 line-clamp-2 text-[12px] font-semibold leading-snug" style={{ color: 'var(--fg-strong)' }}>
        {node.title}
      </div>
      <div className="mt-1 line-clamp-2 text-[10.5px] leading-snug" style={{ color: 'var(--fg-dim)' }}>
        {node.subtitle}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

function MindMapEdge(props: EdgeProps) {
  const kind = (props.data as { kind?: MindMapEdge['kind'] } | undefined)?.kind ?? 'tree'
  const stroke = kind === 'branch'
    ? '#F7A26B'
    : '#6FE39A'
  return (
    <BezierEdge
      {...props}
      style={{
        stroke,
        strokeWidth: kind === 'branch' ? 1.7 : 2.4,
        strokeDasharray: kind === 'branch' ? '7 6' : undefined,
      }}
    />
  )
}

const nodeTypes: NodeTypes = { mind: MindMapFlowNode }
const edgeTypes: EdgeTypes = { mind: MindMapEdge }

export default function MindMapGraph({
  nodes,
  goalAnchor,
  planItems,
  selectedId,
  onSelect,
  expandedIds,
}: {
  nodes: TraceNode[]
  goalAnchor: GoalAnchor | null
  planItems: PlanItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  expandedIds: ReadonlySet<string>
}) {
  const projection = useMemo(() => buildMindMapProjection(nodes, goalAnchor, planItems, expandedIds), [nodes, goalAnchor, planItems, expandedIds])
  const rfNodes = useMemo(
    () => projection.nodes.map((node) => ({
      id: node.id,
      type: 'mind',
      position: node.position,
      data: node as unknown as Record<string, unknown>,
      selected: node.id === selectedId,
    })),
    [projection.nodes, selectedId],
  )
  const rfEdges = useMemo(
    () => projection.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'mind',
      data: { kind: edge.kind },
      animated: false,
    })),
    [projection.edges],
  )

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 0.95 }}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      minZoom={0.18}
      maxZoom={1.35}
      onNodeClick={(_, node) => onSelect(node.id)}
    >
      <Background gap={28} size={1} color="rgba(255,255,255,0.05)" />
    </ReactFlow>
  )
}
