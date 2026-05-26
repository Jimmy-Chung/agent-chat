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
import { getServerBase, getWsUrl } from '@/lib/server-url'

const TOKEN_KEY = 'AGENT_CHAT_TOKEN'

const MAX_RECONNECT_DELAY = 30_000
const BASE_RECONNECT_DELAY = 1_000

const PING_INTERVAL_MS = 20_000

export interface PiConfig {
  wssUrl: string
  piToken: string
}

class WsClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private attempt = 0
  private disposed = false
  private piConfig: PiConfig | null = null

  setPiConfig(config: PiConfig | null): void {
    this.piConfig = config
  }

  connect(piConfig?: PiConfig): void {
    if (this.ws?.readyState === WebSocket.OPEN) return
    this.disposed = false
    if (piConfig) this.piConfig = piConfig

    const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
    const wsUrl = getWsUrl()
    const params = new URLSearchParams()
    if (token) params.set('token', token)
    if (this.piConfig?.wssUrl) params.set('piWssUrl', this.piConfig.wssUrl)
    if (this.piConfig?.piToken) params.set('piToken', this.piConfig.piToken)
    const url = params.toString() ? `${wsUrl}?${params}` : wsUrl

    useWsStore.getState().setStatus('connecting')
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.attempt = 0
      useWsStore.getState().setStatus('connected')
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(encodeFrame(createFrame('ping' as never, {})))
        }
      }, PING_INTERVAL_MS)
    }

    this.ws.onmessage = (ev) => {
      let frame: ReturnType<typeof decodeFrame> | undefined
      try {
        frame = decodeFrame(ev.data as string)
        this.handleFrame(frame)
      } catch (err) {
        console.error('[ws] frame parse error', frame?.t, err)
      }
    }

    this.ws.onclose = (event: CloseEvent) => {
      if (this.pingTimer) {
        clearInterval(this.pingTimer)
        this.pingTimer = null
      }
      if (event.code === 4401) {
        // Token invalid — signal auth failure, do not reconnect
        useWsStore.getState().setUnauthorized()
        return
      }
      useWsStore.getState().setStatus('disconnected')
      // WS 断连 → 当前活跃话题如果处于 processing，标记为 aborting
      // 其他话题等用户切过去时再处理（那时 WS 已重连或会触发 session.health）
      const activeTopicId = useTopicStore.getState().activeTopicId
      if (activeTopicId) {
        const status = useMessageStore.getState().agentStatusByTopic[activeTopicId]
        if (status === 'processing') {
          useMessageStore.getState().setAgentStatus(activeTopicId, 'aborting')
        }
      }
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
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    useWsStore.getState().setStatus('disconnected')
  }

  send(event: ClientEvent): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    const frame = createFrame(event.type, event.data)
    this.ws.send(encodeFrame(frame))
    return true
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
          status: event.data.status ?? 'streaming',
          started_at: Date.now(),
          finished_at: null,
          stop_reason: null,
          cron_run_id: null,
          turn_id: (event.data as { turnId?: string }).turnId ?? null,
          client_message_id: event.data.clientMessageId ?? null,
          retry_count: event.data.retryCount ?? 0,
          max_retries: event.data.maxRetries ?? 2,
        })
        if (event.data.role === 'assistant') {
          messageStore.startStreaming(event.data.topicId, event.data.messageId)
        }
        break

      case 'message.delta': {
        const part = event.data.part
        if (part.kind === 'text') {
          if (useMessageStore.getState().streamingText[event.data.messageId] === undefined) {
            const existingText = messageStore.getPartContent(event.data.messageId, 'text')
            messageStore.setStreamingText(event.data.messageId, existingText)
          }
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
          if (useMessageStore.getState().streamingThinking[event.data.messageId] === undefined) {
            const existingThinking = messageStore.getPartContent(event.data.messageId, 'thinking')
            messageStore.setStreamingThinking(event.data.messageId, existingThinking)
          }
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
        messageStore.endStreaming(event.data.messageId)
        messageStore.updateMessage(event.data.messageId, {
          status: event.data.stopReason === 'aborted' ? 'aborted' : 'done',
          finished_at: Date.now(),
          stop_reason: event.data.stopReason,
        })
        messageStore.setAgentStatus(event.data.topicId, event.data.stopReason === 'tool_use' ? 'processing' : 'idle', event.data.stopReason === 'tool_use' ? 'tool_use' : undefined)
        break

      case 'message.delivery': {
        if (event.data.status === 'error') {
          messageStore.removeMessage(event.data.messageId)
          break
        }
        messageStore.updateMessage(event.data.messageId, {
          status: event.data.status === 'done' ? 'done' : event.data.status,
          retry_count: event.data.retryCount,
          max_retries: event.data.maxRetries,
        })
        break
      }

      case 'error':
        console.error('[ws] server error:', event.data)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('agent-chat:error', { detail: event.data }))
        }
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
          origin_topic_id: (a.origin_topic_id as string) ?? null,
          name: a.name as string,
          mime: (a.mime as string) ?? null,
          size_bytes: (a.size_bytes as number) ?? null,
          r2_key: ((a as Record<string, unknown>).r2_key as string) ?? '',
          download_url: (a.download_url as string) ?? undefined,
          preview_url: (a.preview_url as string) ?? undefined,
          source: a.source as 'generated' | 'uploaded',
          created_at: a.created_at as number,
          metadata_json: (a.metadata_json as string) ?? null,
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
          origin_topic_id: ((a as Record<string, unknown>).origin_topic_id as string) ?? null,
          name: (a as Record<string, unknown>).name as string,
          mime: ((a as Record<string, unknown>).mime as string) ?? null,
          size_bytes: ((a as Record<string, unknown>).size_bytes as number) ?? null,
          r2_key: ((a as Record<string, unknown>).r2_key as string) ?? '',
          download_url: ((a as Record<string, unknown>).download_url as string) ?? undefined,
          preview_url: ((a as Record<string, unknown>).preview_url as string) ?? undefined,
          source: (a as Record<string, unknown>).source as 'generated' | 'uploaded',
          created_at: (a as Record<string, unknown>).created_at as number,
          metadata_json: ((a as Record<string, unknown>).metadata_json as string) ?? null,
        }))
        const activeTopicId = useTopicStore.getState().activeTopicId
        if (activeTopicId === 'system_artifact_pool') {
          useArtifactStore.getState().setPoolArtifacts(artifacts)
        } else if (activeTopicId) {
          useArtifactStore.getState().setTopicArtifacts(activeTopicId, artifacts)
        }
        break
      }

      case 'artifact.upload.ready':
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('agent-chat:artifact-upload-ready', { detail: event.data }))
        }
        break

      case 'artifact.download.ready':
        useArtifactStore.getState().updateArtifactAccess(event.data.artifactId, {
          download_url: event.data.downloadUrl,
          preview_url: event.data.previewUrl ?? event.data.downloadUrl,
        })
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('agent-chat:artifact-download-ready', { detail: event.data }))
        }
        break

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
        const agentTopicId = d.topicId as string
        const agentState = d.state as string
        const agentPhase = d.phase as string | undefined
        messageStore.setAgentStatus(agentTopicId, agentState, agentPhase)
        // BUG-040 ⑤ — On agent.status: idle, force-finalize any streaming residue
        // for this topic. Adapter may have stopped emitting events without a
        // message.end (e.g. CLI silent exit). Scan every streaming message on this
        // topic, not just the global singleton, and clear its live buffer.
        if (agentState === 'idle') {
          messageStore.clearProgress(agentTopicId)
          const state = useMessageStore.getState()
          const streamingMessages = (state.byTopic[agentTopicId] ?? []).filter(
            (m) => m.status === 'streaming',
          )
          for (const m of streamingMessages) {
            messageStore.endStreaming(m.id)
            messageStore.updateMessage(m.id, {
              status: 'aborted',
              finished_at: Date.now(),
              stop_reason: 'aborted',
            })
          }
          // Also handle the legacy global pointer in case the streaming message
          // was added under a different topic during a race.
          if (state.streamingTopicId === agentTopicId && state.streamingMessageId) {
            messageStore.endStreaming(state.streamingMessageId)
          }
          // Flush queued messages now that the turn is truly done.
          const pending = messageStore.flushPendingMessages(agentTopicId)
          for (const pm of pending) {
            this.send({
              type: 'user.message',
              data: {
                topicId: agentTopicId,
                content: pm.content,
                clientMessageId: pm.clientMessageId,
                mentions: [],
              },
            })
          }
        }
        break
      }

      case 'agent.progress': {
        const d = event.data as Record<string, unknown>
        messageStore.setProgress(d.topicId as string, {
          phase: d.phase as string,
          message: d.message as string,
          metadata: d.metadata as Record<string, unknown> | undefined,
        })
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

      case 'session.status': {
        const d = event.data as Record<string, unknown>
        useWsStore.getState().setSessionReady(d.topicId as string, d.ready as boolean)
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
            status: r.status as 'aborted' | 'error' | 'streaming' | 'done' | 'pending' | 'needs_retry' | 'retrying',
            started_at: (r.started_at as number) ?? Date.now(),
            finished_at: r.finished_at as number | null,
            stop_reason: r.stop_reason as string | null,
            cron_run_id: r.cron_run_id as string | null,
            turn_id: (r.turn_id as string) ?? null,
            client_message_id: (r.client_message_id as string) ?? null,
            retry_count: (r.retry_count as number) ?? 0,
            max_retries: (r.max_retries as number) ?? 2,
          }
        })
        messageStore.setMessages(d.topicId, msgs)
        messageStore.reconcileAgentStatusFromMessages(d.topicId)
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

      case 'mcp.command.result':
        handleMcpResult(event.data as McpListResult & { requestId: string })
        break

      case 'mcp.command.error':
        handleMcpError(event.data as { requestId: string; code: string; message: string })
        break

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

