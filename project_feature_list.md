# agent-chat — 需求清单

| 项目 | 值 |
|---|---|
| 当前版本 | v1.0.0 |
| 状态 | Part 1 已完成 |
| 更新时间 | 2026-05-09 |

---

## v1.0.0 — Part 1: 核心功能 (当前版本)

> 基于 `.omc/plans/autopilot-execution-plan.md` Part 1 (步骤 1-7)，PI Agent 侧改动不计入本仓库。

### FEAT-001: pnpm monorepo 脚手架

| 字段 | 值 |
|---|---|
| ID | FEAT-001 |
| 标题 | pnpm monorepo 脚手架 |
| 状态 | 已回归 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 初始化 pnpm monorepo: packages/protocol, server, web, mock-pi。含 tsconfig.base.json, biome.json, .gitignore, .npmrc, CI (GitHub Actions), README |
| 验收标准 | `pnpm install && pnpm -r typecheck && pnpm -F web build && pnpm format --check` 全绿 |
| 测试用例 | 手动验收（脚手架无单测） |
| 影响模块 | 根目录配置 |
| 对应步骤 | Step 1 |

### FEAT-002: 协议层类型定义

| 字段 | 值 |
|---|---|
| ID | FEAT-002 |
| 标题 | 协议层类型定义 (packages/protocol) |
| 状态 | 已回归 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 定义所有跨进程消息的 TypeScript 类型 + zod schema: PIEvent (message/tool/file/todo/plan/interaction/cron/usage), PI RPC 方法签名, 前后端 WS 事件, 领域类型, WS 帧编解码 |
| 验收标准 | `pnpm -F protocol typecheck && pnpm -F protocol test` 全绿, zod schema 测试覆盖 ≥90% |
| 测试用例 | `packages/protocol/src/__tests__/schema.test.ts` (95 tests) |
| 影响模块 | packages/protocol |
| 对应步骤 | Step 2 |
| 备注 | 协议层冻结后改动须在 commit message 标注 `protocol: BREAKING` |

### FEAT-003: Mock PI Server

| 字段 | 值 |
|---|---|
| ID | FEAT-003 |
| 标题 | Mock PI Server (packages/mock-pi) |
| 状态 | 已回归 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 本地 WebSocket 服务模拟 PI Adapter 全部 RPC + 事件流。含 fixture 事件流 (simple-text / tool-use / file-edit / approval / cron-trigger), scenario runner 按 content 关键词匹配 fixture 并按真实节奏推流, Bearer 鉴权 |
| 验收标准 | mock-pi dev 启动后 healthz 200, ws client 连接 + createSession + sendUserMessage("hi") → 收到 start/delta/end 三条事件 |
| 测试用例 | `packages/mock-pi/src/__tests__/scenarios.test.ts` (8 tests) |
| 影响模块 | packages/mock-pi |
| 对应步骤 | Step 3 |

### FEAT-004: 后端核心服务

| 字段 | 值 |
|---|---|
| ID | FEAT-004 |
| 标题 | 后端核心服务 (packages/server) |
| 状态 | 已回归 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | Fastify + SQLite (drizzle) + WebSocket Hub + PI Adapter 客户端 + R2 presigned URL + Token 鉴权 + 系统话题 seed。包含: DB schema (users/topics/messages/message_parts/FTS5/artifacts/cron_jobs/cron_runs/interactions/usage_records/audit_log), WS handler (topic/message/interaction/cron/artifact/search), PI client 自动重连 + seq 续传, 流式 delta 100ms/32KB/end batch flush |
| 验收标准 | 三窗口跑 mock-pi + server, `curl localhost:8080/healthz` 200, 单测 + 集成测试覆盖 ≥70% |
| 测试用例 | `packages/server/src/__tests__/` — 7 files (topic/message/artifact/cron/interaction/usage.repo + ws.hub) |
| 影响模块 | packages/server |
| 对应步骤 | Step 4 |

### FEAT-005: 前端骨架 + 状态管理

| 字段 | 值 |
|---|---|
| ID | FEAT-005 |
| 标题 | 前端骨架 + 状态管理 (packages/web) |
| 状态 | 已回归 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | App Router + 主布局三栏 (TopicSidebar / 对话主区 / RightPanel) + Zustand stores (topics/messages/agent-status/todos/plan/artifacts/interactions/usage) + WS client 自动重连 + seq 续传 + Token 鉴权页。视觉粗糙,不打磨细节,所有值用 CSS 变量占位 |
| 验收标准 | 三窗口跑 mock-pi + server + web, 浏览器输入 token → sidebar 显示系统话题 → 点击进入 → 看到空 message list |
| 测试用例 | `packages/web/src/__tests__/` — topic-store(8), message-store(14), artifact-store(12), cron-store(7), sop-template-store(3), ui-store(4), ws-store(5), ws-client-dispatch(5), streaming-state(6), streaming-perf(4) |
| 影响模块 | packages/web |
| 对应步骤 | Step 5 |

