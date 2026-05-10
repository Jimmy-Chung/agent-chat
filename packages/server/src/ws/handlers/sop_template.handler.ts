import type { WSFrame } from '@agent-chat/protocol'
import { topicSelectSchema } from '@agent-chat/protocol'
import type { WsHub } from '../hub'
import * as sopRepo from '../../db/repos/sop_template.repo'

function templateToPayload(t: sopRepo.SopTemplate) {
  return {
    id: t.id,
    name: t.name,
    icon: t.icon,
    description: t.description,
    agent_type: t.agent_type,
    workflow_mode: t.workflow_mode,
    builtin: t.builtin,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }
}

export function registerSopTemplateHandlers(hub: WsHub): void {
  // Send template list when client opens SOP library
  hub.on('client:topic.select', (conn, frame: WSFrame) => {
    const data = topicSelectSchema.parse(frame.d)
    if (data.topicId !== 'system_sop_library') return

    const templates = sopRepo.listTemplates()
    hub.sendToClient(conn.ws, {
      type: 'sop_template.list',
      data: { templates: templates.map(templateToPayload) },
    })
  })
}
