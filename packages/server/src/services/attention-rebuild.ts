import {
  aggregate,
  buildInterpretPrompt,
  buildMindMapProjection,
  buildTrace,
  extractGoalAnchor,
  storeToRawEvents,
  type AttentionInteraction,
  type GoalAnchor,
  type TraceNode,
} from '@agent-chat/protocol'
import type { AttentionLlmConfig, InterpretResult } from '../routes/attention'
import {
  buildFrozenInterpMap,
  mergeInterpret,
  planIncrementalInterpret,
  resolveGoalPinning,
  type FrozenInterp,
} from './attention-incremental'
import {
  getAttentionGoalSnapshot,
  markAttentionGoalSnapshotDegraded,
  upsertAttentionGoalSnapshot,
  type AttentionGoalSnapshot,
} from '../db/repos/attention_goal_snapshot.repo'
import {
  parseAggregationDecisionStore,
  resolveAggregationDecisions,
  type DecideAggregationsFn,
} from './attention-aggregation-decisions'
import { listInteractionsByTopic } from '../db/repos/interaction.repo'
import { listMessagesAndPartsByTopic } from '../db/repos/message.repo'
import { listTopicRuntimeEvents, runtimeEventToRawEvent } from '../db/repos/topic_runtime_event.repo'
import { logGatewayEvent } from '../server-logs'

export interface AttentionRebuildResult {
  ok: boolean
  degraded?: boolean
  reason?: string
  snapshot?: AttentionGoalSnapshot
}

export type InterpretTraceFn = (
  prompt: string,
  llm: AttentionLlmConfig,
  opts?: { maxTokens?: number },
) => Promise<InterpretResult>

function interactionToAttention(input: Awaited<ReturnType<typeof listInteractionsByTopic>>[number]): AttentionInteraction {
  let options: string[] | undefined
  let response: string | undefined
  try {
    const parsed = input.options_json ? JSON.parse(input.options_json) : null
    if (Array.isArray(parsed)) options = parsed.map((item) => String(item))
    else if (Array.isArray(parsed?.options)) options = parsed.options.map((item: unknown) => String(item))
  } catch {
    options = undefined
  }
  try {
    const parsed = input.response_json ? JSON.parse(input.response_json) : null
    if (typeof parsed === 'string') response = parsed
    else if (typeof parsed?.value === 'string') response = parsed.value
    else if (typeof parsed?.label === 'string') response = parsed.label
    else if (parsed != null) response = JSON.stringify(parsed)
  } catch {
    response = input.response_json ?? undefined
  }
  return {
    interactionId: input.id,
    messageId: input.message_id ?? undefined,
    topicId: input.topic_id,
    interactionKind: input.kind,
    prompt: input.prompt,
    options,
    status: input.status,
    response,
  }
}

function resolveGoalAnchor(goal: AttentionGoalSnapshot, defaultGoalAnchor: GoalAnchor | null): GoalAnchor {
  const text = goal.goal_text.trim()
  return {
    raw_query: text || defaultGoalAnchor?.raw_query || '',
    normalized_goal: text || defaultGoalAnchor?.normalized_goal || '',
    ts: goal.created_at || defaultGoalAnchor?.ts || 0,
  }
}

function hasValidNodes(nodes: TraceNode[]): boolean {
  return nodes.some((node) => node.source_message_ids.length > 0)
}

