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
import { useArtifactStore } from '@/stores/artifact-store'
import { useCronStore } from '@/stores/cron-store'
import { useSopTemplateStore } from '@/stores/sop-template-store'

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws`
  }
  return 'ws://127.0.0.1:8080/ws'
}

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

    const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
    const wsUrl = getWsUrl()
    const url = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl

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
      plan_mode: Boolean(raw.plan_mode),
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
          turn_id: (event.data as { turnId?: string }).turnId ?? null,
        })
        messageStore.startStreaming(event.data.messageId)
        break

      case 'message.delta': {
        const part = event.data.part
        if (part.kind === 'text') {
          messageStore.appendDelta(event.data.messageId, part.content)
          const nextText = `${useMessageStore.getState().streamingText[event.data.messageId] ?? ''}`
          messageStore.upsertSnapshotPart(
            event.data.messageId,
            'text',
            JSON.stringify({ content: nextText }),
            `${event.data.messageId}-text`,
          )
        }
        if (part.kind === 'thinking') {
          messageStore.appendThinkingDelta(event.data.messageId, part.content)
          const nextThinking = `${useMessageStore.getState().streamingThinking[event.data.messageId] ?? ''}`
          messageStore.upsertSnapshotPart(
            event.data.messageId,
            'thinking',
            JSON.stringify({ content: nextThinking }),
            `${event.data.messageId}-thinking`,
          )
        }
        if (part.kind === 'tool_input') {
          messageStore.appendToolInputDelta(event.data.messageId, part.toolUseId, part.partial)
        }
        break
      }

      case 'message.end':
        if (messageStore.streamingMessageId === event.data.messageId) {
          messageStore.endStreaming(event.data.messageId)
        }
        messageStore.updateMessage(event.data.messageId, {
          status: event.data.stopReason === 'aborted' ? 'aborted' : 'done',
          finished_at: Date.now(),
          stop_reason: event.data.stopReason,
        })
        break

      case 'error':
        console.error('[ws] server error:', event.data)
        break

      case 'tool.call': {
        const d = event.data as Record<string, unknown>
        messageStore.upsertSnapshotPart(
          d.messageId as string,
          'tool_use',
          JSON.stringify({
            toolUseId: d.toolUseId,
            name: d.name,
            input: d.input,
          }),
          `tool-${String(d.toolUseId)}`,
        )
        break
      }

      case 'tool.result': {
        const d = event.data as Record<string, unknown>
        messageStore.upsertSnapshotPart(
          d.messageId as string,
          'tool_result',
          JSON.stringify({
            toolUseId: d.toolUseId,
            output: d.output,
            isError: d.isError,
          }),
          `tool-result-${String(d.toolUseId)}`,
        )
        break
      }

      case 'file.diff': {
        const d = event.data as Record<string, unknown>
        messageStore.upsertSnapshotPart(
          d.messageId as string,
          'file_diff',
          JSON.stringify({ path: d.path, before: d.before, after: d.after }),
          `diff-${String(d.path)}`,
        )
        break
      }

      case 'artifact.added': {
        const a = event.data as Record<string, unknown>
        useArtifactStore.getState().addArtifact({
          id: a.id as string,
          topic_id: (a.topic_id as string) ?? null,
          origin_topic_id: null,
          name: a.name as string,
          mime: (a.mime as string) ?? null,
          size_bytes: (a.size_bytes as number) ?? null,
          r2_key: '',
          source: a.source as 'generated' | 'uploaded',
          created_at: a.created_at as number,
          metadata_json: null,
        })
        break
      }

      case 'artifact.deleted':
        useArtifactStore.getState().removeArtifact(event.data.id)
        break

      case 'artifact.moved':
        useArtifactStore.getState().moveArtifact(
          event.data.id,
          event.data.fromTopicId,
          event.data.toTopicId,
        )
        break

      case 'artifact.list': {
        const rawList = (event.data as { artifacts: unknown[] }).artifacts
        const artifacts = rawList.map((a) => ({
          id: (a as Record<string, unknown>).id as string,
          topic_id: ((a as Record<string, unknown>).topic_id as string) ?? null,
          origin_topic_id: null,
          name: (a as Record<string, unknown>).name as string,
          mime: ((a as Record<string, unknown>).mime as string) ?? null,
          size_bytes: ((a as Record<string, unknown>).size_bytes as number) ?? null,
          r2_key: '',
          source: (a as Record<string, unknown>).source as 'generated' | 'uploaded',
          created_at: (a as Record<string, unknown>).created_at as number,
          metadata_json: null,
        }))
        const activeTopicId = useTopicStore.getState().activeTopicId
        if (activeTopicId === 'system_artifact_pool') {
          useArtifactStore.getState().setPoolArtifacts(artifacts)
        } else if (activeTopicId) {
          useArtifactStore.getState().setTopicArtifacts(activeTopicId, artifacts)
        }
        break
      }

      case 'cron.list': {
        const crons = (event.data as { crons: unknown[] }).crons.map((c) => {
          const r = c as Record<string, unknown>
          return {
            cronId: r.cronId as string,
            originTopicId: r.originTopicId as string,
            cronExpr: r.cronExpr as string,
            prompt: r.prompt as string,
            status: r.status as 'active' | 'paused' | 'error',
            lastRunAt: r.lastRunAt as number | undefined,
            nextRunAt: r.nextRunAt as number | undefined,
          }
        })
        useCronStore.getState().setCrons(crons)
        break
      }

      case 'cron.upserted':
        useCronStore.getState().upsertCron({
          cronId: (event.data as Record<string, unknown>).cronId as string,
          originTopicId: (event.data as Record<string, unknown>).originTopicId as string,
          cronExpr: (event.data as Record<string, unknown>).cronExpr as string,
          prompt: (event.data as Record<string, unknown>).prompt as string,
          status: (event.data as Record<string, unknown>).status as 'active' | 'paused' | 'error',
        })
        break

      case 'cron.triggered':
        useCronStore.getState().addRun({
          id: (event.data as Record<string, unknown>).runId as string,
          cronId: (event.data as Record<string, unknown>).cronId as string,
          triggeredAt: (event.data as Record<string, unknown>).firedAt as number,
          firedAt: (event.data as Record<string, unknown>).firedAt as number,
        })
        break

      case 'sop_template.list': {
        const templates = (event.data as { templates: unknown[] }).templates.map((t) => {
          const r = t as Record<string, unknown>
          return {
            id: r.id as string,
            name: r.name as string,
            icon: (r.icon as string) ?? null,
            description: (r.description as string) ?? null,
            agent_type: r.agent_type as 'programming' | 'general' | 'any',
            workflow_mode: r.workflow_mode as 'lazy' | 'eager' | 'off',
            builtin: r.builtin as boolean,
            created_at: r.created_at as number,
            updated_at: r.updated_at as number,
          }
        })
        useSopTemplateStore.getState().setTemplates(templates)
        break
      }

      case 'todo.update': {
        const d = event.data as Record<string, unknown>
        messageStore.setTodos(d.topicId as string, d.items as Array<{ id: string; content: string; status: string; activeForm?: string }>)
        break
      }

      case 'plan.update': {
        const d = event.data as Record<string, unknown>
        messageStore.setPlan(d.topicId as string, d.plan as string)
        break
      }

      case 'interaction.request': {
        const d = event.data as Record<string, unknown>
        const msgId = (d.messageId as string) ?? ''
        messageStore.setInteraction(d.interactionId as string, {
          interactionId: d.interactionId as string,
          messageId: msgId,
          topicId: d.topicId as string,
          interactionKind: d.interactionKind as string,
          prompt: d.prompt as string,
          options: d.options as string[] | undefined,
        })
        break
      }

      case 'agent.status': {
        const d = event.data as Record<string, unknown>
        messageStore.setAgentStatus(d.topicId as string, d.state as string)
        break
      }

      case 'usage.snapshot': {
        const d = event.data as Record<string, unknown>
        messageStore.setUsage(d.messageId as string, {
          model: d.model as string,
          inputTokens: d.inputTokens as number,
          outputTokens: d.outputTokens as number,
        })
        break
      }

      case 'session.health': {
        const d = event.data as Record<string, unknown>
        useWsStore.getState().setSessionHealth(d.topicId as string, d.state as string, d.lastError as string | undefined)
        break
      }

      case 'cron.run.completed': {
        const d = event.data as Record<string, unknown>
        useCronStore.getState().completeRun(d.runId as string, {
          status: d.status as string,
          summary: (d.summary as string | null) ?? null,
          duration: (d.duration as number | null) ?? null,
          completedAt: d.completedAt as number,
        })
        break
      }

      case 'messages.history': {
        const d = event.data as { topicId: string; messages: unknown[]; partsByMessage: Record<string, unknown[]> }
        const msgs = d.messages.map((m) => {
          const r = m as Record<string, unknown>
          return {
            id: r.id as string,
            topic_id: r.topic_id as string,
            role: r.role as 'user' | 'assistant' | 'system' | 'cron',
            status: r.status as 'aborted' | 'error' | 'streaming' | 'done',
            started_at: (r.started_at as number) ?? Date.now(),
            finished_at: r.finished_at as number | null,
            stop_reason: r.stop_reason as string | null,
            cron_run_id: r.cron_run_id as string | null,
            turn_id: (r.turn_id as string) ?? null,
          }
        })
        messageStore.setMessages(d.topicId, msgs)
        for (const [msgId, parts] of Object.entries(d.partsByMessage)) {
          for (const p of parts) {
            const r = p as Record<string, unknown>
            messageStore.upsertSnapshotPart(
              msgId,
              r.kind as 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'file_diff',
              r.content_json as string,
              r.id as string,
            )
          }
        }
        break
      }
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

let instance: WsClient | null = null

export function getWsClient(): WsClient {
  if (!instance) {
    instance = new WsClient()
  }
  return instance
}

export type { WsClient }
