'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReactFlow, Background, Handle, Position, type NodeChange, type NodeProps, type NodeTypes, type XYPosition } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { TraceNode } from '@/lib/attention'
import { buildGraphData, NODE_W } from '@/lib/attention/graph-projector'
import { goalDistanceColor } from '@/lib/attention/goal-distance'

function AttentionFlowNode({ data, selected }: NodeProps) {
  const { node, index } = data as { node: TraceNode; index: number }
  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{
        width: NODE_W,
        background: 'var(--glass-modal, rgba(20,22,27,0.9))',
        border: selected ? '1px solid rgba(10,132,255,0.6)' : '1px solid var(--hairline-2)',
        boxShadow: selected ? '0 0 0 1px rgba(10,132,255,0.4), 0 8px 24px rgba(0,0,0,0.4)' : '0 6px 18px rgba(0,0,0,0.3)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="flex items-center gap-1.5">
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold"
          style={{ background: 'var(--glass-2)', color: 'var(--fg-dim)' }}
        >
          {index + 1}
        </span>
        <span className="h-2 w-2 rounded-full" style={{ background: goalDistanceColor(node.goal_distance) }} />
        {node.status === 'running' && <span className="text-[10px]" style={{ color: '#F7C26B' }}>分析中</span>}
      </div>
      <div className="mt-1 truncate text-[12px] font-medium" style={{ color: 'var(--fg-strong)' }}>
        {node.is_loading || !node.conclusion ? '分析中…' : node.conclusion}
      </div>
      <div className="mt-0.5 truncate text-[10.5px]" style={{ color: 'var(--fg-dim)' }}>
        {node.user_message}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
}

const nodeTypes: NodeTypes = { attention: AttentionFlowNode }

export default function AttentionGraph({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: TraceNode[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [draggedPositions, setDraggedPositions] = useState<Record<string, XYPosition>>({})
  const { nodes: rfNodes, edges } = useMemo(() => buildGraphData(nodes), [nodes])
  useEffect(() => {
    const visibleIds = new Set(rfNodes.map((node) => node.id))
    setDraggedPositions((prev) => {
      let changed = false
      const next: Record<string, XYPosition> = {}
      for (const [id, position] of Object.entries(prev)) {
        if (!visibleIds.has(id)) {
          changed = true
          continue
        }
        next[id] = position
      }
      return changed ? next : prev
    })
  }, [rfNodes])
  const styledNodes = useMemo(
    () => rfNodes.map((n) => ({ ...n, position: draggedPositions[n.id] ?? n.position, selected: n.id === selectedId })),
    [draggedPositions, rfNodes, selectedId],
  )
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setDraggedPositions((prev) => {
      let changed = false
      const next = { ...prev }
      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue
        next[change.id] = change.position
        changed = true
      }
      return changed ? next : prev
    })
  }, [])

  return (
    <ReactFlow
      nodes={styledNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, n) => onSelect(n.id)}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      minZoom={0.3}
      maxZoom={1.5}
      onNodesChange={onNodesChange}
    >
      <Background gap={20} size={1} color="rgba(255,255,255,0.05)" />
    </ReactFlow>
  )
}
