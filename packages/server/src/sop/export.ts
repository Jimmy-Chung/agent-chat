import type {
  MindMapProjection,
  TodoItem,
  TraceNode,
} from '@agent-chat/protocol'
import { type SopNode, buildSopDraftFromAttentionNodes } from './workflow'

export type SopDraft = Omit<SopNode, 'id' | 'created_at' | 'updated_at'>

export interface SopExportLlmConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export type SopExportFailureCode =
  | 'TOPIC_NOT_FOUND'
  | 'ATTENTION_SNAPSHOT_NOT_FOUND'
  | 'ATTENTION_SNAPSHOT_EMPTY'
  | 'ATTENTION_NODE_SELECTION_EMPTY'
  | 'ATTENTION_NODE_SELECTION_INVALID'
  | 'SOP_EXPORT_LLM_UNAVAILABLE'
  | 'SOP_EXPORT_LLM_FAILED'

export type SopExportDistillResult =
  | { ok: true; draft: SopDraft }
  | {
      ok: false
      code: 'SOP_EXPORT_LLM_UNAVAILABLE' | 'SOP_EXPORT_LLM_FAILED'
      message: string
    }

export interface SopExportGeneratedTemplate {
  name: string
  icon: string | null
  description: string | null
  agent_type: SopDraft['agent_type']
  instruction: string
  input_contract: string | null
  output_contract: string
  plan_template: string | null
  todo_items_json: string | null
}

export interface SopExportRequest {
  topicId: string
  goalId?: string
  name: string
  selectedNodeIds: string[]
  selectedSourceIds?: string[]
}

export interface SopExportDeps {
  getTopic(id: string): Promise<{ id: string; name: string } | null | undefined>
  getSnapshot(input: { topicId: string; goalId?: string }): Promise<
    | {
        topic_id: string
        goal_text: string | null
        trace_nodes_json: string | null
        mind_projection_json: string | null
      }
    | null
    | undefined
  >
  llm: SopExportLlmConfig | undefined
  fetchImpl?: typeof fetch
  emitError(code: SopExportFailureCode, message: string): void
  emitGenerated(template: SopExportGeneratedTemplate): void
}

const LLM_TIMEOUT_MS = 20_000

/**
 * Resolve the trace-node source ids for an export selection. Prefers explicit
 * selectedSourceIds (the client computed them against its live projection,
 * which may differ from the stored one when nodes are expanded); falls back to
 * mapping projection node ids for older clients.
 */
export function resolveSelectedAttentionSourceIds(
  projection: MindMapProjection,
  selectedNodeIds: string[],
  selectedSourceIds?: string[],
): string[] {
  const sourceIds = new Set<string>()
  for (const sourceId of selectedSourceIds ?? []) {
    if (sourceId) sourceIds.add(sourceId)
  }
  if (sourceIds.size > 0) return [...sourceIds]

  const selected = new Set(selectedNodeIds)
  for (const node of projection.nodes) {
    if (!selected.has(node.id)) continue
    for (const sourceId of node.sourceNodeIds ?? []) {
      if (sourceId) sourceIds.add(sourceId)
    }
  }
  return [...sourceIds]
}

/**
 * Distill raw attention-node material into a reusable stepwise workflow via
 * the attention LLM. The material's transcript-style instruction is input
 * only — without a usable LLM result, nothing is produced (no fallback).
 */
