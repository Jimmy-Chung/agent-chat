import { describe, expect, it } from 'vitest'
import {
  agentStatusPayloadSchema,
  createFrame,
  createSessionParamsSchema,
  cronTriggeredPayloadSchema,
  decodeFrame,
  encodeFrame,
  errorPayloadSchema,
  fileDiffPayloadSchema,
  interactionRequestPayloadSchema,
  messageEndPayloadSchema,
  messageStartPayloadSchema,
  partDeltaSchema,
  piEventSchema,
  planUpdatePayloadSchema,
  textDeltaSchema,
  thinkingDeltaSchema,
  todoItemSchema,
  todoUpdatePayloadSchema,
  toolCallPayloadSchema,
  toolInputDeltaSchema,
  toolResultPayloadSchema,
  usageDeltaPayloadSchema,
  wsFrameSchema,
} from '../index'
import {
  agentStatusSchema,
  artifactDownloadInitSchema,
  artifactUploadInitSchema,
  clientEventDataSchemas,
  cronListSchema,
  cronRunCompletedSchema,
  cronUpsertedSchema,
  errorSchema,
  serverEventDataSchemas,
  sessionHealthSchema,
  topicCreateSchema,
  topicDeleteSchema,
  topicResumeSchema,
  usageSnapshotSchema,
  userActionSchema,
  userMessageSchema,
  messageDeltaSchema as wsMessageDeltaSchema,
  messageStartSchema as wsMessageStartSchema,
} from '../ws-events'

// ─── PIEvent positive tests ───────────────────────────────────────

