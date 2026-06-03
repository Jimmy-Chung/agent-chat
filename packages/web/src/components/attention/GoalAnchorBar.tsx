'use client'

import type { GoalAnchor, TraceNode } from '@/lib/attention'
import { goalDistanceColor, goalDistanceTone } from '@/lib/attention'

/**
 * 目标锚点栏：展示原始目标 + 最近节点目标距离的弱提示。
 * v1 只做弱色条/文案，不做脉动强告警（S5 边界）。
 */
export function GoalAnchorBar({ goalAnchor, nodes }: { goalAnchor: GoalAnchor | null; nodes: TraceNode[] }) {
  const recent = nodes.slice(-3)
  const maxDist = recent.length ? Math.max(...recent.map((n) => n.goal_distance)) : 0
  const tone = goalDistanceTone(maxDist)
  const drifting = tone === 'off'

  return (
    <div
      className="shrink-0 px-4 py-3"
      style={{ borderBottom: '1px solid var(--hairline)', background: 'var(--glass-1)' }}
    >
      <div className="flex items-center gap-2">
        <span style={{ fontSize: 13 }}>🎯</span>
        <span className="truncate text-[13px] font-semibold" style={{ color: 'var(--fg-strong)' }} title={goalAnchor?.raw_query}>
          {goalAnchor?.normalized_goal || '（暂无目标锚点）'}
        </span>
      </div>
      {nodes.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <span
            className="inline-flex h-1.5 flex-1 overflow-hidden rounded-full"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            <span
              style={{
                width: `${Math.round((1 - maxDist) * 100)}%`,
                background: goalDistanceColor(maxDist),
                transition: 'width 240ms ease',
              }}
            />
          </span>
          <span className="text-[11px]" style={{ color: drifting ? '#F7A26B' : 'var(--fg-dim)' }}>
            {drifting ? '近期行为与目标距离拉大' : tone === 'near' ? '紧贴目标' : '中性'}
          </span>
        </div>
      )}
    </div>
  )
}
