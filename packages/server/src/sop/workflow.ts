import type { TodoItem, TraceNode } from '@agent-chat/protocol'

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

function compactText(value: string | null | undefined, fallback = ''): string {
  return (value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    || fallback
}

function nodeTitle(node: TraceNode): string {
  return compactText(
    node.aggregate_title
      || node.user_summary
      || node.intent
      || node.user_message,
    '未命名步骤',
  ).slice(0, 80)
}

function nodeAssistantText(node: TraceNode): string {
  return compactText(node.assistant_summary || node.conclusion, '根据该轮上下文完成处理并沉淀结论。')
}

function nodeUserText(node: TraceNode): string {
  return compactText(node.user_message, '用户提供该步骤的输入。')
}

export function buildSopDraftFromAttentionNodes(input: {
  name: string
  topicName: string
  goalText?: string | null
  agentType: 'programming' | 'general' | 'any'
  nodes: TraceNode[]
}): Omit<SopNode, 'id' | 'created_at' | 'updated_at'> {
  const orderedNodes = input.nodes
    .filter((node) => node && compactText(node.user_message || node.intent))
    .sort((a, b) => (a.ts_start ?? 0) - (b.ts_start ?? 0))

  const steps = orderedNodes.map((node, index) => {
    const title = nodeTitle(node)
    const exchanges = (node.exchanges ?? []).filter((exchange) => compactText(exchange.user_message))
    const dialogue = exchanges.length > 1
      ? exchanges.map((exchange, exchangeIndex) => [
          `  ${index + 1}.${exchangeIndex + 1} 用户输入：${compactText(exchange.user_message)}`,
          `  ${index + 1}.${exchangeIndex + 1} 助手输出：${compactText(exchange.assistant_summary, nodeAssistantText(node))}`,
        ].join('\n')).join('\n')
      : [
          `用户输入：${exchanges[0] ? compactText(exchanges[0].user_message) : nodeUserText(node)}`,
          `助手输出：${exchanges[0] ? compactText(exchanges[0].assistant_summary, nodeAssistantText(node)) : nodeAssistantText(node)}`,
        ].join('\n')
    return {
      id: String(index + 1),
      title,
      block: [`步骤 ${index + 1}：${title}`, dialogue].join('\n'),
    }
  })

  const stepText = steps.length
    ? steps.map((step) => step.block).join('\n\n')
    : '当前选择没有可导出的注意力节点。'
  const goalLine = compactText(input.goalText, compactText(input.topicName, '当前话题目标'))

  return {
    name: input.name.trim(),
    description: `从「${input.topicName}」注意力节点导出的 SOP`,
    agent_type: input.agentType,
    instruction: [
      `复用「${input.topicName}」中围绕目标「${goalLine}」沉淀出的工作步骤。`,
      '执行同类任务时，按下列步骤推进；每一步先理解用户输入，再复用对应助手处理方式产出结果。',
      '',
      stepText,
    ].join('\n'),
    input_contract: '用户提供同类任务目标、必要上下文、约束条件，以及每个步骤所需输入。',
    output_contract: '按 SOP 步骤完成任务，输出可交付结果，并说明关键判断、执行过程和后续建议。',
    plan_template: steps.length
      ? steps.map((step, index) => `${index + 1}. ${step.title}`).join('\n')
      : '1. 确认输入\n2. 执行 SOP\n3. 校验输出',
    todo_items: steps.length
      ? steps.map((step) => ({ id: step.id, content: step.title, status: 'pending' as const }))
      : [
          { id: '1', content: '确认输入满足 SOP 输入契约', status: 'pending' },
          { id: '2', content: '按 SOP 指令执行任务', status: 'pending' },
          { id: '3', content: '校验结果满足输出契约', status: 'pending' },
        ],
  }
}
