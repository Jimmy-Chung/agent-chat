import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as messageRepo from '../db/repos/message.repo'
import * as topicRepo from '../db/repos/topic.repo'

describe('MessageRepo', () => {
  let topicId: string

  beforeAll(async () => {
    await setupTestDb()
    const topic = await topicRepo.createTopic({
      name: 'Message Test Topic',
      kind: 'normal',
      agentType: 'general',
    })
    topicId = topic.id
  })

  afterAll(() => {
    teardownTestDb()
  })

  it('should create a message', async () => {
    const msg = await messageRepo.createMessage({
      topicId,
      role: 'user',
      status: 'done',
    })

    expect(msg.id).toBeTruthy()
    expect(msg.topic_id).toBe(topicId)
    expect(msg.role).toBe('user')
    expect(msg.status).toBe('done')
    expect(msg.started_at).toBeGreaterThan(0)
    expect(msg.finished_at).toBeNull()
    expect(msg.stop_reason).toBeNull()
  })

  it('should default status to streaming', async () => {
    const msg = await messageRepo.createMessage({
      topicId,
      role: 'assistant',
    })
    expect(msg.status).toBe('streaming')
  })

  it('should get a message by id', async () => {
    const created = await messageRepo.createMessage({
      topicId,
      role: 'user',
    })

    const found = await messageRepo.getMessage(created.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
    expect(found!.role).toBe('user')
  })

  it('should return undefined for non-existent message', async () => {
    const found = await messageRepo.getMessage('nonexistent')
    expect(found).toBeUndefined()
  })

  it('should list messages by topic ordered by started_at', async () => {
    const topic = await topicRepo.createTopic({
      name: 'List Topic',
      kind: 'normal',
      agentType: 'general',
    })

    const msg1 = await messageRepo.createMessage({
      topicId: topic.id,
      role: 'user',
    })
    const msg2 = await messageRepo.createMessage({
      topicId: topic.id,
      role: 'assistant',
    })

    const messages = await messageRepo.listMessagesByTopic(topic.id)
    expect(messages.length).toBe(2)
    expect(messages[0].id).toBe(msg1.id)
    expect(messages[1].id).toBe(msg2.id)
  })

  it('should update message status, stopReason, and finishedAt', async () => {
    const msg = await messageRepo.createMessage({
      topicId,
      role: 'assistant',
    })
    const finishedAt = Date.now()

    await messageRepo.updateMessage(msg.id, {
      status: 'done',
      stop_reason: 'end_turn',
      finished_at: finishedAt,
    })

    const updated = await messageRepo.getMessage(msg.id)
    expect(updated).toBeDefined()
    expect(updated!.status).toBe('done')
    expect(updated!.stop_reason).toBe('end_turn')
    expect(updated!.finished_at).toBe(finishedAt)
  })

  it('should create a message part', async () => {
    const msg = await messageRepo.createMessage({
      topicId,
      role: 'assistant',
    })

    const part = await messageRepo.createMessagePart({
      messageId: msg.id,
      kind: 'text',
      contentJson: JSON.stringify({ text: 'hello' }),
    })

    expect(part.id).toBeTruthy()
    expect(part.message_id).toBe(msg.id)
    expect(part.ordinal).toBe(0)
    expect(part.kind).toBe('text')
    expect(part.content_json).toBe(JSON.stringify({ text: 'hello' }))
  })

  it('should assign incrementing ordinals to parts', async () => {
    const msg = await messageRepo.createMessage({
      topicId,
      role: 'assistant',
    })

    const part1 = await messageRepo.createMessagePart({
      messageId: msg.id,
      kind: 'text',
      contentJson: '"a"',
    })
    const part2 = await messageRepo.createMessagePart({
      messageId: msg.id,
      kind: 'text',
      contentJson: '"b"',
    })

    expect(part1.ordinal).toBe(0)
    expect(part2.ordinal).toBe(1)
  })

  it('should get message parts by message id', async () => {
    const msg = await messageRepo.createMessage({
      topicId,
      role: 'assistant',
    })

    await messageRepo.createMessagePart({
      messageId: msg.id,
      kind: 'text',
      contentJson: '"first"',
    })
    await messageRepo.createMessagePart({
      messageId: msg.id,
      kind: 'text',
      contentJson: '"second"',
    })

    const parts = await messageRepo.getMessageParts(msg.id)
    expect(parts.length).toBe(2)
    expect(parts[0].content_json).toBe('"first"')
    expect(parts[1].content_json).toBe('"second"')
  })

  it('should update message part content', async () => {
    const msg = await messageRepo.createMessage({
      topicId,
      role: 'assistant',
    })

    const part = await messageRepo.createMessagePart({
      messageId: msg.id,
      kind: 'text',
      contentJson: '"original"',
    })

    await messageRepo.updateMessagePartContent(part.id, '"updated"')

    const parts = await messageRepo.getMessageParts(msg.id)
    expect(parts[0].content_json).toBe('"updated"')
  })

  it('aggregates text deltas into a single snapshot part', async () => {
    const msg = await messageRepo.createMessage({
      topicId,
      role: 'assistant',
    })

    messageRepo.bufferPartDelta(msg.id, 'text', JSON.stringify({ content: 'Hello' }))
    messageRepo.bufferPartDelta(msg.id, 'text', JSON.stringify({ content: ' world' }))
    await messageRepo.flushParts()

    const parts = await messageRepo.getMessageParts(msg.id)
    expect(parts).toHaveLength(1)
    expect(parts[0].kind).toBe('text')
    expect(parts[0].content_json).toBe(JSON.stringify({ content: 'Hello world' }))
  })

  it('aggregates thinking deltas into a single snapshot part', async () => {
    const msg = await messageRepo.createMessage({
      topicId,
      role: 'assistant',
    })

    messageRepo.bufferPartDelta(msg.id, 'thinking', JSON.stringify({ content: 'Plan' }))
    messageRepo.bufferPartDelta(msg.id, 'thinking', JSON.stringify({ content: ' more' }))
    await messageRepo.flushParts()

    const parts = await messageRepo.getMessageParts(msg.id)
    expect(parts).toHaveLength(1)
    expect(parts[0].kind).toBe('thinking')
    expect(parts[0].content_json).toBe(JSON.stringify({ content: 'Plan more' }))
  })

  it('does not re-accumulate deltas onto a message already marked done (replay guard)', async () => {
    const msg = await messageRepo.createMessage({
      topicId,
      role: 'assistant',
    })

    // Original stream: deltas flushed, then the turn finalizes (message.end → done).
    messageRepo.bufferPartDelta(msg.id, 'text', JSON.stringify({ content: 'Hello' }))
    messageRepo.bufferPartDelta(msg.id, 'text', JSON.stringify({ content: ' world' }))
    await messageRepo.flushParts()
    await messageRepo.updateMessage(msg.id, { status: 'done', finished_at: Date.now() })

    // Session recreate replays the same completed turn from seq 0.
    messageRepo.bufferPartDelta(msg.id, 'text', JSON.stringify({ content: 'Hello' }))
    messageRepo.bufferPartDelta(msg.id, 'text', JSON.stringify({ content: ' world' }))
    await messageRepo.flushParts()

    const parts = await messageRepo.getMessageParts(msg.id)
    expect(parts).toHaveLength(1)
    // Content must NOT be doubled into "Hello worldHello world".
    expect(parts[0].content_json).toBe(JSON.stringify({ content: 'Hello world' }))
  })

  it('does not double content when replay hits a still-streaming message', async () => {
    // The "half-double" real-world case: a message is still streaming when the
    // session breaks. By the time the adapter replays, the DB already has the
    // full text but the message.status is still 'streaming' — the done-guard
    // doesn't fire, so the include-guard must catch it.
    const msg = await messageRepo.createMessage({
      topicId,
      role: 'assistant',
      status: 'streaming',
    })

    // First pass: text flushed into DB, but turn hasn't finished yet.
    messageRepo.bufferPartDelta(msg.id, 'text', JSON.stringify({ content: 'Hello' }))
    messageRepo.bufferPartDelta(msg.id, 'text', JSON.stringify({ content: ' world' }))
    await messageRepo.flushParts()
    // Message is still streaming, not done.

    // Replay: session recreate re-sends the same deltas.
    messageRepo.bufferPartDelta(msg.id, 'text', JSON.stringify({ content: 'Hello' }))
    messageRepo.bufferPartDelta(msg.id, 'text', JSON.stringify({ content: ' world' }))
    await messageRepo.flushParts()
    // Now the turn actually finishes.
    await messageRepo.updateMessage(msg.id, { status: 'done', finished_at: Date.now() })

    const parts = await messageRepo.getMessageParts(msg.id)
    expect(parts).toHaveLength(1)
    expect(parts[0].content_json).toBe(JSON.stringify({ content: 'Hello world' }))
  })

  it('upserts tool snapshots instead of creating duplicate tool_use parts', async () => {
    const msg = await messageRepo.createMessage({
      topicId,
      role: 'assistant',
    })

    messageRepo.bufferPartDelta(msg.id, 'tool_use', JSON.stringify({ toolUseId: 't1', name: 'Read', input: { path: 'a.ts' } }))
    messageRepo.bufferPartDelta(msg.id, 'tool_use', JSON.stringify({ toolUseId: 't1', name: 'Read', input: { path: 'b.ts' } }))
    await messageRepo.flushParts()

    const parts = (await messageRepo.getMessageParts(msg.id)).filter((part) => part.kind === 'tool_use')
    expect(parts).toHaveLength(1)
    expect(parts[0].content_json).toBe(JSON.stringify({ toolUseId: 't1', name: 'Read', input: { path: 'b.ts' } }))
  })
})