describe('PIEvent — positive parsing', () => {
  const baseEvent = {
    seq: 1,
    sessionId: 'sess-1',
    ts: 1700000000000,
  }

  it('parses message.start', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      turnId: 'turn-1',
      payload: {
        kind: 'message.start',
        messageId: 'msg-1',
        role: 'assistant',
      },
    })
    expect(event.turnId).toBe('turn-1')
    expect(event.payload.kind).toBe('message.start')
    if (event.payload.kind === 'message.start') {
      expect(event.payload.messageId).toBe('msg-1')
      expect(event.payload.role).toBe('assistant')
    }
  })

  it('parses message.delta with text part', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'message.delta',
        messageId: 'msg-1',
        part: { kind: 'text', content: 'Hello' },
      },
    })
    expect(event.payload.kind).toBe('message.delta')
    if (event.payload.kind === 'message.delta') {
      expect(event.payload.part.kind).toBe('text')
    }
  })

  it('parses message.delta with thinking part', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'message.delta',
        messageId: 'msg-1',
        part: { kind: 'thinking', content: 'Hmm...' },
      },
    })
    expect(event.payload.kind).toBe('message.delta')
    if (event.payload.kind === 'message.delta') {
      expect(event.payload.part.kind).toBe('thinking')
    }
  })

  it('parses message.delta with tool_input part', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'message.delta',
        messageId: 'msg-1',
        part: {
          kind: 'tool_input',
          toolUseId: 'tool-1',
          partial: '{"path":',
        },
      },
    })
    expect(event.payload.kind).toBe('message.delta')
    if (event.payload.kind === 'message.delta') {
      expect(event.payload.part.kind).toBe('tool_input')
    }
  })

  it('parses message.end', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'message.end',
        messageId: 'msg-1',
        stopReason: 'end_turn',
      },
    })
    expect(event.payload.kind).toBe('message.end')
    if (event.payload.kind === 'message.end') {
      expect(event.payload.stopReason).toBe('end_turn')
    }
  })

  it('parses tool.call', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'tool.call',
        toolUseId: 'tool-1',
        messageId: 'msg-1',
        name: 'Edit',
        input: { path: '/tmp/a.ts' },
      },
    })
    expect(event.payload.kind).toBe('tool.call')
    if (event.payload.kind === 'tool.call') {
      expect(event.payload.name).toBe('Edit')
    }
  })

  it('parses tool.result', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'tool.result',
        toolUseId: 'tool-1',
        messageId: 'msg-1',
        output: 'ok',
        isError: false,
      },
    })
    expect(event.payload.kind).toBe('tool.result')
    if (event.payload.kind === 'tool.result') {
      expect(event.payload.isError).toBe(false)
    }
  })

  it('parses file.diff', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'file.diff',
        messageId: 'msg-1',
        path: '/src/a.ts',
        before: 'old',
        after: 'new',
      },
    })
    expect(event.payload.kind).toBe('file.diff')
    if (event.payload.kind === 'file.diff') {
      expect(event.payload.path).toBe('/src/a.ts')
    }
  })

  it('parses todo.update', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'todo.update',
        items: [
          {
            id: 't1',
            content: 'Step 1',
            status: 'in_progress',
            activeForm: 'Working on step 1',
          },
        ],
      },
    })
    expect(event.payload.kind).toBe('todo.update')
    if (event.payload.kind === 'todo.update') {
      expect(event.payload.items).toHaveLength(1)
      expect(event.payload.items[0].activeForm).toBe('Working on step 1')
    }
  })

  it('parses plan.update', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'plan.update',
        plan: '# Plan\n1. Step 1\n2. Step 2',
      },
    })
    expect(event.payload.kind).toBe('plan.update')
    if (event.payload.kind === 'plan.update') {
      expect(event.payload.plan).toContain('Step 1')
    }
  })

  it('parses interaction.request with approval', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'interaction.request',
        interactionId: 'int-1',
        messageId: 'msg-1',
        interactionKind: 'approval',
        prompt: 'Allow edit?',
        defaultTimeoutMs: 30000,
      },
    })
    expect(event.payload.kind).toBe('interaction.request')
    if (event.payload.kind === 'interaction.request') {
      expect(event.payload.interactionKind).toBe('approval')
      expect(event.payload.defaultTimeoutMs).toBe(30000)
    }
  })

  it('parses interaction.request with choice', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'interaction.request',
        interactionId: 'int-2',
        interactionKind: 'choice',
        prompt: 'Pick one',
        options: ['A', 'B'],
      },
    })
    expect(event.payload.kind).toBe('interaction.request')
    if (event.payload.kind === 'interaction.request') {
      expect(event.payload.interactionKind).toBe('choice')
      expect(event.payload.options).toEqual(['A', 'B'])
    }
  })

  it('parses agent.status', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: { kind: 'agent.status', state: 'processing', phase: 'thinking' },
    })
    expect(event.payload.kind).toBe('agent.status')
    if (event.payload.kind === 'agent.status') {
      expect(event.payload.state).toBe('processing')
      expect(event.payload.phase).toBe('thinking')
    }
  })

  it('parses cron.triggered', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'cron.triggered',
        cronId: 'cron-1',
        originSessionId: 'sess-1',
        runId: 'run-1',
        firedAt: 1700000000000,
      },
    })
    expect(event.payload.kind).toBe('cron.triggered')
    if (event.payload.kind === 'cron.triggered') {
      expect(event.payload.originSessionId).toBe('sess-1')
    }
  })

  it('parses usage.delta', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'usage.delta',
        messageId: 'msg-1',
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 80,
        cacheCreateTokens: 20,
      },
    })
    expect(event.payload.kind).toBe('usage.delta')
    if (event.payload.kind === 'usage.delta') {
      expect(event.payload.model).toBe('claude-sonnet-4-6')
      expect(event.payload.cacheReadTokens).toBe(80)
    }
  })

  it('parses usage.delta without optional cache fields', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'usage.delta',
        messageId: 'msg-1',
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
      },
    })
    expect(event.payload.kind).toBe('usage.delta')
    if (event.payload.kind === 'usage.delta') {
      expect(event.payload.cacheReadTokens).toBeUndefined()
    }
  })

  it('parses error', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'error',
        code: 'internal',
        message: 'Something broke',
        recoverable: true,
      },
    })
    expect(event.payload.kind).toBe('error')
    if (event.payload.kind === 'error') {
      expect(event.payload.recoverable).toBe(true)
    }
  })

  it('parses session.health', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'session.health',
        state: 'connected',
        piSessionId: 'sess-1',
      },
    })
    expect(event.payload.kind).toBe('session.health')
    if (event.payload.kind === 'session.health') {
      expect(event.payload.state).toBe('connected')
      expect(event.payload.piSessionId).toBe('sess-1')
    }
  })

  it('parses session.health with lastError', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'session.health',
        state: 'disconnected',
        piSessionId: 'sess-1',
        lastError: 'connection reset',
      },
    })
    if (event.payload.kind === 'session.health') {
      expect(event.payload.lastError).toBe('connection reset')
    }
  })

  it('parses cron.run.completed', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'cron.run.completed',
        cronId: 'cron-1',
        runId: 'run-1',
        status: 'success',
        summary: 'Done',
        duration: 5000,
        completedAt: 1700000005000,
      },
    })
    expect(event.payload.kind).toBe('cron.run.completed')
    if (event.payload.kind === 'cron.run.completed') {
      expect(event.payload.status).toBe('success')
      expect(event.payload.duration).toBe(5000)
    }
  })

  it('parses cron.run.completed with null fields', () => {
    const event = piEventSchema.parse({
      ...baseEvent,
      payload: {
        kind: 'cron.run.completed',
        cronId: 'cron-1',
        runId: 'run-2',
        status: 'failed',
        summary: null,
        duration: null,
        completedAt: 1700000005000,
      },
    })
    if (event.payload.kind === 'cron.run.completed') {
      expect(event.payload.status).toBe('failed')
      expect(event.payload.summary).toBeNull()
    }
  })
})

