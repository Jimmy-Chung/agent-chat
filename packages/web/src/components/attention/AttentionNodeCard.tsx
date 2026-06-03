'use client'

import { useState } from 'react'
import type { TraceNode } from '@/lib/attention'
import { goalDistanceColor } from '@/lib/attention'

/** 节点详情：用户原话 + 结论 + 目标距离 + 子交互（exchanges）展开。 */
export function AttentionNodeCard({ node }: { node: TraceNode }) {
  const [expanded, setExpanded] = useState(false)
  const exchanges = node.exchanges ?? []
  const hasSub = exchanges.length > 1

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="attention-node-card">
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: 'var(--fg-dim)', letterSpacing: '0.08em' }}>
          用户
        </div>
        <div className="text-[13px]" style={{ color: 'var(--fg-strong)', whiteSpace: 'pre-wrap' }}>
          {node.user_message}
        </div>
      </div>

      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: 'var(--fg-dim)', letterSpacing: '0.08em' }}>
          结论
        </div>
        <div className="text-[13px]" style={{ color: 'var(--fg-regular)' }}>
          {node.is_loading ? '分析中…' : node.conclusion || '—'}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: goalDistanceColor(node.goal_distance) }} />
        <span className="text-[12px]" style={{ color: 'var(--fg-dim)' }}>
          目标距离 {node.goal_distance.toFixed(2)} · {node.step_count} 个工具步骤
        </span>
      </div>

      {hasSub && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11.5px]"
            style={{ color: 'var(--fg-regular)' }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            {exchanges.length} 轮子交互
          </button>
          {expanded && (
            <ul className="mt-2 flex flex-col gap-2" data-testid="attention-subexchanges">
              {exchanges.map((ex) => (
                <li
                  key={ex.id}
                  className="rounded-lg px-2.5 py-2"
                  style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)' }}
                >
                  <div className="truncate text-[12px]" style={{ color: 'var(--fg-strong)' }}>
                    {ex.user_message}
                  </div>
                  <div className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--fg-dim)' }}>
                    {ex.assistant_summary}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
