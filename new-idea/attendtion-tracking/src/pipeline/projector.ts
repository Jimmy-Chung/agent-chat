import dagre from 'dagre'
import { TraceNode, PlanItem, GoalAnchor, TraceExchange } from '../types'
import { Node as FlowNode, Edge as FlowEdge } from '@xyflow/react'
import { computeGoalDistance } from './interpreter'
import { groupExchanges, ExchangeGroup } from './aggregator'

export type GraphData = {
  nodes: FlowNode[]
  edges: FlowEdge[]
  anchor: GoalAnchor
  focusPath: string[]
}

export type NodePositions = Map<string, { x: number; y: number }>

const NODE_W = 260
const NODE_H = 110
const H_GAP = 150
const V_GAP = 80

// ── Phase 1: compute positions via dagre — only re-run when structure changes ──

export function computePositions(
  traceNodes: TraceNode[],
  planItems: PlanItem[],
  collapsedBranches: Set<string>
): NodePositions {
  void planItems
  const positions: NodePositions = new Map()

  const mainNodes = traceNodes.filter((n) => n.branch_id === 'main')
  const branchNodes = traceNodes.filter(
    (n) => n.branch_id !== 'main' && !collapsedBranches.has(n.branch_id)
  )

  // ── 1. 主干节点用 dagre LR 横向布局（不包含分支节点）──────────────────
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: V_GAP, ranksep: H_GAP, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of mainNodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H })
  }
  for (let i = 1; i < mainNodes.length; i++) {
    g.setEdge(mainNodes[i - 1].id, mainNodes[i].id)
  }

  dagre.layout(g)

  for (const n of mainNodes) {
    const pos = g.node(n.id)
    positions.set(n.id, { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 })
  }

  // ── 2. 分支节点：从父主干节点向下纵向排列（思维导图子节点风格）────────────
  const mainNodeIds = new Set(mainNodes.map((n) => n.id))
  const placedBranch = new Set<string>()

  // 找所有「入口」分支节点（直接挂在主干节点下的第一个）
  for (const entry of branchNodes) {
    if (placedBranch.has(entry.id)) continue
    if (!entry.parent_id || !mainNodeIds.has(entry.parent_id)) continue

    const parentPos = positions.get(entry.parent_id)
    if (!parentPos) continue

    // 沿分支链纵向排列
    let current: TraceNode | undefined = entry
    let depth = 0
    while (current && !placedBranch.has(current.id)) {
      positions.set(current.id, {
        x: parentPos.x,
        y: parentPos.y + NODE_H + V_GAP + depth * (NODE_H + V_GAP),
      })
      placedBranch.add(current.id)
      depth++
      current = branchNodes.find(
        (bn) => bn.parent_id === current!.id && bn.branch_id === current!.branch_id
      )
    }
  }

  return positions
}

// ── Phase 2: assemble graph from pre-computed positions — cheap, runs on data changes ──

export function buildGraph(
  traceNodes: TraceNode[],
  planItems: PlanItem[],
  positions: NodePositions,
  anchor: GoalAnchor,
  collapsedBranches: Set<string>
): GraphData {
  void planItems
  const mainNodes = traceNodes.filter((n) => n.branch_id === 'main')
  const branchNodes = traceNodes.filter(
    (n) => n.branch_id !== 'main' && !collapsedBranches.has(n.branch_id)
  )
  const focusPath = mainNodes.map((n) => n.id)

  const flowNodes: FlowNode[] = []
  const flowEdges: FlowEdge[] = []

  // Execution nodes
  for (const n of [...mainNodes, ...branchNodes]) {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 }
    flowNodes.push({
      id: n.id,
      type: n.branch_id !== 'main' ? 'branchNode' : 'executionNode',
      position: pos,
      data: n as unknown as Record<string, unknown>,
    })
  }

  // Main-line edges
  for (let i = 1; i < mainNodes.length; i++) {
    flowEdges.push({
      id: `main_${i}`,
      source: mainNodes[i - 1].id,
      target: mainNodes[i].id,
      type: 'mainLineEdge',
      style: { stroke: '#3b82f6', strokeWidth: 2 },
      animated: mainNodes[i].is_loading,
    })
  }

  // Branch edges：父节点 bottom → 子节点 top（纵向连接）
  for (const n of branchNodes) {
    if (n.parent_id) {
      flowEdges.push({
        id:           `branch_${n.id}`,
        source:       n.parent_id,
        target:       n.id,
        sourceHandle: 'branch-out',
        targetHandle: 'branch-in',
        type:         'branchEdge',
        style:        { stroke: '#6b7280', strokeWidth: 1.5 },
      })
    }
  }

  return { nodes: flowNodes, edges: flowEdges, anchor, focusPath }
}

