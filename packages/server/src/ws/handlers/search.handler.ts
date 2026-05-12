import type { WSFrame } from '@agent-chat/protocol'
import { searchQuerySchema } from '@agent-chat/protocol'
import * as messageRepo from '../../db/repos/message.repo'
import { logger } from '../../logger'
import type { EventBroadcaster } from '../../pi/event-router'

export function registerSearchHandlers(
  hub: { on: (event: string, handler: (...args: unknown[]) => void) => void },
  broadcaster: EventBroadcaster,
): void {
  hub.on('client:search.query', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    try {
      const data = searchQuerySchema.parse(frame.d)
      const results = await messageRepo.searchMessages(data.q, data.topicId)
      logger.info({ query: data.q, count: results.length }, 'Search completed')
      broadcaster.broadcast('error', {
        code: 'SEARCH_RESULTS',
        message: JSON.stringify(results),
      })
    } catch (err) {
      logger.warn({ err }, 'Search failed')
    }
  })
}