export async function distillSopDraftWithLlm(input: {
  material: SopDraft
  llm: SopExportLlmConfig | undefined
  fetchImpl?: typeof fetch
}): Promise<SopExportDistillResult> {
  const { material, llm } = input
  if (!llm?.apiKey || !llm.baseUrl || !llm.model) {
    return {
      ok: false,
      code: 'SOP_EXPORT_LLM_UNAVAILABLE',
      message: '未配置 SOP 提炼 LLM（ATTENTION_LLM_*），无法生成 SOP 草稿',
    }
  }
  const fetchImpl = input.fetchImpl ?? fetch

  const prompt = [
    '下面是从一次会话的注意力节点中提取的原始步骤材料（含用户输入与助手输出摘录）。',
    '请把它提炼成一份可复用的标准工作流（SOP），供同类任务直接执行。',
    '',
    '要求：',
    '- 只输出一个 JSON 对象，不要 markdown。字段：description, instruction, input_contract, output_contract, plan_template, todo_items。',
    '- instruction 必须是分步工作流，每步包含：步骤名、输入、动作（含关键判断）、产出。提炼做事方法，禁止照抄原始对话文本，禁止出现「用户说 / 助手说」式罗列。',
    '- 步骤数量与原始步骤大体对应，高度相关的相邻步骤可合并。',
    '- plan_template 是与步骤一一对应的编号清单，每行格式 `N. 步骤名`。',
    '- todo_items 是与步骤一一对应的数组，每项 {id, content, status}，status 固定 "pending"。',
    '- 保留输入材料中的 name 与 agent_type，不要更改。',
    '',
    JSON.stringify({
      name: material.name,
      agent_type: material.agent_type,
      description: material.description,
      instruction: material.instruction,
      input_contract: material.input_contract,
      output_contract: material.output_contract,
      plan_template: material.plan_template,
      todo_items: material.todo_items,
    }),
  ].join('\n')

  try {
    const res = await fetchImpl(
      `${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${llm.apiKey}`,
        },
        body: JSON.stringify({
          model: llm.model,
          max_tokens: 2400,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                '你是工作流提炼器：把结构化会话步骤材料提炼为简洁、可执行、可复用的 SOP 模板，并严格输出 JSON。',
            },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      },
    )
    if (!res.ok) {
      return {
        ok: false,
        code: 'SOP_EXPORT_LLM_FAILED',
        message: `SOP 提炼调用失败（HTTP ${res.status}）`,
      }
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    const parsed = parseJsonObjectLoose(content)
    if (!parsed) {
      return {
        ok: false,
        code: 'SOP_EXPORT_LLM_FAILED',
        message: 'SOP 提炼结果不是合法 JSON',
      }
    }
    const instruction = pickNonEmptyString(parsed.instruction)
    const outputContract = pickNonEmptyString(parsed.output_contract)
    if (!instruction || !outputContract) {
      return {
        ok: false,
        code: 'SOP_EXPORT_LLM_FAILED',
        message: 'SOP 提炼结果缺少 instruction 或 output_contract',
      }
    }
    return {
      ok: true,
      draft: {
        ...material,
        description:
          pickNonEmptyString(parsed.description) ?? material.description,
        instruction,
        input_contract:
          pickNonEmptyString(parsed.input_contract) ?? material.input_contract,
        output_contract: outputContract,
        plan_template:
          pickNonEmptyString(parsed.plan_template) ?? material.plan_template,
        todo_items:
          normalizeLlmTodoItems(parsed.todo_items) ?? material.todo_items,
      },
    }
  } catch (err) {
    return {
      ok: false,
      code: 'SOP_EXPORT_LLM_FAILED',
      message: `SOP 提炼调用异常：${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Full export pipeline: load the attention snapshot, pick the selected trace
 * nodes, distill them with the LLM, and emit the result as an editable draft
 * (sop_template.generated). Persisting happens later via sop_template.create
 * once the user confirms the draft in the editor.
 */
export async function runSopExportFromAttention(
  request: SopExportRequest,
  deps: SopExportDeps,
): Promise<void> {
  const topic = await deps.getTopic(request.topicId)
  if (!topic) {
    deps.emitError('TOPIC_NOT_FOUND', '话题不存在')
    return
  }

  const snapshot = await deps.getSnapshot({
    topicId: request.topicId,
    goalId: request.goalId,
  })
  if (!snapshot || snapshot.topic_id !== request.topicId) {
    deps.emitError(
      'ATTENTION_SNAPSHOT_NOT_FOUND',
      '当前话题没有可导出的注意力快照',
    )
    return
  }

  const traceNodes = parseJsonArrayLoose<TraceNode>(snapshot.trace_nodes_json)
  const projection = parseJsonObjectLoose(
    snapshot.mind_projection_json,
  ) as MindMapProjection | null
  if (!traceNodes.length || !projection?.nodes?.length) {
    deps.emitError(
      'ATTENTION_SNAPSHOT_EMPTY',
      '当前注意力快照为空，无法导出 SOP',
    )
    return
  }

  const selectedSourceIds = resolveSelectedAttentionSourceIds(
    projection,
    request.selectedNodeIds,
    request.selectedSourceIds,
  )
  if (!selectedSourceIds.length) {
    deps.emitError(
      'ATTENTION_NODE_SELECTION_EMPTY',
      '所选注意力节点没有可导出的源内容',
    )
    return
  }

  const selectedSourceSet = new Set(selectedSourceIds)
  const orderedNodes = traceNodes.filter((node) =>
    selectedSourceSet.has(node.id),
  )
  if (!orderedNodes.length) {
    deps.emitError(
      'ATTENTION_NODE_SELECTION_INVALID',
      '所选注意力节点无法匹配到源内容',
    )
    return
  }

  // 导出的 SOP 默认适用任意 Agent 类型；用户可在草稿编辑器中收窄。
  const material = buildSopDraftFromAttentionNodes({
    name: request.name,
    topicName: topic.name,
    goalText: snapshot.goal_text,
    agentType: 'any',
    nodes: orderedNodes,
  })

  const result = await distillSopDraftWithLlm({
    material,
    llm: deps.llm,
    fetchImpl: deps.fetchImpl,
  })
  if (!result.ok) {
    deps.emitError(result.code, result.message)
    return
  }

  deps.emitGenerated({
    name: result.draft.name,
    icon: null,
    description: result.draft.description ?? null,
    agent_type: result.draft.agent_type,
    instruction: result.draft.instruction,
    input_contract: result.draft.input_contract ?? null,
    output_contract: result.draft.output_contract,
    plan_template: result.draft.plan_template ?? null,
    todo_items_json: result.draft.todo_items
      ? JSON.stringify(result.draft.todo_items)
      : null,
  })
}

function pickNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeLlmTodoItems(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const todos: TodoItem[] = []
  value.forEach((item, index) => {
    if (typeof item === 'string') {
      const content = item.trim()
      if (content)
        todos.push({ id: String(index + 1), content, status: 'pending' })
      return
    }
    if (!item || typeof item !== 'object') return
    const record = item as Record<string, unknown>
    const content = pickNonEmptyString(record.content)
    if (!content) return
    todos.push({
      id: pickNonEmptyString(record.id) ?? String(index + 1),
      content,
      status: 'pending',
    })
  })
  return todos.length ? todos : undefined
}

function parseJsonObjectLoose(
  value: string | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function parseJsonArrayLoose<T>(value: string | null | undefined): T[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}