### FEAT-006: 核心消息组件

| 字段 | 值 |
|---|---|
| ID | FEAT-006 |
| 标题 | 核心消息组件 (MessageBubble / ToolCard / DiffCard / ApprovalCard / ThinkingBlock / AgentStatusBar / TodoPanel / PlanPanel) |
| 状态 | 已回归 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 所有 message_part 类型的渲染组件骨架。MessageBubble 根据 role 切样式 (user 右蓝 / assistant 左玻璃 / system 居中紫 / cron 顶部金条), 内部按 part.kind 渲染 MarkdownContent / ThinkingBlock / ToolCard / DiffCard。ApprovalCard 三状态 (pending/approved/rejected) |
| 验收标准 | 触发 fixture tool-use 跑通看到 ToolCard, file-edit 看到 DiffCard, approval 看到 ApprovalCard pending → 点同意 → approved |
| 测试用例 | E2E: `e2e/streaming.spec.ts` (4 tests)，组件渲染 E2E 待补充 (TC-006) |
| 影响模块 | packages/web |
| 对应步骤 | Step 6 |

### FEAT-007: 流式逻辑 + stream-safe Markdown

| 字段 | 值 |
|---|---|
| ID | FEAT-007 |
| 标题 | 流式逻辑 + stream-safe Markdown |
| 状态 | 已回归 (有缺陷，见下方) |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 流式 delta 合并到同一气泡不刷屏不闪烁。message-aggregator 累加 delta, stream-safe-markdown 状态机检测未闭合代码块/列表/表格并虚拟补全。ESC + StopButton abort。性能: 1k delta 期间 FPS ≥50 |
| 验收标准 | fixture simple-text 1000 delta FPS ≥50 无 flash, 代码块未闭合不崩, ESC abort 生效 |
| 测试用例 | `packages/web/src/lib/__tests__/stream-safe-markdown.test.ts` (34) + `packages/web/src/__tests__/streaming-state.test.ts` (6) + `packages/web/src/__tests__/streaming-perf.test.ts` (4) + `e2e/streaming.spec.ts` (4) |
| 影响模块 | packages/web |
| 对应步骤 | Step 7 |
| 备注 | 本期最大技术点 |

#### FEAT-007 缺陷清单 (2026-05-10 审查 → 已修复)

PI Agent 协议为**增量 delta**（参见 pi-agent-requirements.md §4 "累加，前端拼"；mock-pi fixture 实证），以下缺陷已全部修复：

| # | 缺陷 | 严重度 | 状态 | 修复内容 |
|---|---|---|---|---|
| 1 | **BUG-001: delta 累加逻辑错误** | 高 | 已修复 | ws-client.ts 改用 `appendDelta` |
| 2 | **useDeferredValue 节流缺失** | 高 | 已修复 | MessageBubble 添加 `useDeferredValue` |
| 3 | **requestIdleCallback / batch 合并缺失** | 中 | 降级 | `useDeferredValue` 已提供基本节流，E2E FPS ≥ 50 验证通过，暂不需要额外 batch |
| 4 | **makeStreamSafe 未覆盖 `_` / `[` / `~~` / HTML 实体** | 中 | 已修复 | 提取为独立模块，覆盖 7 种未闭合语法 |
| 5 | **FPS ≥ 50 无测量手段** | 低 | 已修复 | E2E 测试 E2 通过 `requestAnimationFrame` 计数验证 |

---

## 需求池 (待讨论)

> 以下需求来自设计文档 `agent-chat-design.md §1 范围内`,归入 Part 2 或后续版本。

### FEAT-015: 话题 rename/delete 前端交互

| 字段 | 值 |
|---|---|
| ID | FEAT-015 |
| 标题 | 话题 rename / delete 前端交互 |
| 状态 | 待讨论 |
| 版本 | v1.2.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 补充话题侧边栏的 rename 和 delete 交互。后端 + 协议 + store 已有完整支持，缺前端 UI 入口（编辑按钮/右键菜单/双击编辑 rename，删除按钮/滑动删除 + 确认弹窗含产物策略选择） |
| 验收标准 | 侧边栏可 rename 话题（ID 不变）、可 delete 话题（普通话题软删除、系统话题不可删），删除时弹窗选择产物处理策略（转池/删除） |
| 测试用例 | TBD |
| 影响模块 | packages/web (Sidebar 组件) |
| 备注 | 未计划（v1.0.0 需求审查时发现前端交互缺口，后端已完整实现） |