// ─── PIEvent negative tests ───────────────────────────────────────

describe('PIEvent — negative parsing (missing fields)', () => {
  it('rejects event without seq', () => {
    expect(() =>
      piEventSchema.parse({
        sessionId: 'sess-1',
        ts: 1700000000000,
        payload: {
          kind: 'message.start',
          messageId: 'msg-1',
          role: 'assistant',
        },
      }),
    ).toThrow()
  })

  it('rejects event without sessionId', () => {
    expect(() =>
      piEventSchema.parse({
        seq: 1,
        ts: 1700000000000,
        payload: {
          kind: 'message.start',
          messageId: 'msg-1',
          role: 'assistant',
        },
      }),
    ).toThrow()
  })

  it('rejects event without ts', () => {
    expect(() =>
      piEventSchema.parse({
        seq: 1,
        sessionId: 'sess-1',
        payload: {
          kind: 'message.start',
          messageId: 'msg-1',
          role: 'assistant',
        },
      }),
    ).toThrow()
  })

  it('rejects event without payload', () => {
    expect(() =>
      piEventSchema.parse({
        seq: 1,
        sessionId: 'sess-1',
        ts: 1700000000000,
      }),
    ).toThrow()
  })

  it('rejects message.start without messageId', () => {
    expect(() =>
      piEventSchema.parse({
        seq: 1,
        sessionId: 'sess-1',
        ts: 1700000000000,
        payload: { kind: 'message.start', role: 'assistant' },
      }),
    ).toThrow()
  })

  it('rejects message.start with wrong role', () => {
    expect(() =>
      piEventSchema.parse({
        seq: 1,
        sessionId: 'sess-1',
        ts: 1700000000000,
        payload: {
          kind: 'message.start',
          messageId: 'msg-1',
          role: 'user',
        },
      }),
    ).toThrow()
  })

  it('rejects unknown payload kind', () => {
    expect(() =>
      piEventSchema.parse({
        seq: 1,
        sessionId: 'sess-1',
        ts: 1700000000000,
        payload: { kind: 'unknown.event' },
      }),
    ).toThrow()
  })

  it('rejects message.end with invalid stopReason', () => {
    expect(() =>
      piEventSchema.parse({
        seq: 1,
        sessionId: 'sess-1',
        ts: 1700000000000,
        payload: {
          kind: 'message.end',
          messageId: 'msg-1',
          stopReason: 'invalid',
        },
      }),
    ).toThrow()
  })
})

// ─── PartDelta tests ───────────────────────────────────────────────

describe('PartDelta', () => {
  it('parses text delta', () => {
    const result = partDeltaSchema.parse({
      kind: 'text',
      content: 'Hello world',
    })
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(result.content).toBe('Hello world')
    }
  })

  it('parses thinking delta', () => {
    const result = partDeltaSchema.parse({
      kind: 'thinking',
      content: 'Let me think...',
    })
    expect(result.kind).toBe('thinking')
  })

  it('parses tool_input delta', () => {
    const result = partDeltaSchema.parse({
      kind: 'tool_input',
      toolUseId: 'tu-1',
      partial: '{"key":',
    })
    expect(result.kind).toBe('tool_input')
    if (result.kind === 'tool_input') {
      expect(result.toolUseId).toBe('tu-1')
      expect(result.partial).toBe('{"key":')
    }
  })

  it('rejects unknown delta kind', () => {
    expect(() =>
      partDeltaSchema.parse({ kind: 'image', url: 'http://...' }),
    ).toThrow()
  })

  it('rejects text delta without content', () => {
    expect(() => textDeltaSchema.parse({ kind: 'text' })).toThrow()
  })

  it('rejects thinking delta without content', () => {
    expect(() => thinkingDeltaSchema.parse({ kind: 'thinking' })).toThrow()
  })

  it('rejects tool_input delta without toolUseId', () => {
    expect(() =>
      toolInputDeltaSchema.parse({ kind: 'tool_input', partial: '{}' }),
    ).toThrow()
  })
})

