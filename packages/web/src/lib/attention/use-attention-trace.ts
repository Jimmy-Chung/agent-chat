// S3 (AIT-221) React hook：把实时骨架（S1）与 LLM 语义（S2）连起来。
// AIT-226：Attention 面板不再使用本地语义兜底；LLM 不可用时不返回推断节点。
// AIT-231：Attention 图按目标历史持久化，同一目标切回时基于当前完整会话重绘并覆盖快照。
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Message, MessagePart } from '@agent-chat/protocol'
import { useMessageStore } from '@/stores/message-store'
import { getServerBase } from '@/lib/server-url'
import { aggregate, type CandidateNode } from './aggregator'
import { storeToRawEvents, extractGoalAnchor, type TodoSnapshotItem } from './store-adapter'
import {
  planInterpret,
  makeInterpretKey,
  buildTrace,
  buildInterpretPrompt,
  callInterpret,
  type InterpretResult,
} from './orchestrator'
import type { GoalAnchor, PlanItem, RawEvent, TraceNode } from './types'

export interface AttentionGoalMeta {
  id: string
  topic_id: string
  goal_text: string
  title: string | null
  is_default: boolean
  active: boolean
  source_message_count: number
  source_last_event_ts: number
  created_at: number
  updated_at: number
  has_snapshot: boolean
}

export interface AttentionTrace {
  nodes: TraceNode[]
  goalAnchor: GoalAnchor | null
  planItems: PlanItem[]
  rawEvents: RawEvent[]
  isAnalyzing: boolean
  llmUnavailable: boolean
  goals: AttentionGoalMeta[]
  activeGoal: AttentionGoalMeta | null
  activeGoalId: string | null
  goalDraft: string
  setGoalDraft: (value: string) => void
  createGoal: (goalText?: string) => Promise<void>
  selectGoal: (goalId: string) => Promise<void>
  renameGoal: (goalId: string, title: string) => Promise<void>
  reloadGoals: () => Promise<void>
}

const EMPTY_MESSAGES: never[] = []
const STALE_PENDING_USER_MESSAGE_MS = 2 * 60 * 1000

export function hasActiveAttentionMessage(messages: Message[], now = Date.now()): boolean {
  return messages.some((message) => {
    if (message.status === 'streaming' || message.status === 'retrying') return true
    if (message.role !== 'user' || message.status !== 'pending') return false
    return now - message.started_at < STALE_PENDING_USER_MESSAGE_MS
  })
}

export function resolveGoalAnchor(input: {
  explicitTarget: string | null | undefined
  explicitUpdatedAt: number | null | undefined
  messages: Message[]
  partsByMessage: Record<string, MessagePart[]>
}): GoalAnchor | null {
  const explicit = input.explicitTarget?.trim()
  if (explicit) {
    return {
      raw_query: explicit,
      normalized_goal: explicit,
      ts: input.explicitUpdatedAt ?? 0,
    }
  }
  return extractGoalAnchor({ messages: input.messages, partsByMessage: input.partsByMessage })
}

interface PersistedAttentionGoalSnapshot extends AttentionGoalMeta {
  goal_json: string | null
  raw_events_json: string
  candidates_json: string
  interpret_json: string
  trace_nodes_json: string
  plan_items_json: string
}

interface LoadedSnapshot {
  meta: AttentionGoalMeta
  nodes: TraceNode[]
  goalAnchor: GoalAnchor | null
  planItems: PlanItem[]
  rawEvents: RawEvent[]
  interpret: InterpretResult
}

function safeParse<T>(json: string | null | undefined): T | null {
  if (!json) return null
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

function getToken(): string | undefined {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('AGENT_CHAT_TOKEN') || undefined : undefined
}

function authHeaders(token?: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function goalTitle(goal: AttentionGoalMeta): string {
  return goal.title?.trim() || (goal.is_default ? '默认目标' : goal.goal_text)
}

function toLoadedSnapshot(snapshot: PersistedAttentionGoalSnapshot): LoadedSnapshot | null {
  const nodes = safeParse<TraceNode[]>(snapshot.trace_nodes_json)
  const goalAnchor = snapshot.goal_json ? safeParse<GoalAnchor | null>(snapshot.goal_json) : null
  const planItems = safeParse<PlanItem[]>(snapshot.plan_items_json)
  const rawEvents = safeParse<RawEvent[]>(snapshot.raw_events_json)
  const interpret = safeParse<InterpretResult>(snapshot.interpret_json)
  if (!nodes || !planItems || !rawEvents || !interpret) return null
  return { meta: snapshot, nodes, goalAnchor, planItems, rawEvents, interpret }
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(8_000) })
  if (!res.ok) return null
  return res.json() as Promise<T>
}

