import type { TodoItem } from '@agent-chat/protocol'

export type SopAgentType = 'general' | 'programming' | 'any'

export interface SopNode {
  id: string
  name: string
  description?: string | null
  agent_type: SopAgentType
  instruction: string
  input_contract?: string | null
  output_contract: string
  plan_template?: string | null
  todo_items?: TodoItem[]
  created_at?: number
  updated_at?: number
}

export interface SopSnapshotEntry {
  sopId: string
  name: string
  order: number
  snapshot: SopNode
}

export interface TopicSopSnapshot {
  selectedSops: SopSnapshotEntry[]
  composedInstruction: string
  composedPlan?: string
  composedTodos?: TodoItem[]
}

export function assertValidSopNode(input: Pick<SopNode, 'name' | 'instruction' | 'output_contract'>): void {
  if (!input.name.trim()) throw new Error('SOP name is required')
  if (!input.instruction.trim()) throw new Error('SOP instruction is required')
  if (!input.output_contract.trim()) throw new Error('SOP outputContract is required')
}

function cloneSopNode(node: SopNode): SopNode {
  return {
    ...node,
    todo_items: node.todo_items?.map((item) => ({ ...item })),
  }
}

export function composeSopWorkflow(nodes: SopNode[]): TopicSopSnapshot | undefined {
  if (nodes.length === 0) return undefined

  const selectedSops = nodes.map((node, index) => ({
    sopId: node.id,
    name: node.name,
    order: index,
    snapshot: cloneSopNode(node),
  }))

  const instructionBlocks = nodes.map((node, index) => {
    const previousOutput = index === 0
      ? '用户输入、话题上下文与当前会话历史。'
      : `上一个 SOP「${nodes[index - 1]!.name}」的输出。`
    return [
      `## SOP ${index + 1}: ${node.name}`,
      node.description ? `目标：${node.description}` : undefined,
      `输入契约：${node.input_contract?.trim() || previousOutput}`,
      `执行指令：${node.instruction}`,
      `输出契约：${node.output_contract}`,
    ].filter(Boolean).join('\n')
  })

  const composedPlan = nodes
    .map((node, index) => node.plan_template?.trim()
      ? `## SOP ${index + 1}: ${node.name}\n\n${node.plan_template.trim()}`
      : '')
    .filter(Boolean)
    .join('\n\n')

  const composedTodos = nodes.flatMap((node, nodeIndex) =>
    (node.todo_items ?? []).map((item, itemIndex) => ({
      ...item,
      id: `${nodeIndex + 1}.${item.id || itemIndex + 1}`,
      content: `[${node.name}] ${item.content}`,
    })),
  )

  return {
    selectedSops,
    composedInstruction: instructionBlocks.join('\n\n'),
    ...(composedPlan ? { composedPlan } : {}),
    ...(composedTodos.length > 0 ? { composedTodos } : {}),
  }
}

export function buildSopDraftFromHistory(input: {
  topicName: string
  messages: Array<{ role: string; content: string }>
}): Omit<SopNode, 'id' | 'created_at' | 'updated_at'> {
  const turns = input.messages
    .filter((message) => message.content.trim())
    .slice(-20)
    .map((message) => `${message.role}: ${message.content.trim()}`)
    .join('\n')

  const summary = turns
    ? turns.slice(0, 1200)
    : '当前话题暂无可总结的会话内容。'

  return {
    name: `${input.topicName} SOP`,
    description: `从「${input.topicName}」会话历史生成的 SOP 草稿`,
    agent_type: 'any',
    instruction: [
      '复用当前会话中已经沉淀出的工作方法，按步骤完成同类任务。',
      '执行时先确认输入是否满足输入契约，再产出符合输出契约的结果。',
      '',
      '会话依据：',
      summary,
    ].join('\n'),
    input_contract: '用户提供同类任务目标、必要上下文与约束条件。',
    output_contract: '输出可直接交付给用户的结果，并列出关键决策、执行步骤和后续建议。',
    plan_template: '1. 确认目标与输入\n2. 按 SOP 指令执行\n3. 校验输出契约\n4. 汇总结果与后续建议',
    todo_items: [
      { id: '1', content: '确认输入满足 SOP 输入契约', status: 'pending' },
      { id: '2', content: '按 SOP 指令执行任务', status: 'pending' },
      { id: '3', content: '校验结果满足输出契约', status: 'pending' },
    ],
  }
}