// ─── TodoItem schema ───────────────────────────────────────────────

describe('todoItemSchema', () => {
  it('parses valid todo', () => {
    const result = todoItemSchema.parse({
      id: 't1',
      content: 'Task',
      status: 'pending',
    })
    expect(result.id).toBe('t1')
    expect(result.activeForm).toBeUndefined()
  })

  it('parses todo with activeForm', () => {
    const result = todoItemSchema.parse({
      id: 't1',
      content: 'Task',
      status: 'in_progress',
      activeForm: 'Doing task',
    })
    expect(result.activeForm).toBe('Doing task')
  })

  it('rejects invalid status', () => {
    expect(() =>
      todoItemSchema.parse({
        id: 't1',
        content: 'Task',
        status: 'done',
      }),
    ).toThrow()
  })
})

// ─── WSFrame round-trip ───────────────────────────────────────────

describe('WSFrame encode/decode round-trip', () => {
  it('round-trips a basic frame', () => {
    const frame = createFrame('message.start', {
      topicId: 't1',
      messageId: 'm1',
      role: 'assistant',
    })
    const encoded = encodeFrame(frame)
    const decoded = decodeFrame(encoded)
    expect(decoded).toEqual(frame)
  })

  it('round-trips a frame with id and seq', () => {
    const frame = createFrame('rpc', { method: 'createSession' }, 'rpc-1', 42)
    const encoded = encodeFrame(frame)
    const decoded = decodeFrame(encoded)
    expect(decoded.v).toBe(1)
    expect(decoded.t).toBe('rpc')
    expect(decoded.id).toBe('rpc-1')
    expect(decoded.seq).toBe(42)
  })

  it('round-trips frame without optional fields', () => {
    const frame = createFrame('agent.status', { state: 'idle' })
    const encoded = encodeFrame(frame)
    const decoded = decodeFrame(encoded)
    expect(decoded.id).toBeUndefined()
    expect(decoded.seq).toBeUndefined()
  })

  it('rejects frame with wrong version', () => {
    expect(() =>
      decodeFrame(JSON.stringify({ v: 2, t: 'test', d: {} })),
    ).toThrow()
  })

  it('rejects frame without t field', () => {
    expect(() => decodeFrame(JSON.stringify({ v: 1, d: {} }))).toThrow()
  })

  it('rejects non-JSON input', () => {
    expect(() => decodeFrame('not json')).toThrow()
  })
})

// ─── WSFrame schema direct ────────────────────────────────────────

describe('wsFrameSchema', () => {
  it('accepts valid frame', () => {
    const result = wsFrameSchema.parse({
      v: 1,
      t: 'event',
      d: { kind: 'test' },
    })
    expect(result.v).toBe(1)
  })

  it('accepts frame with all optional fields', () => {
    const result = wsFrameSchema.parse({
      v: 1,
      t: 'rpc',
      d: {},
      id: 'corr-1',
      seq: 99,
    })
    expect(result.id).toBe('corr-1')
    expect(result.seq).toBe(99)
  })
})

// ─── Server event schemas ─────────────────────────────────────────

