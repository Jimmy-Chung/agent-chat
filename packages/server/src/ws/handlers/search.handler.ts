import type { WSFrame } from '@agent-chat/protocol'
import { searchQuerySchema } from '@agent-chat/protocol'
import type { WsHub } from '../hub'
import * as messageRepo from '../../db/repos/message.repo'
import { logger } from '../../logger'

export function registerSearchHandlers(hub: WsHub): void {
  hub.on('client:search.query', (_conn, _frame: WSFrame) => {
    // search results can be sent back as server events
    // For now, log and emit — the client would need a dedicated search.result event
    try {
      const data = searchQuerySchema.parse(_frame.d)
      const results = messageRepo.searchMessages(data.q, data.topicId)
      logger.info({ query: data.q, count: results.length }, 'Search completed')
      // Results broadcast as a generic event for now
      hub.broadcast({
        type: 'error',
        data: {
          code: 'SEARCH_RESULTS',
          message: JSON.stringify(results),
        },
      })
    } catch (err) {
      logger.warn({ err }, 'Search failed')
    }
  })
}
