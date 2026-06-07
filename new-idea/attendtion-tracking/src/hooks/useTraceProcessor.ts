import { useState, useCallback, useRef, useMemo } from 'react'
import { RawEvent, TraceNode, PlanItem, GoalAnchor, ProviderConfig } from '../types'
import { parseClaudeCodeJsonl } from '../parser/claudeCodeParser'
import { aggregate, candidatesToLoadingNodes } from '../pipeline/aggregator'
import {
  interpretTrace,
  normalizeGoalAnchor,
  detectBranches,
} from '../pipeline/interpreter'
import { projectExpandableTree, GraphData } from '../pipeline/projector'

export type ProcessingPhase =
  | 'idle'
  | 'parsing'
  | 'aggregating'
  | 'interpreting'
  | 'detecting'
  | 'done'
  | 'error'

export type ProgressInfo = {
  phase: ProcessingPhase
  overall: number
  label: string
  elapsedMs: number
  error: string | null
}

export type TraceState = {
  rawEvents: RawEvent[]
  goalAnchor: GoalAnchor | null
  traceNodes: TraceNode[]
  planItems: PlanItem[]
  progress: ProgressInfo
}

const IDLE_PROGRESS: ProgressInfo = {
  phase: 'idle',
  overall: 0,
  label: '',
  elapsedMs: 0,
  error: null,
}

export function useTraceProcessor(providerConfig: ProviderConfig) {
  const [state, setState] = useState<TraceState>({
    rawEvents: [],
    goalAnchor: null,
    traceNodes: [],
    planItems: [],
    progress: IDLE_PROGRESS,
  })

  const abortRef = useRef(false)
  const startedAtRef = useRef<number>(0)

  const process = useCallback(
    async (jsonlContent: string) => {
      abortRef.current = false
      startedAtRef.current = Date.now()

      const setPhase = (
        phase: ProcessingPhase,
        overall: number,
        label: string
      ) => {
        if (abortRef.current) return
        setState((s) => ({
          ...s,
          progress: {
            phase,
            overall,
            label,
            elapsedMs: Date.now() - startedAtRef.current,
            error: null,
          },
        }))
      }

      // ── 1. Parse ────────────────────────────────────────────────────────────
      setPhase('parsing', 0.05, '解析 JSONL…')
      let rawEvents: RawEvent[]
      let goalAnchor: GoalAnchor | null
      try {
        const result = parseClaudeCodeJsonl(jsonlContent)
        rawEvents = result.events
        goalAnchor = result.goalAnchor
      } catch (err) {
        setState((s) => ({
          ...s,
          progress: { ...IDLE_PROGRESS, phase: 'error', error: String(err) },
        }))
        return
      }

      // ── 2. Aggregate ────────────────────────────────────────────────────────
      setPhase('aggregating', 0.10, '聚合事件…')
      const { candidates, planItems } = aggregate(rawEvents)

      if (candidates.length === 0) {
        setState((s) => ({
          ...s,
          rawEvents,
          goalAnchor,
          planItems,
          traceNodes: [],
          progress: { ...IDLE_PROGRESS, phase: 'done', overall: 1 },
        }))
        return
      }

      // Show loading placeholder while LLM runs
      const loadingNodes = candidatesToLoadingNodes(candidates)
      setState((s) => ({
        ...s,
        rawEvents,
        goalAnchor,
        planItems,
        traceNodes: loadingNodes,
        progress: {
          phase: 'interpreting',
          overall: 0.15,
          label: `共 ${candidates.length} 个步骤，正在分析…`,
          elapsedMs: Date.now() - startedAtRef.current,
          error: null,
        },
      }))

      if (abortRef.current) return

      // ── 3. Normalize goal (non-blocking) ────────────────────────────────────
      if (goalAnchor && providerConfig.apiKey) {
        normalizeGoalAnchor(goalAnchor.raw_query, providerConfig)
          .then((normalized) => {
            if (!abortRef.current && goalAnchor) {
              goalAnchor = { ...goalAnchor, normalized_goal: normalized }
              setState((s) => ({ ...s, goalAnchor }))
            }
          })
          .catch(() => {/* keep raw query */})
      }

      // ── 4. Interpret trace (one LLM call) ────────────────────────────────────
      let interpretedNodes: TraceNode[]
      try {
        interpretedNodes = await interpretTrace(
          candidates,
          rawEvents,
          goalAnchor ?? { raw_query: '', normalized_goal: '', ts: 0 },
          planItems,
          providerConfig.apiKey ? providerConfig : null,
          (label) => {
            if (!abortRef.current) {
              setState((s) => ({
                ...s,
                progress: { ...s.progress, label, overall: 0.6 },
              }))
            }
          }
        )
      } catch (err) {
        setState((s) => ({
          ...s,
          progress: { ...IDLE_PROGRESS, phase: 'error', error: String(err) },
        }))
        return
      }

      if (abortRef.current) return

      setState((s) => ({
        ...s,
        traceNodes: interpretedNodes,
        progress: {
          phase: 'interpreting',
          overall: 0.85,
          label: `生成 ${interpretedNodes.length} 个决策节点`,
          elapsedMs: Date.now() - startedAtRef.current,
          error: null,
        },
      }))

      // ── 5. Detect semantic branches ──────────────────────────────────────────
      setPhase('detecting', 0.92, '检测语义分支…')
      const currentGoal = goalAnchor ?? { raw_query: '', normalized_goal: '', ts: 0 }
      const branchedNodes = await detectBranches(
        interpretedNodes,
        currentGoal,
        providerConfig.apiKey ? providerConfig : null
      )

      if (!abortRef.current) {
        setState((s) => ({
          ...s,
          traceNodes: branchedNodes,
          progress: {
            phase: 'done',
            overall: 1,
            label: `完成，共 ${branchedNodes.length} 个决策节点`,
            elapsedMs: Date.now() - startedAtRef.current,
            error: null,
          },
        }))
      }
    },
    [providerConfig]
  )

  const reset = useCallback(() => {
    abortRef.current = true
    setState({
      rawEvents: [],
      goalAnchor: null,
      traceNodes: [],
      planItems: [],
      progress: IDLE_PROGRESS,
    })
  }, [])

  return { state, process, reset }
}

// ── Graph data with stable positions ─────────────────────────────────────────

export function useGraphData(
  state: TraceState,
  collapsedBranches: Set<string>,
  expandedNodes?: Set<string>
): GraphData | null {
  const { traceNodes, goalAnchor } = state

  return useMemo(() => {
    if (!goalAnchor || traceNodes.length === 0) return null
    return projectExpandableTree(
      traceNodes,
      expandedNodes ?? new Set(),
      goalAnchor,
      collapsedBranches
    )
  }, [traceNodes, goalAnchor, collapsedBranches, expandedNodes])
}

export function useMaxGoalDistance(traceNodes: TraceNode[]): number {
  return useMemo(() => {
    const loaded = traceNodes.filter((n) => !n.is_loading)
    if (loaded.length === 0) return 0
    return Math.max(...loaded.slice(-3).map((n) => n.goal_distance))
  }, [traceNodes])
}