// ── Convenience: full project (for cases where structure changes) ─────────────

export function project(
  traceNodes: TraceNode[],
  planItems: PlanItem[],
  anchor: GoalAnchor,
  collapsedBranches: Set<string>
): GraphData {
  const positions = computePositions(traceNodes, planItems, collapsedBranches)
  return buildGraph(traceNodes, planItems, positions, anchor, collapsedBranches)
}

// ── Expandable horizontal tree layout ────────────────────────────────────────
// 每一层节点横向排列（左→右），子树展开时子节点在父节点正下方横向铺开。
// 父节点 X 坐标 = 其子树的起始 X，子树宽度 = max(节点宽, 子节点链总宽)。
// 这保证右侧同级节点自动跟子树宽度对齐，不重叠。

const TREE_NODE_W     = 260    // 节点宽度（同 NODE_W）
const TREE_LEVEL_H    = 260    // 父子层之间的纵向间距
const TREE_SIBLING_GAP = 60   // 同级兄弟之间的横向间距
const TREE_TOP_GAP    = 100   // 顶层节点之间的横向间距

type TNode = {
  id:            string
  type:          'executionNode' | 'exchangeNode'
  rawData:       Record<string, unknown>
  parentId:      string | null
  level:         number
  subtreeWidth:  number
  children:      TNode[]
}

function buildExchangeTNode(
  exchange: TraceExchange,
  subExchanges: TraceExchange[] | undefined,
  id: string,
  index: number,
  parentId: string,
  level: number,
  expandedNodes: Set<string>
): TNode {
  const canExpand = (subExchanges?.length ?? 0) > 1
  const children: TNode[] = []

  if (canExpand && expandedNodes.has(id)) {
    subExchanges!.forEach((ex, j) => {
      children.push({
        id:           `${id}__e${j}`,
        type:         'exchangeNode',
        rawData:      { exchange: ex, index: j, goalDistance: 0.5, subExchanges: [] },
        parentId:     id,
        level:        level + 1,
        subtreeWidth: 0,
        children:     [],
      })
    })
  }

  return {
    id,
    type:    'exchangeNode',
    rawData: {
      exchange:     { ...exchange, id },  // 确保 exchange.id === TNode.id
      index:        index,
      goalDistance: 0.5,
      subExchanges: canExpand ? subExchanges : undefined,
      __isExpanded: expandedNodes.has(id),
    },
    parentId,
    level,
    subtreeWidth: 0,
    children,
  }
}

function buildPhaseTNode(n: TraceNode, expandedNodes: Set<string>): TNode {
  const children: TNode[] = []
  const canExpand = (n.user_message_count ?? 0) > 1

  if (canExpand && expandedNodes.has(n.id)) {
    const groups = groupExchanges(n.exchanges ?? [], 12)
    groups.forEach((g, i) => {
      const groupId = `${n.id}__g${i}`
      const synEx: TraceExchange = {
        id:                groupId,   // 与 TNode.id 一致，保证展开按钮能命中 expandedNodes
        user_message:      g.user_message,
        user_kind:         g.user_kind,
        assistant_summary: g.assistant_summary,
        assistant_actions: [],
        tool_count:        g.tool_count,
        event_ids:         g.exchanges.flatMap((e) => e.event_ids),
        ts_start:          g.ts_start,
        ts_end:            g.ts_end,
        prev_ai_summary:   g.prev_ai_summary,
      }
      children.push(
        buildExchangeTNode(
          synEx,
          g.exchanges.length > 1 ? g.exchanges : undefined,
          groupId,
          i,
          n.id,
          1,
          expandedNodes
        )
      )
    })
  }

  return {
    id:           n.id,
    type:         'executionNode',
    rawData:      n as unknown as Record<string, unknown>,
    parentId:     null,
    level:        0,
    subtreeWidth: 0,
    children,
  }
}

function calcWidth(node: TNode): number {
  if (node.children.length === 0) {
    node.subtreeWidth = TREE_NODE_W
    return TREE_NODE_W
  }
  const childrenSum = node.children.reduce((s, c) => s + calcWidth(c), 0)
                    + (node.children.length - 1) * TREE_SIBLING_GAP
  node.subtreeWidth = Math.max(TREE_NODE_W, childrenSum)
  return node.subtreeWidth
}