### FEAT-008: 产物系统

| 字段 | 值 |
|---|---|
| ID | FEAT-008 |
| 标题 | 产物系统 (Artifacts) |
| 状态 | 已回归 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 话题级产物 + 产物池 (跨话题共享), @产物引用语法, 删话题产物处理 (转产物池/一并删除)。纯本地，不涉及云存储 |
| 验收标准 | 产物 CRUD、话题级产物列表、产物池列表、@产物引用、删话题弹窗选择产物策略 |
| 测试用例 | `packages/server/src/__tests__/artifact.repo.test.ts` (8) + `packages/web/src/__tests__/artifact-store.test.ts` (12)，handler 逻辑待补充 |
| 影响模块 | server, web |
| 对应步骤 | 设计文档 Phase 5 |

### FEAT-016: R2 云端产物上传下载

| 字段 | 值 |
|---|---|
| ID | FEAT-016 |
| 标题 | R2 云端产物上传下载 |
| 状态 | 待讨论 |
| 版本 | v1.2.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 话题级产物上传到 R2 云存储，Agent 可消费产物。包含：1) 用户在话题内上传文件 → R2 存储 → 关联到话题；2) 用户 @产物 发消息 → server 将产物信息（名称、下载 URL）传给 PI Agent → Agent 可读取内容并加工；3) R2 presigned URL 上传、下载链接生成 |
| 验收标准 | 用户上传文件到 R2 成功、Agent 能读取上传产物内容并加工、下载链接可访问 |
| 测试用例 | TBD |
| 影响模块 | packages/server (r2/client.ts), packages/web |
| 备注 | 从 FEAT-008 拆出，FEAT-008 为本地产物系统（已回归），本需求为 R2 云端部分 |

### FEAT-009: 定时任务管理

| 字段 | 值 |
|---|---|
| ID | FEAT-009 |
| 标题 | 定时任务管理 (Cron) |
| 状态 | 已回归 |
| 版本 | v1.0.0 (Part 1 基础) / v1.1.0 (完善) |
| 提出时间 | 2026-05-09 |
| 描述 | 话题内自然语言创建 cron, 触发结果回到原话题, 系统话题"定时任务管理"列表/暂停/编辑/删除 |
| 验收标准 | TBD |
| 测试用例 | `packages/server/src/__tests__/cron.repo.test.ts` (13) + `packages/server/src/__tests__/cron-handler.test.ts` (7) + `packages/web/src/__tests__/cron-store.test.ts` (7) |
| 影响模块 | server, web |
| 对应步骤 | 设计文档 Phase 5 |

### FEAT-010: 创建话题向导

| 字段 | 值 |
|---|---|
| ID | FEAT-010 |
| 标题 | 创建话题向导 |
| 状态 | 已回归 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 创建话题向导 (programming/general 分支表单)。Programming 类型工作目录由 PI Agent 按 topicId 自动生成，用户无需手动填写 |
| 验收标准 | TBD |
| 测试用例 | `packages/server/src/__tests__/topic-handler.test.ts` (10) + `packages/server/src/__tests__/topic.repo.test.ts` (7) + `packages/web/src/__tests__/topic-store.test.ts` (8) |
| 影响模块 | server, web |
| 对应步骤 | 设计文档 Phase 4 |

#### 外部依赖

- [external] TODO: PI Agent 新增 `WORKSPACE_ROOT` 环境变量，收到 createSession 时自动在 `{WORKSPACE_ROOT}/{topicId}` 下创建工作目录，`ProgrammingSpec.cwd` 改为可选（不传则自动生成）

### FEAT-011: PWA + 部署

| 字段 | 值 |
|---|---|
| ID | FEAT-011 |
| 标题 | PWA + 部署 + 优化 |
| 状态 | 待讨论 |
| 版本 | v1.2.0 |
| 提出时间 | 2026-05-09 |
| 描述 | manifest + SW, Cloudflare Tunnel 配置, Lighthouse PWA/Performance ≥90, iPhone 实测 |
| 验收标准 | Lighthouse PWA ≥90, iPhone 添加到主屏幕可启动 |
| 测试用例 | TBD |
| 影响模块 | web, 部署配置 |
| 对应步骤 | 设计文档 Phase 6 |

### FEAT-012: 视觉打磨 + 响应式 + 移动端