async function listAttentionGoals(input: { topicId: string; serverBase: string; token?: string }): Promise<AttentionGoalMeta[]> {
  const body = await requestJson<{ goals?: AttentionGoalMeta[] }>(
    `${input.serverBase}/api/agent-chat/v1/attention/goals/${input.topicId}`,
    { headers: authHeaders(input.token) },
  )
  return Array.isArray(body?.goals) ? body.goals : []
}

async function ensureDefaultGoal(input: {
  topicId: string
  goalText: string
  serverBase: string
  token?: string
}): Promise<AttentionGoalMeta | null> {
  const body = await requestJson<{ goal?: AttentionGoalMeta }>(
    `${input.serverBase}/api/agent-chat/v1/attention/goals/${input.topicId}/default`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(input.token) },
      body: JSON.stringify({ goalText: input.goalText, title: '默认目标' }),
    },
  )
  return body?.goal ?? null
}

async function createAttentionGoal(input: {
  topicId: string
  goalText: string
  serverBase: string
  token?: string
}): Promise<AttentionGoalMeta | null> {
  const body = await requestJson<{ goal?: AttentionGoalMeta }>(
    `${input.serverBase}/api/agent-chat/v1/attention/goals/${input.topicId}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(input.token) },
      body: JSON.stringify({ goalText: input.goalText, title: input.goalText }),
    },
  )
  return body?.goal ?? null
}

async function activateAttentionGoal(input: {
  goalId: string
  serverBase: string
  token?: string
}): Promise<AttentionGoalMeta | null> {
  const body = await requestJson<{ goal?: AttentionGoalMeta }>(
    `${input.serverBase}/api/agent-chat/v1/attention/goals/${input.goalId}/activate`,
    { method: 'POST', headers: authHeaders(input.token) },
  )
  return body?.goal ?? null
}

async function renameAttentionGoal(input: {
  goalId: string
  title: string
  serverBase: string
  token?: string
}): Promise<AttentionGoalMeta | null> {
  const body = await requestJson<{ goal?: AttentionGoalMeta }>(
    `${input.serverBase}/api/agent-chat/v1/attention/goals/${input.goalId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeaders(input.token) },
      body: JSON.stringify({ title: input.title }),
    },
  )
  return body?.goal ?? null
}

async function loadGoalSnapshot(input: {
  goalId: string
  serverBase: string
  token?: string
}): Promise<LoadedSnapshot | null> {
  const body = await requestJson<{ snapshot?: PersistedAttentionGoalSnapshot }>(
    `${input.serverBase}/api/agent-chat/v1/attention/goals/${input.goalId}/snapshot`,
    { headers: authHeaders(input.token) },
  )
  return body?.snapshot ? toLoadedSnapshot(body.snapshot) : null
}

async function saveGoalSnapshot(input: {
  goalId: string
  serverBase: string
  token?: string
  goalAnchor: GoalAnchor | null
  rawEvents: RawEvent[]
  candidates: CandidateNode[]
  interpret: InterpretResult
  nodes: TraceNode[]
  planItems: PlanItem[]
  sourceMessageCount: number
  sourceLastEventTs: number
}): Promise<void> {
  await fetch(`${input.serverBase}/api/agent-chat/v1/attention/goals/${input.goalId}/snapshot`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...authHeaders(input.token),
    },
    body: JSON.stringify({
      goalJson: JSON.stringify(input.goalAnchor),
      rawEventsJson: JSON.stringify(input.rawEvents),
      candidatesJson: JSON.stringify(input.candidates),
      interpretJson: JSON.stringify(input.interpret),
      traceNodesJson: JSON.stringify(input.nodes),
      planItemsJson: JSON.stringify(input.planItems),
      sourceMessageCount: input.sourceMessageCount,
      sourceLastEventTs: input.sourceLastEventTs,
    }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined)
}

