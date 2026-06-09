'use client'

import { useMemo, useState } from 'react'
import type { GoalAnchor, PlanItem, TraceNode } from '@/lib/attention'
import { buildMindMapProjection, type MindMapNode } from '@/lib/attention/mind-map-projector'
import { getWsClient } from '@/lib/ws-client'

type PreviewNode = {
  id: string
  title: string
  userText: string
  assistantText: string
}

function compactText(value: string | null | undefined, fallback = ''): string {
  return (value ?? '').replace(/\s+/g, ' ').trim() || fallback
}

function titleForTraceNode(node: TraceNode): string {
  return compactText(
    node.aggregate_title
      || node.user_summary
      || node.intent
      || node.user_message,
    '未命名步骤',
  )
}

export function resolveAttentionSopSelectionPreview(nodes: TraceNode[], selectedMindNodes: MindMapNode[]): PreviewNode[] {
  const selectedSourceIds = new Set(selectedMindNodes.flatMap((node) => node.sourceNodeIds))
  return nodes
    .filter((node) => selectedSourceIds.has(node.id))
    .map((node) => ({
      id: node.id,
      title: titleForTraceNode(node),
      userText: compactText(node.exchanges?.[0]?.user_message || node.user_message, '用户输入'),
      assistantText: compactText(node.exchanges?.[0]?.assistant_summary || node.assistant_summary || node.conclusion, '助手输出'),
    }))
}

export function AttentionSopExportModal({
  topicId,
  activeGoalId,
  nodes,
  goalAnchor,
  planItems,
  onClose,
}: {
  topicId: string
  activeGoalId?: string | null
  nodes: TraceNode[]
  goalAnchor: GoalAnchor | null
  planItems: PlanItem[]
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set())
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set())
  const projection = useMemo(
    () => buildMindMapProjection(nodes, goalAnchor, planItems, expandedNodeIds),
    [nodes, goalAnchor, planItems, expandedNodeIds],
  )
  const selectedMindNodes = useMemo(
    () => projection.nodes.filter((node) => selectedNodeIds.has(node.id)),
    [projection.nodes, selectedNodeIds],
  )
  const previewNodes = useMemo(
    () => resolveAttentionSopSelectionPreview(nodes, selectedMindNodes),
    [nodes, selectedMindNodes],
  )
  const canSubmit = name.trim().length > 0 && selectedNodeIds.size > 0 && previewNodes.length > 0

  const toggleSelected = (id: string) => {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleExpanded = (id: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = () => {
    if (!canSubmit) return
    const sent = getWsClient().send({
      type: 'sop_template.export_from_attention',
      data: {
        topicId,
        ...(activeGoalId ? { goalId: activeGoalId } : {}),
        name: name.trim(),
        selectedNodeIds: [...selectedNodeIds],
      },
    })
    if (sent) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-4"
      style={{ background: 'rgba(3,5,10,.58)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)' }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-[980px] flex-col overflow-hidden rounded-[14px]"
        style={{ background: 'var(--bg-0)', border: '1px solid var(--hairline-2)', boxShadow: '0 24px 80px rgba(0,0,0,.62)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 px-5" style={{ borderBottom: '1px solid var(--hairline)' }}>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold" style={{ color: 'var(--fg-strong)' }}>导出 SOP</h3>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--fg-dim)' }}>从注意力节点选择可复用步骤</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-[7px]"
            style={{ color: 'var(--fg-dim)', background: 'var(--glass-1)', border: '1px solid var(--hairline)' }}
            aria-label="关闭导出 SOP"
          >
            x
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-h-0 overflow-auto p-4" style={{ borderRight: '1px solid var(--hairline)' }}>
            <div className="space-y-2">
              {projection.nodes.map((node) => {
                const visualDepth = Math.max(0, Math.min(4, node.depth - 1))
                const isNested = visualDepth > 0
                return (
                  <div key={node.id} className="relative" style={{ marginLeft: visualDepth * 18 }}>
                    {isNested && (
                      <div
                        className="absolute bottom-2 left-[-10px] top-2 w-px"
                        style={{ background: 'rgba(125,183,255,.28)' }}
                      />
                    )}
                    <div
                      className="flex items-start gap-2 rounded-[8px] px-3 py-2"
                      style={{
                        background: selectedNodeIds.has(node.id)
                          ? 'rgba(10,132,255,.14)'
                          : isNested
                            ? 'rgba(255,255,255,.035)'
                            : 'var(--glass-1)',
                        border: isNested ? '1px solid rgba(255,255,255,.08)' : '1px solid var(--hairline)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedNodeIds.has(node.id)}
                        onChange={() => toggleSelected(node.id)}
                        className="mt-1 h-4 w-4 shrink-0"
                        aria-label={`选择 ${node.title}`}
                      />
                      <button
                        type="button"
                        onClick={() => toggleSelected(node.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`${isNested ? 'text-[12px]' : 'text-[13px]'} truncate font-medium`} style={{ color: 'var(--fg-strong)' }}>{node.title}</span>
                          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--glass-2)', color: 'var(--fg-dim)' }}>{node.kind}</span>
                        </div>
                        <div className="mt-1 line-clamp-2 text-[11px]" style={{ color: 'var(--fg-dim)' }}>{node.subtitle || `${node.sourceNodeIds.length} 个源节点`}</div>
                      </button>
                      {node.hasChildren && (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(node.id)}
                          className="h-7 shrink-0 rounded-[7px] px-2 text-[11px]"
                          style={{ color: '#8fc6ff', background: 'rgba(10,132,255,.12)', border: '1px solid rgba(10,132,255,.25)' }}
                        >
                          {expandedNodeIds.has(node.id) ? '收起' : '展开'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <aside className="flex min-h-0 flex-col p-4">
            <label className="text-[12px] font-medium" style={{ color: 'var(--fg-strong)' }}>
              SOP 名称
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-2 h-10 w-full rounded-[8px] px-3 text-sm outline-none"
                style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', color: 'var(--fg-strong)' }}
                placeholder="例如：AkShare 数据分析 SOP"
              />
            </label>

            <div className="mt-4 flex items-center justify-between text-[12px]" style={{ color: 'var(--fg-dim)' }}>
              <span>已选 {selectedNodeIds.size} 个节点</span>
              <span>{previewNodes.length} 个步骤</span>
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-[8px] p-3" style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)' }}>
              {previewNodes.length === 0 ? (
                <p className="text-[12px]" style={{ color: 'var(--fg-dim)' }}>选择左侧节点后预览步骤。</p>
              ) : (
                <div className="space-y-3">
                  {previewNodes.map((node, index) => (
                    <div key={node.id} className="text-[12px] leading-5">
                      <div className="font-semibold" style={{ color: 'var(--fg-strong)' }}>{index + 1}. {node.title}</div>
                      <div className="mt-1 line-clamp-2" style={{ color: 'var(--fg-dim)' }}>用户：{node.userText}</div>
                      <div className="line-clamp-2" style={{ color: 'var(--fg-dim)' }}>助手：{node.assistantText}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-[8px] px-4 text-sm"
                style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', color: 'var(--fg-regular)' }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="h-9 rounded-[8px] px-4 text-sm font-semibold disabled:opacity-45"
                style={{ background: 'rgba(10,132,255,.2)', border: '1px solid rgba(10,132,255,.38)', color: '#9fd0ff' }}
              >
                导出到 SOP 中心
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
