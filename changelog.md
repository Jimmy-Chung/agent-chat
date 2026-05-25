# Changelog

## 2026-05-26 [v1.7.5] — Provider proxy 生产域名路由修复

> 修复 Pages 静态站在缺少 `NEXT_PUBLIC_WS_URL` 构建变量时，把 Provider HTTP proxy 请求打到 `agent-chat.jimmy-jam.com` 自身导致 Next 404 的问题。

### BUG-046 (AIT-174): Provider proxy 固定走 Worker HTTP API
- 前端统一通过 `server-url` 推导 Worker WS/HTTP base；生产 Pages 域名缺少构建变量时兜底到 `agent-chat-server.jimmychung038.workers.dev`
- Provider 管理、adapter version、push 订阅、token 校验共用同一 Worker URL 推导逻辑
- Worker provider proxy 遇到 adapter 非 JSON 错误时透传上游 status/body，不再把旧 tunnel 的 Cloudflare 530 文本错误转换成 Worker 500
- 新增单测断言 `wss://pi.example.com/api/agent-chat/v1/socket` 最终转发为 `https://pi.example.com/api/agent-chat/v1/providers?group=universal`

## 2026-05-26 [v1.7.4] — BUG-046 transient disconnect 不再结束流式消息

> 配合 AIT-174 streaming close + resume 联调：agent-chat DO 不再把 PI adapter 的短暂断链误判为 assistant message 失败。

### BUG-046 (AIT-174): `session.health disconnected` 不再合成 `message.end(error)`
- `event-router` 收到 `session.health disconnected` 时只广播连接健康状态，不再调用 `finalizeStaleMessagesByTopic`
- in-flight assistant message 的结束原因改为等待 adapter 真实 `message.end`，避免 reconnect grace 窗口中提前 error end
- 新增单测覆盖 transient disconnect 时不广播合成 `message.end(error)`，并保持 streaming message 状态

## 2026-05-25 [v1.7.3] — BUG-046 replay 游标配套修复

> 配合 AIT-174 / BUG-046 的 adapter 方案 A：agent-chat 侧保留 PI session 的 lastSeq，避免断线重连后从 0 请求 replay。

### BUG-046 (AIT-174): stale PI connection 重连保留 lastSeq
- `PiClient` 在连接池外维护 per-session lastSeq，closed/stale conn 被移除后仍保留已处理游标
- `reconnectSession()` 新建 WS 后使用 `attachSession({ sessionId, lastSeq })`，不再回退到 `lastSeq: 0`
- `sendUserMessage RPC failed` 日志补充 `sessionId` + `clientMessageId`，便于断链窗口中定位未送达消息
- 新增单测覆盖 stale session reconnect 时沿用 remembered lastSeq

## 2026-05-25 [v1.7.2] — agent.status 映射收尾 + 链路验证

> 跟进 v1.7.1 带入的「agent.status 状态模型重构」WIP：补齐代码整洁与测试，并补跑真实 adapter 链路验证。

### chore: event-router `mapAgentState` 移出 import 块 + 单测
- `mapAgentState`（adapter 原始 state → WS `{state, phase}` 映射）此前被误插在 import 语句中间，移到 imports 之后并导出
- 新增 4 个单测覆盖 idle/aborting/waiting_for_user/thinking/streaming/tool/未知值的映射

### 链路验证（R-007 / R-006，连真实 Tailscale adapter `100.87.35.81:7331`）
- L0 心跳 5/5、L1-1 单轮直连、L1-2 双话题经 server、L3 压测（3 轮含 tool use + 产物）均通过
- 探针确认真实 adapter 发原始 `agent.status:{state:'thinking'}`，`mapAgentState` 映射正确，生产路径无误
- 已知 BUG-044（adapter 首个 text delta 回显用户输入）仍在册，属外部 adapter 侧

## 2026-05-25 [v1.7.1] — Provider 切换分组修复 + v1.7.x 首发

