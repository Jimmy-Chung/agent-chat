// Attention 决策轨迹核心类型 —— 迁自 new-idea/attendtion-tracking/src/types/index.ts
// （去掉了原 ProviderConfig：LLM provider 由 S2 server 侧持有，不在前端类型里）

export type EventKind = 'tool_use' | 'thinking' | 'plan' | 'todo' | 'message'
export type UserMessageKind = 'question' | 'proposal' | 'choice' | 'evidence' | 'instruction'
export type AssistantActionKind = 'ask' | 'options' | 'solve' | 'status'

export type RawEvent = {
  id: string
  ts: number
  kind: EventKind
  role?: 'user' | 'assistant' // 'user' = real human input
  parent_task_id?: string
  turn_id?: string
  payload: Record<string, unknown>
  source_line?: number
  source_uuid?: string
}

export type AlignmentStatus = 'on_track' | 'skipped' | 'unplanned'
export type NodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'abandoned'

export type TraceExchange = {
  id: string
  user_message: string
  user_kind: UserMessageKind
  prev_ai_summary?: string // 上一轮 AI 回答（触发本次提问的上下文）
  assistant_summary: string
  assistant_actions: AssistantActionKind[]
  event_ids: string[]
  tool_count: number
  ts_start: number
  ts_end: number
}

export type TraceNode = {
  id: string
  parent_id: string | null
  branch_id: string

  user_message: string // 用户原话（这是节点的主体）
  intent: string // 模型对用户意图的归纳（可选）
  rationale: string | null
  conclusion: string | null // 这次交互完成了什么 / 发现了什么

  planned_ref: string | null
  alignment: AlignmentStatus
  goal_distance: number // 0~1，越大越偏离目标

  status: NodeStatus
  event_ids: string[] // 该节点包含的所有原始事件
  step_count: number // 聚合了几个工具调用步骤
  user_kind?: UserMessageKind
  assistant_actions?: AssistantActionKind[]
  user_message_count?: number
  exchanges?: TraceExchange[]

  ts_start: number
  ts_end: number | null
  is_loading?: boolean
}

export type PlanItem = {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed'
  depth: number
  execution_node_id?: string
}

export type GoalAnchor = {
  raw_query: string
  normalized_goal: string
  ts: number
}
