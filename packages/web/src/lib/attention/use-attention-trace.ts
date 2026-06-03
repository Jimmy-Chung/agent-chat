// S3 (AIT-221) React hook：把实时骨架（S1）与 LLM 语义（S2）连起来。
// 骨架随 store 实时演进；agent 落定时调一次 interpret，结果缓存；server 失败全程 cosine 兜底。
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMessageStore } from '@/stores/message-store'
import { getServerBase } from '@/lib/server-url'
import { aggregate } from './aggregator'
import { storeToRawEvents, extractGoalAnchor, type TodoSnapshotItem } from './store-adapter'
import {
  planInterpret,
  buildTrace,
  buildInterpretPrompt,
  callInterpret,
  type InterpretResult,
} from './orchestrator'
import type { GoalAnchor, PlanItem, TraceNode } from './types'

export interface AttentionTrace {
  nodes: TraceNode[]
  goalAnchor: GoalAnchor | null
  planItems: PlanItem[]
  isAnalyzing: boolean
}

const EMPTY_MESSAGES: never[] = []

export function useAttentionTrace(topicId: string): AttentionTrace {
  const messages = useMessageStore((s) => s.byTopic[topicId] ?? EMPTY_MESSAGES)
  const partsByMessage = useMessageStore((s) => s.partsByMessage)
  const todos = useMessageStore((s) => s.todosByTopic[topicId]) as TodoSnapshotItem[] | undefined
  const plan = useMessageStore((s) => s.planByTopic[topicId])
  const agentStatus = useMessageStore((s) => s.agentStatusByTopic[topicId] ?? 'idle')

  const rawEvents = useMemo(
    () => storeToRawEvents({ messages, partsByMessage, todos, plan }),
    [messages, partsByMessage, todos, plan],
  )
  const aggregated = useMemo(() => aggregate(rawEvents), [rawEvents])
  const candidates = aggregated.candidates
  const planItems = aggregated.planItems
  const goalAnchor = useMemo(
    () => extractGoalAnchor({ messages, partsByMessage }),
    [messages, partsByMessage],
  )
  const lastEventTs = rawEvents.length > 0 ? rawEvents[rawEvents.length - 1].ts : 0

  const [interpret, setInterpret] = useState<InterpretResult | null>(null)
  const lastKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const { shouldCall, cacheKey } = planInterpret({
      candidateCount: candidates.length,
      lastEventTs,
      agentStatus,
      lastInterpretedKey: lastKeyRef.current,
    })
    if (!shouldCall) return
    lastKeyRef.current = cacheKey // 先占位，避免重复触发
    let cancelled = false
    const prompt = buildInterpretPrompt(candidates, goalAnchor)
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('AGENT_CHAT_TOKEN') || undefined : undefined
    callInterpret(prompt, { serverBase: getServerBase(), token }).then((result) => {
      if (cancelled) return
      if (result) setInterpret(result)
      // result 为 null（server 不可用/降级）：保持 cosine 兜底，不清空已有结果
    })
    return () => {
      cancelled = true
    }
  }, [candidates, lastEventTs, agentStatus, goalAnchor])

  const inProgress = agentStatus !== 'idle'
  const nodes = useMemo(
    () => buildTrace(candidates, goalAnchor, interpret, { inProgress }),
    [candidates, goalAnchor, interpret, inProgress],
  )

  return { nodes, goalAnchor, planItems, isAnalyzing: inProgress }
}