> 本版本首次为 v1.7.x 线打 tag，含 v1.6.1 以来累积的 FEAT（AIT-167/171/172、FEAT-045 等）与本次 BUG-045 修复，以及若干进行中的 protocol/server/web 改动。

### BUG-045 (AIT-173): 切换活跃 Provider 后分组被重置为 claude-code
- Sidebar 标签页内 `handleSwitchProvider` 与 Provider 配置弹窗 `handleActivate` 调用 `updateProviderConfig` 时未带 `group`，adapter 整条替换后缺省 group 回落为 `claude-code`，导致 codex/pi-agent 分组的 Provider 一切换就跳到 Claude Code 分组
- 修复：两处切换入口均回传当前 Provider 的 `group`，保持分组不变
- 验证：Playwright 驱动真实 UI，切换 codex Provider 后停留在 Codex 分组；对照组（旧 payload）复现了分组跳变

## 2026-05-21 [v1.6.1] — 新建话题 Provider 透传修复

### BUG-041 (AIT-155): 新建话题未传递全局活跃 providerId 致 createSession 使用错误 Provider
- `Sidebar.tsx` 的 `handleCreateTopic` 发送 `topic.create` 时缺少 `providerId` 字段
- 修复：从 `providerConfigs` 取 `isActive` 的 Provider ID，写入 `topic.create` 的 `providerId` 字段

## 2026-05-21 [v1.6.0] — 会话链路兜底 + Provider 统一管理

### FEAT-040 (AIT-128): 同工作目录的活跃话题创建拦截
- 服务端在 `topic.create` 时按规范化目录路径校验，命中已有活跃 programming 话题则拒绝并广播 `error{code:'DUPLICATE_CWD', details:{topicId, topicName, cwd}}`
- 前端 Sidebar 创建话题前置同名/同目录校验，命中冲突直接弹 warning Toast，提示占用话题名 · 话题 ID

### FEAT-041: 全局 Toast 视口
- 新增 `ToastViewport` + `toast-store`，遵循 `S8 Toasts.html` 设计稿：右下角 glass 卡片、左侧状态色竖条、状态色 icon tile、底部自动消失进度条
- warning/info/success 默认 4.6s 自动消失，error 持久展示直至手动关闭
- 接入 server `error` 事件：`DUPLICATE_NAME` / `DUPLICATE_CWD` / `PI_SESSION_FAILED` 等映射为对应 Toast 文案

### BUG-039: 长 Thinking / 切 Topic 中断输出
- server `event-router` 在 `message.start` 与 text/thinking `message.delta` 时兜底广播 `agent.status: streaming`，避免长 thinking 期间 UI 永远停在 thinking
- `messages.load` 入口先 `flushParts()`，确保切换话题返回时拿到的 history 不会丢正在流式的增量
- 前端 `message-store` 新增 `getPartContent` / `setStreamingThinking`，`setMessages` 不再清掉仍在 history 中的消息 live buffer
- `ws-client` 收到 `message.delta` 时若 live buffer 缺失，自动从已有 snapshot part 续写，避免文本被覆盖

### BUG-040 (AIT-145): sendUserMessage 兜底 + agent.status idle 收口
- AIT-143 共识分工 agent-chat 侧 ④⑤
- 新增 turn-level watchdog：`attemptDelivery` RPC ack 后启动 30s 计时器（`TURN_WATCHDOG_TIMEOUT_MS` 可配置），收到任意 PI 事件即清掉；超时则广播 `error{code:'TURN_NO_RESPONSE'}` + `agent.status: idle`，让 UI 退出 loading 可重试
- 前端 `agent.status: idle` 时扫描该 topic 全部 `status=streaming` 消息并 finalize 为 `aborted`，清掉 `streamingText/streamingThinking/streamingToolInputs`，不再依赖全局单例

### FEAT-042 (AIT-150 / AIT-151): Agent Chat ↔ PI Adapter 链路状态可观测
- AIT-150 Server：health probe 间隔缩短至 15s，超时缩短至 45s；PI WS close/error 时 emit session.health(reconnecting→disconnected)；event-router session.health 事件跳过 seq 去重
- AIT-151 Frontend：通过 Sidebar sessionHealthByTopic 分层展示每个话题的 PI 连接状态

