'use client'

import type { TraceNode } from '@/lib/attention'
import { goalDistanceColor } from '@/lib/attention'

/** 决策节点纵向列表：conclusion + 目标距离色条 + 状态 + 点选。 */
export function AttentionNodeList({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: TraceNode[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (nodes.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-[13px]" style={{ color: 'var(--fg-dim)' }}>
        暂无决策节点
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-1 p-2" data-testid="attention-node-list">
      {nodes.map((node, i) => {
        const active = node.id === selectedId
        const running = node.status === 'running'
        return (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors"
              style={{
                background: active ? 'rgba(10,132,255,0.13)' : 'transparent',
                boxShadow: active ? 'inset 0 0 0 1px rgba(10,132,255,0.45)' : 'none',
              }}
            >
              <span
                className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                style={{ background: 'var(--glass-2)', color: 'var(--fg-dim)' }}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: goalDistanceColor(node.goal_distance) }}
                    title={`目标距离 ${node.goal_distance.toFixed(2)}`}
                  />
                  <span className="truncate text-[12.5px] font-medium" style={{ color: 'var(--fg-strong)' }}>
                    {running && (node.is_loading || !node.conclusion) ? '分析中…' : node.conclusion || node.user_message.slice(0, 15)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px]" style={{ color: 'var(--fg-dim)' }}>
                  {node.user_message}
                  {node.user_message_count && node.user_message_count > 1 ? ` · ${node.user_message_count} 轮` : ''}
                </span>
              </span>
              {running && (
                <span className="mt-0.5 shrink-0 text-[10px]" style={{ color: '#F7C26B' }}>
                  ●
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
