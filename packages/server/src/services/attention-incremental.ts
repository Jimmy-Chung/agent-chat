// 增量重建核心（纯逻辑，可单测）。设计见 attention-incremental-rebuild-design.md。
//
// 原则：只冻结 LLM 层（每节点解释），结构层每次全跑。
// 冻结身份 = 节点 source_message_ids 集合（内容身份，不是合成的 cand_N 位置 id）——
// compactTurnsToPhases 在 >12 时会重排 cand_N，但底层消息集合才是稳定锚点。
import type { CandidateNode, AttentionInterpretResult, GoalAnchor } from '@agent-chat/protocol'

/** 单个节点被冻结的 LLM 解释字段。 */
export interface FrozenInterp {
  conclusion: string
  goalAlignment: number
  userSummary?: string
  assistantSummary?: string
  aggregateTitle?: string
  sameTopic?: boolean
  closeCurrentTopic?: boolean
  nodeReason?: string
}

/** 节点冻结 key = 排序后的 source_message_ids 并集。空集合返回 ''（不冻结）。 */
export function candidateFreezeKey(sourceMessageIds: readonly string[] | undefined): string {
  if (!sourceMessageIds || sourceMessageIds.length === 0) return ''
  return [...sourceMessageIds].sort().join('|')
}

/**
 * 从上次快照的 candidates_json + interpret_json 还原「成员集合 → 冻结解释」表。
 * 任何解析异常都吞掉，返回空表（退回全量行为）。
 */
export function buildFrozenInterpMap(candidatesJson: string, interpretJson: string): Map<string, FrozenInterp> {
  const map = new Map<string, FrozenInterp>()
  let candidates: unknown
  let interpret: unknown
  try {
    candidates = JSON.parse(candidatesJson)
    interpret = JSON.parse(interpretJson)
  } catch {
    return map
  }
  if (!Array.isArray(candidates)) return map
  const it = interpret as Partial<AttentionInterpretResult> | null
  if (!it || !Array.isArray(it.conclusion) || !Array.isArray(it.goalAlignment)) return map
  candidates.forEach((c: unknown, i: number) => {
    const node = c as CandidateNode
    const key = candidateFreezeKey(node?.source_message_ids)
    if (!key) return
    const conclusion = it.conclusion?.[i]
    if (typeof conclusion !== 'string') return
    map.set(key, {
      conclusion,
      goalAlignment: typeof it.goalAlignment?.[i] === 'number' ? it.goalAlignment[i] : 5,
      userSummary: it.userSummary?.[i],
      assistantSummary: it.assistantSummary?.[i],
      aggregateTitle: it.aggregateTitle?.[i],
      sameTopic: it.sameTopic?.[i],
      closeCurrentTopic: it.closeCurrentTopic?.[i],
      nodeReason: it.nodeReason?.[i],
    })
  })
  return map
}

/** 划分当前候选：哪些命中冻结表（复用）、哪些待解释（送 LLM）。pendingIdx 保留它们在 candidates 中的原始下标。 */
export function planIncrementalInterpret(
  candidates: CandidateNode[],
  frozenMap: Map<string, FrozenInterp>,
): { pending: CandidateNode[]; pendingIdx: number[] } {
  const pending: CandidateNode[] = []
  const pendingIdx: number[] = []
  candidates.forEach((c, i) => {
    const key = candidateFreezeKey(c.source_message_ids)
    if (!key || !frozenMap.has(key)) {
      pending.push(c)
      pendingIdx.push(i)
    }
  })
  return { pending, pendingIdx }
}

type InterpretArrays = Pick<
  AttentionInterpretResult,
  | 'conclusion'
  | 'goalAlignment'
  | 'userSummary'
  | 'assistantSummary'
  | 'aggregateTitle'
  | 'sameTopic'
  | 'closeCurrentTopic'
  | 'nodeReason'
>

/**
 * 把「冻结解释」与「LLM 对 pending 的解释」按 candidates 顺序合并成全长平行数组。
 * llm 的数组按 pendingIdx 顺序对应；缺失项留空（buildTrace 会本地兜底）。
 * pinnedNormalizedGoal 写入结果的 normalizedGoal（R3：目标钉死时复用旧值）。
 */
