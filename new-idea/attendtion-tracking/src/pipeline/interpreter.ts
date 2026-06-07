import { TraceNode, GoalAnchor, RawEvent, PlanItem, ProviderConfig } from '../types'
import { CandidateNode } from './aggregator'
import { callDeepSeek } from '../provider/deepseek'

// ── Local cosine similarity (fallback for goal_distance) ─────────────────────

const STOP = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','are','was','were','be','been','has','have','had','do','does',
  'did','will','would','could','should','it','this','that',
  '的','了','在','是','我','他','她','它','们','和','与','有','为','以',
])

function tokenize(t: string) {
  return t.toLowerCase().split(/[\s\W]+/).filter((w) => w.length > 1 && !STOP.has(w))
}

function cosine(a: string[], b: string[]): number {
  const fa = new Map<string,number>()
  const fb = new Map<string,number>()
  a.forEach((w) => fa.set(w, (fa.get(w)??0)+1))
  b.forEach((w) => fb.set(w, (fb.get(w)??0)+1))
  const vocab = new Set([...fa.keys(),...fb.keys()])
  let dot=0,ma=0,mb=0
  for (const w of vocab) {
    const va=fa.get(w)??0, vb=fb.get(w)??0
    dot+=va*vb; ma+=va*va; mb+=vb*vb
  }
  return ma===0||mb===0 ? 0 : dot/(Math.sqrt(ma)*Math.sqrt(mb))
}

export function computeGoalDistance(goalText: string, text: string): number {
  return Math.max(0, Math.min(1, 1 - cosine(tokenize(goalText), tokenize(text))))
}

// ── Build compact model-activity summary for a candidate ─────────────────────

function summarizeModelActivity(c: CandidateNode): string {
  const parts: string[] = []

  // Tool calls (top 5)
  const toolSummaries = c.tools.slice(0, 5).map((t) => {
    const name = (t.payload.name as string|undefined) ?? 'tool'
    const input = (t.payload.input as Record<string,unknown>) ?? {}
    const cmd = input.command as string|undefined
    const fp = (input.file_path ?? input.path) as string|undefined
    if (cmd) return `${name}(${cmd.trim().split('\n')[0].slice(0,50)})`
    if (fp) return `${name}(${String(fp).split('/').pop()})`
    return name
  })
  if (toolSummaries.length) {
    parts.push(toolSummaries.join(', ') + (c.tools.length > 5 ? ` …+${c.tools.length-5}` : ''))
  }

  // First thinking snippet
  const th = c.thinking[0]?.payload.text as string|undefined
  if (th) parts.push(`思考：${th.slice(0,80).replace(/\n/g,' ')}`)

  // All model text replies combined
  const replies = c.messages
    .map((m) => (m.payload.text as string|undefined) ?? '')
    .filter((t) => t.trim().length > 0)
  if (replies.length > 0) {
    const combined = replies.join(' ').slice(0, 100).replace(/\n/g, ' ')
    parts.push(`回复：${combined}`)
  }

  return parts.join(' | ') || '（无工具调用）'
}

// ── LLM: interpret all candidates in one call ─────────────────────────────────

type InterpretResult = {
  conclusion: string
  goalAlignment: number  // 0-10
}

async function interpretAllWithLLM(
  candidates: CandidateNode[],
  goalAnchor: GoalAnchor,
  config: ProviderConfig
): Promise<InterpretResult[]> {
  const goal = goalAnchor.normalized_goal || goalAnchor.raw_query

  const lines = candidates.map((c, i) => {
    const activity = summarizeModelActivity(c)
    const prevAi = c.exchanges[0]?.prev_ai_summary
    const prevLine = prevAi ? `\n    [上一步 AI 说]：「${prevAi.slice(0, 60)}」` : ''
    return `[${i}] 用户：「${c.user_message.slice(0,80)}」${prevLine}\n    模型：${activity}`
  }).join('\n')

  const prompt = `总目标：「${goal}」

以下是一次 AI 会话的完整对话记录（每条包含用户问题和模型的处理过程）：
${lines}

请为每一条对话生成：
1. conclusion：15字以内，该次交互完成了什么或发现了什么（从模型的角度）
2. goalAlignment：0-10整数，该次交互与总目标的相关程度（10=直接推进目标）

严格按 JSON 数组格式回复，长度必须 = ${candidates.length}，顺序与上面一致：
[{"conclusion":"...","goalAlignment":9},{"conclusion":"...","goalAlignment":7}]`

  const raw = await callDeepSeek(prompt, config)
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('no JSON array')
  const parsed = JSON.parse(match[0]) as InterpretResult[]
  if (!Array.isArray(parsed) || parsed.length !== candidates.length) {
    throw new Error(`expected ${candidates.length} items, got ${parsed.length}`)
  }
  return parsed.map((r) => ({
    conclusion: String(r.conclusion ?? '').slice(0, 100),
    goalAlignment: Math.max(0, Math.min(10, Number(r.goalAlignment ?? 5))),
  }))
}

