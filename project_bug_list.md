# agent-chat — Bug 清单

| 项目 | 值 |
|---|---|
| 当前版本 | v1.1.0 |
| 更新时间 | 2026-05-12 |

---

## 待修复

### BUG-019: 定时任务仍在话题内但管理页缺失

| 字段 | 值 |
|---|---|
| ID | BUG-019 |
| 标题 | 定时任务仍在话题内但管理页缺失 |
| 状态 | 下个版本 (v1.2.0) |
| 发现时间 | 2026-05-12 |
| 影响模块 | 待排查 |
| 描述 | 用户已设置 3 个定时任务，但当前只有 1 个还能在”定时任务管理”系统话题中查到，另外 2 个在原话题内仍然存在，但管理页缺失 |
| 根因 | 待排查 |
| 修复方案 | 待排查 |

### BUG-003: 允许创建同名话题

| 字段 | 值 |
|---|---|
| ID | BUG-003 |
| 标题 | 允许创建同名话题 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-10 |
| 修复时间 | 2026-05-10 |
| 影响模块 | packages/server/src/ws/handlers/topic.handler.ts, packages/server/src/db/repos/topic.repo.ts |
| 描述 | 用户可以创建多个同名话题，正常应阻止创建同名话题 |
| 根因 | `createTopic` 直接插入 DB，无同名检查 |
| 修复方案 | 新增 `getTopicByName` 查重（只查未归档话题），`topic.handler.ts` 创建前检查，同名返回 `DUPLICATE_NAME` 错误 |

### BUG-018: 消息在页面刷新后丢失 — bufferPartDelta 替换而非累加

| 字段 | 值 |
|---|---|
| ID | BUG-018 |
| 标题 | 消息在页面刷新后丢失 — bufferPartDelta 替换而非累加 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-11 |
| 修复时间 | 2026-05-11 |
| 影响模块 | packages/server/src/db/repos/message.repo.ts |
| 描述 | 用户与 Agent 对话后刷新页面，消息内容丢失（只看到最后一个 delta 片段） |
| 根因 | `bufferPartDelta` 对 text/thinking 类型使用 `existing.contentJson = contentJson` 直接替换（line 145），但 PI Agent 发送的是增量 delta（每个 delta 只包含一小段新文本）。正确行为应该累加 content 字段。导致 DB 中只持久化了最后一个 delta 的小段文本，刷新加载历史时消息内容残缺 |
| 修复方案 | 对 text/thinking 类型的 part，解析 JSON 后累加 `content` 字段：`prevData.content = (prevData.content ?? '') + newData.content` |

### BUG-002: PI Agent 创建定时任务时不知道当前时间 + 定时任务未出现在管理器

| 字段 | 值 |
|---|---|
| ID | BUG-002 |
| 标题 | PI Agent 创建定时任务时不知道当前时间 + 定时任务未出现在管理器 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-10 |
| 修复时间 | 2026-05-11 |
| 影响模块 | packages/server/src/pi/event-router.ts |
| 描述 | 在聊天窗口中要求 PI Agent 创建定时任务时发现两个问题：(1) Agent 不知道当前时间是什么，无法正确设置 cron 表达式；(2) 创建的定时任务没有出现在定时任务管理器（system_cron_admin topic）中 |
| 根因 | (1) [external] PI Agent 侧需在 system prompt 中注入当前时间；(2) `event-router.ts` 的 `routeEvent()` 缺少对 `cron.created` PI 事件的处理，事件到达后落入 `default` 分支被忽略，未持久化到 DB 也未 broadcast 给前端 |
| 修复方案 | event-router.ts 新增 `case 'cron.created'`，查找 topic → 查重 → 创建/更新 cron job → broadcast `cron.upserted` |

### BUG-001: message.delta 累加逻辑错误 — 使用 setStreamingText 替换而非 appendDelta 追加

| 字段 | 值 |
|---|---|
| ID | BUG-001 |
| 标题 | message.delta 累加逻辑错误 — 使用 setStreamingText 替换而非 appendDelta 追加 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-10 |
| 影响模块 | packages/web/src/lib/ws-client.ts:171, packages/web/src/stores/message-store.ts |
| 描述 | ws-client.ts dispatch `message.delta` 事件时，错误地使用 `setStreamingText()`（替换整个文本）而非 `appendDelta()`（追加增量文本）。代码注释声称 "PI sends snapshot-style text deltas"，但实际 PI Agent 协议是增量 delta（参见 pi-agent-requirements.md §4 "累加，前端拼"；Claude Code SDK `content_block_delta` 天然增量；mock-pi fixture simple-text.json 每个 delta 是小段新文本）|
| 影响 | 流式消息只显示最后一个 delta 片段，前面所有 delta 内容丢失；stream-safe markdown 未闭合场景不会出现（因为文本始终很短），掩盖了 FEAT-007 容错逻辑的真实缺陷；useDeferredValue / requestIdleCallback 节流机制在当前模式下无意义 |
| 根因 | ws-client.ts 对 PI 协议 delta 模式理解错误（增量 vs snapshot） |
| 修复方案 | 改用 `appendDelta()`；同时需补 `useDeferredValue` + batch 节流机制（1k delta 性能要求） |

