import { useState, useCallback, useRef } from 'react'
import { RawEvent, TraceNode, PlanItem, GoalAnchor, ProviderConfig } from '../types'
import { parseClaudeCodeJsonl } from '../parser/claudeCodeParser'
import { aggregate, candidatesToLoadingNodes } from '../pipeline/aggregator'
import { interpretTrace, normalizeGoalAnchor, detectBranches } from '../pipeline/interpreter'

export const LANE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']

export type SessionState = {
  id: string
  label: string
  color: string
  rawEvents: RawEvent[]
  goalAnchor: GoalAnchor | null
  traceNodes: TraceNode[]
  planItems: PlanItem[]
  isProcessing: boolean
  error: string | null
}

const INITIAL_SESSION = (id: string, label: string, color: string): SessionState => ({
  id, label, color,
  rawEvents: [], goalAnchor: null, traceNodes: [], planItems: [],
  isProcessing: true, error: null,
})

export function useMultiSession(providerConfig: ProviderConfig) {
  const [sessions, setSessions] = useState<SessionState[]>([])
  const abortMap = useRef(new Map<string, boolean>())
  const colorIdx = useRef(0)

  const patchSession = useCallback((id: string, patch: Partial<SessionState>) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const addSession = useCallback(
    async (jsonl: string, label: string) => {
      const id = `sess_${Date.now()}`
      const color = LANE_COLORS[colorIdx.current % LANE_COLORS.length]
      colorIdx.current++

      abortMap.current.set(id, false)
      setSessions((prev) => [...prev, INITIAL_SESSION(id, label, color)])

      try {
        // 1. Parse
        const { events, goalAnchor } = parseClaudeCodeJsonl(jsonl)
        if (abortMap.current.get(id)) return

        // 2. Aggregate
        const { candidates, planItems } = aggregate(events)
        if (abortMap.current.get(id)) return

        // Show loading placeholder
        const loadingNodes = candidatesToLoadingNodes(candidates)
        patchSession(id, { rawEvents: events, goalAnchor, planItems, traceNodes: loadingNodes })

        // 3. Goal normalization (non-blocking)
        if (goalAnchor && providerConfig.apiKey) {
          normalizeGoalAnchor(goalAnchor.raw_query, providerConfig)
            .then((normalized) => {
              if (!abortMap.current.get(id)) {
                setSessions((prev) =>
                  prev.map((s) =>
                    s.id === id && s.goalAnchor
                      ? { ...s, goalAnchor: { ...s.goalAnchor!, normalized_goal: normalized } }
                      : s
                  )
                )
              }
            })
            .catch(() => {})
        }

        if (candidates.length === 0) {
          patchSession(id, { isProcessing: false })
          return
        }

        // 4. Interpret
        const interpreted = await interpretTrace(
          candidates, events,
          goalAnchor ?? { raw_query: '', normalized_goal: '', ts: 0 },
          planItems,
          providerConfig.apiKey ? providerConfig : null,
          () => {}
        )
        if (abortMap.current.get(id)) return

        // 5. Detect branches
        const branched = await detectBranches(
          interpreted,
          goalAnchor ?? { raw_query: '', normalized_goal: '', ts: 0 },
          providerConfig.apiKey ? providerConfig : null
        )
        if (abortMap.current.get(id)) return

        patchSession(id, { traceNodes: branched, isProcessing: false })
      } catch (err) {
        patchSession(id, { isProcessing: false, error: String(err) })
      }
    },
    [providerConfig, patchSession]
  )

  const removeSession = useCallback((id: string) => {
    abortMap.current.set(id, true)
    setSessions((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const resetAll = useCallback(() => {
    for (const id of abortMap.current.keys()) abortMap.current.set(id, true)
    setSessions([])
    colorIdx.current = 0
  }, [])

  return { sessions, addSession, removeSession, resetAll }
}
