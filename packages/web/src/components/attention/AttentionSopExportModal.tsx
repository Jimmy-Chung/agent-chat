'use client'

import type { GoalAnchor, PlanItem, TraceNode } from '@/lib/attention'
import {
  type MindMapNode,
  buildMindMapProjection,
} from '@/lib/attention/mind-map-projector'
import { getWsClient } from '@/lib/ws-client'
import { useToastStore } from '@/stores/toast-store'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'

const MindMapGraph = dynamic(() => import('./MindMapGraph'), {
  ssr: false,
  loading: () => (
    <div
      className="flex h-full items-center justify-center text-[12px]"
      style={{ color: 'var(--fg-dim)' }}
    >
      加载节点图...
    </div>
  ),
})

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
    node.aggregate_title ||
      node.user_summary ||
      node.intent ||
      node.user_message,
    '未命名步骤',
  )
}

function defaultSopName(goalAnchor: GoalAnchor | null): string {
  const base = compactText(
    goalAnchor?.normalized_goal || goalAnchor?.raw_query,
    '注意力节点',
  )
  return base.endsWith('SOP') ? base : `${base} SOP`
}

export function resolveAttentionSopSelectionPreview(
  nodes: TraceNode[],
  selectedMindNodes: MindMapNode[],
): PreviewNode[] {
  const selectedSourceIds = new Set(
    selectedMindNodes.flatMap((node) => node.sourceNodeIds),
  )
  return resolveAttentionSopSelectionPreviewFromSourceIds(
    nodes,
    selectedSourceIds,
  )
}

export function resolveAttentionSopSelectionPreviewFromSourceIds(
  nodes: TraceNode[],
  selectedSourceIds: ReadonlySet<string>,
): PreviewNode[] {
  return nodes
    .filter((node) => selectedSourceIds.has(node.id))
    .map((node) => ({
      id: node.id,
      title: titleForTraceNode(node),
      userText: compactText(
        node.exchanges?.[0]?.user_message || node.user_message,
        '用户输入',
      ),
      assistantText: compactText(
        node.exchanges?.[0]?.assistant_summary ||
          node.assistant_summary ||
          node.conclusion,
        '助手输出',
      ),
    }))
}

