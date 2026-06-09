import type { MindMapNode, MindMapProjection } from '@agent-chat/protocol'
import type { AttentionLlmConfig, AttentionInterpretDiagnostics } from '../routes/attention'

export interface AggregationDecision {
  mergeable: boolean
  confidence: number
  title: string
  summary: string
  reason: string
}

export type AggregationDecisionStore = Record<string, AggregationDecision>

export interface AggregationDecisionGroup {
  nodeId: string
  decisionKey: string
  blockKey: string
  sourceNodeIds: string[]
  groupType: 'capacity' | 'content' | 'branch'
  reason: string
  childTitles: string[]
  currentTitle: string
  currentSummary: string
  goalDistance: number
  turnCount: number
  toolCount: number
}

export interface AggregationDecisionResult {
  ok: boolean
  decisions: AggregationDecision[]
  reason?: string
  diagnostics?: AttentionInterpretDiagnostics
}

export type DecideAggregationsFn = (
  prompt: string,
  llm: AttentionLlmConfig,
  opts?: { maxTokens?: number },
) => Promise<AggregationDecisionResult>

const DEFAULT_DECISION: AggregationDecision = {
  mergeable: true,
  confidence: 1,
  title: '',
  summary: '',
  reason: 'capacity compact',
}

function normalizeGroupType(value: unknown, reason: string | null | undefined): 'capacity' | 'content' | 'branch' {
  if (value === 'capacity' || value === 'content' || value === 'branch') return value
  if (reason === 'capacity_compact') return 'capacity'
  if (reason === 'resolved') return 'branch'
  return 'content'
}

function decisionKey(groupType: string, groupKey: string): string {
  return `${groupType}:${groupKey}`
}

export function parseAggregationDecisionStore(json: string | null | undefined): AggregationDecisionStore {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: AggregationDecisionStore = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      const record = value as Record<string, unknown>
      out[key] = {
        mergeable: record.mergeable !== false,
        confidence: typeof record.confidence === 'number' ? Math.min(1, Math.max(0, record.confidence)) : 0,
        title: typeof record.title === 'string' ? record.title : '',
        summary: typeof record.summary === 'string' ? record.summary : '',
        reason: typeof record.reason === 'string' ? record.reason : '',
      }
    }
    return out
  } catch {
    return {}
  }
}

export function collectAggregationGroups(projection: MindMapProjection): AggregationDecisionGroup[] {
  return projection.nodes
    .filter((node) => node.kind === 'aggregate' && node.aggregation?.groupKey)
    .map((node) => {
      const aggregation = node.aggregation!
      const groupType = normalizeGroupType(aggregation.groupType, aggregation.reason)
      return {
        nodeId: node.id,
        decisionKey: decisionKey(groupType, aggregation.groupKey!),
        blockKey: decisionKey(groupType, [...new Set(node.sourceNodeIds)].sort().join('|')),
        sourceNodeIds: node.sourceNodeIds,
        groupType,
        reason: aggregation.reason ?? 'unknown',
        childTitles: aggregation.sourceTitles,
        currentTitle: node.title,
        currentSummary: node.subtitle,
        goalDistance: node.goalDistance,
        turnCount: aggregation.turnCount,
        toolCount: aggregation.toolCount,
      }
    })
}

export function buildAggregationDecisionPrompt(groups: AggregationDecisionGroup[]): string {
  const lines = [
    '你是会话聚合审阅器。给定若干聚合候选，为每组判断是否可以聚合，并输出短标题与摘要。',
    '规则：capacity 类型是容量治理，必须 mergeable=true；content/branch 类型需要判断是否语义上属于同一话题或一个已收束阶段。',
    '标题不超过 12 个汉字，摘要不超过 36 个汉字。严格输出 JSON：{"groups":[{"mergeable":true,"confidence":0.9,"title":"短标题","summary":"短摘要","reason":"依据"}]}，顺序与输入一致。',
    '',
  ]
  groups.forEach((group, index) => {
    lines.push(`组${index}`)
    lines.push(`类型：${group.groupType}`)
    lines.push(`触发原因：${group.reason}`)
    lines.push(`当前标题：${group.currentTitle}`)
    lines.push(`当前摘要：${group.currentSummary}`)
    lines.push(`目标距离：${group.goalDistance.toFixed(2)}，轮数：${group.turnCount}，工具数：${group.toolCount}`)
    lines.push(`子标题：${group.childTitles.slice(0, 10).join(' / ') || '（无）'}`)
    lines.push('')
  })
  return lines.join('\n')
}

