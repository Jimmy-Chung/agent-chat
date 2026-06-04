import type { GoalAnchor, PlanItem, TraceNode } from './types'
import { governConversationTree, type ConversationTreeNode } from './conversation-tree'

export type MindMapNodeKind = ConversationTreeNode['kind']
export type MindMapEdgeKind = 'tree' | 'branch' | 'collapsed'

export interface MindMapNode {
  id: string
  kind: MindMapNodeKind
  title: string
  subtitle: string
  relation: ConversationTreeNode['relation']
  goalDistance: number
  active: boolean
  current: boolean
  collapsed: boolean
  depth: number
  sourceNodeIds: string[]
  aggregation: ConversationTreeNode['aggregation']
  status?: TraceNode['status']
  position: { x: number; y: number }
}

export interface MindMapEdge {
  id: string
  source: string
  target: string
  kind: MindMapEdgeKind
}

export interface MindMapProjection {
  nodes: MindMapNode[]
  edges: MindMapEdge[]
}

const ROOT_X = 0
const ROOT_Y = 0
const TOPIC_X0 = 320
const TOPIC_GAP_X = 310
const TURN_Y = 170
const TURN_GAP_X = 210
const BRANCH_X = 260
const BRANCH_GAP_Y = 210
const ANNOTATION_Y = -150
const TOPIC_DEPTH_Y = 260

function isVisible(id: string, treeNodes: Record<string, ConversationTreeNode>): boolean {
  let current = treeNodes[id]
  while (current?.parentId) {
    const parent = treeNodes[current.parentId]
    if (parent?.collapsed && !current.active) return false
    current = parent
  }
  return true
}

export function buildMindMapProjection(
  traceNodes: TraceNode[],
  goalAnchor: GoalAnchor | null,
  planItems: PlanItem[],
): MindMapProjection {
  const tree = governConversationTree(traceNodes, goalAnchor, planItems)
  const nodes: MindMapNode[] = []
  const edges: MindMapEdge[] = []
  const positionById = new Map<string, { x: number; y: number }>()
  const root = tree.nodes[tree.rootId]

  nodes.push({
    id: root.id,
    kind: root.kind,
    title: root.title,
    subtitle: root.summary,
    relation: root.relation,
    goalDistance: root.goalDistance,
    active: root.active,
    current: root.current,
    collapsed: root.collapsed,
    depth: root.depth,
    sourceNodeIds: root.sourceNodeIds,
    aggregation: root.aggregation,
    status: root.status,
    position: { x: ROOT_X, y: ROOT_Y },
  })
  positionById.set(root.id, { x: ROOT_X, y: ROOT_Y })

  const rootTopics = root.childIds.map((id) => tree.nodes[id]).filter((node) => node?.kind === 'topic')
  rootTopics.forEach((topic, index) => {
    const position = { x: TOPIC_X0 + index * TOPIC_GAP_X, y: ROOT_Y }
    positionById.set(topic.id, position)
  })

  const branchTopicLane = new Map<string, number>()

  for (const id of tree.orderedIds) {
    const node = tree.nodes[id]
    if (node.id === tree.rootId || !isVisible(id, tree.nodes)) continue

    let position = positionById.get(node.id)
    const parentPosition = node.parentId ? positionById.get(node.parentId) : undefined

    if (!position) {
      if (node.kind === 'topic' && node.relation === 'branch') {
        const lane = branchTopicLane.size
        branchTopicLane.set(node.id, lane)
        position = {
          x: (parentPosition?.x ?? TOPIC_X0) + BRANCH_X,
          y: (parentPosition?.y ?? ROOT_Y) + TOPIC_DEPTH_Y + lane * BRANCH_GAP_Y,
        }
      } else if (node.kind === 'turn') {
        const siblings = node.parentId ? tree.nodes[node.parentId].childIds.filter((childId) => tree.nodes[childId]?.kind === 'turn') : []
        const index = Math.max(0, siblings.indexOf(node.id))
        position = {
          x: (parentPosition?.x ?? TOPIC_X0) + index * TURN_GAP_X,
          y: (parentPosition?.y ?? ROOT_Y) + TURN_Y,
        }
      } else if (node.kind === 'plan' || node.kind === 'decision') {
        position = {
          x: parentPosition?.x ?? TOPIC_X0,
          y: (parentPosition?.y ?? ROOT_Y) + ANNOTATION_Y,
        }
      } else {
        position = { x: parentPosition?.x ?? TOPIC_X0, y: parentPosition?.y ?? ROOT_Y }
      }
      positionById.set(node.id, position)
    }

    nodes.push({
      id: node.id,
      kind: node.kind,
      title: node.title,
      subtitle: node.collapsed ? `${node.summary} · 已聚合` : node.summary,
      relation: node.relation,
      goalDistance: node.goalDistance,
      active: node.active,
      current: node.current,
      collapsed: node.collapsed,
      depth: node.depth,
      sourceNodeIds: node.sourceNodeIds,
      aggregation: node.aggregation,
      status: node.status,
      position,
    })

    if (node.parentId && positionById.has(node.parentId)) {
      edges.push({
        id: `edge_${node.parentId}_${node.id}`,
        source: node.parentId,
        target: node.id,
        kind: node.collapsed ? 'collapsed' : node.relation === 'branch' ? 'branch' : 'tree',
      })
    }
  }

  return { nodes, edges }
}
