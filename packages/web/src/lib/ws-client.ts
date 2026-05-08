'use client'

import {
  type WSFrame,
  type ClientEvent,
  type ServerEvent,
  encodeFrame,
  decodeFrame,
  createFrame,
  serverEventDataSchemas,
} from '@agent-chat/protocol'
import { useWsStore } from '@/stores/ws-store'
import { useTopicStore } from '@/stores/topic-store'
import { useMessageStore } from '@/stores/message-store'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://127.0.0.1:8080/ws'
const TOKEN_KEY = 'AGENT_CHAT_TOKEN'

const MAX_RECONNECT_DELAY = 30_000
const BASE_RECONNECT_DELAY = 1_000

class WsClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private disposed = false

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return
    this.disposed = false

    const token =
      typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
    const url = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL

    useWsStore.getState().setStatus('connecting')
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.attempt = 0
      useWsStore.getState().setStatus('connected')
    }

    this.ws.onmessage = (ev) => {
      try {
        const frame = decodeFrame(ev.data as string)
        this.handleFrame(frame)
      } catch {
        // Ignore malformed frames
      }
    }

    this.ws.onclose = () => {
      useWsStore.getState().setStatus('disconnected')
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onclose will fire after onerror
    }
  }

  disconnect(): void {
    this.disposed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    useWsStore.getState().setStatus('disconnected')
  }

  send(event: ClientEvent): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const frame = createFrame(event.type, event.data)
    this.ws.send(encodeFrame(frame))
  }

  private handleFrame(frame: WSFrame): void {
    if (frame.seq !== undefined) {
      useWsStore.getState().setLastSeq(frame.seq)
    }

    const parser = serverEventDataSchemas[frame.t]
    if (!parser) return

    const data = parser.parse(frame.d)
    const event = { type: frame.t, data } as ServerEvent
    this.dispatch(event)
  }

  private toTopic(raw: Record<string, unknown>): import('@agent-chat/protocol').Topic {
    return {
      id: raw.id as string,
      name: raw.name as string,
      kind: raw.kind as import('@agent-chat/protocol').Topic['kind'],
      agent_type: raw.agent_type as import('@agent-chat/protocol').Topic['agent_type'],
      pi_session_id: (raw.pi_session_id as string) ?? null,
      programming_spec_json: null,
      general_spec_json: null,
      sop_template_id: null,
      current_model: (raw.current_model as string) ?? null,
      history_frozen_at: (raw.history_frozen_at as number) ?? null,
      created_at: raw.created_at as number,
      updated_at: raw.updated_at as number,
      archived: (raw.archived as boolean) ?? false,
    }
  }

  private dispatch(event: ServerEvent): void {
    const topicStore = useTopicStore.getState()
    const messageStore = useMessageStore.getState()

    switch (event.type) {
      case 'topics.list':
        topicStore.setTopics(event.data.topics.map((t) => this.toTopic(t as Record<string, unknown>)))
        break
      case 'topic.created':
        topicStore.upsertTopic(this.toTopic(event.data as Record<string, unknown>))
        break
      case 'topic.updated':
        topicStore.upsertTopic(this.toTopic(event.data as Record<string, unknown>))
        break
      case 'topic.deleted':
        topicStore.removeTopic(event.data.id)
        messageStore.removeMessagesByTopic(event.data.id)
        break
      case 'message.start':
        messageStore.addMessage(event.data.topicId, {
          id: event.data.messageId,
          topic_id: event.data.topicId,
          role: event.data.role,
          status: 'streaming',
          started_at: Date.now(),
          finished_at: null,
          stop_reason: null,
          cron_run_id: null,
        })
        break
      case 'message.end':
        messageStore.updateMessage(event.data.messageId, {
          status: event.data.stopReason === 'aborted' ? 'aborted' : 'done',
          finished_at: Date.now(),
          stop_reason: event.data.stopReason,
        })
        break
      case 'message.delta':
        messageStore.appendPart(event.data.messageId, {
          id: `${event.data.messageId}-${Date.now()}`,
          message_id: event.data.messageId,
          ordinal: 0,
          kind: 'text',
          content_json: JSON.stringify(event.data.part),
        })
        break
      case 'error':
        console.error('[ws] server error:', event.data)
        break
      // Other events handled in future features
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, this.attempt),
      MAX_RECONNECT_DELAY,
    )
    this.attempt++
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }
}

// Singleton instance
let instance: WsClient | null = null

export function getWsClient(): WsClient {
  if (!instance) {
    instance = new WsClient()
  }
  return instance
}

export type { WsClient }
