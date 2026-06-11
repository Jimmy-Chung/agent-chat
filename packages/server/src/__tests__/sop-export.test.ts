import type { TraceNode } from '@agent-chat/protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  type SopExportDeps,
  type SopExportLlmConfig,
  distillSopDraftWithLlm,
  runSopExportFromAttention,
} from '../sop/export'
import { buildSopDraftFromAttentionNodes } from '../sop/workflow'

const LLM: SopExportLlmConfig = {
  apiKey: 'k',
  baseUrl: 'https://llm.test/v1',
  model: 'm',
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
    intent: '',
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

const LLM_RESULT = {
  description: '拉取并分析数据的可复用工作流',
  instruction: [
    '步骤 1：拉取数据',
    '输入：数据源地址与筛选条件',
    '动作：校验数据源可达后拉取，缺字段时先补全映射',
    '产出：结构化原始数据集',
    '',
    '步骤 2：分析数据',
    '输入：步骤 1 的数据集',
    '动作：按目标维度聚合，输出关键指标与异常点',
    '产出：分析结论与图表',
  ].join('\n'),
  input_contract: '提供数据源与分析目标',
  output_contract: '交付分析结论、关键判断与后续建议',
  plan_template: '1. 拉取数据\n2. 分析数据',
  todo_items: [
    { id: '1', content: '拉取数据', status: 'pending' },
    { id: '2', content: '分析数据', status: 'pending' },
  ],
}

function okFetch(content: unknown = LLM_RESULT): typeof fetch {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(content) } }],
        }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch
}

function material(name = '数据分析 SOP') {
  return buildSopDraftFromAttentionNodes({
    name,
    topicName: '原话题',
    goalText: '分析数据',
    agentType: 'any',
    nodes: [traceNode('n1'), traceNode('n2')],
  })
}

