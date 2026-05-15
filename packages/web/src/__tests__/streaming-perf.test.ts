import { describe, it, expect } from 'vitest'
import { makeStreamSafe } from '../lib/stream-safe-markdown'
import { useMessageStore } from '../stores/message-store'

function generateGrowingMarkdown(chunks: number): string[] {
  const parts: string[] = []
  let acc = ''
  for (let i = 0; i < chunks; i++) {
    if (i % 100 === 50) acc += '```js\n'
    if (i % 100 === 80) acc += '\n```'
    acc += `chunk ${i} with **some bold** and \`code\` text. `
    parts.push(acc)
  }
  return parts
}

describe('Streaming performance — D: 量化性能', () => {
  it('D1: makeStreamSafe 单次 10KB 输入 < 10ms', () => {
    const input = generateGrowingMarkdown(1)[0]!.repeat(50) + '```js\nunclosed'
    const start = performance.now()
    makeStreamSafe(input)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(10)
  })

  it('D2: makeStreamSafe 1000 次调用总耗时 < 2000ms', () => {
    const inputs = generateGrowingMarkdown(1000)
    const start = performance.now()
    for (const input of inputs) {
      makeStreamSafe(input)
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(2000)
  })

  it('D3: appendDelta 1000 次 store 操作 < 1000ms', () => {
    useMessageStore.setState({
      byTopic: {},
      partsByMessage: {},
      loading: false,
      streamingText: {},
      streamingTopicId: null,
      todosByTopic: {},
      planByTopic: {},
      agentStatusByTopic: {},
      usageByMessage: {},
      interactions: {},
    })
    const store = useMessageStore.getState()
    store.startStreaming('perf-topic', 'perf-m1')
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      store.appendDelta('perf-m1', `x`)
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(1000)
  })

  it('D4: 1000 delta 全链路 (store + makeStreamSafe) < 2000ms', () => {
    useMessageStore.setState({
      byTopic: {},
      partsByMessage: {},
      loading: false,
      streamingText: {},
      streamingTopicId: null,
      todosByTopic: {},
      planByTopic: {},
      agentStatusByTopic: {},
      usageByMessage: {},
      interactions: {},
    })
    const store = useMessageStore.getState()
    store.startStreaming('perf-topic', 'perf-m2')
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      store.appendDelta('perf-m2', `chunk${i} `)
      const text = useMessageStore.getState().streamingText['perf-m2'] ?? ''
      makeStreamSafe(text)
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(2000)
  })
})
