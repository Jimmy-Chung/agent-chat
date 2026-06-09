import {
  aggregate,
  buildInterpretPrompt,
  buildMindMapProjection,
  buildTrace,
  extractGoalAnchor,
  storeToRawEvents,
  type AttentionInteraction,
  type GoalAnchor,
  type RawEvent,
  type TraceNode,
  type AttentionInterpretResult,
  type CandidateNode,
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

const MAX_INCREMENTAL_CANDIDATES_PER_REBUILD = 4

function safeParseArray<T>(json: string | null | undefined): T[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function safeParseRecord<T extends object>(json: string | null | undefined): Partial<T> {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Partial<T> : {}
  } catch {
    return {}
  }
}

function hasUsableSnapshot(goal: AttentionGoalSnapshot, nodes: TraceNode[]): boolean {
  return goal.source_message_count > 0 && goal.source_last_event_ts > 0 && hasValidNodes(nodes)
}

function currentGoalChanged(goal: AttentionGoalSnapshot, goalAnchor: GoalAnchor): boolean {
  if (!goal.goal_json) return true
  try {
    const previous = JSON.parse(goal.goal_json) as GoalAnchor
    return (previous.raw_query?.trim() ?? '') !== goalAnchor.raw_query.trim()
  } catch {
    return true
  }
}

function previousGoalAnchor(goal: AttentionGoalSnapshot): GoalAnchor | null {
  if (!goal.goal_json) return null
  try {
    return JSON.parse(goal.goal_json) as GoalAnchor
  } catch {
    return null
  }
}

function stableCandidateId(candidate: CandidateNode, index: number, existingIds: Set<string>): string {
  const source = candidate.source_message_ids[0]?.replace(/[^a-zA-Z0-9_-]/g, '_')
  let id = source ? `attn_${source}` : `attn_delta_${index + 1}`
  let suffix = 2
  while (existingIds.has(id)) {
    id = `${id}_${suffix}`
    suffix += 1
  }
  existingIds.add(id)
  return id
}

function stabilizeDeltaCandidates(candidates: CandidateNode[], existingNodes: TraceNode[]): CandidateNode[] {
  const existingIds = new Set(existingNodes.map((node) => node.id))
  return candidates.map((candidate, index) => ({
    ...candidate,
    id: stableCandidateId(candidate, index, existingIds),
  }))
}

function appendInterpretJson(
  previousJson: string,
  previousNodes: TraceNode[],
  delta: AttentionInterpretResult,
): string {
  const previous = safeParseRecord<AttentionInterpretResult>(previousJson)
  const baseConclusion = Array.isArray(previous.conclusion)
    ? previous.conclusion
    : previousNodes.map((node) => node.conclusion ?? node.assistant_summary ?? '')
  const baseGoalAlignment = Array.isArray(previous.goalAlignment)
    ? previous.goalAlignment
    : previousNodes.map((node) => Math.round((1 - node.goal_distance) * 10))
  const append = <T>(existing: unknown, fallback: T[], incoming: T[] | undefined): T[] => [
    ...(Array.isArray(existing) ? existing as T[] : fallback),
    ...(incoming ?? []),
  ]
  return JSON.stringify({
    conclusion: [...baseConclusion, ...delta.conclusion],
    goalAlignment: [...baseGoalAlignment, ...delta.goalAlignment],
    userSummary: append(previous.userSummary, previousNodes.map((node) => node.user_summary ?? node.user_message), delta.userSummary),
    assistantSummary: append(previous.assistantSummary, previousNodes.map((node) => node.assistant_summary ?? node.conclusion ?? ''), delta.assistantSummary),
    aggregateTitle: append(previous.aggregateTitle, previousNodes.map((node) => node.aggregate_title ?? node.user_message), delta.aggregateTitle),
    sameTopic: append(previous.sameTopic, previousNodes.map((node) => node.same_topic ?? true), delta.sameTopic),
    closeCurrentTopic: append(previous.closeCurrentTopic, previousNodes.map((node) => node.close_current_topic ?? false), delta.closeCurrentTopic),
    nodeReason: append(previous.nodeReason, previousNodes.map((node) => node.rationale ?? ''), delta.nodeReason),
    normalizedGoal: delta.normalizedGoal,
  })
}

function messageEventTs(message: { started_at: number; finished_at?: number | null }): number {
  return message.finished_at ?? message.started_at
}

function countMessagesThroughTs(messages: Array<{ started_at: number; finished_at?: number | null }>, ts: number): number {
  return messages.filter((message) => messageEventTs(message) <= ts).length
}

function countMessagesCoveredByEvents(messages: Array<{ id?: string }>, events: RawEvent[]): number {
  const messageIds = new Set(events.map((event) => event.message_id).filter((id): id is string => !!id))
  return messages.filter((message) => !!message.id && messageIds.has(message.id)).length
}

function rawEventIds(events: RawEvent[]): Set<string> {
  return new Set(events.map((event) => event.id).filter(Boolean))
}

function eventBelongsToCandidate(event: RawEvent, candidate: CandidateNode): boolean {
  if (event.message_id && candidate.source_message_ids.includes(event.message_id)) return true
  const eventIds = [
    ...candidate.thinking.map((item) => item.id),
    ...candidate.tools.map((item) => item.id),
    ...candidate.messages.map((item) => item.id),
  ]
  return eventIds.includes(event.id)
}

function processedEventsThroughCandidates(rawEvents: RawEvent[], candidates: CandidateNode[]): RawEvent[] {
  let lastIndex = -1
  for (const candidate of candidates) {
    rawEvents.forEach((event, index) => {
      if (eventBelongsToCandidate(event, candidate)) lastIndex = Math.max(lastIndex, index)
    })
  }
  return lastIndex >= 0 ? rawEvents.slice(0, lastIndex + 1) : []
}

async function rebuildIncrementalAttentionGoalSnapshot(input: {
  goal: AttentionGoalSnapshot
  rawEvents: RawEvent[]
  sourceMessageCount: number
  sourceLastEventTs: number
  messages: Array<{ id: string; started_at: number; finished_at?: number | null }>
  previousRawEvents: RawEvent[]
  goalAnchor: GoalAnchor
  llm: AttentionLlmConfig
  interpretTrace: InterpretTraceFn
  decideAggregations: DecideAggregationsFn
  maxTokens?: number
  previousNodes: TraceNode[]
}): Promise<AttentionRebuildResult> {
  const previousEventIds = rawEventIds(input.previousRawEvents)
  const deltaEvents = previousEventIds.size
    ? input.rawEvents.filter((event) => !previousEventIds.has(event.id))
    : input.rawEvents.filter((event) => event.ts > input.goal.source_last_event_ts)
  if (!deltaEvents.length) {
    const currentPlanItems = aggregate(input.rawEvents).planItems
    const mindProjection = buildMindMapProjection(input.previousNodes, input.goalAnchor, currentPlanItems)
    const snapshot = await upsertAttentionGoalSnapshot({
      id: input.goal.id,
      goalJson: JSON.stringify(input.goalAnchor),
      rawEventsJson: JSON.stringify(input.rawEvents),
      candidatesJson: input.goal.candidates_json,
      interpretJson: input.goal.interpret_json,
      traceNodesJson: JSON.stringify(input.previousNodes),
      planItemsJson: JSON.stringify(currentPlanItems),
      mindProjectionJson: JSON.stringify(mindProjection),
      aggregationDecisionsJson: input.goal.aggregation_decisions_json,
      sourceMessageCount: input.sourceMessageCount,
      sourceLastEventTs: input.sourceLastEventTs,
      degradedReason: null,
    })
    return snapshot ? { ok: true, snapshot } : { ok: false, reason: 'not_found' }
  }

  const deltaAggregate = aggregate(deltaEvents)
  const deltaCandidates = stabilizeDeltaCandidates(
    deltaAggregate.candidates
      .filter((candidate) => candidate.source_message_ids.length > 0)
      .slice(0, MAX_INCREMENTAL_CANDIDATES_PER_REBUILD),
    input.previousNodes,
  )
  if (!deltaCandidates.length) {
    const nextWatermark = deltaEvents[deltaEvents.length - 1]?.ts ?? input.goal.source_last_event_ts
    const processedRawEvents = input.rawEvents.filter((event) => event.ts <= nextWatermark)
    const currentPlanItems = aggregate(processedRawEvents).planItems
    const mindProjection = buildMindMapProjection(input.previousNodes, input.goalAnchor, currentPlanItems)
    const snapshot = await upsertAttentionGoalSnapshot({
      id: input.goal.id,
      goalJson: JSON.stringify(input.goalAnchor),
      rawEventsJson: JSON.stringify(processedRawEvents),
      candidatesJson: input.goal.candidates_json,
      interpretJson: input.goal.interpret_json,
      traceNodesJson: JSON.stringify(input.previousNodes),
      planItemsJson: JSON.stringify(currentPlanItems),
      mindProjectionJson: JSON.stringify(mindProjection),
      aggregationDecisionsJson: input.goal.aggregation_decisions_json,
      sourceMessageCount: countMessagesThroughTs(input.messages, nextWatermark),
      sourceLastEventTs: nextWatermark,
      degradedReason: null,
    })
    return snapshot ? { ok: true, snapshot } : { ok: false, reason: 'not_found' }
  }

  const prompt = buildInterpretPrompt(deltaCandidates, input.goalAnchor)
  const llmResult = await input.interpretTrace(prompt, input.llm, { maxTokens: input.maxTokens })
  if (!llmResult.ok || !Array.isArray(llmResult.conclusion) || !Array.isArray(llmResult.goalAlignment)) {
    const reason = llmResult.reason ?? 'unknown'
    await logGatewayEvent({
      eventKind: 'attention.rebuild.degraded',
      status: reason,
      topicId: input.goal.topic_id,
      payload: {
        goalId: input.goal.id,
        reason,
        incremental: true,
        pendingCount: deltaCandidates.length,
        frozenCount: input.previousNodes.length,
        hasApiKey: !!input.llm.apiKey,
        hasBaseUrl: !!input.llm.baseUrl,
        hasModel: !!input.llm.model,
        sourceMessageCount: input.sourceMessageCount,
        sourceLastEventTs: input.sourceLastEventTs,
        diagnostics: llmResult.diagnostics,
      },
    })
    const snapshot = await markAttentionGoalSnapshotDegraded({ id: input.goal.id, reason })
    return { ok: false, degraded: true, reason, snapshot: snapshot ?? input.goal }
  }

  const pinnedNormalizedGoal = previousGoalAnchor(input.goal)?.normalized_goal?.trim() || input.goalAnchor.normalized_goal
  const semanticGoalAnchor: GoalAnchor = { ...input.goalAnchor, normalized_goal: pinnedNormalizedGoal }
  const deltaInterpreted = mergeInterpret(deltaCandidates, new Map(), deltaCandidates.map((_, index) => index), llmResult, semanticGoalAnchor.normalized_goal)
  const deltaTraceNodes = buildTrace(deltaCandidates, semanticGoalAnchor, deltaInterpreted)
  if (!deltaTraceNodes.length || !hasValidNodes(deltaTraceNodes)) {
    const snapshot = await markAttentionGoalSnapshotDegraded({ id: input.goal.id, reason: 'empty_trace' })
    return { ok: false, degraded: true, reason: 'empty_trace', snapshot: snapshot ?? input.goal }
  }

  const combinedTraceNodes = [...input.previousNodes, ...deltaTraceNodes]
  const processedDeltaEvents = processedEventsThroughCandidates(deltaEvents, deltaCandidates)
  const processedEventIds = new Set([
    ...previousEventIds,
    ...processedDeltaEvents.map((event) => event.id),
  ])
  const processedRawEvents = input.rawEvents.filter((event) => processedEventIds.has(event.id))
  const nextWatermark = processedRawEvents[processedRawEvents.length - 1]?.ts
    ?? Math.max(...deltaTraceNodes.map((node) => node.ts_end ?? node.ts_start ?? 0))
  const currentPlanItems = aggregate(processedRawEvents).planItems
  const previousCandidates = safeParseArray<CandidateNode>(input.goal.candidates_json)
  const combinedCandidates = [...previousCandidates, ...deltaCandidates]
  const mindProjection = buildMindMapProjection(combinedTraceNodes, semanticGoalAnchor, currentPlanItems)
  const deltaNodeIds = new Set(deltaTraceNodes.map((node) => node.id))
  const aggregationResult = await resolveAggregationDecisions({
    projection: mindProjection,
    frozenStore: parseAggregationDecisionStore(input.goal.aggregation_decisions_json),
    llm: input.llm,
    decideAggregations: input.decideAggregations,
    maxTokens: Math.min(input.maxTokens ?? 1200, 1200),
    reviewSourceNodeIds: deltaNodeIds,
  })
  if (aggregationResult.degradedReason) {
    await logGatewayEvent({
      eventKind: 'attention.aggregation.degraded',
      status: aggregationResult.degradedReason,
      topicId: input.goal.topic_id,
      payload: {
        goalId: input.goal.id,
        reason: aggregationResult.degradedReason,
        incremental: true,
      },
    })
  }
  const finalProjection = aggregationResult.projection
  const snapshot = await upsertAttentionGoalSnapshot({
    id: input.goal.id,
    goalJson: JSON.stringify(semanticGoalAnchor),
    rawEventsJson: JSON.stringify(processedRawEvents),
    candidatesJson: JSON.stringify(combinedCandidates),
    interpretJson: appendInterpretJson(input.goal.interpret_json, input.previousNodes, deltaInterpreted),
    traceNodesJson: JSON.stringify(combinedTraceNodes),
    planItemsJson: JSON.stringify(currentPlanItems),
    mindProjectionJson: JSON.stringify(finalProjection),
    aggregationDecisionsJson: JSON.stringify(aggregationResult.nextStore),
    sourceMessageCount: countMessagesCoveredByEvents(input.messages, processedRawEvents),
    sourceLastEventTs: nextWatermark,
    degradedReason: null,
  })
  if (!snapshot) return { ok: false, reason: 'not_found' }
  return { ok: true, snapshot }
}

export async function rebuildAttentionGoalSnapshot(input: {
  goalId: string
  llm: AttentionLlmConfig
  interpretTrace: InterpretTraceFn
  decideAggregations: DecideAggregationsFn
  maxTokens?: number
  mode?: 'incremental' | 'full'
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
  const previousNodes = safeParseArray<TraceNode>(goal.trace_nodes_json)
  const previousRawEvents = safeParseArray<RawEvent>(goal.raw_events_json)
  const previousRawEventIds = rawEventIds(previousRawEvents)
  const hasUnseenRawEvents = previousRawEventIds.size > 0 && rawEvents.some((event) => !previousRawEventIds.has(event.id))
  if (
    input.mode !== 'full' &&
    hasUsableSnapshot(goal, previousNodes) &&
    !currentGoalChanged(goal, goalAnchor) &&
    (
      sourceLastEventTs > goal.source_last_event_ts ||
      sourceMessageCount > goal.source_message_count ||
      hasUnseenRawEvents
    )
  ) {
    return rebuildIncrementalAttentionGoalSnapshot({
      goal,
      rawEvents,
      sourceMessageCount,
      sourceLastEventTs,
      messages,
      previousRawEvents,
      goalAnchor,
      llm: input.llm,
      interpretTrace: input.interpretTrace,
      decideAggregations: input.decideAggregations,
      maxTokens: input.maxTokens,
      previousNodes,
    })
  }

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
  const frozenMap = goalChanged || input.mode === 'full'
    ? new Map<string, FrozenInterp>()
    : buildFrozenInterpMap(goal.candidates_json, goal.interpret_json)
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