describe('Server event schemas', () => {
  it('parses topics.list', () => {
    const schema = serverEventDataSchemas['topics.list']
    const result = schema.parse({
      topics: [
        {
          id: 't1',
          name: 'Test',
          kind: 'normal',
          agent_type: 'programming',
          pi_session_id: 'sess-1',
          current_model: 'claude-sonnet-4-6',
          history_frozen_at: null,
          created_at: 1700000000000,
          updated_at: 1700000000000,
          archived: false,
        },
      ],
    })
    expect(result.topics).toHaveLength(1)
  })

  it('parses topic.created', () => {
    const schema = serverEventDataSchemas['topic.created']
    const result = schema.parse({
      id: 't1',
      name: 'New Topic',
      kind: 'normal',
      agent_type: 'general',
      pi_session_id: null,
      current_model: null,
      history_frozen_at: null,
      created_at: 1700000000000,
      updated_at: 1700000000000,
      archived: false,
    })
    expect(result.name).toBe('New Topic')
  })

  it('parses message.start', () => {
    const result = wsMessageStartSchema.parse({
      topicId: 't1',
      messageId: 'm1',
      role: 'assistant',
    })
    expect(result.topicId).toBe('t1')
  })

  it('parses message.delta', () => {
    const result = wsMessageDeltaSchema.parse({
      topicId: 't1',
      messageId: 'm1',
      part: { kind: 'text', content: 'hi' },
    })
    expect(result.part.kind).toBe('text')
  })

  it('parses cron.list', () => {
    const result = cronListSchema.parse({
      crons: [
        {
          cronId: 'adapter-c1',
          localCronId: 'local-c1',
          originTopicId: 't1',
          originSessionId: 'sess-1',
          runtime: 'programming',
          providerGroup: 'codex',
          cronExpr: '0 9 * * *',
          prompt: 'Daily report',
          timezone: 'Asia/Shanghai',
          tags: ['ops', 'daily'],
          status: 'active',
          lastRunAt: 1699990000000,
          nextRunAt: 1700000000000,
          createdAt: 1699980000000,
          updatedAt: 1699990000000,
        },
      ],
    })
    expect(result.crons).toHaveLength(1)
    expect(result.crons[0].cronId).toBe('adapter-c1')
    expect(result.crons[0].localCronId).toBe('local-c1')
  })

  it('parses cron.upserted', () => {
    const result = cronUpsertedSchema.parse({
      cronId: 'adapter-c1',
      localCronId: 'local-c1',
      originTopicId: 't1',
      cronExpr: '0 9 * * *',
      prompt: 'Daily report',
      tags: ['ops'],
      status: 'paused',
    })
    expect(result.status).toBe('paused')
    expect(result.lastRunAt).toBeUndefined()
  })

  it('parses usage.snapshot', () => {
    const result = usageSnapshotSchema.parse({
      topicId: 't1',
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      byModel: {
        'claude-sonnet-4-6': {
          inputTokens: 1000,
          outputTokens: 500,
          costMicroUsd: 150,
        },
      },
    })
    expect(result.totalInputTokens).toBe(1000)
    expect(result.byModel['claude-sonnet-4-6'].costMicroUsd).toBe(150)
  })

  it('parses error', () => {
    const result = errorSchema.parse({
      code: 'auth_invalid',
      message: 'Bad token',
    })
    expect(result.code).toBe('auth_invalid')
  })

  it('parses agent.status', () => {
    const result = agentStatusSchema.parse({
      topicId: 't1',
      state: 'processing',
      phase: 'streaming',
    })
    expect(result.state).toBe('processing')
    expect(result.phase).toBe('streaming')
  })

  it('parses artifact.moved', () => {
    const schema = serverEventDataSchemas['artifact.moved']
    const result = schema.parse({
      id: 'a1',
      fromTopicId: 't1',
      toTopicId: null,
    })
    expect(result.toTopicId).toBeNull()
  })
})

// ─── Client event schemas ─────────────────────────────────────────