export function applyAggregationDecisions(
  projection: MindMapProjection,
  groups: AggregationDecisionGroup[],
  decisionsByKey: AggregationDecisionStore,
): MindMapProjection {
  const keyByNodeId = new Map(groups.map((group) => [group.nodeId, group.decisionKey]))
  return {
    ...projection,
    nodes: projection.nodes.map((node): MindMapNode => {
      const key = keyByNodeId.get(node.id)
      const decision = key ? decisionsByKey[key] : undefined
      if (!decision || !node.aggregation) return node
      const aggregation = {
        ...node.aggregation,
        semanticTitle: decision.title || undefined,
        semanticSummary: decision.summary || undefined,
        semanticMergeable: decision.mergeable,
        semanticConfidence: decision.confidence,
        semanticReason: decision.reason || undefined,
      }
      if (!decision.mergeable) return { ...node, aggregation }
      return {
        ...node,
        title: decision.title || node.title,
        subtitle: decision.summary ? `${decision.summary} · 已聚合` : node.subtitle,
        aggregation,
      }
    }),
  }
}

export async function resolveAggregationDecisions(input: {
  projection: MindMapProjection
  frozenStore: AggregationDecisionStore
  llm: AttentionLlmConfig
  decideAggregations: DecideAggregationsFn
  maxTokens?: number
  reviewSourceNodeIds?: Set<string>
}): Promise<{ projection: MindMapProjection; nextStore: AggregationDecisionStore; rejectedKeys: Set<string>; degradedReason?: string }> {
  const groups = collectAggregationGroups(input.projection)
  const nextStore: AggregationDecisionStore = {}
  for (const [key, decision] of Object.entries(input.frozenStore)) {
    if (decision.mergeable === false) nextStore[key] = decision
  }
  if (!groups.length) return { projection: input.projection, nextStore, rejectedKeys: new Set() }

  const misses: AggregationDecisionGroup[] = []
  for (const group of groups) {
    const frozen = input.frozenStore[group.decisionKey]
    if (frozen) {
      nextStore[group.decisionKey] = frozen
      continue
    }
    if (
      input.reviewSourceNodeIds &&
      !group.sourceNodeIds.some((sourceNodeId) => input.reviewSourceNodeIds!.has(sourceNodeId))
    ) {
      nextStore[group.decisionKey] = {
        ...DEFAULT_DECISION,
        title: group.currentTitle,
        summary: group.currentSummary.replace(/\s*·\s*已聚合$/, ''),
        reason: 'frozen old aggregation',
      }
      continue
    }
    if (group.groupType === 'capacity') {
      nextStore[group.decisionKey] = {
        ...DEFAULT_DECISION,
        title: group.currentTitle,
        summary: group.currentSummary.replace(/\s*·\s*已聚合$/, ''),
      }
      misses.push(group)
      continue
    }
    misses.push(group)
  }

  let degradedReason: string | undefined
  if (misses.length > 0) {
    const result = await input.decideAggregations(buildAggregationDecisionPrompt(misses), input.llm, { maxTokens: input.maxTokens })
    if (result.ok && result.decisions.length) {
      misses.forEach((group, index) => {
        const raw = result.decisions[index]
        if (!raw) return
        nextStore[group.decisionKey] = {
          mergeable: group.groupType === 'capacity' ? true : raw.mergeable,
          confidence: raw.confidence,
          title: raw.title || group.currentTitle,
          summary: raw.summary || group.currentSummary.replace(/\s*·\s*已聚合$/, ''),
          reason: raw.reason,
        }
      })
    } else {
      degradedReason = result.reason ?? 'aggregation_llm_failed'
    }
  }

  return {
    projection: applyAggregationDecisions(input.projection, groups, nextStore),
    nextStore,
    rejectedKeys: new Set(
      groups
        .filter((group) => group.groupType !== 'capacity' && nextStore[group.decisionKey]?.mergeable === false)
        .map((group) => group.blockKey),
    ),
    degradedReason,
  }
}