export function useAttentionTrace(topicId: string): AttentionTrace {
  const messages = useMessageStore((s) => s.byTopic[topicId] ?? EMPTY_MESSAGES)
  const partsByMessage = useMessageStore((s) => s.partsByMessage)
  const todos = useMessageStore((s) => s.todosByTopic[topicId]) as TodoSnapshotItem[] | undefined
  const plan = useMessageStore((s) => s.planByTopic[topicId])
  const agentStatus = useMessageStore((s) => s.agentStatusByTopic[topicId] ?? 'idle')
  const interactionsById = useMessageStore((s) => s.interactions)
  const interactions = useMemo(
    () => Object.values(interactionsById).filter((interaction) => interaction.topicId === topicId),
    [interactionsById, topicId],
  )

  const rawEvents = useMemo(
    () => storeToRawEvents({ messages, partsByMessage, interactions, todos, plan }),
    [messages, partsByMessage, interactions, todos, plan],
  )
  const hasLiveMessages = useMemo(() => hasActiveAttentionMessage(messages), [messages])
  const aggregated = useMemo(() => aggregate(rawEvents), [rawEvents])
  const candidates = aggregated.candidates
  const livePlanItems = aggregated.planItems
  const defaultGoalAnchor = useMemo(
    () => resolveGoalAnchor({ explicitTarget: null, explicitUpdatedAt: null, messages, partsByMessage }),
    [messages, partsByMessage],
  )
  const defaultGoalText = defaultGoalAnchor?.normalized_goal?.trim() || defaultGoalAnchor?.raw_query?.trim() || ''
  const lastEventTs = rawEvents.length > 0 ? rawEvents[rawEvents.length - 1].ts : 0

  const [goals, setGoals] = useState<AttentionGoalMeta[]>([])
  const [activeGoalId, setActiveGoalId] = useState<string | null>(null)
  const [goalDraft, setGoalDraft] = useState('')
  const [interpret, setInterpret] = useState<{ key: string; result: InterpretResult } | null>(null)
  const [snapshot, setSnapshot] = useState<LoadedSnapshot | null>(null)
  const [llmUnavailable, setLlmUnavailable] = useState(false)
  const lastKeyRef = useRef<string | null>(null)
  const forceRedrawRef = useRef(false)

  const reloadGoals = useCallback(async () => {
    const serverBase = getServerBase()
    const token = getToken()
    const loaded = await listAttentionGoals({ topicId, serverBase, token })
    setGoals(loaded)
    const active = loaded.find((goal) => goal.active) ?? loaded[0] ?? null
    setActiveGoalId((prev) => (prev && loaded.some((goal) => goal.id === prev) ? prev : active?.id ?? null))
  }, [topicId])

  useEffect(() => {
    let cancelled = false
    const serverBase = getServerBase()
    const token = getToken()
    listAttentionGoals({ topicId, serverBase, token }).then(async (loaded) => {
      if (cancelled) return
      let nextGoals = loaded
      if (!nextGoals.some((goal) => goal.is_default) && defaultGoalText) {
        const defaultGoal = await ensureDefaultGoal({ topicId, goalText: defaultGoalText, serverBase, token })
        if (cancelled) return
        if (defaultGoal) nextGoals = await listAttentionGoals({ topicId, serverBase, token })
      }
      setGoals(nextGoals)
      const active = nextGoals.find((goal) => goal.active) ?? nextGoals[0] ?? null
      setActiveGoalId(active?.id ?? null)
      if (active) setGoalDraft(active.goal_text)
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [defaultGoalText, topicId])

  const activeGoal = useMemo(
    () => goals.find((goal) => goal.id === activeGoalId) ?? null,
    [activeGoalId, goals],
  )
  const goalText = activeGoal?.goal_text?.trim() || defaultGoalText
  const goalAnchor = useMemo<GoalAnchor | null>(() => {
    if (!goalText) return null
    return { raw_query: goalText, normalized_goal: goalText, ts: activeGoal?.created_at ?? defaultGoalAnchor?.ts ?? 0 }
  }, [activeGoal?.created_at, defaultGoalAnchor?.ts, goalText])
  const goalKey = activeGoal?.id ?? goalAnchor?.normalized_goal ?? ''

  useEffect(() => {
    if (activeGoal) setGoalDraft(activeGoal.goal_text)
  }, [activeGoal?.id, activeGoal?.goal_text])

  useEffect(() => {
    if (!activeGoalId) {
      setSnapshot(null)
      return
    }
    let cancelled = false
    loadGoalSnapshot({ goalId: activeGoalId, serverBase: getServerBase(), token: getToken() }).then((loaded) => {
      if (cancelled) return
      setSnapshot(loaded)
      setInterpret(null)
      const forced = forceRedrawRef.current
      forceRedrawRef.current = false
      const snapshotIsCurrent =
        !!loaded &&
        loaded.meta.source_message_count === messages.length &&
        loaded.meta.source_last_event_ts === lastEventTs
      lastKeyRef.current = !forced && snapshotIsCurrent
        ? makeInterpretKey(candidates.length, lastEventTs, goalKey)
        : null
    }).catch(() => {
      if (!cancelled) setSnapshot(null)
    })
    return () => {
      cancelled = true
    }
  }, [activeGoalId, candidates.length, goalKey, lastEventTs, messages.length])

  useEffect(() => {
    if (!activeGoalId) return
    const { shouldCall, cacheKey } = planInterpret({
      candidateCount: candidates.length,
      lastEventTs,
      goalKey,
      agentStatus: hasLiveMessages ? agentStatus : 'idle',
      lastInterpretedKey: forceRedrawRef.current ? null : lastKeyRef.current,
    })
    if (!shouldCall) return
    lastKeyRef.current = cacheKey
    forceRedrawRef.current = false
    setLlmUnavailable(false)
    let cancelled = false
    const prompt = buildInterpretPrompt(candidates, goalAnchor)
    const token = getToken()
    const serverBase = getServerBase()
    callInterpret(prompt, { serverBase, token }).then((result) => {
      if (cancelled) return
      if (result) {
        setInterpret({ key: cacheKey, result })
        setLlmUnavailable(false)
        return
      }
      setInterpret(null)
      setLlmUnavailable(true)
    })
    return () => {
      cancelled = true
    }
  }, [activeGoalId, candidates, lastEventTs, agentStatus, goalAnchor, hasLiveMessages, goalKey])

  const inProgress = hasLiveMessages && agentStatus !== 'idle'
  const currentKey = makeInterpretKey(candidates.length, lastEventTs, goalKey)
  const semanticGoalAnchor = useMemo<GoalAnchor | null>(() => {
    const normalized = interpret?.key === currentKey ? interpret.result.normalizedGoal?.trim() : ''
    if (!normalized) return goalAnchor
    return { raw_query: goalAnchor?.raw_query ?? normalized, normalized_goal: normalized, ts: goalAnchor?.ts ?? 0 }
  }, [currentKey, goalAnchor, interpret])
  const liveNodes = useMemo(
    () => interpret?.key === currentKey
      ? buildTrace(candidates, semanticGoalAnchor, interpret.result, { inProgress })
      : [],
    [candidates, currentKey, semanticGoalAnchor, interpret, inProgress],
  )
  const useSnapshot = !!snapshot && snapshot.meta.id === activeGoalId && (!interpret || interpret.key !== currentKey)
  const nodes = useSnapshot ? snapshot.nodes : liveNodes
  const displayGoalAnchor = useSnapshot ? snapshot.goalAnchor : semanticGoalAnchor
  const displayPlanItems = useSnapshot ? snapshot.planItems : livePlanItems
  const displayRawEvents = useSnapshot ? snapshot.rawEvents : rawEvents

  useEffect(() => {
    if (!activeGoalId || !interpret || interpret.key !== currentKey || !liveNodes.length) return
    const token = getToken()
    const serverBase = getServerBase()
    void saveGoalSnapshot({
      goalId: activeGoalId,
      serverBase,
      token,
      goalAnchor: semanticGoalAnchor,
      rawEvents,
      candidates,
      interpret: interpret.result,
      nodes: liveNodes,
      planItems: livePlanItems,
      sourceMessageCount: messages.length,
      sourceLastEventTs: lastEventTs,
    }).then(() => {
      void reloadGoals()
    })
  }, [activeGoalId, candidates, currentKey, interpret, lastEventTs, liveNodes, livePlanItems, messages.length, rawEvents, reloadGoals, semanticGoalAnchor])

  const createGoal = useCallback(async (goalTextInput?: string) => {
    const next = (goalTextInput ?? goalDraft).trim()
    if (!next) return
    const created = await createAttentionGoal({ topicId, goalText: next, serverBase: getServerBase(), token: getToken() })
    if (!created) return
    forceRedrawRef.current = true
    setGoals((prev) => [created, ...prev.map((goal) => ({ ...goal, active: false }))])
    setActiveGoalId(created.id)
    setGoalDraft(created.goal_text)
  }, [goalDraft, topicId])

  const selectGoal = useCallback(async (goalId: string) => {
    const activated = await activateAttentionGoal({ goalId, serverBase: getServerBase(), token: getToken() })
    if (!activated) return
    forceRedrawRef.current = true
    setGoals((prev) => prev.map((goal) => ({ ...goal, active: goal.id === goalId })))
    setActiveGoalId(goalId)
    setGoalDraft(activated.goal_text)
  }, [])

  const renameGoal = useCallback(async (goalId: string, title: string) => {
    const renamed = await renameAttentionGoal({ goalId, title, serverBase: getServerBase(), token: getToken() })
    if (!renamed) return
    setGoals((prev) => prev.map((goal) => (goal.id === goalId ? { ...goal, title: renamed.title, updated_at: renamed.updated_at } : goal)))
  }, [])

  return {
    nodes,
    goalAnchor: displayGoalAnchor,
    planItems: displayPlanItems,
    rawEvents: displayRawEvents,
    isAnalyzing: inProgress || (!!activeGoalId && !!lastKeyRef.current && !nodes.length && !llmUnavailable),
    llmUnavailable,
    goals,
    activeGoal,
    activeGoalId,
    goalDraft,
    setGoalDraft,
    createGoal,
    selectGoal,
    renameGoal,
    reloadGoals,
  }
}

export { goalTitle as attentionGoalTitle }
