import { describe, expect, it } from 'vitest'
import {
  assertValidSopNode,
  buildSopDraftFromAttentionNodes,
  buildSopDraftFromHistory,
  composeSopWorkflow,
  type SopNode,
} from '../sop/workflow'
import type { TraceNode } from '@agent-chat/protocol'

function makeSop(overrides: Partial<SopNode> = {}): SopNode {
  return {
    id: 'sop-1',
    name: '需求澄清',
    description: '澄清用户需求',
    agent_type: 'any',
    instruction: '整理需求目标、范围和待确认问题。',
    input_contract: '用户原始需求。',
    output_contract: '输出需求目标、范围、待确认问题。',
    plan_template: '1. 读取需求\n2. 输出澄清结果',
    todo_items: [
      { id: '1', content: '读取需求', status: 'pending' },
    ],
    ...overrides,
  }
}

function traceNode(id: string, overrides: Partial<TraceNode> = {}): TraceNode {
  const order = Number(id.replace(/\D/g, '')) || 1
  return {
    id,
    parent_id: null,
    branch_id: 'main',
    user_message: `用户输入 ${id}`,
    user_summary: `步骤 ${id}`,
    assistant_summary: `助手输出 ${id}`,
    intent: `处理 ${id}`,
    rationale: null,
    conclusion: `结论 ${id}`,
    planned_ref: null,
    alignment: 'unplanned',
    goal_distance: 0.2,
    status: 'done',
    event_ids: [id],
    source_message_ids: [`m-${id}`],
    step_count: 1,
    ts_start: order * 100,
    ts_end: order * 100 + 1,
    ...overrides,
  }
}

describe('AIT-224 SOP workflow', () => {
  it('TC-AIT-224-02 requires outputContract when saving SOP nodes', () => {
    expect(() => assertValidSopNode(makeSop({ output_contract: '' })))
      .toThrow('outputContract')
  })

  it('TC-AIT-224-05 composes multiple SOPs in order and chains previous output into next input', () => {
    const workflow = composeSopWorkflow([
      makeSop({ id: 'sop-1', name: '需求澄清', output_contract: '输出澄清结果。' }),
      makeSop({
        id: 'sop-2',
        name: '开发计划',
        instruction: '基于澄清结果拆解开发计划。',
        input_contract: '',
        output_contract: '输出开发计划。',
      }),
    ])

    expect(workflow?.selectedSops.map((entry) => entry.sopId)).toEqual(['sop-1', 'sop-2'])
    expect(workflow?.composedInstruction).toContain('SOP 1: 需求澄清')
    expect(workflow?.composedInstruction).toContain('SOP 2: 开发计划')
    expect(workflow?.composedInstruction).toContain('上一个 SOP「需求澄清」的输出。')
    expect(workflow?.composedInstruction.indexOf('SOP 1')).toBeLessThan(
      workflow?.composedInstruction.indexOf('SOP 2') ?? 0,
    )
  })

  it('TC-AIT-224-04 stores immutable snapshots for selected SOPs', () => {
    const source = makeSop()
    const workflow = composeSopWorkflow([source])
    source.instruction = 'mutated later'
    source.todo_items![0]!.content = 'mutated todo'

    expect(workflow?.selectedSops[0]?.snapshot.instruction).toBe('整理需求目标、范围和待确认问题。')
    expect(workflow?.selectedSops[0]?.snapshot.todo_items?.[0]?.content).toBe('读取需求')
  })

  it('TC-AIT-224-07 workflow snapshot does not include SOP-level workflowMode', () => {
    const workflow = composeSopWorkflow([makeSop()])
    expect(JSON.stringify(workflow)).not.toContain('workflowMode')
    expect(JSON.stringify(workflow)).not.toContain('workflow_mode')
  })

  it('TC-AIT-224-06 builds an editable SOP draft from full topic history', () => {
    const draft = buildSopDraftFromHistory({
      topicName: '移动端优化',
      messages: [
        { role: 'user', content: '需要优化移动端布局' },
        { role: 'assistant', content: '先检查断点，再修正按钮与列表。' },
      ],
    })

    expect(draft.name).toBe('移动端优化 SOP')
    expect(draft.output_contract).toContain('可直接交付')
    expect(draft.instruction).toContain('需要优化移动端布局')
    expect(draft.todo_items?.length).toBeGreaterThan(0)
  })

  it('builds a SOP draft from selected attention nodes in trace order', () => {
    const draft = buildSopDraftFromAttentionNodes({
      name: 'AkShare SOP',
      topicName: '/akshare',
      goalText: '维护 akshare 话题',
      agentType: 'programming',
      nodes: [
        traceNode('n3', { user_summary: '第三步' }),
        traceNode('n1', { user_summary: '第一步' }),
      ],
    })

    expect(draft.name).toBe('AkShare SOP')
    expect(draft.agent_type).toBe('programming')
    expect(draft.instruction.indexOf('第一步')).toBeLessThan(draft.instruction.indexOf('第三步'))
    expect(draft.plan_template).toBe('1. 第一步\n2. 第三步')
    expect(draft.todo_items?.map((item) => item.content)).toEqual(['第一步', '第三步'])
  })
})