export function mergeInterpret(
  candidates: CandidateNode[],
  frozenMap: Map<string, FrozenInterp>,
  pendingIdx: number[],
  llm: Partial<InterpretArrays> | null,
  pinnedNormalizedGoal: string | undefined,
): AttentionInterpretResult {
  const out: AttentionInterpretResult = {
    conclusion: [],
    goalAlignment: [],
    userSummary: [],
    assistantSummary: [],
    aggregateTitle: [],
    sameTopic: [],
    closeCurrentTopic: [],
    nodeReason: [],
    normalizedGoal: pinnedNormalizedGoal,
  }
  // pendingIdx 中的原始下标 → 它在 llm 数组里的位置
  const idxToPending = new Map<number, number>()
  pendingIdx.forEach((origIdx, k) => idxToPending.set(origIdx, k))

  candidates.forEach((c, i) => {
    const key = candidateFreezeKey(c.source_message_ids)
    const frozen = key ? frozenMap.get(key) : undefined
    if (frozen) {
      out.conclusion.push(frozen.conclusion)
      out.goalAlignment.push(frozen.goalAlignment)
      out.userSummary!.push(frozen.userSummary ?? '')
      out.assistantSummary!.push(frozen.assistantSummary ?? '')
      out.aggregateTitle!.push(frozen.aggregateTitle ?? '')
      out.sameTopic!.push(frozen.sameTopic ?? true)
      out.closeCurrentTopic!.push(frozen.closeCurrentTopic ?? false)
      out.nodeReason!.push(frozen.nodeReason ?? '')
      return
    }
    const k = idxToPending.get(i)
    const ga = k != null ? llm?.goalAlignment?.[k] : undefined
    out.conclusion.push((k != null && llm?.conclusion?.[k]) || '')
    out.goalAlignment.push(typeof ga === 'number' ? ga : 5)
    out.userSummary!.push((k != null && llm?.userSummary?.[k]) || '')
    out.assistantSummary!.push((k != null && llm?.assistantSummary?.[k]) || '')
    out.aggregateTitle!.push((k != null && llm?.aggregateTitle?.[k]) || '')
    out.sameTopic!.push(k != null && typeof llm?.sameTopic?.[k] === 'boolean' ? llm.sameTopic[k] : true)
    out.closeCurrentTopic!.push(
      k != null && typeof llm?.closeCurrentTopic?.[k] === 'boolean' ? llm.closeCurrentTopic[k] : false,
    )
    out.nodeReason!.push((k != null && llm?.nodeReason?.[k]) || '')
  })
  return out
}

/**
 * R3/R4：判断目标是否变更，并给出钉死后的 normalized_goal。
 * - 目标未变：复用上次快照的 normalized_goal（不让 LLM 重新措辞）。
 * - 目标已变 / 无历史：用本次 LLM 的 normalizedGoal（或回退原文）。
 */
export function resolveGoalPinning(input: {
  currentAnchor: GoalAnchor
  prevGoalJson: string | null
  llmNormalizedGoal: string | undefined
}): { goalChanged: boolean; pinnedNormalizedGoal: string } {
  let prev: GoalAnchor | null = null
  if (input.prevGoalJson) {
    try {
      prev = JSON.parse(input.prevGoalJson) as GoalAnchor
    } catch {
      prev = null
    }
  }
  const currentRaw = input.currentAnchor.raw_query.trim()
  const prevRaw = prev?.raw_query?.trim() ?? ''
  const goalChanged = !prev || prevRaw !== currentRaw
  const llmGoal = input.llmNormalizedGoal?.trim()
  if (goalChanged) {
    return { goalChanged, pinnedNormalizedGoal: llmGoal || input.currentAnchor.normalized_goal }
  }
  // 未变：钉死旧值优先
  const pinned = prev?.normalized_goal?.trim() || llmGoal || input.currentAnchor.normalized_goal
  return { goalChanged, pinnedNormalizedGoal: pinned }
}
