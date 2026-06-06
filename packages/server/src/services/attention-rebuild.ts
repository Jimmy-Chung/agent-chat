import {
  aggregate,
  buildInterpretPrompt,
  buildMindMapProjection,
  buildTrace,
  extractGoalAnchor,
  storeToRawEvents,
  type AttentionInteraction,
  type AttentionInterpretResult,
  type GoalAnchor,
  type TraceNode,
} from '@agent-chat/protocol'
import type { AttentionLlmConfig, InterpretResult } from '../routes/attention'
import {
  getAttentionGoalSnapshot,
  markAttentionGoalSnapshotDegraded,
  upsertAttentionGoalSnapshot,
  type AttentionGoalSnapshot,
} from '../db/repos/attention_goal_snapshot.repo'
import { listInteractionsByTopic } from '../db/repos/interaction.repo'
import { listMessagesAndPartsByTopic } from '../db/repos/message.repo'
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
  maxTokens?: number
}): Promise<AttentionRebuildResult> {
  const goal = await getAttentionGoalSnapshot(input.goalId)
  if (!goal) return { ok: false, reason: 'not_found' }

  const { messages, partsByMessage } = await listMessagesAndPartsByTopic(goal.topic_id)
  const interactions = (await listInteractionsByTopic(goal.topic_id)).map(interactionToAttention)
  const rawEvents = storeToRawEvents({ messages, partsByMessage, interactions })
  const sourceMessageCount = messages.length
  const sourceLastEventTs = rawEvents.length > 0 ? rawEvents[rawEvents.length - 1].ts : 0
  const defaultGoalAnchor = extractGoalAnchor({ messages, partsByMessage })
  const goalAnchor = resolveGoalAnchor(goal, defaultGoalAnchor)
  const { candidates, planItems } = aggregate(rawEvents)

  if (!rawEvents.length || !candidates.length) {
    const snapshot = await markAttentionGoalSnapshotDegraded({ id: goal.id, reason: 'empty_source' })
    return { ok: false, degraded: true, reason: 'empty_source', snapshot: snapshot ?? goal }
  }

  const prompt = buildInterpretPrompt(candidates, goalAnchor)
  const interpreted = await input.interpretTrace(prompt, input.llm, { maxTokens: input.maxTokens })
  if (!interpreted.ok) {
    const reason = interpreted.reason ?? 'unknown'
    await logGatewayEvent({
      eventKind: 'attention.rebuild.degraded',
      status: reason,
      topicId: goal.topic_id,
      payload: {
        goalId: goal.id,
        reason,
        hasApiKey: !!input.llm.apiKey,
        hasBaseUrl: !!input.llm.baseUrl,
        hasModel: !!input.llm.model,
        sourceMessageCount,
        sourceLastEventTs,
      },
    })
    const snapshot = await markAttentionGoalSnapshotDegraded({ id: goal.id, reason })
    return { ok: false, degraded: true, reason, snapshot: snapshot ?? goal }
  }
  if (!Array.isArray(interpreted.conclusion) || !Array.isArray(interpreted.goalAlignment)) {
    const snapshot = await markAttentionGoalSnapshotDegraded({ id: goal.id, reason: 'parse_error' })
    return { ok: false, degraded: true, reason: 'parse_error', snapshot: snapshot ?? goal }
  }

  const normalizedGoal = interpreted.normalizedGoal?.trim()
  const semanticGoalAnchor = normalizedGoal
    ? { ...goalAnchor, normalized_goal: normalizedGoal }
    : goalAnchor
  const traceNodes = buildTrace(candidates, semanticGoalAnchor, interpreted as AttentionInterpretResult)
  if (!traceNodes.length || !hasValidNodes(traceNodes)) {
    const snapshot = await markAttentionGoalSnapshotDegraded({ id: goal.id, reason: 'empty_trace' })
    return { ok: false, degraded: true, reason: 'empty_trace', snapshot: snapshot ?? goal }
  }

  const mindProjection = buildMindMapProjection(traceNodes, semanticGoalAnchor, planItems)
  const snapshot = await upsertAttentionGoalSnapshot({
    id: goal.id,
    goalJson: JSON.stringify(semanticGoalAnchor),
    rawEventsJson: JSON.stringify(rawEvents),
    candidatesJson: JSON.stringify(candidates),
    interpretJson: JSON.stringify(interpreted),
    traceNodesJson: JSON.stringify(traceNodes),
    planItemsJson: JSON.stringify(planItems),
    mindProjectionJson: JSON.stringify(mindProjection),
    sourceMessageCount,
    sourceLastEventTs,
    degradedReason: null,
  })
  if (!snapshot) return { ok: false, reason: 'not_found' }
  return { ok: true, snapshot }
}