describe('Client event schemas', () => {
  it('parses topic.create with programming', () => {
    const result = topicCreateSchema.parse({
      name: 'Code Project',
      agentType: 'programming',
      programming: {
        extension: 'claude-code',
        yolo: false,
        cwd: '/home/user/repo',
        permissionMode: 'default',
      },
    })
    expect(result.programming?.extension).toBe('claude-code')
  })

  it('parses topic.create general without programming', () => {
    const result = topicCreateSchema.parse({
      name: 'Chat',
      agentType: 'general',
    })
    expect(result.programming).toBeUndefined()
  })

  it('parses topic.delete', () => {
    const result = topicDeleteSchema.parse({
      id: 't1',
      artifactStrategy: 'pool',
    })
    expect(result.artifactStrategy).toBe('pool')
  })

  it('parses user.message with mentions', () => {
    const result = userMessageSchema.parse({
      topicId: 't1',
      content: 'Check @file.csv',
      mentions: [
        {
          id: 'a1',
          name: 'file.csv',
          downloadUrl: 'https://r2.example/file.csv',
        },
      ],
    })
    expect(result.mentions).toHaveLength(1)
  })

  it('parses user.message without mentions', () => {
    const result = userMessageSchema.parse({
      topicId: 't1',
      content: 'Hello',
      mentions: [],
    })
    expect(result.mentions).toHaveLength(0)
  })

  it('parses user.action approve', () => {
    const result = userActionSchema.parse({
      topicId: 't1',
      action: 'approve',
      interactionId: 'int-1',
    })
    expect(result.action).toBe('approve')
  })

  it('parses user.action abort without interactionId', () => {
    const result = userActionSchema.parse({
      topicId: 't1',
      action: 'abort',
    })
    expect(result.interactionId).toBeUndefined()
  })

  it('parses artifact.upload.init', () => {
    const result = artifactUploadInitSchema.parse({
      name: 'data.csv',
      mime: 'text/csv',
      sizeBytes: 1024,
      topicId: 't1',
    })
    expect(result.sizeBytes).toBe(1024)
  })

  it('parses artifact.upload.ready', () => {
    const schema = serverEventDataSchemas['artifact.upload.ready']
    const result = schema.parse({
      uploadId: 'up1',
      uploadUrl: 'https://example.test/api/artifacts/upload/key?token=t',
      method: 'PUT',
      expiresAt: Date.now() + 60_000,
      maxBytes: 1024,
    })
    expect(result.method).toBe('PUT')
  })

  it('parses artifact.download.init', () => {
    const result = artifactDownloadInitSchema.parse({ artifactId: 'a1' })
    expect(result.artifactId).toBe('a1')
  })

  it('parses artifact.download.ready', () => {
    const schema = serverEventDataSchemas['artifact.download.ready']
    const result = schema.parse({
      artifactId: 'a1',
      downloadUrl: 'https://example.test/api/artifacts/download/key?token=t',
      previewUrl: 'https://example.test/api/artifacts/download/key?token=t',
      expiresAt: Date.now() + 60_000,
    })
    expect(result.artifactId).toBe('a1')
  })

  it('parses cron.edit with partial update', () => {
    const schema = clientEventDataSchemas['cron.edit']
    const result = schema.parse({
      cronId: 'c1',
      cronExpr: '0 10 * * *',
      tags: ['tag-a', 'tag-b'],
    })
    expect(result.prompt).toBeUndefined()
    expect(result.tags).toEqual(['tag-a', 'tag-b'])
  })

  it('rejects topic.delete with invalid artifactStrategy', () => {
    expect(() =>
      topicDeleteSchema.parse({
        id: 't1',
        artifactStrategy: 'keep',
      }),
    ).toThrow()
  })
})

// ─── RPC schemas ──────────────────────────────────────────────────

describe('RPC schemas', () => {
  it('parses createSession params with programming spec', () => {
    const result = createSessionParamsSchema.parse({
      kind: 'programming',
      programming: {
        extension: 'claude-code',
        yolo: true,
        cwd: '/home/user/repo',
        permissionMode: 'bypassPermissions',
        systemPrompt: 'Be helpful',
        allowedTools: ['Edit', 'Write'],
      },
    })
    expect(result.kind).toBe('programming')
    expect(result.programming?.yolo).toBe(true)
    expect(result.programming?.allowedTools).toEqual(['Edit', 'Write'])
  })

  it('parses createSession params with general spec', () => {
    const result = createSessionParamsSchema.parse({
      kind: 'general',
      general: {
        systemPrompt: 'You are an assistant',
        initialPlan: '# Plan\nStep 1',
        initialTodos: [{ id: 't1', content: 'First', status: 'pending' }],
      },
      workflowMode: 'eager',
    })
    expect(result.kind).toBe('general')
    expect(result.general?.initialTodos).toHaveLength(1)
    expect(result.workflowMode).toBe('eager')
  })

  it('rejects createSession with invalid kind', () => {
    expect(() =>
      createSessionParamsSchema.parse({
        kind: 'custom',
      }),
    ).toThrow()
  })
})

// ─── Individual payload schemas ───────────────────────────────────

