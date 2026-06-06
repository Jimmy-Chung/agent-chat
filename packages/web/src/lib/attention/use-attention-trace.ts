// Attention 面板数据流：server 负责节点生成/治理/落库；前端只触发重绘并渲染快照。
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Message, MessagePart } from '@agent-chat/protocol'
import { extractGoalAnchor } from '@agent-chat/protocol'
import { useMessageStore } from '@/stores/message-store'
import { getServerBase } from '@/lib/server-url'
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

export function hasActiveAttentionMessage(messages: { role: string; status: string; started_at: number }[], now = Date.now()): boolean {
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
  mind_projection_json?: string | null
  degraded_reason?: string | null
}

interface LoadedSnapshot {
  meta: PersistedAttentionGoalSnapshot
  nodes: TraceNode[]
  goalAnchor: GoalAnchor | null
  planItems: PlanItem[]
  rawEvents: RawEvent[]
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
  if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return undefined
  return localStorage.getItem('AGENT_CHAT_TOKEN') || undefined
}

function authHeaders(token?: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function goalTitle(goal: AttentionGoalMeta): string {
  return goal.title?.trim() || (goal.is_default ? '默认目标' : goal.goal_text)
}

export function toLoadedSnapshot(snapshot: PersistedAttentionGoalSnapshot): LoadedSnapshot | null {
  if (!snapshot.has_snapshot || snapshot.source_message_count <= 0 || snapshot.source_last_event_ts <= 0) return null
  const nodes = safeParse<TraceNode[]>(snapshot.trace_nodes_json)
  const goalAnchor = snapshot.goal_json ? safeParse<GoalAnchor | null>(snapshot.goal_json) : null
  const planItems = safeParse<PlanItem[]>(snapshot.plan_items_json)
  const rawEvents = safeParse<RawEvent[]>(snapshot.raw_events_json)
  if (!nodes || !planItems || !rawEvents) return null
  if (nodes.length === 0 || rawEvents.length === 0) return null
  return { meta: snapshot, nodes, goalAnchor, planItems, rawEvents }
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(12_000) })
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
  goalText?: string
  serverBase: string
  token?: string
}): Promise<AttentionGoalMeta | null> {
  const body = await requestJson<{ goal?: AttentionGoalMeta }>(
    `${input.serverBase}/api/agent-chat/v1/attention/goals/${input.topicId}/default`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(input.token) },
      body: JSON.stringify({ goalText: input.goalText ?? '', title: '默认目标' }),
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
}): Promise<{ snapshot: LoadedSnapshot | null; degradedReason: string | null }> {
  const body = await requestJson<{ snapshot?: PersistedAttentionGoalSnapshot }>(
    `${input.serverBase}/api/agent-chat/v1/attention/goals/${input.goalId}/snapshot`,
    { headers: authHeaders(input.token) },
  )
  const degradedReason = body?.snapshot?.degraded_reason ?? null
  return { snapshot: body?.snapshot ? toLoadedSnapshot(body.snapshot) : null, degradedReason }
}

async function rebuildGoalSnapshot(input: {
  goalId: string
  serverBase: string
  token?: string
}): Promise<{ snapshot: LoadedSnapshot | null; degradedReason: string | null }> {
  const body = await requestJson<{
    ok?: boolean
    degraded?: boolean
    reason?: string
    snapshot?: PersistedAttentionGoalSnapshot
  }>(
    `${input.serverBase}/api/agent-chat/v1/attention/goals/${input.goalId}/rebuild`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(input.token) },
      body: '{}',
      signal: AbortSignal.timeout(55_000),
    },
  )
  const degradedReason = body?.degraded ? body.reason ?? body.snapshot?.degraded_reason ?? 'unknown' : body?.snapshot?.degraded_reason ?? null
  return { snapshot: body?.snapshot ? toLoadedSnapshot(body.snapshot) : null, degradedReason }
}