| 字段 | 值 |
|---|---|
| ID | FEAT-012 |
| 标题 | 视觉打磨 + 响应式 + 移动端适配 (Part 2) |
| 状态 | 待讨论 |
| 版本 | v1.1.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 替换占位 design tokens 为设计稿最终值, Liquid Glass 工具类, PWA, 响应式断点 + iPhone 抽屉/sheet/大标题 |
| 验收标准 | TBD (需等设计稿) |
| 测试用例 | TBD |
| 影响模块 | packages/web |
| 对应步骤 | autopilot-execution-plan.md Step 8 |
| 备注 | **必须等用户手动喂入设计稿后才能启动** |

---

### FEAT-013: PI Session 持久化与自动恢复

| 字段 | 值 |
|---|---|
| ID | FEAT-013 |
| 标题 | PI Session 持久化与自动恢复 (Per-session WS + Resume) |
| 状态 | 已验证 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 每个 topic 独享一条 PI WS 连接，避免多 session 事件交叉。Server 重启或 PI Agent 意外退出后，已有 topic 的 session 能自动恢复：1) Server 启动时遍历有 pi_session_id 的 topic，为每个 session 重新建立 WS 连接；2) sendUserMessage 失败时检测 session 失效，自动 resume 或提示用户；3) Topic 删除时关闭对应的 WS 连接 |
| 验收标准 | 1) 多个 topic 并发收发消息互不干扰；2) Server 重启后已有 topic 能自动恢复 PI 连接；3) 删除 topic 时正确清理 WS |
| 测试用例 | TC-013: 创建2个topic并发消息；重启server后发消息 |
| 影响模块 | packages/server (pi/client.ts, pi/event-router.ts, ws/handlers/) |
| 备注 | 未计划（v1.0.0 E2E 联调时发现必需，临时插入） |

---

### FEAT-014: 协议补充 — session.health / topic.resume / cron.run.completed

| 字段 | 值 |
|---|---|
| ID | FEAT-014 |
| 标题 | 协议补充 — session.health / topic.resume / cron.run.completed |
| 状态 | 已回归 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 补充三个 WS 事件：1) `session.health` (Server→Client): PI 连接状态通知 (connected/disconnected/reconnecting)，Server 自动重试 N 次后推送 disconnected 让前端显示手动重连；2) `topic.resume` (Client→Server): 用户手动触发 PI session 重连；3) `cron.run.completed` (Server→Client): 定时任务执行结果回调 (success/failed/timeout + summary + duration) |
| 验收标准 | protocol schema 测试覆盖正反例，`pnpm -F protocol test` 全绿 |
| 测试用例 | `packages/protocol/src/__tests__/schema.test.ts` (session.health/cron.run.completed/topic.resume: 17 tests) |
| 影响模块 | packages/protocol |
| 备注 | 未计划（v1.0.0 需求审查时发现协议缺口，临时插入） |

---

## 不在本仓库范围的需求

> 以下需求归 PI Adapter 仓库实现,详见 `.omc/plans/pi-agent-requirements.md`
> 架构：普通对话走 PI Agent 直接处理；编程对话走 PI Adapter → Claude Code（透传）。

### E1: 增量 delta 模式
- **状态**: PI 已确认会改
- **当前**: `message.delta` 发送 snapshot 式全量文本
- **要求**: 改为增量 delta（每次只发新增文本片段，前端累加拼接）

### E2: edit 工具调用 → file.diff 事件翻译
- **状态**: 待改
- **背景**: 编程对话中，Claude Code 已有 `edit` 内建工具，PI adapter 需拦截该 tool call
- **要求**: 提取 `path`/`before`/`after`，翻译为 `{ kind: 'file.diff', path, before, after, messageId }` 事件推给 server

### E3: write 工具调用 → artifact.created 事件翻译
- **状态**: 待改
- **背景**: 编程对话中，Claude Code 已有 `write` 内建工具，PI adapter 需拦截该 tool call
- **要求**: 翻译为 `{ kind: 'artifact.created', artifactId, name, mime, sizeBytes, metadata }` 事件推给 server；产物系统依赖此能力

### E4: usage.delta 事件上报
- **状态**: 待改
- **要求**: 每次 `message.end` 后发送 `{ kind: 'usage.delta', messageId, model, inputTokens, outputTokens, cacheReadTokens?, cacheCreateTokens? }`

### E5: WORKSPACE_ROOT 环境变量 (FEAT-010 外部依赖)
- **状态**: 待改
- **要求**: 收到 `createSession` 时自动在 `{WORKSPACE_ROOT}/{topicId}` 创建工作目录

### 其他已有外部需求
- PI Adapter 接口 (WebSocket + JSON-RPC)
- Claude Code SDK event → PIEvent 映射
- 通用 Workflow Tools 注入 (workflow_set_plan / workflow_upsert_todos / workflow_report_step)
- Cron 集成 (触发回到原 session)
- 健康检查 /healthz
