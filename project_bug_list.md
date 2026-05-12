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

### BUG-021: Deploy workflow 始终部署 dev/v1.2.0 旧代码而非 master

| 字段 | 值 |
|---|---|
| ID | BUG-021 |
| 标题 | Deploy workflow 始终部署 dev/v1.2.0 旧代码而非 master |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 影响模块 | .github/workflows/deploy.yml, .github/workflows/deploy-pages.yml |
| 描述 | 所有部署均使用 dev/v1.2.0 代码，master 修复永远不生效 |
| 根因 | GitHub 仓库默认分支为 dev/v1.2.0，workflow_run 触发的 actions/checkout@v4 无显式 ref 时 checkout 默认分支，导致始终部署旧代码。同时 default_branch 配置错误。 |
| 修复方案 | 两个 deploy workflow 均加 `ref: master`；用 gh API 将仓库默认分支改为 master |

### BUG-022: DO RPC (stub.setConfig) 因 compatibility_date 过旧不可用

| 字段 | 值 |
|---|---|
| ID | BUG-022 |
| 标题 | DO RPC (stub.setConfig) 因 compatibility_date 过旧不可用 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 影响模块 | packages/server/wrangler.toml |
| 描述 | 调用 stub.setConfig() 时报 TypeError: stub.setConfig is not a function |
| 根因 | Cloudflare DO RPC（直接调用 stub 方法）需要 compatibility_date >= 2024-04-05，wrangler.toml 配置为 2024-01-01 |
| 修复方案 | wrangler.toml compatibility_date 改为 2024-04-05 |

### BUG-023: Cloudflare 过滤 Upgrade 头，WebSocket 升级检测失败

| 字段 | 值 |
|---|---|
| ID | BUG-023 |
| 标题 | Cloudflare 过滤 Upgrade 头，WebSocket 升级检测失败 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 影响模块 | packages/server/src/worker.ts |
| 描述 | Worker 对所有 WebSocket 升级请求返回 426，连接无法建立 |
| 根因 | Cloudflare CDN 在转发请求给 Worker 时过滤掉 Upgrade 头，导致 request.headers.get('Upgrade') 始终返回 null |
| 修复方案 | 改用 Sec-WebSocket-Key 头检测 WebSocket 升级请求，该头不会被 Cloudflare 过滤 |

### BUG-018: Workers 中 ulid 包报 nodeCrypto.randomBytes is not a function

| 字段 | 值 |
|---|---|
| ID | BUG-018 |
| 标题 | Workers 中 ulid 包报 nodeCrypto.randomBytes is not a function |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 影响模块 | packages/server/src/db/repos/*.ts, packages/server/src/lib/ulid.ts |
| 描述 | Worker 初始化时报错，WebSocket 无法建立连接 |
| 根因 | ulid 包环境检测顺序：先找 window.crypto（Workers 无 window）→ 回退 require("crypto")（esbuild 打包后 randomBytes 不可用）。Workers 有 crypto.getRandomValues() 但 ulid 检测逻辑不会走到这里 |
| 修复方案 | 移除 ulid 依赖，用 Web Crypto API (crypto.getRandomValues) 实现 30 行本地 ULID，写入 packages/server/src/lib/ulid.ts |

### BUG-020: FTS5 porter tokenizer 导致 Worker 初始化报错，所有请求返回 500

| 字段 | 值 |
|---|---|
| ID | BUG-020 |
| 标题 | FTS5 porter tokenizer 导致 Worker 初始化报错，所有请求返回 500 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 影响模块 | packages/server/src/db/migrate.ts |
| 描述 | Worker 冷启动时 runMigrations() 抛错，所有请求（包括 WebSocket 升级）返回 500，前端显示"Token 错误？"断线提示 |
| 根因 | migrate.ts 末尾 `CREATE VIRTUAL TABLE messages_fts USING fts5(..., tokenize = 'porter unicode61')` 无 try/catch 保护，D1 不支持 porter tokenizer 时直接抛出，导致 initialize() 每次都失败 |
| 修复方案 | tokenizer 改为 D1 确定支持的 `unicode61`，并用 try/catch 包裹，FTS5 不可用时降级为 warn 日志而不中断初始化 |

### BUG-019: Workers token 鉴权失效 + WebSocket 心跳超时断线

| 字段 | 值 |
|---|---|
| ID | BUG-019 |
| 标题 | Workers token 鉴权失效 + WebSocket 心跳超时断线 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 影响模块 | packages/server/src/worker.ts, packages/server/src/ws/topic-do.ts, packages/web/src/lib/ws-client.ts |
| 描述 | 配置 AGENT_CHAT_TOKEN 后，前端一直提示"连接已断开 — Token 错误？" |
| 根因 | (1) worker.ts 路由 /ws 时从未调用 stub.setConfig()，导致 DO 内 this.config 永远为 null，token 校验条件 (this.config && ...) 短路跳过；(2) token 校验在 acceptWebSocket() 之后执行，返回 401 时 WS 已接受，行为未定义；(3) 前端从未发送 ping frame，DO 心跳检测约 60 秒后关闭连接，前端显示断线 banner |
| 修复方案 | worker.ts 提升 appConfig 到模块级，/ws 路由前置 token 校验并调用 stub.setConfig()；topic-do.ts 将 token 校验移至 acceptWebSocket() 之前，setConfig() 中初始化 piClient；ws-client.ts 每 20 秒发送 ping frame |

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