describe('Individual payload schemas', () => {
  it('messageStartPayloadSchema rejects wrong role', () => {
    expect(() =>
      messageStartPayloadSchema.parse({
        kind: 'message.start',
        messageId: 'm1',
        role: 'user',
      }),
    ).toThrow()
  })

  it('messageEndPayloadSchema accepts all valid stop reasons', () => {
    const reasons = [
      'end_turn',
      'max_tokens',
      'tool_use',
      'aborted',
      'error',
    ] as const
    for (const reason of reasons) {
      const result = messageEndPayloadSchema.parse({
        kind: 'message.end',
        messageId: 'm1',
        stopReason: reason,
      })
      expect(result.stopReason).toBe(reason)
    }
  })

  it('agentStatusPayloadSchema accepts all valid states', () => {
    const states = [
      'idle',
      'processing',
      'aborting',
    ] as const
    const phases = ['thinking', 'streaming', 'tool_use'] as const
    for (const state of states) {
      const result = agentStatusPayloadSchema.parse({
        kind: 'agent.status',
        state,
      })
      expect(result.state).toBe(state)
    }
    for (const phase of phases) {
      const result = agentStatusPayloadSchema.parse({
        kind: 'agent.status',
        state: 'processing',
        phase,
      })
      expect(result.state).toBe('processing')
      expect(result.phase).toBe(phase)
    }
  })

  it('errorPayloadSchema parses correctly', () => {
    const result = errorPayloadSchema.parse({
      kind: 'error',
      code: 'session_not_found',
      message: 'No such session',
      recoverable: false,
    })
    expect(result.recoverable).toBe(false)
  })

  it('fileDiffPayloadSchema parses correctly', () => {
    const result = fileDiffPayloadSchema.parse({
      kind: 'file.diff',
      messageId: 'm1',
      path: '/src/index.ts',
      before: 'console.log("old")',
      after: 'console.log("new")',
    })
    expect(result.before).toBe('console.log("old")')
    expect(result.after).toBe('console.log("new")')
  })

  it('planUpdatePayloadSchema parses correctly', () => {
    const result = planUpdatePayloadSchema.parse({
      kind: 'plan.update',
      plan: '# My Plan',
    })
    expect(result.plan).toBe('# My Plan')
  })

  it('todoUpdatePayloadSchema parses empty items', () => {
    const result = todoUpdatePayloadSchema.parse({
      kind: 'todo.update',
      items: [],
    })
    expect(result.items).toHaveLength(0)
  })

  it('toolCallPayloadSchema parses with unknown input', () => {
    const result = toolCallPayloadSchema.parse({
      kind: 'tool.call',
      toolUseId: 'tu1',
      messageId: 'm1',
      name: 'Bash',
      input: { command: 'ls -la' },
    })
    expect(result.name).toBe('Bash')
  })

  it('toolResultPayloadSchema parses with isError true', () => {
    const result = toolResultPayloadSchema.parse({
      kind: 'tool.result',
      toolUseId: 'tu1',
      messageId: 'm1',
      output: { error: 'command not found' },
      isError: true,
    })
    expect(result.isError).toBe(true)
  })

  it('cronTriggeredPayloadSchema parses correctly', () => {
    const result = cronTriggeredPayloadSchema.parse({
      kind: 'cron.triggered',
      cronId: 'c1',
      originSessionId: 's1',
      runId: 'r1',
      firedAt: 1700000000000,
    })
    expect(result.firedAt).toBe(1700000000000)
  })

  it('usageDeltaPayloadSchema parses without optional cache fields', () => {
    const result = usageDeltaPayloadSchema.parse({
      kind: 'usage.delta',
      messageId: 'm1',
      model: 'claude-sonnet-4-6',
      inputTokens: 200,
      outputTokens: 100,
    })
    expect(result.cacheReadTokens).toBeUndefined()
    expect(result.cacheCreateTokens).toBeUndefined()
  })

  it('interactionRequestPayloadSchema parses with optional fields', () => {
    const result = interactionRequestPayloadSchema.parse({
      kind: 'interaction.request',
      interactionId: 'i1',
      messageId: 'm1',
      interactionKind: 'choice',
      prompt: 'Pick an option',
      options: ['A', 'B', 'C'],
      defaultTimeoutMs: 60000,
    })
    expect(result.options).toEqual(['A', 'B', 'C'])
  })
})

// ─── session.health schema ───────────────────────────────────────

