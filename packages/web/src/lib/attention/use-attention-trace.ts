// S3 (AIT-221) React hook：把实时骨架（S1）与 LLM 语义（S2）连起来。
// 骨架随 store 实时演进；agent 落定时调一次 interpret，结果缓存。
// AIT-226：Attention 面板不再使用本地语义兜底；LLM 不可用时不返回推断节点。
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Message, MessagePart } from '@agent-chat/protocol'
import { useMessageStore } from '@/stores/message-store'
import { useTopicStore } from '@/stores/topic-store'
import { getServerBase } from '@/lib/server-url'
import { aggregate } from './aggregator'
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

export interface AttentionTrace {
  nodes: TraceNode[]
  goalAnchor: GoalAnchor | null
  planItems: PlanItem[]
  rawEvents: RawEvent[]
  isAnalyzing: boolean
  llmUnavailable: boolean
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

export function useAttentionTrace(topicId: string): AttentionTrace {
  const messages = useMessageStore((s) => s.byTopic[topicId] ?? EMPTY_MESSAGES)
  const partsByMessage = useMessageStore((s) => s.partsByMessage)
  const topic = useTopicStore((s) => s.topics.find((entry) => entry.id === topicId) ?? null)
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
  const planItems = aggregated.planItems
  const goalAnchor = useMemo(
    () => resolveGoalAnchor({
      explicitTarget: topic?.attention_target,
      explicitUpdatedAt: topic?.updated_at,
      messages,
      partsByMessage,
    }),
    [messages, partsByMessage, topic?.attention_target, topic?.updated_at],
  )
  const lastEventTs = rawEvents.length > 0 ? rawEvents[rawEvents.length - 1].ts : 0
  const goalKey = goalAnchor?.normalized_goal ?? ''

  const [interpret, setInterpret] = useState<{ key: string; result: InterpretResult } | null>(null)
  const [llmUnavailable, setLlmUnavailable] = useState(false)
  const lastKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const { shouldCall, cacheKey } = planInterpret({
      candidateCount: candidates.length,
      lastEventTs,
      goalKey,
      agentStatus: hasLiveMessages ? agentStatus : 'idle',
      lastInterpretedKey: lastKeyRef.current,
    })
    if (!shouldCall) return
    lastKeyRef.current = cacheKey // 先占位，避免重复触发
    setLlmUnavailable(false)
    let cancelled = false
    const prompt = buildInterpretPrompt(candidates, goalAnchor)
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('AGENT_CHAT_TOKEN') || undefined : undefined
    callInterpret(prompt, { serverBase: getServerBase(), token }).then((result) => {
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
  }, [candidates, lastEventTs, agentStatus, goalAnchor, hasLiveMessages, goalKey])

  const inProgress = hasLiveMessages && agentStatus !== 'idle'
  const currentKey = makeInterpretKey(candidates.length, lastEventTs, goalKey)
  const semanticGoalAnchor = useMemo<GoalAnchor | null>(() => {
    const normalized = interpret?.key === currentKey ? interpret.result.normalizedGoal?.trim() : ''
    if (!normalized) return goalAnchor
    return { raw_query: goalAnchor?.raw_query ?? normalized, normalized_goal: normalized, ts: goalAnchor?.ts ?? 0 }
  }, [currentKey, goalAnchor, interpret])
  const nodes = useMemo(
    () => interpret?.key === currentKey
      ? buildTrace(candidates, semanticGoalAnchor, interpret.result, { inProgress })
      : [],
    [candidates, currentKey, semanticGoalAnchor, interpret, inProgress],
  )

  return { nodes, goalAnchor: semanticGoalAnchor, planItems, rawEvents, isAnalyzing: inProgress, llmUnavailable }
}
