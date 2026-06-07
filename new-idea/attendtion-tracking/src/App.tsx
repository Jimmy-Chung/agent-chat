import { useState, useMemo, useCallback, useRef } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import GoalAnchorBar from './components/GoalAnchorBar'
import TraceDAG from './components/TraceDAG'
import NodeCard from './components/NodeCard'
import ProviderPanel from './components/ProviderPanel'
import FileUpload from './components/FileUpload'
import ProgressPanel from './components/ProgressPanel'
import { TraceNode } from './types'
import { loadProviderConfig, saveProviderConfig } from './provider/config'
import { useTraceProcessor, useGraphData, useMaxGoalDistance } from './hooks/useTraceProcessor'
import { useMultiSession } from './hooks/useMultiSession'
import { projectTimeline } from './pipeline/projector'
import { TraceExchange } from './types'
import {
  RotateCcw,
  GitBranch,
  Layers,
  ChevronLeft,
  ChevronRight,
  PlusCircle,
  Rows3,
  X,
  Folder,
} from 'lucide-react'

function AddSessionButton({ onAdd }: { onAdd: (jsonl: string, label: string) => void }) {
  const fileRef   = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  const handleFiles = (files: File[]) => {
    const jsonlFiles = files.filter(
      (f) => f.name.endsWith('.jsonl') || f.name.endsWith('.json')
    )
    jsonlFiles.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const content = (ev.target?.result as string) ?? ''
        if (content.trim()) onAdd(content, file.name.replace(/\.[^.]+$/, ''))
      }
      reader.readAsText(file)
    })
  }

  return (
    <>
      <div className="flex gap-1.5">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs
            text-emerald-400 hover:text-emerald-300 border border-emerald-900/40
            hover:border-emerald-700 rounded-lg transition-colors bg-emerald-900/10"
        >
          <PlusCircle size={12} />
          添加会话（多选）
        </button>
        <button
          onClick={() => folderRef.current?.click()}
          title="选择文件夹，自动读取所有 .jsonl"
          className="px-2.5 py-2 text-xs text-emerald-600 hover:text-emerald-400
            border border-emerald-900/40 hover:border-emerald-700 rounded-lg
            transition-colors bg-emerald-900/10"
        >
          <Folder size={12} />
        </button>
      </div>
      {/* 多文件选择 */}
      <input
        ref={fileRef}
        type="file"
        accept=".jsonl,.json"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      {/* 文件夹选择 */}
      <input
        ref={folderRef}
        type="file"
        // @ts-expect-error webkitdirectory not in TS types
        webkitdirectory=""
        className="hidden"
        onChange={(e) => {
          handleFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </>
  )
}

export default function App() {
  const [providerConfig, setProviderConfig] = useState(loadProviderConfig)
  const [showProvider, setShowProvider] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [collapsedBranches] = useState<Set<string>>(new Set())
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [cachedJsonl, setCachedJsonl] = useState<string | null>(null)
  const [timelineMode, setTimelineMode] = useState(false)

  // ── 展开节点状态（替代导航栈，所有层级在同一图里） ──────────────────
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  const handleToggleExpand = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev)

      if (next.has(nodeId)) {
        // 收起：删除自身及所有后代
        for (const id of [...next]) {
          if (id === nodeId || id.startsWith(`${nodeId}__`)) next.delete(id)
        }
      } else {
        // 展开前：手风琴——收起同级节点及其后代
        // 同级定义：父路径相同 && 深度相同（用 __ 分隔层级）
        const newParts = nodeId.split('__')
        const parentPath = newParts.slice(0, -1).join('__')  // '' 代表顶层

        for (const id of [...next]) {
          if (id === nodeId) continue
          const idParts = id.split('__')
          const idParent = idParts.slice(0, -1).join('__')
          if (idParent === parentPath && idParts.length === newParts.length) {
            // 同级节点：收起它和它的所有后代
            for (const other of [...next]) {
              if (other === id || other.startsWith(`${id}__`)) next.delete(other)
            }
          }
        }

        next.add(nodeId)
      }

      return next
    })
  }, [])

  // ── Multi-session timeline ──────────────────────────────────────────────────
  const { sessions, addSession, removeSession, resetAll } = useMultiSession(providerConfig)

  const timelineGraphData = useMemo(() => {
    if (!timelineMode || sessions.length === 0) return null
    const anchor = sessions.find((s) => s.goalAnchor)?.goalAnchor
      ?? { raw_query: '多会话时间线', normalized_goal: '多会话时间线', ts: 0 }
    return projectTimeline(
      sessions.map((s) => ({ id: s.id, label: s.label, color: s.color, nodes: s.traceNodes })),
      anchor
    )
  }, [timelineMode, sessions])

  // Find the TraceNode and its raw events when clicking a timeline node
  const timelineSelectedNode: TraceNode | null = useMemo(() => {
    if (!selectedNodeId || !timelineMode) return null
    for (const s of sessions) {
      const found = s.traceNodes.find((n) => n.id === selectedNodeId)
      if (found) return found
    }
    return null
  }, [selectedNodeId, timelineMode, sessions])

  const timelineSelectedEvents = useMemo(() => {
    if (!selectedNodeId || !timelineMode) return []
    for (const s of sessions) {
      if (s.traceNodes.find((n) => n.id === selectedNodeId)) return s.rawEvents
    }
    return []
  }, [selectedNodeId, timelineMode, sessions])

  const { state, process, reset } = useTraceProcessor(providerConfig)

  const handleJsonl = (content: string) => {
    setCachedJsonl(content)
    process(content)
  }

  const graphData = useGraphData(state, collapsedBranches, expandedNodes)
  const maxGoalDistance = useMaxGoalDistance(state.traceNodes)

  const selectedNode: TraceNode | null = useMemo(() => {
    if (!selectedNodeId || timelineMode) return null

    // 先找顶层 TraceNode
    const topNode = state.traceNodes.find((n) => n.id === selectedNodeId)
    if (topNode) return topNode

    // 再找 exchange 子节点（构造合成 TraceNode）
    const flowNode = graphData?.nodes.find((n) => n.id === selectedNodeId)
    if (flowNode?.type === 'exchangeNode') {
      const d = flowNode.data as { exchange?: TraceExchange; subExchanges?: TraceExchange[] }
      if (d.exchange) {
        const base = state.traceNodes[0]
        if (!base) return null
        return {
          ...base,
          id:                 selectedNodeId,
          user_message:       d.exchange.user_message,
          conclusion:         d.exchange.assistant_summary,
          exchanges:          d.subExchanges?.length ? d.subExchanges : [d.exchange],
          event_ids:          d.exchange.event_ids,
          step_count:         d.exchange.tool_count,
          user_message_count: d.subExchanges?.length ?? 1,
        }
      }
    }

    return null
  }, [selectedNodeId, state.traceNodes, graphData, timelineMode])

  const branches = useMemo(() => {
    const seen = new Set<string>()
    for (const n of state.traceNodes) seen.add(n.branch_id)
    return Array.from(seen)
  }, [state.traceNodes])

  const stats = useMemo(() => {
    const loaded = state.traceNodes.filter((n) => !n.is_loading)
    const total = state.traceNodes.length
    const onTrack = loaded.filter((n) => n.alignment === 'on_track').length
    const unplanned = loaded.filter((n) => n.alignment === 'unplanned').length
    const avgDist =
      loaded.length > 0
        ? loaded.reduce((s, n) => s + n.goal_distance, 0) / loaded.length
        : 0
    return { total, onTrack, unplanned, avgDist }
  }, [state.traceNodes])

  const { phase } = state.progress
  const hasData = state.traceNodes.length > 0 || phase !== 'idle'
  const isProcessing = phase === 'parsing' || phase === 'aggregating' || phase === 'interpreting'

  const activeNode = timelineMode ? timelineSelectedNode : selectedNode
  const activeEvents = timelineMode ? timelineSelectedEvents : state.rawEvents
  const activeGraphData = timelineMode ? timelineGraphData : graphData
  const timelineAnchor = sessions.find((s) => s.goalAnchor)?.goalAnchor
    ?? { raw_query: '多会话时间线', normalized_goal: '多会话时间线', ts: 0 }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <GoalAnchorBar
        anchor={timelineMode ? timelineAnchor : state.goalAnchor}
        maxGoalDistance={timelineMode ? 0 : maxGoalDistance}
        onSettingsClick={() => setShowProvider(true)}
      />

      <div className="flex pt-14 h-screen">
        {/* Sidebar */}
        <aside
          className={`
            flex-shrink-0 flex flex-col bg-gray-900/50 border-r border-gray-800
            transition-all duration-200
            ${sidebarOpen ? 'w-72' : 'w-0 overflow-hidden'}
          `}
        >
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {timelineMode ? (
              /* ── Timeline mode sidebar ─────────────────────────────── */
              <>
                <div className="flex items-center gap-2 mb-1">
                  <Rows3 size={13} className="text-blue-400" />
                  <h2 className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
                    多会话时间线
                  </h2>
                </div>

                <AddSessionButton onAdd={addSession} />

                {/* Session list */}
                {sessions.length > 0 && (
                  <div className="space-y-2">
                    {sessions.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-lg bg-gray-900 border border-gray-800 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: s.color }}
                          />
                          <span className="text-xs text-gray-300 truncate flex-1">{s.label}</span>
                          {s.isProcessing && (
                            <span className="text-[10px] text-blue-400">解析中…</span>
                          )}
                          {s.error && (
                            <span className="text-[10px] text-red-400">失败</span>
                          )}
                          <button
                            onClick={() => removeSession(s.id)}
                            className="text-gray-600 hover:text-gray-400 transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </div>
                        {s.goalAnchor && (
                          <p className="text-[10px] text-gray-600 mt-1 truncate">
                            {s.goalAnchor.normalized_goal || s.goalAnchor.raw_query}
                          </p>
                        )}
                        {!s.isProcessing && !s.error && (
                          <p className="text-[10px] text-gray-700 mt-0.5">
                            {s.traceNodes.filter((n) => !n.is_loading).length} 个节点
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {sessions.length === 0 && (
                  <p className="text-xs text-gray-600 text-center py-4">
                    点击「添加会话」上传 JSONL 文件
                  </p>
                )}

                <button
                  onClick={() => { setTimelineMode(false); resetAll(); setSelectedNodeId(null) }}
                  className="w-full flex items-center justify-center gap-2 py-2 text-xs
                    text-gray-500 hover:text-gray-300 border border-gray-800
                    hover:border-gray-600 rounded-lg transition-colors mt-2"
                >
                  <RotateCcw size={12} />
                  返回单会话
                </button>
              </>
            ) : !hasData ? (
              <>
                <div>
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    加载轨迹
                  </h2>
                  <FileUpload onJsonl={handleJsonl} />
                </div>
                <div className="text-xs text-gray-600 space-y-1.5 leading-relaxed">
                  <p className="font-medium text-gray-500">Claude Code JSONL 路径：</p>
                  <code className="block bg-gray-900 px-2 py-1.5 rounded text-gray-400 font-mono text-[10px] leading-relaxed">
                    ~/.claude/projects/&lt;id&gt;/*.jsonl
                  </code>
                </div>
                {/* Enter timeline mode without loading a file first */}
                <button
                  onClick={() => setTimelineMode(true)}
                  className="w-full flex items-center justify-center gap-2 py-2 text-xs
                    text-blue-400 hover:text-blue-300 border border-blue-900/40
                    hover:border-blue-700 rounded-lg transition-colors bg-blue-900/10"
                >
                  <Rows3 size={12} />
                  多会话时间线
                </button>
              </>
            ) : (
              <>
                {/* Progress panel — prominent when active */}
                <ProgressPanel progress={state.progress} />

                {/* Stats — only after first results */}
                {stats.total > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      会话统计
                    </h2>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: '节点数', value: stats.total },
                        { label: '符合计划', value: stats.onTrack },
                        { label: '计划外', value: stats.unplanned },
                        {
                          label: '平均距离',
                          value: `${(stats.avgDist * 100).toFixed(0)}%`,
                        },
                      ].map((s) => (
                        <div key={s.label} className="bg-gray-900 rounded-lg p-2.5">
                          <p className="text-xs text-gray-500">{s.label}</p>
                          <p className="text-lg font-semibold text-gray-200 mt-0.5">
                            {s.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Plan items */}
                {state.planItems.length > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      <Layers size={11} className="inline mr-1" />
                      计划（{state.planItems.length}）
                    </h2>
                    <div className="space-y-1">
                      {state.planItems.map((item) => {
                        const doneStyle =
                          item.status === 'completed'
                            ? 'line-through text-gray-600'
                            : item.status === 'in_progress'
                            ? 'text-blue-300'
                            : 'text-gray-400'
                        return (
                          <div
                            key={item.id}
                            className="flex items-start gap-2 text-xs"
                            style={{ paddingLeft: item.depth * 12 }}
                          >
                            <span className="text-gray-600 mt-0.5 flex-shrink-0">
                              {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '›' : '○'}
                            </span>
                            <span className={doneStyle}>{item.text}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Branches */}
                {branches.length > 1 && (
                  <div>
                    <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      <GitBranch size={11} className="inline mr-1" />
                      分支
                    </h2>
                    <div className="space-y-1">
                      {branches.map((b) => (
                        <div
                          key={b}
                          className={`text-xs px-2 py-1.5 rounded flex items-center gap-2
                            ${b === 'main' ? 'bg-blue-900/30 text-blue-300' : 'bg-gray-800/60 text-gray-500'}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full flex-shrink-0
                              ${b === 'main' ? 'bg-blue-400' : 'bg-gray-600'}`}
                          />
                          {b}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="space-y-2 pt-1">
                  {cachedJsonl && !isProcessing && (
                    <button
                      onClick={() => process(cachedJsonl)}
                      className="w-full flex items-center justify-center gap-2 py-2 text-xs
                        font-medium text-blue-400 hover:text-blue-300
                        border border-blue-900/60 hover:border-blue-700
                        rounded-lg transition-colors bg-blue-900/10 hover:bg-blue-900/20"
                    >
                      用 AI 重新解析
                    </button>
                  )}
                  <button
                    onClick={() => setTimelineMode(true)}
                    className="w-full flex items-center justify-center gap-2 py-2 text-xs
                      text-blue-400 hover:text-blue-300 border border-blue-900/40
                      hover:border-blue-700 rounded-lg transition-colors bg-blue-900/10"
                  >
                    <Rows3 size={12} />
                    多会话时间线
                  </button>
                  <button
                    onClick={() => { reset(); setCachedJsonl(null) }}
                    className="w-full flex items-center justify-center gap-2 py-2 text-xs
                      text-gray-500 hover:text-gray-300 border border-gray-800
                      hover:border-gray-600 rounded-lg transition-colors"
                  >
                    <RotateCcw size={12} />
                    加载其他轨迹
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>

        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex-shrink-0 w-4 flex items-center justify-center
            text-gray-700 hover:text-gray-400 transition-colors
            border-r border-gray-800 bg-gray-900/30 hover:bg-gray-900"
        >
          {sidebarOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
        </button>

        {/* Graph area */}
        <main
          className={`flex-1 min-w-0 transition-all duration-200 ${
            activeNode ? 'mr-96' : ''
          }`}
        >
          {!timelineMode && phase === 'error' ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <p className="text-red-400 text-sm">{state.progress.error}</p>
              <button
                onClick={() => { reset(); setCachedJsonl(null) }}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                重试
              </button>
            </div>
          ) : (
            <ReactFlowProvider>
              <TraceDAG
                graphData={activeGraphData}
                selectedNodeId={selectedNodeId}
                onNodeClick={setSelectedNodeId}
                onToggleExpand={!timelineMode ? handleToggleExpand : undefined}
                expandedNodes={!timelineMode ? expandedNodes : undefined}
              />
            </ReactFlowProvider>
          )}
        </main>
      </div>

      {/* Node detail */}
      <NodeCard
        node={activeNode}
        events={activeEvents}
        onClose={() => setSelectedNodeId(null)}
      />

      {/* Provider panel */}
      {showProvider && (
        <ProviderPanel
          config={providerConfig}
          onSave={(cfg) => {
            setProviderConfig(cfg)
            saveProviderConfig(cfg)
            setShowProvider(false)
            if (cachedJsonl && cfg.apiKey) {
              setTimeout(() => process(cachedJsonl), 100)
            }
          }}
          onClose={() => setShowProvider(false)}
        />
      )}
    </div>
  )
}
