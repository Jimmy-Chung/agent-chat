import { eq } from 'drizzle-orm'
import { sopTemplates } from '../schema'
import { getDb } from '../migrate'
import { ulid } from '../../lib/ulid'

export interface SopTemplate {
  id: string
  name: string
  icon: string | null
  description: string | null
  agent_type: 'programming' | 'general' | 'any'
  instruction: string
  input_contract: string | null
  output_contract: string
  system_prompt_addon: string | null
  plan_template: string | null
  todos_template_json: string | null
  todo_items_json: string | null
  workflow_mode: 'lazy' | 'eager' | 'off'
  builtin: boolean
  created_at: number
  updated_at: number
}

export async function createTemplate(input: {
  name: string
  icon?: string
  description?: string
  agentType: 'programming' | 'general' | 'any'
  instruction?: string
  inputContract?: string | null
  outputContract?: string
  systemPromptAddon?: string
  planTemplate?: string
  todosTemplateJson?: string
  todoItemsJson?: string | null
  workflowMode?: 'lazy' | 'eager' | 'off'
  builtin?: boolean
}): Promise<SopTemplate> {
  const instruction = input.instruction ?? input.systemPromptAddon ?? ''
  const outputContract = input.outputContract ?? input.description ?? input.planTemplate ?? instruction
  if (!input.name.trim()) throw new Error('SOP name is required')
  if (!instruction.trim()) throw new Error('SOP instruction is required')
  if (!outputContract.trim()) throw new Error('SOP outputContract is required')

  const now = Date.now()
  const row = {
    id: ulid(),
    name: input.name,
    icon: input.icon ?? null,
    description: input.description ?? null,
    agentType: input.agentType,
    instruction,
    inputContract: input.inputContract ?? null,
    outputContract,
    systemPromptAddon: input.systemPromptAddon ?? null,
    planTemplate: input.planTemplate ?? null,
    todosTemplateJson: input.todosTemplateJson ?? null,
    todoItemsJson: input.todoItemsJson ?? input.todosTemplateJson ?? null,
    workflowMode: input.workflowMode ?? 'lazy',
    builtin: input.builtin ?? false,
    createdAt: now,
    updatedAt: now,
  }
  await getDb().insert(sopTemplates).values(row).run()
  return toDomain(row)
}

export async function getTemplate(id: string): Promise<SopTemplate | undefined> {
  const rows = await getDb()
    .select()
    .from(sopTemplates)
    .where(eq(sopTemplates.id, id))
    .all()
  return rows[0] ? toDomain(rows[0]) : undefined
}

export async function listTemplates(agentType?: string, options: { includeBuiltins?: boolean } = {}): Promise<SopTemplate[]> {
  const db = getDb()
  const query = db.select().from(sopTemplates)
  const rows = agentType
    ? await query.where(eq(sopTemplates.agentType, agentType)).all()
    : await query.all()
  return rows
    .map(toDomain)
    .filter((template) => options.includeBuiltins || !template.builtin)
}

export async function updateTemplate(
  id: string,
  data: Partial<Pick<SopTemplate, 'name' | 'icon' | 'description' | 'agent_type' | 'instruction' | 'input_contract' | 'output_contract' | 'system_prompt_addon' | 'plan_template' | 'todos_template_json' | 'todo_items_json' | 'workflow_mode'>>,
): Promise<SopTemplate | undefined> {
  const current = await getTemplate(id)
  if (!current) return undefined
  if (current.builtin) return undefined

  const nextName = data.name ?? current.name
  const nextInstruction = data.instruction ?? current.instruction
  const nextOutputContract = data.output_contract ?? current.output_contract
  if (!nextName.trim()) throw new Error('SOP name is required')
  if (!nextInstruction.trim()) throw new Error('SOP instruction is required')
  if (!nextOutputContract.trim()) throw new Error('SOP outputContract is required')

  const keyMap: Record<string, string> = {
    name: 'name',
    icon: 'icon',
    description: 'description',
    agent_type: 'agentType',
    instruction: 'instruction',
    input_contract: 'inputContract',
    output_contract: 'outputContract',
    system_prompt_addon: 'systemPromptAddon',
    plan_template: 'planTemplate',
    todos_template_json: 'todosTemplateJson',
    todo_items_json: 'todoItemsJson',
    workflow_mode: 'workflowMode',
  }
  const set: Record<string, unknown> = { updatedAt: Date.now() }
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      const col = keyMap[k] ?? k
      set[col] = v
    }
  }
  await getDb().update(sopTemplates).set(set).where(eq(sopTemplates.id, id)).run()
  return getTemplate(id)
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const t = await getTemplate(id)
  if (t?.builtin) return false
  const result = await getDb()
    .delete(sopTemplates)
    .where(eq(sopTemplates.id, id))
    .run()
  const meta = result.meta as { rows_written?: number } | undefined
  return (meta?.rows_written ?? 0) > 0
}

function toDomain(row: Record<string, unknown>): SopTemplate {
  const instruction = (row.instruction as string) || (row.systemPromptAddon as string) || ''
  const outputContract = (row.outputContract as string)
    || (row.description as string)
    || (row.planTemplate as string)
    || instruction
    || ''
  const todoItemsJson = (row.todoItemsJson as string) || (row.todosTemplateJson as string) || null
  return {
    id: row.id as string,
    name: row.name as string,
    icon: (row.icon as string) || null,
    description: (row.description as string) || null,
    agent_type: (row.agentType as string) as SopTemplate['agent_type'],
    instruction,
    input_contract: (row.inputContract as string) || null,
    output_contract: outputContract,
    system_prompt_addon: (row.systemPromptAddon as string) || null,
    plan_template: (row.planTemplate as string) || null,
    todos_template_json: (row.todosTemplateJson as string) || null,
    todo_items_json: todoItemsJson,
    workflow_mode: (row.workflowMode as string) as SopTemplate['workflow_mode'],
    builtin: row.builtin as boolean,
    created_at: row.createdAt as number,
    updated_at: row.updatedAt as number,
  }
}
