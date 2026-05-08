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
]

export function seedSystemTopics(): void {
  for (const t of SYSTEM_TOPICS) {
    upsertSystemTopic(t.id, t.name, t.kind)
    logger.info({ id: t.id, name: t.name }, 'System topic ensured')
  }
}
