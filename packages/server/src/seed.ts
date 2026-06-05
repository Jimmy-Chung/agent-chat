import { upsertSystemTopic } from './db/repos/topic.repo'
import { logger } from './logger'

const SYSTEM_TOPICS = [
  {
    id: 'system_cron_admin',
    name: '⏰ 定时任务管理',
    kind: 'system_cron_admin' as const,
  },
  {
    id: 'system_artifact_pool',
    name: '📦 产物池',
    kind: 'system_artifact_pool' as const,
  },
  {
    id: 'system_sop_library',
    name: '📋 SOP 模板库',
    kind: 'system_sop_library' as const,
  },
]

export async function seedSystemTopics(): Promise<void> {
  for (const t of SYSTEM_TOPICS) {
    await upsertSystemTopic(t.id, t.name, t.kind)
    logger.info({ id: t.id, name: t.name }, 'System topic ensured')
  }
}
