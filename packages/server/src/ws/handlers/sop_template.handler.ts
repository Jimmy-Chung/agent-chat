import type { WSFrame } from '@agent-chat/protocol'
import { topicSelectSchema } from '@agent-chat/protocol'
import * as sopRepo from '../../db/repos/sop_template.repo'

function templateToPayload(t: sopRepo.SopTemplate) {
  return {
    id: t.id,
    name: t.name,
    icon: t.icon,
    description: t.description,
    agent_type: t.agent_type,
    instruction: t.instruction,
    input_contract: t.input_contract,
    output_contract: t.output_contract,
    plan_template: t.plan_template,
    todo_items_json: t.todo_items_json,
    builtin: t.builtin,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }
}

export function registerSopTemplateHandlers(
  hub: { on: (event: string, handler: (...args: unknown[]) => void) => void; sendToClient?: (ws: unknown, event: { type: string; data: unknown }) => void },
): void {
  hub.on('client:topic.select', async (...args: unknown[]) => {
    const conn = args[0]
    const frame = args[1] as WSFrame
    const data = topicSelectSchema.parse(frame.d)
    if (data.topicId !== 'system_sop_library') return

    const templates = await sopRepo.listTemplates()
    if (hub.sendToClient) {
      hub.sendToClient(conn, {
        type: 'sop_template.list',
        data: { templates: templates.map(templateToPayload) },
      })
    }
  })
}