// ─── MCP command via WS (server proxies to adapter + notifies adapter) ──

export interface McpListResult {
  stdout: string
  stderr: string
  exitCode: number
  servers?: Array<{ name: string; scope: string }>
}

const pendingMcpRequests = new Map<string, { resolve: (v: McpListResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

export async function sendMcpCommand(params: {
  action: 'add' | 'remove' | 'list' | 'get'
  name?: string
  command?: string
  scope?: 'user' | 'project' | 'local'
  projectDir?: string
}): Promise<McpListResult> {
  const { status } = useWsStore.getState()

  // Prefer WS (server notifies adapter after add/remove), fall back to HTTP
  if (status === 'connected') {
    const client = getWsClient()
    const requestId = crypto.randomUUID()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingMcpRequests.delete(requestId)
        reject(new Error('MCP command timeout'))
      }, 15_000)

      pendingMcpRequests.set(requestId, { resolve, reject, timer })

      const sent = client.send({
        type: 'mcp.command',
        data: {
          requestId,
          action: params.action,
          name: params.name,
          command: params.command,
          scope: params.scope,
          projectDir: params.projectDir,
        },
      })

      if (!sent) {
        clearTimeout(timer)
        pendingMcpRequests.delete(requestId)
        reject(new Error('Failed to send MCP command via WS'))
      }
    })
  }

  // HTTP fallback
  const res = await fetch('/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`MCP proxy failed: HTTP ${res.status} ${detail.slice(0, 200)}`)
  }
  return res.json()
}