describe('distillSopDraftWithLlm', () => {
  // TC-249-01
  it('maps structured LLM output into a stepwise draft aligned with plan and todos', async () => {
    const result = await distillSopDraftWithLlm({
      material: material(),
      llm: LLM,
      fetchImpl: okFetch(),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.name).toBe('数据分析 SOP')
    expect(result.draft.instruction).toBe(LLM_RESULT.instruction)
    expect(result.draft.instruction).not.toContain('用户输入 n1')
    expect(result.draft.plan_template?.split('\n')).toHaveLength(2)
    expect(result.draft.todo_items).toHaveLength(2)
    expect(
      result.draft.todo_items?.every((item) => item.status === 'pending'),
    ).toBe(true)
  })

  // TC-249-05（服务端部分）
  it('keeps agent_type as any regardless of source topic type', async () => {
    const result = await distillSopDraftWithLlm({
      material: material(),
      llm: LLM,
      fetchImpl: okFetch(),
    })
    expect(result.ok && result.draft.agent_type).toBe('any')
  })

  // TC-249-04
  it('fails with SOP_EXPORT_LLM_UNAVAILABLE when llm config is missing or incomplete', async () => {
    const missing = await distillSopDraftWithLlm({
      material: material(),
      llm: undefined,
    })
    expect(!missing.ok && missing.code).toBe('SOP_EXPORT_LLM_UNAVAILABLE')

    const incomplete = await distillSopDraftWithLlm({
      material: material(),
      llm: { ...LLM, apiKey: '' },
    })
    expect(!incomplete.ok && incomplete.code).toBe('SOP_EXPORT_LLM_UNAVAILABLE')
  })

  // TC-249-04
  it('fails with SOP_EXPORT_LLM_FAILED on http error, network error and bad payload', async () => {
    const httpError = vi.fn(
      async () => new Response('rate limited', { status: 429 }),
    ) as unknown as typeof fetch
    const networkError = vi.fn(async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    const badPayload = okFetch('这不是 JSON')

    for (const fetchImpl of [httpError, networkError, badPayload]) {
      const result = await distillSopDraftWithLlm({
        material: material(),
        llm: LLM,
        fetchImpl,
      })
      expect(!result.ok && result.code).toBe('SOP_EXPORT_LLM_FAILED')
    }
  })

  it('fails when the LLM omits required instruction or output_contract', async () => {
    const result = await distillSopDraftWithLlm({
      material: material(),
      llm: LLM,
      fetchImpl: okFetch({ ...LLM_RESULT, instruction: '' }),
    })
    expect(!result.ok && result.code).toBe('SOP_EXPORT_LLM_FAILED')
  })
})

function deps(overrides: Partial<SopExportDeps> = {}): SopExportDeps & {
  emitError: ReturnType<typeof vi.fn>
  emitGenerated: ReturnType<typeof vi.fn>
} {
  const nodes = [traceNode('n1'), traceNode('n2')]
  const base = {
    getTopic: vi.fn(async () => ({ id: 'topic-1', name: '原话题' })),
    getSnapshot: vi.fn(async () => ({
      topic_id: 'topic-1',
      goal_text: '分析数据',
      trace_nodes_json: JSON.stringify(nodes),
      mind_projection_json: JSON.stringify({
        nodes: [{ id: 'agg', sourceNodeIds: ['n1', 'n2'] }],
        edges: [],
      }),
    })),
    llm: LLM,
    fetchImpl: okFetch(),
    emitError: vi.fn(),
    emitGenerated: vi.fn(),
  }
  return { ...base, ...overrides } as ReturnType<typeof deps>
}

const REQUEST = {
  topicId: 'topic-1',
  name: '数据分析 SOP',
  selectedNodeIds: ['agg'],
  selectedSourceIds: ['n1', 'n2'],
}

describe('runSopExportFromAttention', () => {
  // TC-249-02（服务端部分）
  it('emits a generated draft instead of persisting', async () => {
    const d = deps()
    await runSopExportFromAttention(REQUEST, d)

    expect(d.emitError).not.toHaveBeenCalled()
    expect(d.emitGenerated).toHaveBeenCalledTimes(1)
    const template = d.emitGenerated.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >
    expect(template.name).toBe('数据分析 SOP')
    expect(template.agent_type).toBe('any')
    expect(template.instruction).toBe(LLM_RESULT.instruction)
    expect(JSON.parse(template.todo_items_json as string)).toHaveLength(2)
  })

  // TC-249-04（链路层）
  it('emits SOP_EXPORT_LLM_UNAVAILABLE without llm config and never generates', async () => {
    const d = deps({ llm: undefined })
    await runSopExportFromAttention(REQUEST, d)

    expect(d.emitGenerated).not.toHaveBeenCalled()
    expect(d.emitError).toHaveBeenCalledWith(
      'SOP_EXPORT_LLM_UNAVAILABLE',
      expect.any(String),
    )
  })

  it('emits SOP_EXPORT_LLM_FAILED when the LLM call fails', async () => {
    const failingFetch = vi.fn(async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    const d = deps({ fetchImpl: failingFetch })
    await runSopExportFromAttention(REQUEST, d)

    expect(d.emitGenerated).not.toHaveBeenCalled()
    expect(d.emitError).toHaveBeenCalledWith(
      'SOP_EXPORT_LLM_FAILED',
      expect.any(String),
    )
  })

  it('emits TOPIC_NOT_FOUND / snapshot errors on missing prerequisites', async () => {
    const noTopic = deps({ getTopic: vi.fn(async () => null) })
    await runSopExportFromAttention(REQUEST, noTopic)
    expect(noTopic.emitError).toHaveBeenCalledWith(
      'TOPIC_NOT_FOUND',
      expect.any(String),
    )

    const noSnapshot = deps({ getSnapshot: vi.fn(async () => null) })
    await runSopExportFromAttention(REQUEST, noSnapshot)
    expect(noSnapshot.emitError).toHaveBeenCalledWith(
      'ATTENTION_SNAPSHOT_NOT_FOUND',
      expect.any(String),
    )
  })

  it('emits ATTENTION_NODE_SELECTION_EMPTY when selection resolves to nothing', async () => {
    const d = deps()
    await runSopExportFromAttention(
      {
        ...REQUEST,
        selectedNodeIds: ['missing'],
        selectedSourceIds: undefined,
      },
      d,
    )
    expect(d.emitGenerated).not.toHaveBeenCalled()
    expect(d.emitError).toHaveBeenCalledWith(
      'ATTENTION_NODE_SELECTION_EMPTY',
      expect.any(String),
    )
  })
})
