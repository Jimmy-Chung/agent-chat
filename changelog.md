# Changelog

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