export function handleMcpResult(data: McpListResult & { requestId: string }): void {
  const entry = pendingMcpRequests.get(data.requestId)
  if (!entry) return
  pendingMcpRequests.delete(data.requestId)
  clearTimeout(entry.timer)
  entry.resolve({ stdout: data.stdout, stderr: data.stderr, exitCode: data.exitCode, servers: data.servers })
}

export function handleMcpError(data: { requestId: string; code: string; message: string }): void {
  const entry = pendingMcpRequests.get(data.requestId)
  if (!entry) return
  pendingMcpRequests.delete(data.requestId)
  clearTimeout(entry.timer)
  entry.reject(new Error(`${data.code}: ${data.message}`))
}

// ─── Provider config HTTP API (server proxies to adapter REST endpoints) ──────

function getAdapterQs(): string {
  const wssUrl = localStorage.getItem('PI_ADAPTER_WSS_URL') || ''
  const piToken = localStorage.getItem('PI_ADAPTER_TOKEN') || ''
  const qs = new URLSearchParams()
  if (wssUrl) qs.set('wssUrl', wssUrl)
  if (piToken) qs.set('piToken', piToken)
  return qs.toString()
}

export async function sendProviderRpc(
  method: 'listProviderConfigs' | 'addProviderConfig' | 'updateProviderConfig' | 'removeProviderConfig',
  params: Record<string, unknown>,
): Promise<unknown> {
  const base = getServerBase()
  const qs = getAdapterQs()
  const { id, ...rest } = params as Record<string, unknown> & { id?: string }

  let url: string
  let httpMethod: string
  let body: string | undefined

  switch (method) {
    case 'listProviderConfigs': {
      const listQs = new URLSearchParams(qs)
      listQs.set('group', 'universal')
      url = `${base}/api/agent-chat/v1/providers?${listQs}`
      httpMethod = 'GET'
      break
    }
    case 'addProviderConfig':
      url = `${base}/api/agent-chat/v1/providers?${qs}`
      httpMethod = 'POST'
      body = JSON.stringify(rest)
      break
    case 'updateProviderConfig':
      url = `${base}/api/agent-chat/v1/providers/${id}?${qs}`
      httpMethod = 'PATCH'
      body = JSON.stringify(rest)
      break
    case 'removeProviderConfig':
      url = `${base}/api/agent-chat/v1/providers/${id}?${qs}`
      httpMethod = 'DELETE'
      break
  }

  const agentChatToken = localStorage.getItem('AGENT_CHAT_TOKEN') || ''
  const headers: Record<string, string> = {}
  if (agentChatToken) headers['Authorization'] = `Bearer ${agentChatToken}`
  if (body) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method: httpMethod,
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((err as { message?: string }).message || res.statusText)
  }
  return res.json()
}

export type { WsClient }