export function useAttentionTrace(topicId: string): AttentionTrace {
  const messages = useMessageStore((s) => s.byTopic[topicId] ?? EMPTY_MESSAGES)
  const agentStatus = useMessageStore((s) => s.agentStatusByTopic[topicId] ?? 'idle')
  const hasLiveMessages = useMemo(() => hasActiveAttentionMessage(messages), [messages])
  const sourceSignal = useMemo(
    () => `${messages.length}:${messages.reduce((max, message) => Math.max(max, message.finished_at ?? message.started_at), 0)}`,
    [messages],
  )

  const [goals, setGoals] = useState<AttentionGoalMeta[]>([])
  const [activeGoalId, setActiveGoalId] = useState<string | null>(null)
  const [goalDraft, setGoalDraft] = useState('')
  const [snapshot, setSnapshot] = useState<LoadedSnapshot | null>(null)
  const [llmUnavailable, setLlmUnavailable] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const lastRebuildKeyRef = useRef<string | null>(null)

  const reloadGoals = useCallback(async () => {
    const serverBase = getServerBase()
    const token = getToken()
    const loaded = await listAttentionGoals({ topicId, serverBase, token })
    setGoals(loaded)
    const active = loaded.find((goal) => goal.active) ?? loaded[0] ?? null
    setActiveGoalId((prev) => (prev && loaded.some((goal) => goal.id === prev) ? prev : active?.id ?? null))
  }, [sourceSignal, topicId])

  const rebuild = useCallback(async (goalId: string, opts: { force?: boolean } = {}) => {
    if (!goalId) return
    const key = `${goalId}:${sourceSignal}`
    if (!opts.force && lastRebuildKeyRef.current === key) return
    lastRebuildKeyRef.current = key
    setIsAnalyzing(true)
    const result = await rebuildGoalSnapshot({ goalId, serverBase: getServerBase(), token: getToken() }).catch(() => ({
      snapshot: null,
      degradedReason: 'fetch_error',
    }))
    setIsAnalyzing(false)
    if (result.snapshot) setSnapshot(result.snapshot)
    setLlmUnavailable(!!result.degradedReason)
    void reloadGoals()
  }, [reloadGoals, sourceSignal])

  useEffect(() => {
    let cancelled = false
    const serverBase = getServerBase()
    const token = getToken()
    listAttentionGoals({ topicId, serverBase, token }).then(async (loaded) => {
      if (cancelled) return
      let nextGoals = loaded
      if (!nextGoals.some((goal) => goal.is_default)) {
        const defaultGoal = await ensureDefaultGoal({ topicId, serverBase, token })
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
  }, [topicId])

  const activeGoal = useMemo(
    () => goals.find((goal) => goal.id === activeGoalId) ?? null,
    [activeGoalId, goals],
  )

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
      setSnapshot(loaded.snapshot)
      setLlmUnavailable(!!loaded.degradedReason && !loaded.snapshot)
      if (!loaded.snapshot && !loaded.degradedReason) void rebuild(activeGoalId, { force: true })
    }).catch(() => {
      if (!cancelled) setSnapshot(null)
    })
    return () => {
      cancelled = true
    }
  }, [activeGoalId, rebuild])

  useEffect(() => {
    if (!activeGoalId || hasLiveMessages || agentStatus !== 'idle') return
    void rebuild(activeGoalId)
  }, [activeGoalId, agentStatus, hasLiveMessages, rebuild, sourceSignal])

  const createGoal = useCallback(async (goalTextInput?: string) => {
    const next = (goalTextInput ?? goalDraft).trim()
    if (!next) return
    const created = await createAttentionGoal({ topicId, goalText: next, serverBase: getServerBase(), token: getToken() })
    if (!created) return
    setGoals((prev) => [created, ...prev.map((goal) => ({ ...goal, active: false }))])
    setActiveGoalId(created.id)
    setGoalDraft(created.goal_text)
    await rebuild(created.id, { force: true })
  }, [goalDraft, rebuild, topicId])

  const selectGoal = useCallback(async (goalId: string) => {
    const activated = await activateAttentionGoal({ goalId, serverBase: getServerBase(), token: getToken() })
    if (!activated) return
    setGoals((prev) => prev.map((goal) => ({ ...goal, active: goal.id === goalId })))
    setActiveGoalId(goalId)
    setGoalDraft(activated.goal_text)
    await rebuild(goalId, { force: true })
  }, [rebuild])

  const renameGoal = useCallback(async (goalId: string, title: string) => {
    const renamed = await renameAttentionGoal({ goalId, title, serverBase: getServerBase(), token: getToken() })
    if (!renamed) return
    setGoals((prev) => prev.map((goal) => (goal.id === goalId ? { ...goal, title: renamed.title, updated_at: renamed.updated_at } : goal)))
  }, [])

  return {
    nodes: snapshot?.nodes ?? [],
    goalAnchor: snapshot?.goalAnchor ?? (activeGoal ? { raw_query: activeGoal.goal_text, normalized_goal: activeGoal.goal_text, ts: activeGoal.created_at } : null),
    planItems: snapshot?.planItems ?? [],
    rawEvents: snapshot?.rawEvents ?? [],
    isAnalyzing: isAnalyzing || (hasLiveMessages && agentStatus !== 'idle'),
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