function sourcePreviewForMindNode(
  nodes: TraceNode[],
  mindNode: MindMapNode | null,
): PreviewNode[] {
  if (!mindNode) return []
  return resolveAttentionSopSelectionPreview(nodes, [mindNode])
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
  const initialName = useMemo(() => defaultSopName(goalAnchor), [goalAnchor])
  const [name, setName] = useState(initialName)
  const [selectedMindId, setSelectedMindId] = useState<string | null>(null)
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () => new Set(),
  )
  const projection = useMemo(
    () => buildMindMapProjection(nodes, goalAnchor, planItems, expandedNodeIds),
    [nodes, goalAnchor, planItems, expandedNodeIds],
  )
  // 勾选态按源轨迹集合推导：节点勾选 ⇔ 其全部 sourceNodeIds 已入选。
  // 勾选聚合节点 = 选中其覆盖的全部子内容，展开后的子节点因此显示为已选；
  // 取消某个子节点会把对应源轨迹移出集合，父聚合随之退出全选态。
  const checkedNodeIds = useMemo(
    () =>
      new Set(
        projection.nodes
          .filter(
            (node) =>
              node.sourceNodeIds.length > 0 &&
              node.sourceNodeIds.every((id) => selectedSourceIds.has(id)),
          )
          .map((node) => node.id),
      ),
    [projection.nodes, selectedSourceIds],
  )
  const payloadNodeIds = useMemo(
    () =>
      projection.nodes
        .filter((node) => node.kind !== 'goal' && checkedNodeIds.has(node.id))
        .map((node) => node.id),
    [projection.nodes, checkedNodeIds],
  )
  const previewNodes = useMemo(
    () =>
      resolveAttentionSopSelectionPreviewFromSourceIds(
        nodes,
        selectedSourceIds,
      ),
    [nodes, selectedSourceIds],
  )
  const selectedMindNode = useMemo(
    () =>
      projection.nodes.find((node) => node.id === selectedMindId) ??
      projection.nodes.find((node) => node.kind !== 'goal') ??
      projection.nodes[0] ??
      null,
    [projection.nodes, selectedMindId],
  )
  const selectedSourcePreview = useMemo(
    () => sourcePreviewForMindNode(nodes, selectedMindNode),
    [nodes, selectedMindNode],
  )
  const canSubmit =
    name.trim().length > 0 &&
    payloadNodeIds.length > 0 &&
    selectedSourceIds.size > 0

  useEffect(() => {
    setName((current) => (current.trim() ? current : initialName))
  }, [initialName])

  const toggleSelected = (id: string) => {
    const sourceNodeIds =
      projection.nodes.find((node) => node.id === id)?.sourceNodeIds ?? []
    if (sourceNodeIds.length === 0) return
    setSelectedSourceIds((prev) => {
      const next = new Set(prev)
      const allSelected = sourceNodeIds.every((sourceId) => next.has(sourceId))
      for (const sourceId of sourceNodeIds) {
        if (allSelected) next.delete(sourceId)
        else next.add(sourceId)
      }
      return next
    })
  }

  const selectMindNode = (id: string) => {
    setSelectedMindId(id)
  }

  const toggleExpanded = (id: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedMindChecked = selectedMindNode
    ? checkedNodeIds.has(selectedMindNode.id)
    : false

  const submit = () => {
    if (!canSubmit) return
    const sent = getWsClient().send({
      type: 'sop_template.export_from_attention',
      data: {
        topicId,
        ...(activeGoalId ? { goalId: activeGoalId } : {}),
        name: name.trim(),
        selectedNodeIds: payloadNodeIds,
        selectedSourceIds: [...selectedSourceIds],
      },
    })
    if (sent) {
      useToastStore.getState().pushToast({
        tone: 'info',
        title: '正在提炼 SOP 草稿',
        description: 'LLM 整理完成后会自动打开草稿编辑器，确认后才会保存。',
        durationMs: 6000,
      })
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-4"
      style={{
        background: 'rgba(3,5,10,.58)',
        backdropFilter: 'blur(5px)',
        WebkitBackdropFilter: 'blur(5px)',
      }}
      onClick={onClose}
    >
      <div
        className="flex h-[86vh] max-h-[86vh] w-full max-w-[980px] flex-col overflow-hidden rounded-[14px]"
        style={{
          background: 'var(--bg-0)',
          border: '1px solid var(--hairline-2)',
          boxShadow: '0 24px 80px rgba(0,0,0,.62)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <header
          className="flex h-14 shrink-0 items-center gap-3 px-5"
          style={{ borderBottom: '1px solid var(--hairline)' }}
        >
          <div className="min-w-0">
            <h3
              className="text-[14px] font-semibold"
              style={{ color: 'var(--fg-strong)' }}
            >
              导出 SOP
            </h3>
            <p
              className="mt-0.5 text-[11px]"
              style={{ color: 'var(--fg-dim)' }}
            >
              选择可复用步骤，由 LLM 提炼成工作流草稿后再编辑保存
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-[7px]"
            style={{
              color: 'var(--fg-dim)',
              background: 'var(--glass-1)',
              border: '1px solid var(--hairline)',
            }}
            aria-label="关闭导出 SOP"
          >
            x
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden md:grid-cols-[minmax(0,1fr)_380px] md:grid-rows-none">
          <section
            className="min-h-0 overflow-hidden"
            style={{ borderRight: '1px solid var(--hairline)' }}
          >
            {projection.nodes.length > 0 ? (
              <MindMapGraph
                nodes={nodes}
                goalAnchor={goalAnchor}
                planItems={planItems}
                selectedId={selectedMindNode?.id ?? null}
                onSelect={selectMindNode}
                expandedIds={expandedNodeIds}
                projection={projection}
                exportSelectedIds={checkedNodeIds}
                onToggleExportSelect={toggleSelected}
                onToggleExpand={toggleExpanded}
              />
            ) : (
              <div
                className="flex h-full items-center justify-center text-[12px]"
                style={{ color: 'var(--fg-dim)' }}
              >
                暂无可导出的注意力节点
              </div>
            )}
          </section>

          <aside className="flex min-h-0 flex-col overflow-hidden">
            <div
              data-testid="sop-export-side-scroll"
              className="min-h-0 flex-1 overflow-y-auto p-4"
            >
              <label
                className="text-[12px] font-medium"
                style={{ color: 'var(--fg-strong)' }}
              >
                SOP 名称
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-2 h-10 w-full rounded-[8px] px-3 text-sm outline-none"
                  style={{
                    background: 'var(--glass-1)',
                    border: '1px solid var(--hairline)',
                    color: 'var(--fg-strong)',
                  }}
                  placeholder="例如：AkShare 数据分析 SOP"
                />
              </label>

              <div
                className="mt-4 rounded-[8px] p-3"
                style={{
                  background: 'var(--glass-1)',
                  border: '1px solid var(--hairline)',
                }}
              >
                {selectedMindNode ? (
                  <>
                    <div className="flex items-start gap-3">
                      <label className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                        <input
                          type="checkbox"
                          checked={selectedMindChecked}
                          onChange={() => toggleSelected(selectedMindNode.id)}
                          className="h-4 w-4"
                          aria-label={`选择当前节点 ${selectedMindNode.title}`}
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="truncate text-[13px] font-semibold"
                            style={{ color: 'var(--fg-strong)' }}
                          >
                            {selectedMindNode.title}
                          </span>
                          <span
                            className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                            style={{
                              background: 'var(--glass-2)',
                              color: 'var(--fg-dim)',
                            }}
                          >
                            {selectedMindNode.kind}
                          </span>
                        </div>
                        <div
                          className="mt-1 text-[11px] leading-4"
                          style={{ color: 'var(--fg-dim)' }}
                        >
                          {selectedMindNode.subtitle ||
                            `${selectedMindNode.sourceNodeIds.length} 个源节点`}
                        </div>
                      </div>
                    </div>

                    {selectedMindNode.hasChildren &&
                      selectedMindNode.kind !== 'goal' && (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(selectedMindNode.id)}
                          className="mt-3 h-8 rounded-[8px] px-3 text-[12px] font-medium"
                          style={{
                            color: '#8fc6ff',
                            background: 'rgba(10,132,255,.12)',
                            border: '1px solid rgba(10,132,255,.25)',
                          }}
                        >
                          {expandedNodeIds.has(selectedMindNode.id)
                            ? '收起子节点'
                            : '展开子节点'}
                        </button>
                      )}

                    <div className="mt-3 space-y-2">
                      {selectedSourcePreview.slice(0, 4).map((node, index) => (
                        <div
                          key={node.id}
                          className="rounded-[7px] p-2 text-[11px] leading-4"
                          style={{
                            background: 'rgba(255,255,255,.035)',
                            color: 'var(--fg-dim)',
                          }}
                        >
                          <div
                            className="font-semibold"
                            style={{ color: 'var(--fg-strong)' }}
                          >
                            {index + 1}. {node.title}
                          </div>
                          <div className="mt-1 line-clamp-2">
                            用户：{node.userText}
                          </div>
                          <div className="line-clamp-2">
                            助手：{node.assistantText}
                          </div>
                        </div>
                      ))}
                      {selectedSourcePreview.length > 4 && (
                        <div
                          className="text-[11px]"
                          style={{ color: 'var(--fg-dim)' }}
                        >
                          还有 {selectedSourcePreview.length - 4} 个源步骤...
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-[12px]" style={{ color: 'var(--fg-dim)' }}>
                    左侧暂无可选节点。
                  </p>
                )}
              </div>

              <div
                className="mt-4 flex items-center justify-between text-[12px]"
                style={{ color: 'var(--fg-dim)' }}
              >
                <span>已选 {payloadNodeIds.length} 个节点</span>
                <span>{previewNodes.length} 个步骤</span>
              </div>

              <div
                className="mt-3 rounded-[8px] p-3"
                style={{
                  background: 'var(--glass-1)',
                  border: '1px solid var(--hairline)',
                }}
              >
                {previewNodes.length === 0 ? (
                  <p className="text-[12px]" style={{ color: 'var(--fg-dim)' }}>
                    勾选左侧图节点或右侧当前节点后预览步骤。
                  </p>
                ) : (
                  <div className="space-y-3">
                    {previewNodes.map((node, index) => (
                      <div key={node.id} className="text-[12px] leading-5">
                        <div
                          className="font-semibold"
                          style={{ color: 'var(--fg-strong)' }}
                        >
                          {index + 1}. {node.title}
                        </div>
                        <div
                          className="mt-1 line-clamp-2"
                          style={{ color: 'var(--fg-dim)' }}
                        >
                          用户：{node.userText}
                        </div>
                        <div
                          className="line-clamp-2"
                          style={{ color: 'var(--fg-dim)' }}
                        >
                          助手：{node.assistantText}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div
              className="flex shrink-0 justify-end gap-2 p-4"
              style={{ borderTop: '1px solid var(--hairline)' }}
            >
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-[8px] px-4 text-sm"
                style={{
                  background: 'var(--glass-1)',
                  border: '1px solid var(--hairline)',
                  color: 'var(--fg-regular)',
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="h-9 rounded-[8px] px-4 text-sm font-semibold disabled:opacity-45"
                style={{
                  background: 'rgba(10,132,255,.2)',
                  border: '1px solid rgba(10,132,255,.38)',
                  color: '#9fd0ff',
                }}
              >
                生成 SOP 草稿
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