---

## 已修复

### BUG-001: message.delta 累加逻辑错误 — 使用 setStreamingText 替换而非 appendDelta 追加

| 字段 | 值 |
|---|---|
| ID | BUG-001 |
| 标题 | message.delta 累加逻辑错误 — 使用 setStreamingText 替换而非 appendDelta 追加 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-10 |
| 修复时间 | 2026-05-10 |
| 影响模块 | packages/web/src/lib/ws-client.ts:171, packages/web/src/stores/message-store.ts |
| 描述 | ws-client.ts dispatch `message.delta` 事件时，错误地使用 `setStreamingText()`（替换整个文本）而非 `appendDelta()`（追加增量文本）|
| 根因 | ws-client.ts 对 PI 协议 delta 模式理解错误（增量 vs snapshot） |
| 修复方案 | 改用 `appendDelta()`；同时补 `useDeferredValue` 节流 + `makeStreamSafe` 扩展容错 |

---

## 已验证

> (空)

---

## 待修复

### BUG-015: 长 URL 在消息气泡中被截断

| 字段 | 值 |
|---|---|
| ID | BUG-015 |
| 标题 | 长 URL 在消息气泡中被截断 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-11 |
| 修复时间 | 2026-05-11 |
| 影响模块 | packages/web/src/components/chat/MarkdownRenderer.tsx |
| 描述 | 消息中包含长 URL（如 `https://xxx.trycloudflare.com`）时，末尾 `.com` 被截断不可见 |
| 根因 | `.markdown-body` 外层容器 `overflow: 'hidden'`，长 URL 作为 `<a>` 标签渲染超出容器宽度时内容被裁切，`<a>` 标签没有设置 `overflow-wrap` / `word-break` |
| 修复方案 | `<a>` 标签样式增加 `overflowWrap: 'break-word'` + `wordBreak: 'break-all'`（MarkdownRenderer.tsx:167） |

### BUG-016: Stop 后输入框无法回到可编辑状态

| 字段 | 值 |
|---|---|
| ID | BUG-016 |
| 标题 | Stop 后输入框无法回到可编辑状态 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-11 |
| 修复时间 | 2026-05-11 |
| 影响模块 | packages/server/src/ws/handlers/interaction.handler.ts |
| 描述 | 点击 Stop 中止 Agent 后，输入框持续显示"Agent 正在运行..."，textarea 保持 disabled，无法输入新消息 |
| 根因 | `interaction.handler.ts` 的 abort handler 只向 PI 发送了 `abortSession` RPC，没有 broadcast `agent.status: idle` 给前端。前端 `isAgentRunning` 依赖 `agentStatusByTopic[topicId]`，而 PI 在 abort 后不一定会发回 `idle` 事件，导致状态卡在 `aborting` |
| 修复方案 | abort handler 发送 RPC 后，立即 `hub.broadcast({ type: 'agent.status', data: { topicId, state: 'idle' } })`（interaction.handler.ts:23） |

### BUG-017: Plan 内容更新过程挤压页面布局

| 字段 | 值 |
|---|---|
| ID | BUG-017 |
| 标题 | Plan 内容更新过程挤压页面布局 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-11 |
| 修复时间 | 2026-05-11 |
| 影响模块 | packages/web/src/components/layout/ChatLayout.tsx, packages/web/src/components/layout/InspectorPanel.tsx |
| 描述 | Plan 内容在流式更新或切换显示时，页面布局被挤压变形 |
| 根因 | 三层 overflow 缺失：(1) InspectorPanel 所在 grid column（`<aside>`）无 `overflow: hidden`，内容溢出推宽列宽进而挤压 `1fr` 主列；(2) tab 内容区无 `min-w-0` + `overflow-x: hidden`，flex 子元素未收缩；(3) Plan markdown 容器无 overflow 约束，流式更新时宽内容撑破 |
| 修复方案 | ChatLayout `<aside>` 加 `overflow-hidden`；InspectorPanel tab 区加 `overflow-x-hidden min-w-0`；Plan markdown 容器加 `overflow-hidden` |