export async function rebuildAttentionGoalSnapshot(input: {
  goalId: string
  llm: AttentionLlmConfig
  interpretTrace: InterpretTraceFn
  decideAggregations: DecideAggregationsFn
  maxTokens?: number
}): Promise<AttentionRebuildResult> {
  const goal = await getAttentionGoalSnapshot(input.goalId)
  if (!goal) return { ok: false, reason: 'not_found' }

  const { messages, partsByMessage } = await listMessagesAndPartsByTopic(goal.topic_id)
  const interactions = (await listInteractionsByTopic(goal.topic_id)).map(interactionToAttention)
  const runtimeEvents = (await listTopicRuntimeEvents(goal.topic_id)).map(runtimeEventToRawEvent)
  const rawEvents = storeToRawEvents({ messages, partsByMessage, interactions, runtimeEvents })
  const sourceMessageCount = messages.length
  const sourceLastEventTs = rawEvents.length > 0 ? rawEvents[rawEvents.length - 1].ts : 0
  const defaultGoalAnchor = extractGoalAnchor({ messages, partsByMessage })
  const goalAnchor = resolveGoalAnchor(goal, defaultGoalAnchor)
  const { candidates, planItems } = aggregate(rawEvents)

  if (!rawEvents.length || !candidates.length) {
    const snapshot = await markAttentionGoalSnapshotDegraded({ id: goal.id, reason: 'empty_source' })
    return { ok: false, degraded: true, reason: 'empty_source', snapshot: snapshot ?? goal }
  }

  // ── 增量冻结（R1/R3/R4）：只对新候选调 LLM，旧候选复用上次快照的冻结解释 ────
  // 设计见 attention-incremental-rebuild-design.md。冻结身份 = source_message_ids 集合。
  let prevAnchor: GoalAnchor | null = null
  if (goal.goal_json) {
    try {
      prevAnchor = JSON.parse(goal.goal_json) as GoalAnchor
    } catch {
      prevAnchor = null
    }
  }
  const goalChanged = !prevAnchor || (prevAnchor.raw_query?.trim() ?? '') !== goalAnchor.raw_query.trim()
  const prevNormalizedGoal = prevAnchor?.normalized_goal?.trim() || ''
  // 喂给 LLM 的目标文字：目标未变时钉死旧的归一化表达，让新节点与旧节点对同一目标判定。
  const promptNormalizedGoal = goalChanged ? goalAnchor.normalized_goal : prevNormalizedGoal || goalAnchor.normalized_goal
  const promptAnchor: GoalAnchor = { ...goalAnchor, normalized_goal: promptNormalizedGoal }

  // 目标变更 = 唯一全量触发器：清空冻结表，全部重解释。
  const frozenMap = goalChanged ? new Map<string, FrozenInterp>() : buildFrozenInterpMap(goal.candidates_json, goal.interpret_json)
  const { pending, pendingIdx } = planIncrementalInterpret(candidates, frozenMap)

  let llmResult: InterpretResult | null = null
  if (pending.length > 0) {
    const prompt = buildInterpretPrompt(pending, promptAnchor)
    llmResult = await input.interpretTrace(prompt, input.llm, { maxTokens: input.maxTokens })
    if (!llmResult.ok) {
      const reason = llmResult.reason ?? 'unknown'
      await logGatewayEvent({
        eventKind: 'attention.rebuild.degraded',
        status: reason,
        topicId: goal.topic_id,
        payload: {
          goalId: goal.id,
          reason,
          incremental: !goalChanged && frozenMap.size > 0,
          pendingCount: pending.length,
          frozenCount: frozenMap.size,
          hasApiKey: !!input.llm.apiKey,
          hasBaseUrl: !!input.llm.baseUrl,
          hasModel: !!input.llm.model,
          sourceMessageCount,
          sourceLastEventTs,
          diagnostics: llmResult.diagnostics,
        },
      })
      const snapshot = await markAttentionGoalSnapshotDegraded({ id: goal.id, reason })
      return { ok: false, degraded: true, reason, snapshot: snapshot ?? goal }
    }
    if (!Array.isArray(llmResult.conclusion) || !Array.isArray(llmResult.goalAlignment)) {
      const snapshot = await markAttentionGoalSnapshotDegraded({ id: goal.id, reason: 'parse_error' })
      return { ok: false, degraded: true, reason: 'parse_error', snapshot: snapshot ?? goal }
    }
  }

  // R3：钉死根目标的归一化表达（目标未变则复用旧值，不让 LLM 每次重新措辞）。
  const { pinnedNormalizedGoal } = resolveGoalPinning({
    currentAnchor: goalAnchor,
    prevGoalJson: goal.goal_json,
    llmNormalizedGoal: llmResult?.normalizedGoal,
  })
  // 合并：冻结解释 + 新节点的 LLM 解释 → 全长平行数组（供结构层全量重跑）。
  const interpreted = mergeInterpret(candidates, frozenMap, pendingIdx, llmResult, pinnedNormalizedGoal)
  const semanticGoalAnchor: GoalAnchor = { ...goalAnchor, normalized_goal: pinnedNormalizedGoal }
  const traceNodes = buildTrace(candidates, semanticGoalAnchor, interpreted)
  if (!traceNodes.length || !hasValidNodes(traceNodes)) {
    const snapshot = await markAttentionGoalSnapshotDegraded({ id: goal.id, reason: 'empty_trace' })
    return { ok: false, degraded: true, reason: 'empty_trace', snapshot: snapshot ?? goal }
  }

  const mindProjection = buildMindMapProjection(traceNodes, semanticGoalAnchor, planItems)
  const aggregationResult = await resolveAggregationDecisions({
    projection: mindProjection,
    frozenStore: parseAggregationDecisionStore(goal.aggregation_decisions_json),
    llm: input.llm,
    decideAggregations: input.decideAggregations,
    maxTokens: Math.min(input.maxTokens ?? 1200, 1200),
  })
  if (aggregationResult.degradedReason) {
    await logGatewayEvent({
      eventKind: 'attention.aggregation.degraded',
      status: aggregationResult.degradedReason,
      topicId: goal.topic_id,
      payload: {
        goalId: goal.id,
        reason: aggregationResult.degradedReason,
      },
    })
  }
  const finalAggregationResult = aggregationResult.rejectedKeys.size > 0
    ? await resolveAggregationDecisions({
        projection: buildMindMapProjection(traceNodes, semanticGoalAnchor, planItems, new Set(), {
          blockedAggregationKeys: aggregationResult.rejectedKeys,
        }),
        frozenStore: aggregationResult.nextStore,
        llm: input.llm,
        decideAggregations: input.decideAggregations,
        maxTokens: Math.min(input.maxTokens ?? 1200, 1200),
      })
    : aggregationResult
  const finalProjection = finalAggregationResult.projection
  const snapshot = await upsertAttentionGoalSnapshot({
    id: goal.id,
    goalJson: JSON.stringify(semanticGoalAnchor),
    rawEventsJson: JSON.stringify(rawEvents),
    candidatesJson: JSON.stringify(candidates),
    interpretJson: JSON.stringify(interpreted),
    traceNodesJson: JSON.stringify(traceNodes),
    planItemsJson: JSON.stringify(planItems),
    mindProjectionJson: JSON.stringify(finalProjection),
    aggregationDecisionsJson: JSON.stringify(finalAggregationResult.nextStore),
    sourceMessageCount,
    sourceLastEventTs,
    degradedReason: null,
  })
  if (!snapshot) return { ok: false, reason: 'not_found' }
  return { ok: true, snapshot }
}