describe('session.health schema', () => {
  it('parses connected state', () => {
    const result = sessionHealthSchema.parse({
      topicId: 't1',
      state: 'connected',
      piSessionId: 'sess-1',
    })
    expect(result.state).toBe('connected')
    expect(result.piSessionId).toBe('sess-1')
    expect(result.lastError).toBeUndefined()
  })

  it('parses disconnected state with lastError', () => {
    const result = sessionHealthSchema.parse({
      topicId: 't1',
      state: 'disconnected',
      piSessionId: null,
      lastError: 'PI WS closed unexpectedly',
    })
    expect(result.state).toBe('disconnected')
    expect(result.piSessionId).toBeNull()
    expect(result.lastError).toBe('PI WS closed unexpectedly')
  })

  it('parses reconnecting state', () => {
    const result = sessionHealthSchema.parse({
      topicId: 't1',
      state: 'reconnecting',
      piSessionId: 'sess-1',
    })
    expect(result.state).toBe('reconnecting')
  })

  it('accepts all valid states', () => {
    for (const state of ['connected', 'disconnected', 'reconnecting'] as const) {
      const result = sessionHealthSchema.parse({
        topicId: 't1',
        state,
        piSessionId: null,
      })
      expect(result.state).toBe(state)
    }
  })

  it('rejects invalid state', () => {
    expect(() =>
      sessionHealthSchema.parse({
        topicId: 't1',
        state: 'unknown',
        piSessionId: null,
      }),
    ).toThrow()
  })

  it('rejects without topicId', () => {
    expect(() =>
      sessionHealthSchema.parse({
        state: 'connected',
        piSessionId: 'sess-1',
      }),
    ).toThrow()
  })

  it('is in serverEventDataSchemas', () => {
    const schema = serverEventDataSchemas['session.health']
    expect(schema).toBeDefined()
    const result = schema.parse({
      topicId: 't1',
      state: 'connected',
      piSessionId: 'sess-1',
    })
    expect(result.state).toBe('connected')
  })
})

// ─── cron.run.completed schema ────────────────────────────────────

describe('cron.run.completed schema', () => {
  it('parses successful run', () => {
    const result = cronRunCompletedSchema.parse({
      cronId: 'c1',
      localCronId: 'local-c1',
      runId: 'r1',
      originTopicId: 't1',
      originSessionId: 'sess-1',
      status: 'success',
      summary: 'Report generated',
      durationMs: 5000,
      completedAt: 1700000000000,
    })
    expect(result.status).toBe('success')
    expect(result.durationMs).toBe(5000)
  })

  it('parses failed run with null fields', () => {
    const result = cronRunCompletedSchema.parse({
      cronId: 'c1',
      runId: 'r2',
      originTopicId: 't1',
      status: 'failed',
      summary: null,
      duration: null,
      completedAt: 1700000000000,
    })
    expect(result.status).toBe('failed')
    expect(result.summary).toBeNull()
    expect(result.duration).toBeNull()
  })

  it('parses timeout run', () => {
    const result = cronRunCompletedSchema.parse({
      cronId: 'c1',
      runId: 'r3',
      originTopicId: 't1',
      status: 'timeout',
      summary: 'Exceeded 30s limit',
      duration: 30000,
      completedAt: 1700000000000,
    })
    expect(result.status).toBe('timeout')
  })

  it('accepts all valid statuses', () => {
    for (const status of ['success', 'failed', 'timeout'] as const) {
      const result = cronRunCompletedSchema.parse({
        cronId: 'c1',
        runId: 'r1',
        originTopicId: 't1',
        status,
        summary: null,
        duration: null,
        completedAt: 1700000000000,
      })
      expect(result.status).toBe(status)
    }
  })

  it('rejects invalid status', () => {
    expect(() =>
      cronRunCompletedSchema.parse({
        cronId: 'c1',
        runId: 'r1',
        originTopicId: 't1',
        status: 'running',
        summary: null,
        duration: null,
        completedAt: 1700000000000,
      }),
    ).toThrow()
  })

  it('rejects without required fields', () => {
    expect(() =>
      cronRunCompletedSchema.parse({
        cronId: 'c1',
        runId: 'r1',
        status: 'success',
      }),
    ).toThrow()
  })

  it('is in serverEventDataSchemas', () => {
    const schema = serverEventDataSchemas['cron.run.completed']
    expect(schema).toBeDefined()
    const result = schema.parse({
      cronId: 'c1',
      runId: 'r1',
      originTopicId: 't1',
      status: 'success',
      summary: null,
      duration: null,
      completedAt: 1700000000000,
    })
    expect(result.cronId).toBe('c1')
  })
})

// ─── topic.resume schema ─────────────────────────────────────────

describe('topic.resume schema', () => {
  it('parses valid resume', () => {
    const result = topicResumeSchema.parse({
      topicId: 't1',
    })
    expect(result.topicId).toBe('t1')
  })

  it('rejects without topicId', () => {
    expect(() => topicResumeSchema.parse({})).toThrow()
  })

  it('is in clientEventDataSchemas', () => {
    const schema = clientEventDataSchemas['topic.resume']
    expect(schema).toBeDefined()
    const result = schema.parse({ topicId: 't1' })
    expect(result.topicId).toBe('t1')
  })
})
