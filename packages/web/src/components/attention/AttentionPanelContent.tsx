'use client'

import { useState, type ReactNode } from 'react'
import type { GoalAnchor, TraceNode } from '@/lib/attention'
import { GoalAnchorBar } from './GoalAnchorBar'
import { AttentionNodeList } from './AttentionNodeList'
import { AttentionNodeCard } from './AttentionNodeCard'

/**
 * Attention 面板内容（presentational，无 store/hook 依赖，便于测试）。
 * 左：目标锚点栏 + 决策节点列表 + 选中详情；右：图（由 renderGraph 注入，drawer 里是 React Flow）。
 */
export function AttentionPanelContent({
  nodes,
  goalAnchor,
  renderGraph,
}: {
  nodes: TraceNode[]
  goalAnchor: GoalAnchor | null
  renderGraph?: (p: { nodes: TraceNode[]; selectedId: string | null; onSelect: (id: string) => void }) => ReactNode
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = nodes.find((n) => n.id === selectedId) ?? null

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-full shrink-0 flex-col md:w-[320px]" style={{ borderRight: '1px solid var(--hairline)' }}>
        <GoalAnchorBar goalAnchor={goalAnchor} nodes={nodes} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AttentionNodeList nodes={nodes} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        {selected && (
          <div className="max-h-[42%] shrink-0 overflow-y-auto" style={{ borderTop: '1px solid var(--hairline)' }}>
            <AttentionNodeCard node={selected} />
          </div>
        )}
      </div>
      <div className="hidden min-w-0 flex-1 md:block">
        {renderGraph ? renderGraph({ nodes, selectedId, onSelect: setSelectedId }) : null}
      </div>
    </div>
  )
}