// ── Plan alignment ────────────────────────────────────────────────────────────

function matchToPlan(text: string, planItems: PlanItem[]): {
  ref: string|null; alignment: 'on_track'|'unplanned'
} {
  if (!planItems.length) return { ref: null, alignment: 'unplanned' }
  let best=0, bestItem: PlanItem|null=null
  const t = tokenize(text)
  for (const item of planItems) {
    const s = cosine(t, tokenize(item.text))
    if (s>best) { best=s; bestItem=item }
  }
  return best>0.25 && bestItem
    ? { ref: bestItem.id, alignment: 'on_track' }
    : { ref: null, alignment: 'unplanned' }
}

// ── Build TraceNode from candidate ────────────────────────────────────────────

let _nodeCounter = 0
const nextNodeId = () => `node_${++_nodeCounter}`

function buildNode(
  c: CandidateNode,
  result: InterpretResult | null,
  goalAnchor: GoalAnchor,
  planItems: PlanItem[],
  parentId: string | null,
): TraceNode {
  const goalText = goalAnchor.normalized_goal || goalAnchor.raw_query
  const goal_distance = result
    ? Math.max(0, Math.min(1, 1 - result.goalAlignment / 10))
    : computeGoalDistance(goalText, c.user_message)

  const { ref, alignment } = matchToPlan(c.user_message, planItems)

  return {
    id: nextNodeId(),
    parent_id: parentId,
    branch_id: 'main',
    user_message: c.user_message,
    intent: c.user_message,   // user message IS the intent
    rationale: (c.thinking[0]?.payload.text as string|undefined)?.slice(0,150) ?? null,
    conclusion: result?.conclusion ?? null,
    planned_ref: ref,
    alignment,
    goal_distance,
    status: 'done' as const,
    event_ids: [
      ...c.thinking.map((e) => e.id),
      ...c.tools.map((e) => e.id),
      ...c.messages.map((e) => e.id),
    ],
    step_count: c.tools.length,
    user_kind: c.user_kind,
    assistant_actions: c.assistant_actions,
    user_message_count: c.user_messages.length,
    exchanges: c.exchanges,
    ts_start: c.ts_start,
    ts_end: c.ts_end,
    is_loading: false,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function interpretTrace(
  candidates: CandidateNode[],
  allEvents: RawEvent[],
  goalAnchor: GoalAnchor,
  planItems: PlanItem[],
  config: ProviderConfig | null,
  onProgress: (label: string) => void
): Promise<TraceNode[]> {
  _nodeCounter = 0
  void allEvents

  if (!candidates.length) return []

  onProgress(`分析 ${candidates.length} 条对话…`)

  let results: (InterpretResult | null)[] = new Array(candidates.length).fill(null)

  if (config?.apiKey) {
    try {
      results = await interpretAllWithLLM(candidates, goalAnchor, config)
    } catch (e) {
      console.warn('[interpreter] LLM failed, using fallback:', e)
    }
  }

  const nodes: TraceNode[] = []
  for (let i = 0; i < candidates.length; i++) {
    nodes.push(buildNode(
      candidates[i],
      results[i],
      goalAnchor,
      planItems,
      i > 0 ? nodes[i-1].id : null,
    ))
  }
  return nodes
}

// ── Goal anchor normalization ─────────────────────────────────────────────────

export async function normalizeGoalAnchor(
  rawQuery: string,
  config: ProviderConfig
): Promise<string> {
  const prompt = `以下是用户对 AI Agent 下达的原始指令，请用一句简洁的中文（不超过 20 字）概括其核心目标：

"${rawQuery}"

只回复目标陈述句，不要添加任何其他内容。`
  try {
    const result = await callDeepSeek(prompt, config)
    return result.trim().replace(/^["'「」]|["'「」]$/g,'')
  } catch {
    return rawQuery.slice(0,80)
  }
}

// ── Semantic branch detection ─────────────────────────────────────────────────

type DetourRange = { start: number; end: number; name: string }

async function detectDetoursWithLLM(
  nodes: TraceNode[],
  goalAnchor: GoalAnchor,
  config: ProviderConfig
): Promise<DetourRange[]> {
  const goal = goalAnchor.normalized_goal || goalAnchor.raw_query
  const steps = nodes.map((n,i)=>`[${i}] ${n.user_message.slice(0,60)}`).join('\n')
  const prompt = `总目标：「${goal}」

用户问题序列：
${steps}

请识别其中明显偏离总目标的「偏离段落」（连续多个问题明显跑题后又回归），仅标注确实存在的偏离。
JSON 数组回复（无偏离返回 []）：[{"start":2,"end":4,"name":"branch-name"}]`

  const raw = await callDeepSeek(prompt, config)
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return []
  const parsed = JSON.parse(match[0]) as unknown[]
  return parsed.filter((d): d is DetourRange =>
    typeof d==='object' && d!==null &&
    typeof (d as DetourRange).start==='number' &&
    typeof (d as DetourRange).end==='number' &&
    (d as DetourRange).start<=(d as DetourRange).end &&
    (d as DetourRange).start>=0 &&
    (d as DetourRange).end<nodes.length
  )
}

function thresholdDetours(nodes: TraceNode[]): DetourRange[] {
  const HIGH=0.62, LOW=0.38, MIN=2
  const out: DetourRange[]=[]
  let start=-1, idx=0
  for (let i=0;i<nodes.length;i++) {
    if (start<0 && nodes[i].goal_distance>=HIGH) {
      if (i+1<nodes.length && nodes[i+1].goal_distance>=HIGH) start=i
    } else if (start>=0 && nodes[i].goal_distance<LOW) {
      if (i-start>=MIN) out.push({start,end:i-1,name:`branch-${++idx}`})
      start=-1
    }
  }
  if (start>=0 && nodes.length-start>=MIN) out.push({start,end:nodes.length-1,name:`branch-${++idx}`})
  return out
}

function applyBranches(nodes: TraceNode[], detours: DetourRange[]): TraceNode[] {
  if (!detours.length) return nodes
  const bmap = new Map<number,string>()
  for (const d of detours) for (let i=d.start;i<=d.end;i++) bmap.set(i,d.name)
  const result: TraceNode[]=[]
  let lastMainId: string|null=null
  for (let i=0;i<nodes.length;i++) {
    const bid = bmap.get(i)?? 'main'
    const pbid = i>0?(bmap.get(i-1)?? 'main'):'main'
    const firstOfBranch = bid!=='main' && pbid==='main'
    const returningMain = bid==='main' && pbid!=='main'
    if (bid==='main') {
      const pid:string|null = returningMain ? lastMainId : (i>0 ? result[i-1].id : null)
      const n:TraceNode = {...nodes[i], branch_id:'main', parent_id:pid}
      result.push(n); lastMainId=n.id
    } else {
      const pid:string|null = firstOfBranch ? lastMainId : result[i-1].id
      result.push({...nodes[i], branch_id:bid, parent_id:pid})
    }
  }
  return result
}

export async function detectBranches(
  nodes: TraceNode[],
  goalAnchor: GoalAnchor,
  config: ProviderConfig | null
): Promise<TraceNode[]> {
  if (nodes.length<3) return nodes
  let detours: DetourRange[]=[]
  if (config?.apiKey) {
    try { detours=await detectDetoursWithLLM(nodes,goalAnchor,config) }
    catch { detours=thresholdDetours(nodes) }
  } else {
    detours=thresholdDetours(nodes)
  }
  return applyBranches(nodes,detours)
}