function placeNodes(
  node: TNode,
  startX: number,
  goalText: string,
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[]
): void {
  const y = node.level * TREE_LEVEL_H

  // 计算 goal distance（对 exchange 节点）
  let data = node.rawData
  if (node.type === 'exchangeNode') {
    const ex = (data as { exchange: TraceExchange }).exchange
    const dist = computeGoalDistance(goalText, `${ex.user_message} ${ex.assistant_summary}`)
    data = { ...data, goalDistance: dist }
  }

  flowNodes.push({ id: node.id, type: node.type, position: { x: startX, y }, data })

  if (node.children.length === 0) return

  // 父 → 第一个子节点（向下落边）
  flowEdges.push({
    id:           `drop_${node.id}`,
    source:       node.id,
    target:       node.children[0].id,
    sourceHandle: 'expand-down',
    targetHandle: 'top',
    type:         'childDropEdge',
    style:        { stroke: '#4b5563', strokeWidth: 1.5 },
  })

  // 子节点之间横向链（同级兄弟连接）
  for (let i = 1; i < node.children.length; i++) {
    flowEdges.push({
      id:           `sib_${node.children[i - 1].id}`,
      source:       node.children[i - 1].id,
      target:       node.children[i].id,
      sourceHandle: 'right',
      targetHandle: 'left',
      type:         'childLineEdge',
      style:        { stroke: '#4b5563', strokeWidth: 1.5 },
    })
  }

  let childX = startX
  for (const child of node.children) {
    placeNodes(child, childX, goalText, flowNodes, flowEdges)
    childX += child.subtreeWidth + TREE_SIBLING_GAP
  }
}

export function projectExpandableTree(
  traceNodes: TraceNode[],
  expandedNodes: Set<string>,
  anchor: GoalAnchor,
  collapsedBranches: Set<string>
): GraphData {
  const goalText = anchor.normalized_goal || anchor.raw_query
  const mainNodes   = traceNodes.filter((n) => n.branch_id === 'main')
  const branchNodes = traceNodes.filter(
    (n) => n.branch_id !== 'main' && !collapsedBranches.has(n.branch_id)
  )

  // ── 构建并布局主树 ────────────────────────────────────────────────────────
  const roots = mainNodes.map((n) => buildPhaseTNode(n, expandedNodes))
  roots.forEach(calcWidth)

  const flowNodes: FlowNode[] = []
  const flowEdges: FlowEdge[] = []

  // 顶层主干横向连接
  for (let i = 1; i < roots.length; i++) {
    flowEdges.push({
      id:       `main_${i}`,
      source:   roots[i - 1].id,
      target:   roots[i].id,
      type:     'mainLineEdge',
      style:    { stroke: '#3b82f6', strokeWidth: 2 },
      animated: (roots[i].rawData as TraceNode).is_loading,
    })
  }

  // 放置所有主树节点
  const rootXMap = new Map<string, number>()
  let x = 0
  for (const root of roots) {
    placeNodes(root, x, goalText, flowNodes, flowEdges)
    rootXMap.set(root.id, x)
    x += root.subtreeWidth + TREE_TOP_GAP
  }

  // ── 分支节点：水平排列在主线上方/下方，不占主线空间 ─────────────────────
  // 多个 branch cluster 交替上下排列
  const BRANCH_NODE_W  = 224   // BranchNode w-56
  const BRANCH_H_GAP   = 64    // 分支节点之间横向间距
  const BRANCH_Y_ABOVE = -260  // 主线上方（负 Y）
  const BRANCH_Y_BELOW = 230   // 主线下方

  const mainNodeIds = new Set(mainNodes.map((n) => n.id))

  // 按 branch_id 分组，每组是一条独立的偏离链
  const branchMap = new Map<string, TraceNode[]>()
  for (const n of branchNodes) {
    if (!branchMap.has(n.branch_id)) branchMap.set(n.branch_id, [])
    branchMap.get(n.branch_id)!.push(n)
  }

  let clusterIdx = 0
  for (const [, nodes] of branchMap) {
    // 找到入口节点（父节点是主干节点的那个）
    const entry = nodes.find((n) => n.parent_id && mainNodeIds.has(n.parent_id))
    if (!entry) continue

    const parentX = rootXMap.get(entry.parent_id!) ?? 0
    const branchY  = clusterIdx % 2 === 0 ? BRANCH_Y_ABOVE : BRANCH_Y_BELOW

    // 按父子链重建顺序
    const chain: TraceNode[] = []
    let cur: TraceNode | undefined = entry
    while (cur) {
      chain.push(cur)
      cur = nodes.find((n) => n.parent_id === cur!.id)
    }

    // 横向放置分支节点
    chain.forEach((n, i) => {
      flowNodes.push({
        id:       n.id,
        type:     'branchNode',
        position: { x: parentX + i * (BRANCH_NODE_W + BRANCH_H_GAP), y: branchY },
        data:     n as unknown as Record<string, unknown>,
      })
    })

    // 入口连线：从父主干节点到第一个分支节点
    const srcHandle = branchY < 0 ? 'branch-top-out' : 'branch-out'
    const tgtHandle = branchY < 0 ? 'branch-bottom-in' : 'branch-top-in'
    flowEdges.push({
      id:           `branch_entry_${entry.id}`,
      source:       entry.parent_id!,
      target:       entry.id,
      sourceHandle: srcHandle,
      targetHandle: tgtHandle,
      type:         'branchEdge',
      style:        { stroke: '#6b7280', strokeWidth: 1.5 },
    })

    // 链内横向连线
    for (let i = 1; i < chain.length; i++) {
      flowEdges.push({
        id:           `branch_chain_${chain[i].id}`,
        source:       chain[i - 1].id,
        target:       chain[i].id,
        sourceHandle: 'branch-right-out',
        targetHandle: 'branch-left-in',
        type:         'branchEdge',
        style:        { stroke: '#6b7280', strokeWidth: 1.5 },
      })
    }

    clusterIdx++
  }

  return {
    nodes:     flowNodes,
    edges:     flowEdges,
    anchor,
    focusPath: roots.map((r) => r.id),
  }
}

