# Changelog

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
