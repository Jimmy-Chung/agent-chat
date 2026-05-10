# agent-chat — Bug 清单

| 项目 | 值 |
|---|---|
| 当前版本 | v1.0.0 |
| 更新时间 | 2026-05-09 |

---

## 待修复

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

### BUG-002: PI Agent 创建定时任务时不知道当前时间 + 定时任务未出现在管理器

| 字段 | 值 |
|---|---|
| ID | BUG-002 |
| 标题 | PI Agent 创建定时任务时不知道当前时间 + 定时任务未出现在管理器 |
| 状态 | 待修复 |
| 发现时间 | 2026-05-10 |
| 影响模块 | 待确认（可能涉及 server cron 同步逻辑 / PI Agent 侧） |
| 描述 | 在聊天窗口中要求 PI Agent 创建定时任务时发现两个问题：(1) Agent 不知道当前时间是什么，无法正确设置 cron 表达式；(2) 创建的定时任务没有出现在定时任务管理器（system_cron_admin topic）中 |
| 根因 | 待排查 |
| 修复方案 | 待定 |

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