### FEAT-043 (AIT-152 / AIT-153): Provider 统一管理
- 协议层新增 6 组 Provider RPC schema（list/add/update/remove/switchSession/getUsage）+ provider.rpc WS 事件类型
- AIT-152 Server：topic-do 新增 provider.rpc 中继（session-agnostic → rpcGlobal，switchSessionProvider → rpc）；topic.create 支持 providerId 透传至 createSession
- AIT-153 Frontend：新增 ProviderConfigModal 管理面板（增删改切）；Sidebar 按分组展示活跃 Provider 一键切换 + Toast；TopicPanel 标题区 Extension 下拉选择器；MessageInput 编程话题 Provider/Model 选择器；ws-client sendProviderRpc 请求/响应路由
- Adapter AIT-146（isActive 持久化）已在 adapter 侧修复，切换后 UI 刷新列表同步真实状态

### 关联
- 父 issue：[AIT-143](https://linear.app/ai-jam-jam/issue/AIT-143) — Adapter 侧 ①②③ 修复待合入后联调 ⑥ e2e
- Milestone：v1.6.0

## 2026-05-19 [v1.5.2] — MCP 管理面板 + InteractionCard + RPC 重试

### FEAT-038 (AIT-139): Agent MCP 管理面板
- TopicPanel 新增 MCP 管理入口按钮，MCP 配置弹窗支持 list/add/remove
- User 级 MCP（全局，只读）+ Project 级 MCP（话题 cwd，可编辑）双层 scope
- WS 优先 + HTTP 回退双链路，add/remove 后自动通知 PI Adapter 重载配置
- 协议层新增 `mcp.command` / `mcp.command.result` / `mcp.command.error` 事件

### FEAT-039 (AIT-125): AskUserQuestion 选择交互卡片
- 新增 InteractionCard 组件，支持 choice 类型交互（选项渲染 + 选择回复）
- user.action choice 回复链路完整接通

### AIT-124: keepalive_ack 双向心跳 + health probe 60s + RPC 重试机制
- 双向 keepalive_ack 心跳，health probe 间隔 60s
- PI RPC 调用新增重试机制，提升连接稳定性

## 2026-05-19 [v1.5.1] — 版本号显示更新

### chore: 发版流程补充版本号同步
- 更新 Sidebar 版本号显示至 v1.5.1
- CLAUDE.md 发版流程新增版本号更新步骤

## 2026-05-18 [v1.5.0] — 凌晨睡觉提醒弹窗

### FEAT-037 (AIT-135): 凌晨睡觉提醒弹窗
- 新增 SleepReminder 组件，GMT+8 凌晨 0 点起每 5 分钟弹窗提醒睡觉
- 关闭难度按 `2^round` 指数增长（00:00 → 1 次, 00:05 → 2 次, 00:10 → 4 次 ...）
- 凌晨 1:00 后自动禁用
- 20 条随机文案轮换，不连续重复
- 弹窗样式遵循 glass-morphism 设计规范，文案左对齐
- 移除 ws-client.ts 中 artifact.list 的调试日志

## 2026-05-17 [v1.4.14] — PI WS 断连导致多轮 --resume 失败

### AIT-123: PI WS 连接生命周期修复
- `topic-do.ts`：`void startAutoDelivery()` → `ctx.waitUntil()` 确保 DO 追踪异步操作，防止 isolate 驱逐时关闭 PI WS
- `client.ts`：`PiSessionConn` 新增 `isConnected` getter，`reconnectSession` 检查旧连接状态并清理死连接后创建新连接
- `message-delivery.ts`：`buildSessionParams` programming 类型默认 `extension: 'claude-code'`，`ensureDeliverableSession` 新增 3 步 fallback（reconnect → recreate → session_exists 后重试 reconnect）

## 2026-05-16 [v1.4.12] — PI Adapter 连接配置 + Bug 修复

### FEAT-036 (AIT-116): PI Adapter 连接配置弹窗 + 持续健康探针
- WS upgrade 支持前端传递 `piWssUrl`/`piToken` 参数覆盖服务端配置
- `setConfig` 检测 PI 配置变化时自动重建 PiClient
- PiSessionConn 新增 20s 间隔健康探针，40s 无消息自动断开
- 新增 ConnectionConfigModal 组件，含客户端 WS 路径验证
- WsProvider 改为三步验证流程：Token 鉴权 → PI 配置 → 主界面
- PiStatusBadge 可点击打开配置弹窗，支持重连时切换配置

### BUG-040 (AIT-119): 中间产物预览报错
- PI adapter 生成的产物 `r2_key` 为空时禁用预览按钮，避免点击后报错
- 完整修复需 PI adapter 侧配合上传到 R2 [external]

### BUG-041 (AIT-120): 连续发消息容易触发自动重试
- RPC 发送后同步更新 `lastMessageAt`，防止健康探针误杀活跃 session

## 2026-05-16 [v1.4.11] — topic.select 竞态修复

### BUG-038: topic.select 无条件 ready:true 导致消息 needs_retry
- DO async handler 在 `await createSession()` 期间让出控制权，前端 auto-select 的 `topic.select` 先执行
- 旧代码不检查 `pi_session_id` 就发 `session.status { ready: true }`，前端允许发送消息但 session 不存在
- 修复：`topic.select` 先查 DB 确认 `pi_session_id` 存在才发 `ready:true`，否则发 `ready:false`
- 真实 PI adapter 验证：create → auto-select → send 流程无 needs_retry

## 2026-05-16 [v1.4.8] — Session Gateway 架构 + Streaming 安全网

### AIT-113: 通信稳定性加固 — Session Gateway
- Session 生命周期从消息投递中剥离，topic.select/topic.create 时 await session 就绪后才开放输入
- 新增 `session.status` 事件协议，前端追踪 session 就绪状态
- PI client: PiRpcError 类型化、adapter.ready 等待、lastSeq 跟踪、AbortSignal 超时清理
- 投递逻辑简化：删除 forceRecovery 分支，session_busy 指数退避，session_exists 竞态修复
- mock-pi 对齐真实 adapter 行为（adapter.ready、resumeSession、auto-attach）

### AIT-114 BUG-037: PI 断连时消息永远卡在 streaming
- 新增 `finalizeStaleMessagesByTopic` 查询
- `session.health { disconnected }` 时自动 finalize 所有 streaming 消息为 done + error
- 与 PI adapter 团队达成共识，双方并行修复（adapter 补发 message.end，server 加安全网）

### AIT-112 BUG-036: Thinking 阶段 Stop 按钮补充修复
- 增加 `hasPendingUserMessage` 条件：用户消息 pending 期间也显示 Stop 按钮
- AgentStatusBar 同步 pending 状态检测

## 2026-05-15 [v1.4.0] — PWA 推送、Token 鉴权体验与连接状态指示

### FEAT-011: Web Push 推送通知（PWA Push Notification）
- VAPID 密钥签名 + RFC 8291 aes128gcm 端对端加密，完整 Web Push 协议实现
- push_subscriptions 表持久化多设备订阅，支持 upsert/删除过期订阅
- Service Worker 处理 push 事件并展示系统通知，notificationclick 跳转到对应话题
- assistant 回复、interaction.request 审批请求、cron.run.completed 三类事件触发推送
- PI 侧 error 事件（如欠费异常）转换为系统消息气泡展示给用户

### FEAT-035: Token 校验自动跳回鉴权页 + PI 连接状态指示
- Token 无效/缺失时始终跳转至鉴权页，不允许绕过进入主界面
- Sidebar 左下角实时显示 server↔PI adapter WSS 连接状态（connected/reconnecting/disconnected）

### BUG-036: Thinking 阶段 Stop 按钮失效 + 计时器无法停止
- Stop 按钮可见条件扩展为 `isStreaming || isAgentActive`，thinking/tool 等非 streaming 活跃状态下同样可见
- 收到 `agent.status: idle` 时强制清除残留 streaming 状态，避免 Stop 点击后无视觉反馈

## 2026-05-14 [v1.3.0] — 云端产物、历史一致性与消息时间体验发布

### FEAT-016: R2 云端产物上传下载
- 用户附件与 Agent 中间产物改为走 R2 数据面，agent-chat 只保留 artifact 控制面与 metadata
- 话题产物、全局产物池、signed upload/download URL 与 Adapter 反向 RPC 链路已接通
- `@` 产物消费透传 metadata + signed download URL，不再在 agent-chat / Adapter 之间传文件正文

### FEAT-029: 会话历史一致性优化
- 以 agent-chat DB 为投影视图事实源，刷新后保留 thinking / tool / artifact / interaction 等过程历史
- 发送链路补齐自动 retry、手动 retry、recreateSession 兜底与 needs_retry / revert 状态恢复
- 旧 Topic 恢复时，attach 失败会自动自愈到 recreate，并在 recreate 后清理旧 `lastSeq` 过滤状态

### FEAT-021: 消息列表日期分割线
- 消息列表按浏览器本地自然日插入日期分割线
- 历史加载与流式追加时保持分组稳定，不重复插入同日分割线

### FEAT-030: hover / long-press 时间戳
- 桌面端 hover 显示气泡外侧时间戳，移动端改为长按展示
- 多行消息、流式消息与富内容气泡的时间戳布局一并微调

### BUG-032: 旧 Topic 恢复后 Adapter session attach / recreate 链路异常
- `recreateSession()` 成功后补齐 `attachSession()`，避免新 session 创建成功但当前连接未订阅事件流
- recreate 成功后清理 server 端旧 `lastSeqBySession` 高水位，避免误杀新事件流
- 旧 Topic attach 失败后自动 fallback 到 recreate，并回收失败路径上的临时 PI 连接

### 验收
- `pnpm -r typecheck` ✅
- `pnpm -r test` ✅
- `pnpm -r build` ✅
- `pnpm test:e2e` ✅

---

## 2026-05-13 [v1.2.25] — 修复 Inspector Cron 渲染循环

### BUG-029: Inspector Cron selector 返回新数组导致 React 最大更新深度错误
- 修复 `useCronStore((s) => s.crons.filter(...))` 每次 render 返回新数组的问题
- Inspector 和 CronTab 改为订阅原始 `crons`，再用 `useMemo` 按当前话题过滤
- 本地真实 PI 调试下已验证 `/ws` 101、`createSession/attachSession` 成功

---

## 2026-05-13 [v1.2.24] — Inspector 与 @ 产物选择器修复

### BUG-026: Inspector Cron Tab 未按当前话题隔离
- 右侧 Inspector 的 Cron Tab 改为只展示当前话题 `originTopicId` 对应的定时任务
- Cron tab 计数和折叠状态也按当前话题计算

### BUG-027: artifact.created 的 metadata.path 在 server → IM 链路丢失
- `artifact.added` / `artifact.list` 透传 `metadata_json` 和 `origin_topic_id`
- 前端 artifact store 保存 `metadata_json`，Inspector / 产物池视图优先展示 `metadata.path`
- server 收到 `artifact.created` 时记录安全摘要日志，便于对比 adapter payload

### BUG-028: 聊天窗 @ 产物池选择器回退到旧 UI
- `TopicPanel` 改为引用新版 `@/components/chat/MessageInput`
- 恢复新版 @ 产物选择器宽面板、当前话题 / 产物池 tab、搜索 / 类型筛选和键盘提示

---

## 2026-05-12 [v1.2.23] — 修复 Workers 发送消息链路

### BUG-024: Workers PI Adapter 鉴权 token 丢失
- PiClient 在 Cloudflare Workers 原生 WebSocket 环境下无法设置 Authorization header
- 改为把 `PI_ADAPTER_TOKEN` 注入 PI Adapter WebSocket URL 的 `token` query 参数
- 新增 `pi-client.test.ts` 覆盖 token query 拼接和已有 query 参数保留

### BUG-025: Durable Object user.message 未恢复 v1.1.0 发送语义
- `TopicDurableObject` 的 `user.message` 改为先创建用户消息、写入 message part、索引搜索并广播 `message.start/delta/end`
- PI session 缺失、恢复失败、PI 不可用时广播明确错误事件
- 发送给 PI 时恢复 @产物引用的 `downloadUrl` 兼容处理

---

## 2026-05-12 [v1.2.22] — 修复 FTS5 初始化导致 Worker 全量 500

### BUG-020: FTS5 porter tokenizer 导致 Worker 初始化报错
- migrate.ts FTS5 虚拟表 tokenizer 从 `porter unicode61` 改为 `unicode61`
- 加 try/catch，FTS5 不可用时降级为 warn 而不中断 Worker 初始化

---

## 2026-05-12 [v1.2.21] — Workers token 鉴权及心跳修复

### BUG-018: Workers 中 ulid 包报 nodeCrypto.randomBytes is not a function
- 移除 ulid npm 包，用 Web Crypto API (crypto.getRandomValues) 实现本地 ULID
- 新增 packages/server/src/lib/ulid.ts，6 个 repo 文件改用本地 import

### BUG-019: Workers token 鉴权失效 + WebSocket 心跳超时断线
- worker.ts 提升 appConfig 到模块级，/ws 路由前置 token 校验
- 路由到 DO 前调用 stub.setConfig()，确保 DO 获得正确 config
- topic-do.ts token 校验移至 acceptWebSocket() 之前，setConfig() 初始化 piClient
- ws-client.ts 每 20 秒发送 ping frame，防止 DO 心跳超时断线

---

## 2026-05-12 [v1.2.0] — Cloudflare Workers 全链路迁移

### FEAT-031: SQLite → Cloudflare D1 数据库迁移
- 6 个 repo 文件 (topic/message/artifact/cron/interaction/usage) 全部改为 async/await
- Drizzle ORM 切换到 drizzle-orm/d1 驱动
- better-sqlite3 → D1Database shim 用于测试
- migrate.ts: `setDb(d1)` 单一入口, `getDb()` / `getD1()` 全局访问
- 15 个 repo 测试全 async

### FEAT-032: Fastify → Hono 路由迁移
- 重写 `index.ts` → `worker.ts` (Cloudflare Workers 入口)
- `/healthz` 改为 Hono, 返回 D1 连接状态 (200/503)
- 所有 `process.env.*` → `env.*` (Cloudflare Workers Env)
- CORS、鉴权保持一致

### FEAT-033: ws → Durable Objects WebSocket 迁移
- `WsHub` → `TopicDurableObject` (每 Topic 一个 DO 实例)
- 心跳从 setInterval → DO `alarm()` API
- PI session 持久化到 DO Storage (`pi_session_id`)
- Frontend WS 连接 + PI WS 连接由 DO 管理

### FEAT-034: 本地开发环境 (wrangler.toml + tsconfig)
- wrangler.toml: D1 binding + DO binding + env vars
- tsconfig: `types: ["@cloudflare/workers-types"]`
- `pnpm dev` 支持 `wrangler dev --local`

### 测试基础设施
- D1Database shim over better-sqlite3 (StmtShim + D1Shim)
- 所有 102 个服务端测试迁移为 async/await
- 删除 ws.hub.test.ts (WsHub 已不存在)
- 修复 broadcast 签名: `(type: string, data: unknown)` 双参数

### 验收
- `pnpm -r typecheck` ✅
- `pnpm -r test` ✅ (112 tests: protocol 99 + server 102 + mock-pi 10 已跳过)
- `pnpm -r build` ✅ (web 前端构建通过)

---

## 2026-05-12 [v1.1.0] — UI 视觉升级 + 交互增强 + Turn ID

### FEAT-012: 视觉打磨 + 响应式 + 移动端适配
- Liquid Glass 视觉体系 (毛玻璃/backdrop-blur/半透明)
- CSS 变量 design tokens 全覆盖 (颜色/圆角/间距/阴影/字号)
- 全局布局重构 (Sidebar / TopicPanel / InspectorPanel)
- EmptyState 引导页 + 动画

### FEAT-017: 创建话题 Glass Modal
- Sidebar 内嵌表单 → 居中 Glass Modal 弹窗
- 毛玻璃背景 + backdrop blur 遮罩 + ESC 关闭

### FEAT-018: 创建话题高级选项交互
- Agent 类型 Segmented Control + glow 效果
- YOLO Mode iOS 风格 Switch Toggle
- Permission Mode Radio List + 描述文字

### FEAT-019: AgentStatusBar 完整交互
- Agent 状态指示 (Thinking / Using tool / Idle) + pulse 动画
- 已用时间计时器 + Stop 按钮 + ⌘. 快捷键

### FEAT-022: Inspector Plan Tab 进度追踪
- Markdown 渲染 + Checkbox 进度追踪
- 进度百分比 + 预估时间显示

### FEAT-023: iPhone 移动端专属布局
- 抽屉式 Sidebar + Large Title 导航栏
- 底部固定 Composer + 顶部 Agent 状态条
- Safe Area 适配 (Dynamic Island + Home Indicator)

### FEAT-024: Permission Mode UI 重构
- 创建编程话题权限简化为 YOLO / 普通 两个选项
- 去掉冗余的 permissionMode 下拉框 + checkbox

### FEAT-025: Plan 模式话题内切换
- 编程话题 header 增加 Plan 模式切换按钮
- Server 端 setPlanMode RPC 支持

### FEAT-026: S9 删除话题弹窗
- Glass Modal + 产物策略选择 (转入产物池 / 删除)
- 红色垃圾桶 glyph + 产物预览 + Radio 选择
- TopicItem hover 垃圾桶图标

### FEAT-027: S6 @产物选择器升级
- Filter pills + Mime 图标 + 键盘导航 (↑↓/Enter/Tab/Esc)
- Tab 栏 (当前话题/产物池) 含 count badge
- 搜索框 + 分组列表 + 快捷键提示

### FEAT-028: Turn ID — 消息轮次聚合
- protocol 增 turnId 字段 (PIEvent / Message)
- server event-router turnId↔topicId 映射
- message.repo bufferPartDelta 增量累加 + flush 机制
- 前端 MessageList turn 合并渲染,过渡 message 过滤
- DB migration: messages.turn_id + turn_id 索引

### BUG-015: 长 URL 截断修复
- MarkdownRenderer <a> 标签 overflowWrap + wordBreak

### BUG-016: Stop 后输入框状态恢复
- interaction.handler abort 后 broadcast agent.status idle

### BUG-017: Plan 内容挤压布局
- ChatLayout <aside> overflow:hidden + InspectorPanel overflow 约束

### BUG-018: bufferPartDelta 累加修复
- message.repo bufferPartDelta 对 text/thinking 类型累加 content

### 验收
- `pnpm -r typecheck` ✅
- `pnpm -r test` ✅ (329 tests: protocol 99 + server 106 + web 114 + mock-pi 10)
- `pnpm -r build` ✅

---

## 2026-05-10 [v1.0.0] — v1.0.0 补全: 产物/Cron/协议/Session/测试

### FEAT-008: 产物系统
- Artifact CRUD (server repo + handler + web store)
- 话题级产物列表 + 产物池 (跨话题共享)
- @产物引用 + 删话题产物处理策略 (转池/删除)

### FEAT-009: 定时任务管理
- Cron CRUD + PI 同步 (create/edit/delete)
- cron.run.completed 事件 + CronRun 扩展字段
- 定时任务管理器系统话题

### FEAT-010: 创建话题向导
- SOP 模板系统 (repo + handler + store)
- Programming/General 分支表单
- cwd 改为可选,支持 PI 自动创建工作目录

### FEAT-013: PI Session 持久化与自动恢复
- Per-session WS 连接 (每个 topic 独享 PI 连接)
- Server 重启后自动恢复已有 session
- topic.resume handler (手动重连)

### FEAT-014: 协议补充
- session.health (connected/disconnected/reconnecting)
- cron.run.completed (success/failed/timeout)
- topic.resume handler
- PI frame type 统一为 'event'

### BUG-001: message.delta 累加逻辑修复
- ws-client.ts 改用 appendDelta (增量追加)
- useDeferredValue 节流 + makeStreamSafe 扩展容错

### BUG-003: 阻止创建同名话题
- topic.repo 新增 getTopicByName 查重
- topic.handler 创建前检查,返回 DUPLICATE_NAME 错误

### 测试
- 新增 100+ 单测 (server handler/repo + web store/ws-client/streaming)
- 新增 4 E2E 测试 (Playwright streaming)
- 全量测试: 318 tests passing

### 验收
- `pnpm -r typecheck` ✅
- `pnpm -r test` ✅ (318 tests: protocol 99 + server 100 + web 109 + mock-pi 10)
- 真实 PI Agent 联调通过

---

## 2026-05-09 [v1.0.0] — Part 1: 核心功能

### FEAT-001: pnpm monorepo 脚手架
- 4 packages (protocol, server, web, mock-pi)
- tsconfig.base.json, biome.json, .gitignore, .npmrc
- GitHub Actions CI (typecheck + build)

### FEAT-002: 协议层类型定义 (packages/protocol)
- 12 domain types, 13 PIEvent payload kinds, 14 RPC methods
- 22 Server→Client + 13 Client→Server WS events
- WSFrame encode/decode + zod schemas
- 78 schema tests passing

### FEAT-003: Mock PI Server (packages/mock-pi)
- WebSocket server with Bearer auth (4401 rejection)
- 5 fixtures: simple-text, tool-use, file-edit, approval, cron-trigger
- Scenario runner with keyword matching + realistic pacing
- Session lifecycle + cron simulator
- 10 integration tests passing

### FEAT-004: Backend Server (packages/server)
- Fastify 5 + better-sqlite3 + drizzle-orm (13 tables)
- 6 repos (topic/message/artifact/cron/usage/interaction)
- PI Adapter WS client with auto-reconnect
- WS Hub with auth, heartbeat, seq tracking
- 6 event handlers + R2 presigned URL
- 11 tests passing

### FEAT-005: Frontend Shell (packages/web)
- 4 Zustand stores (topic/message/ws/ui) with immer
- WebSocket client with auto-reconnect + seq tracking
- Three-column layout: Sidebar + TopicPanel + InspectorPanel
- WsProvider global initialization
- 15 files, typecheck + build passing

### FEAT-006: Core UI Components
- MessageBubble: role-aware bubbles, hover timestamp, streaming support
- MessageList: auto-scroll, typing indicator
- ToolCard: collapsible tool call/result with status icons
- DiffCard: file diff with line numbers
- ApprovalCard: interaction.request with approve/deny
- ThinkingBlock, CronIndicator, UsageBadge
- 8 components, typecheck + build passing

### FEAT-007: Streaming + Stream-safe Markdown
- MarkdownRenderer: stream-safe preprocessing (close unclosed fences/bold)
- Shiki syntax highlighting + remark-gfm
- Streaming state in message-store (streamingText, streamingMessageId)
- WS client accumulates deltas, finalizes on message.end
- 5 files, typecheck + build passing

### 验收
- `pnpm -r typecheck` ✅
- `pnpm -r build` ✅
- `pnpm -r test` ✅ (99/99 tests: protocol 78 + mock-pi 10 + server 11)

---

## 2026-05-09 — 初始版本

项目初始化:
- pnpm monorepo 脚手架
- PM 框架 (需求清单 / Bug 清单 / 发版流程)
- 分支策略建立
