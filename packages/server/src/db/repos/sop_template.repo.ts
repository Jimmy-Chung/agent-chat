import { eq } from 'drizzle-orm'
import { sopTemplates } from '../schema'
import { getDb } from '../migrate'
import { ulid } from 'ulid'

export interface SopTemplate {
  id: string
  name: string
  icon: string | null
  description: string | null
  agent_type: 'programming' | 'general' | 'any'
  system_prompt_addon: string | null
  plan_template: string | null
  todos_template_json: string | null
  workflow_mode: 'lazy' | 'eager' | 'off'
  builtin: boolean
  created_at: number
  updated_at: number
}

export function createTemplate(input: {
  name: string
  icon?: string
  description?: string
  agentType: 'programming' | 'general' | 'any'
  systemPromptAddon?: string
  planTemplate?: string
  todosTemplateJson?: string
  workflowMode?: 'lazy' | 'eager' | 'off'
  builtin?: boolean
}): SopTemplate {
  const now = Date.now()
  const row = {
    id: ulid(),
    name: input.name,
    icon: input.icon ?? null,
    description: input.description ?? null,
    agentType: input.agentType,
    systemPromptAddon: input.systemPromptAddon ?? null,
    planTemplate: input.planTemplate ?? null,
    todosTemplateJson: input.todosTemplateJson ?? null,
    workflowMode: input.workflowMode ?? 'lazy',
    builtin: input.builtin ?? false,
    createdAt: now,
    updatedAt: now,
  }
  getDb().insert(sopTemplates).values(row).run()
  return toDomain(row)
}

export function getTemplate(id: string): SopTemplate | undefined {
  const rows = getDb()
    .select()
    .from(sopTemplates)
    .where(eq(sopTemplates.id, id))
    .all()
  return rows[0] ? toDomain(rows[0]) : undefined
}

export function listTemplates(agentType?: string): SopTemplate[] {
  const db = getDb()
  const query = db.select().from(sopTemplates)
  const rows = agentType
    ? query.where(eq(sopTemplates.agentType, agentType)).all()
    : query.all()
  return rows.map(toDomain)
}

export function updateTemplate(
  id: string,
  data: Partial<Pick<SopTemplate, 'name' | 'description' | 'system_prompt_addon' | 'plan_template' | 'todos_template_json' | 'workflow_mode'>>,
): SopTemplate | undefined {
  const keyMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    system_prompt_addon: 'systemPromptAddon',
    plan_template: 'planTemplate',
    todos_template_json: 'todosTemplateJson',
    workflow_mode: 'workflowMode',
  }
  const set: Record<string, unknown> = { updatedAt: Date.now() }
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      const col = keyMap[k] ?? k
      set[col] = v
    }
  }
  getDb().update(sopTemplates).set(set).where(eq(sopTemplates.id, id)).run()
  return getTemplate(id)
}

export function deleteTemplate(id: string): boolean {
  const t = getTemplate(id)
  if (t?.builtin) return false
  const result = getDb()
    .delete(sopTemplates)
    .where(eq(sopTemplates.id, id))
    .run()
  return result.changes > 0
}

function toDomain(row: Record<string, unknown>): SopTemplate {
  return {
    id: row.id as string,
    name: row.name as string,
    icon: (row.icon as string) || null,
    description: (row.description as string) || null,
    agent_type: (row.agentType as string) as SopTemplate['agent_type'],
    system_prompt_addon: (row.systemPromptAddon as string) || null,
    plan_template: (row.planTemplate as string) || null,
    todos_template_json: (row.todosTemplateJson as string) || null,
    workflow_mode: (row.workflowMode as string) as SopTemplate['workflow_mode'],
    builtin: row.builtin as boolean,
    created_at: row.createdAt as number,
    updated_at: row.updatedAt as number,
  }
}