// ── Multi-session timeline layout ─────────────────────────────────────────────

export type SessionForTimeline = {
  id: string
  label: string
  color: string
  nodes: TraceNode[]
}

const TIMELINE_W  = 3200   // total X span in px
const TL_LANE_H   = 130    // height per swim lane
const TL_LANE_PAD = 24     // top padding within lane

export function projectTimeline(
  sessions: SessionForTimeline[],
  fallbackAnchor: GoalAnchor
): GraphData {
  const allNodes = sessions.flatMap((s) =>
    s.nodes.filter((n) => !n.is_loading && n.ts_start > 0)
  )

  if (!allNodes.length) {
    return { nodes: [], edges: [], anchor: fallbackAnchor, focusPath: [] }
  }

  const globalMin = Math.min(...allNodes.map((n) => n.ts_start))
  const globalMax = Math.max(...allNodes.map((n) => (n.ts_end ?? n.ts_start)))
  const timeRange = Math.max(globalMax - globalMin, 1)

  const flowNodes: FlowNode[] = []
  const flowEdges: FlowEdge[] = []

  sessions.forEach((session, sessionIdx) => {
    const laneY = sessionIdx * TL_LANE_H + TL_LANE_PAD

    // Lane label node (anchored far left)
    flowNodes.push({
      id: `lane_label_${session.id}`,
      type: 'laneLabel',
      position: { x: -180, y: laneY },
      data: { label: session.label, color: session.color } as unknown as Record<string, unknown>,
      selectable: false,
      draggable: false,
    })

    // Phase nodes (main branch only, sorted by time)
    const mainNodes = session.nodes
      .filter((n) => !n.is_loading && n.branch_id === 'main' && n.ts_start > 0)
      .sort((a, b) => a.ts_start - b.ts_start)

    for (const node of mainNodes) {
      const x = ((node.ts_start - globalMin) / timeRange) * TIMELINE_W
      flowNodes.push({
        id: node.id,
        type: 'timelineNode',
        position: { x, y: laneY },
        data: {
          ...node,
          __sessionColor: session.color,
          __sessionLabel: session.label,
        } as unknown as Record<string, unknown>,
      })
    }

    // Connect sequential nodes within the session
    for (let i = 1; i < mainNodes.length; i++) {
      flowEdges.push({
        id: `tl_${session.id}_${i}`,
        source: mainNodes[i - 1].id,
        target: mainNodes[i].id,
        type: 'timelineEdge',
        style: { stroke: session.color, strokeWidth: 1.5, opacity: 0.5 },
      })
    }
  })

  return { nodes: flowNodes, edges: flowEdges, anchor: fallbackAnchor, focusPath: [] }
}
