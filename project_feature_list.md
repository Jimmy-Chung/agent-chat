# agent-chat — 需求清单

| 项目 | 值 |
|---|---|
| 当前版本 | v1.2.0 |
| 状态 | Cloudflare Workers 全链路迁移 |
| 更新时间 | 2026-05-13 |

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
| 描述 | 本地 WebSocket 服务模拟 PI Adapter 全部 RPC + 事件流。含 fixture 事件流 (simple-text / tool-use / file-edit / approval / cron-trigger), scenario runner 按 content 关键词匹配 fixture 并按真实节奏推流, 访问控制模拟 |
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
| 描述 | Fastify + SQLite (drizzle) + WebSocket Hub + PI Adapter 客户端 + R2 presigned URL + 访问控制 + 系统话题 seed。包含: DB schema (users/topics/messages/message_parts/FTS5/artifacts/cron_jobs/cron_runs/interactions/usage_records/audit_log), WS handler (topic/message/interaction/cron/artifact/search), PI client 自动重连 + seq 续传, 流式 delta 100ms/32KB/end batch flush |
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
| 描述 | App Router + 主布局三栏 (TopicSidebar / 对话主区 / RightPanel) + Zustand stores (topics/messages/agent-status/todos/plan/artifacts/interactions/usage) + WS client 自动重连 + seq 续传 + 访问控制页。视觉粗糙,不打磨细节,所有值用 CSS 变量占位 |
| 验收标准 | 三窗口跑 mock-pi + server + web, 浏览器完成访问验证 → sidebar 显示系统话题 → 点击进入 → 看到空 message list |
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

## v1.2.0 — Cloudflare 全链路部署

> 基础设施迁移：Fly.io → Cloudflare Workers + D1 + R2 + Pages
> 详见：`.omc/plans/cloudflare-migration-plan.md`
> **范围说明**：本版本仅包含 Cloudflare 基础设施迁移（FEAT-011 + 三大改造任务：SQLite→D1、Fastify→Hono、ws→Durable Objects），UI 功能类需求移至 v1.3.0。

**质量门禁：55 个测试用例必须全部通过才能合并**

| 类别 | 测试 ID | 测试数 | 覆盖范围 |
|------|---------|--------|----------|
| 回归测试 | R-001~R-005 | 5 | 访问控制/消息链路/WS隔离/删除清理/断线重连 |
| D1 异步转换 | DA-001~DA-010 | 10 | repo 层异步化正确性（最高风险） |
| Durable Objects | DO-001~DO-013 | 13 | WS 连接/断连/重连/心跳/冷启动/并发 |
| Hono 路由 | HR-001~HR-008 | 8 | HTTP 路由/访问控制/CORS/错误处理/WS升级 |
| Wrangler 配置 | WR-001~WR-005 | 5 | binding 名称一致性/运行时配置访问/Node 环境变量清理 |
| CF Pages | PG-001~PG-005 | 5 | next-on-pages 构建/Edge Runtime/前端渲染 |
| CI/CD | CD-001~CD-004 | 4 | 自动部署/PR预览/migration顺序/测试门禁 |
| 性能基准 | P-001~P-005 | 5 | 延迟/吞吐量基准 |

> 详细测试用例定义见 `.omc/plans/cloudflare-migration-plan.md` §4

### v1.2.x 过程记录

| 小版本 | 日期 | 需求/工程影响 |
|---|---|---|
| v1.2.21 | 2026-05-12 | Workers 运行时兼容性修复：本地 ULID、WS 访问控制、DO 配置注入、前端 ping 心跳 |
| v1.2.22 | 2026-05-12 | D1 FTS5 初始化兼容性修复，确保 Worker 冷启动不因 tokenizer 差异全量 500 |
| v1.2.23 | 2026-05-12 | 恢复 Workers/DO 发送消息链路到 v1.1.0 语义；PI Adapter 访问凭证改为 Worker 兼容传递方式 |
| v1.2.24 | 2026-05-13 | 修复 Inspector / artifact / @产物选择器在 Cloudflare 迁移后的回归问题 |
| v1.2.25 | 2026-05-13 | 修复 Inspector Cron 过滤 selector 导致的 React 渲染循环 |
| v1.2.26 | 2026-05-13 | GitHub Actions 升级到 Node 24 action runtime，维持 CI/CD 兼容性 |
| v1.2.27 | 2026-05-13 | 清理公开需求/缺陷文档中的访问凭证、访问控制与环境配置细节 |

---

## v1.2.0 功能需求

> 以下需求来自设计文档 `agent-chat-design.md §1 范围内`,归入 Part 2 或后续版本。

### FEAT-015: 话题 rename/delete 前端交互

| 字段 | 值 |
|---|---|
| ID | FEAT-015 |
| 标题 | 话题 rename / delete 前端交互 |
| 状态 | 已回归 |
| 版本 | v1.1.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 补充话题侧边栏的 rename 和 delete 交互。后端 + 协议 + store 已有完整支持，缺前端 UI 入口（编辑按钮/右键菜单/双击编辑 rename，删除按钮/滑动删除 + 确认弹窗含产物策略选择）。Delete 部分已在 FEAT-026 实现，rename 待补充 |
| 验收标准 | 侧边栏可 rename 话题（ID 不变）、可 delete 话题（普通话题软删除、系统话题不可删），删除时弹窗选择产物处理策略（转池/删除） |
| 测试用例 | TBD |
| 影响模块 | packages/web (Sidebar 组件) |
| 备注 | Delete 部分由 FEAT-026 (S9) 覆盖，rename 交互待补充 |

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

### FEAT-029: 会话历史一致性优化（PI 原始会话为事实源）

| 字段 | 值 |
|---|---|
| ID | FEAT-029 |
| 标题 | 会话历史一致性优化（PI 原始会话为事实源） |
| 状态 | 待讨论 |
| 版本 | TBD（下个版本讨论） |
| 提出时间 | 2026-05-12 |
| 描述 | 优化 topic 历史记录的一致性模型，评估将 PI / Claude Code 原始会话作为事实源、SQLite 作为缓存 / 投影视图的方案。重点讨论：1) 刷新或恢复 topic 时，是否需要从 PI 补偿缺失历史；2) 是否需要基于 seq / offset 的增量同步，而非每次全量回放 jsonl；3) 如何避免 server 重启、断线、漏事件导致数据库历史与 PI 原始会话分叉；4) 在一致性提升的前提下控制长会话下的性能与存储成本 |
| 验收标准 | TBD |
| 测试用例 | TBD |
| 影响模块 | packages/server, packages/protocol, packages/web, [external] PI Adapter |
| 备注 | 当前实现以 SQLite 历史为 UI 读取源，存在与 PI 原始会话不一致的风险；本需求先做方案讨论，不在当前版本落地 |

### FEAT-030: 消息 hover 时间戳布局微调

| 字段 | 值 |
|---|---|
| ID | FEAT-030 |
| 标题 | 消息 hover 时间戳布局微调 |
| 状态 | 待讨论 |
| 版本 | TBD（后续版本讨论） |
| 提出时间 | 2026-05-12 |
| 描述 | 优化消息 hover 时显示的时间戳布局，使其更接近 iMessage 风格的气泡内侧水平贴边样式。重点讨论：1) user / assistant 气泡内时间戳的精确位置与对齐；2) 与 UsageBadge 共存时的布局策略；3) hover 态出现时是否应避免额外撑高消息气泡；4) 多行消息、流式消息、含 ToolCard / DiffCard 时的视觉一致性 |
| 验收标准 | TBD |
| 测试用例 | TBD |
| 影响模块 | packages/web |
| 备注 | 当前已做一版内侧右下角布局，但位置与交互细节仍需继续打磨 |

### FEAT-016: R2 云端产物上传下载

| 字段 | 值 |
|---|---|
| ID | FEAT-016 |
| 标题 | R2 云端产物上传下载 |
| 状态 | 待讨论 |
| 版本 | 待定版本 |
| 提出时间 | 2026-05-10 |
| 描述 | 话题级产物上传到 R2 云存储，Agent 可消费产物。包含：1) 用户在话题内上传文件 → R2 存储 → 关联到话题；2) 用户 @产物 发消息 → server 将产物信息（名称、下载 URL）传给 PI Agent → Agent 可读取内容并加工；3) R2 presigned URL 上传、下载链接生成 |
| 验收标准 | 用户上传文件到 R2 成功、Agent 能读取上传产物内容并加工、下载链接可访问 |
| 测试用例 | R2-001~R2-005（R2 集成，待需求确认后补充）；D1 迁移测试（DA-001~DA-010）已归入 v1.2.0 cloudflare-migration-plan.md |
| 影响模块 | packages/server (r2/client.ts), packages/web |
| 备注 | 从 FEAT-008 拆出，FEAT-008 为本地产物系统（已回归），本需求为 R2 云端部分 |

#### FEAT-016 测试用例

##### R2 集成测试 (R2-001~R2-005)

| 用例 ID | 测试内容 | 通过标准 |
|---------|----------|----------|
| R2-001 | presigned URL 生成 | 生成的 URL 有效且可访问 |
| R2-002 | 文件上传流程 | 文件成功上传到 R2，可通过 URL 下载 |
| R2-003 | 多文件并发上传 | 10 个文件同时上传无冲突 |
| R2-004 | R2 权限验证 | 未授权访问返回 403 |
| R2-005 | R2 删除后访问 | 删除的文件 URL 返回 404 |

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

- [external] TODO: PI Agent 新增工作区根目录配置，收到 createSession 时自动在 `{workspaceRoot}/{topicId}` 下创建工作目录，`ProgrammingSpec.cwd` 改为可选（不传则自动生成）

### FEAT-011: PWA + 部署

| 字段 | 值 |
|---|---|
| ID | FEAT-011 |
| 标题 | PWA + 部署 + 优化 |
| 状态 | 部分完成 |
| 版本 | v1.2.0 |
| 提出时间 | 2026-05-09 |
| 描述 | manifest + SW, Cloudflare 部署（前端 Pages + 后端 Workers），Lighthouse PWA/Performance ≥90, iPhone 实测 |
| 验收标准 | Lighthouse PWA ≥90, iPhone 添加到主屏幕可启动 |
| 测试用例 | 详细测试用例见 `.omc/plans/cloudflare-migration-plan.md`（HR-001~008, DO-001~013, P-001~005）；下方为概要 |
| 影响模块 | web, 部署配置 |
| 对应步骤 | 设计文档 Phase 6 |
| 备注 | Cloudflare 部署部分已完成：Workers、Pages、CI/CD 已成功部署。PWA 本体未完成：源码中未发现 manifest、service worker 注册或 next-pwa 配置；当前只有基础 metadata / theme-color。 |

#### FEAT-011 测试用例

##### Hono 路由测试 (HR-001~HR-005)

> Fastify → Hono 迁移验证

| 用例 ID | 测试内容 | 通过标准 |
|---------|----------|----------|
| HR-001 | 所有 HTTP 路由可用 | GET/POST/PUT/DELETE 路由均正常响应 |
| HR-002 | 健康检查端点 | /healthz 返回 200 |
| HR-003 | 访问控制中间件 | 未授权请求返回 401 |
| HR-004 | CORS 配置正确 | 跨域请求正常处理 |
| HR-005 | 错误响应格式 | 错误返回统一 JSON 格式 |

##### Durable Objects WebSocket 测试 (DO-001~DO-008)

> ws → Durable Objects 迁移验证，核心风险点

| 用例 ID | 测试内容 | 通过标准 |
|---------|----------|----------|
| DO-001 | 单客户端连接建立 | WS 连接成功，收到 initial topics |
| DO-002 | 多客户端连接隔离 | 不同 topic 的 client 互不干扰 |
| DO-003 | PI 连接建立 | Durable Object 正确连接 PI Adapter |
| DO-004 | 断线重连 | PI 断线后自动重连，恢复 session |
| DO-005 | 消息路由正确性 | user message 正确路由到对应 topic |
| DO-006 | 心跳机制 | 300s 无响应自动断开，释放资源 |
| DO-007 | 并发连接压测 | 100 并发连接无内存泄漏 |
| DO-008 | Durable Object 冷启动 | 首次连接延迟 < 2s |

##### 性能基准测试 (P-001~P-005)

| 用例 ID | 测试内容 | 通过标准 |
|---------|----------|----------|
| P-001 | 首页加载时间 | < 1.5s（Lighthouse） |
| P-002 | WebSocket 首次连接延迟 | < 500ms |
| P-003 | 消息发送延迟 | < 200ms（不含 PI 处理时间） |
| P-004 | 100 条消息历史加载 | < 1s |
| P-005 | D1 写入延迟 | < 100ms（单条） |

### FEAT-031: SQLite → Cloudflare D1 数据库迁移

| 字段 | 值 |
|---|---|
| ID | FEAT-031 |
| 标题 | SQLite → Cloudflare D1 数据库迁移 |
| 状态 | 已回归 |
| 版本 | v1.2.0 |
| 提出时间 | 2026-05-12 |
| 描述 | 将后端数据库从 better-sqlite3（本地同步 API）迁移到 Cloudflare D1（异步 API）。包含：1) 6 个 repo 文件（topic/message/artifact/cron/interaction/usage）全部改为 async/await；2) Drizzle ORM 切换到 `drizzle-orm/d1`；3) 数据迁移脚本（旧 SQLite → D1）；4) FTS5 虚拟表兼容性验证。这是本次迁移改动量最大、最易出错的部分，必须优先完成 |
| 验收标准 | DA-001~DA-010 全绿；`pnpm -r typecheck` 无报错；`grep "better-sqlite3" packages/server` 结果为空；D1 行数与原 SQLite 一致 |
| 测试用例 | DA-001~DA-010（见 `.omc/plans/cloudflare-migration-plan.md` §4.3） |
| 影响模块 | packages/server/src/db/（schema + 6 个 repo 文件 + migrate.ts） |

### FEAT-032: Fastify → Hono 路由迁移

| 字段 | 值 |
|---|---|
| ID | FEAT-032 |
| 标题 | Fastify → Hono 路由迁移 |
| 状态 | 已回归 |
| 版本 | v1.2.0 |
| 提出时间 | 2026-05-12 |
| 描述 | 将 Node.js Fastify 后端改造为 Cloudflare Workers 兼容的 Hono 应用。包含：1) 重写 `index.ts` 为 Workers 入口；2) `/healthz` 迁移到 Hono，返回 D1 连接状态（而非 SQLite 文件大小）；3) Node 环境变量访问替换为 Workers 运行时配置访问；4) 访问控制中间件、CORS、错误响应格式保持一致 |
| 验收标准 | HR-001~HR-008 全绿；`grep -r "process\.env" packages/server/src` 结果为空 |
| 测试用例 | HR-001~HR-008（见 `.omc/plans/cloudflare-migration-plan.md` §4.5） |
| 影响模块 | packages/server/src/index.ts, config.ts, routes/health.ts |

### FEAT-033: ws → Durable Objects WebSocket 迁移

| 字段 | 值 |
|---|---|
| ID | FEAT-033 |
| 标题 | ws → Durable Objects WebSocket 迁移 |
| 状态 | 已回归 |
| 版本 | v1.2.0 |
| 提出时间 | 2026-05-12 |
| 描述 | 将 Node.js ws 全局 WsHub 迁移到 Cloudflare Durable Objects（每 Topic 一个 DO 实例）。包含：1) 编写 `TopicDurableObject` 类，管理前端 WS 连接 + PI WS 连接；2) 心跳从 `setInterval` 改为 DO `alarm()` API；3) PI session 冷启动恢复（从 DO Storage 读取 pi_session_id）；4) 广播、消息路由、断线重连逻辑迁移 |
| 验收标准 | DO-001~DO-013 全绿；多 Topic 并发消息互不干扰；DO 冷启动延迟 < 2s |
| 测试用例 | DO-001~DO-013（见 `.omc/plans/cloudflare-migration-plan.md` §4.4） |
| 影响模块 | packages/server/src/ws/hub.ts（重写为 DO 类）, wrangler.toml |

### FEAT-034: CI/CD Pipeline + 本地开发环境迁移

| 字段 | 值 |
|---|---|
| ID | FEAT-034 |
| 标题 | CI/CD Pipeline（GitHub → Cloudflare）+ 本地开发环境迁移 |
| 状态 | 已回归 |
| 版本 | v1.2.0 |
| 提出时间 | 2026-05-12 |
| 描述 | 建立 GitHub → Cloudflare 自动部署流水线，并更新本地开发环境。包含：1) 创建 `.github/workflows/deploy.yml`（test → D1 migration → Workers deploy 顺序）；2) Cloudflare Pages 连接 GitHub repo，PR 自动生成 Preview URL；3) 更新 `pnpm dev` 中 server 启动命令为 `wrangler dev --local`（miniflare 模拟 D1/DO） |
| 验收标准 | CD-001~CD-004 全绿；push to master 自动部署；PR 自动生成 Preview URL；本地 `wrangler dev --local` 可正常启动 |
| 测试用例 | CD-001~CD-004（见 `.omc/plans/cloudflare-migration-plan.md` §4.8） |
| 影响模块 | .github/workflows/deploy.yml, package.json（dev 脚本） |

### FEAT-012: 视觉打磨 + 响应式 + 移动端

| 字段 | 值 |
|---|---|
| ID | FEAT-012 |
| 标题 | 视觉打磨 + 响应式 + 移动端适配 (Part 2) |
| 状态 | 已回归 |
| 版本 | v1.1.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 替换占位设计变量为设计稿最终值, Liquid Glass 工具类, 响应式断点。设计稿已喂入，设计变量/globals.css/核心组件已改造完成。移动端和交互增强拆到 FEAT-019 ~ FEAT-023 |
| 验收标准 | 桌面端三栏 Liquid Glass 视觉与设计稿一致，CSS 变量覆盖全部设计变量 |
| 测试用例 | TBD |
| 影响模块 | packages/web |
| 对应步骤 | autopilot-execution-plan.md Step 8 |
| 备注 | 设计稿已喂入，基础视觉改造已完成，交互增强见子需求 |

### FEAT-017: 创建话题 Glass Modal

| 字段 | 值 |
|---|---|
| ID | FEAT-017 |
| 标题 | 创建话题改为 Glass Modal 弹窗 |
| 状态 | 已回归 |
| 版本 | v1.1.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 设计稿 S3 显示创建话题为 glass-3 毛玻璃模态弹窗（带半透明遮罩层），当前实现为 Sidebar 内嵌表单。需将创建话题从内联表单改为独立 Modal，包含：1) glass-3 背景 + backdrop blur 遮罩；2) 居中弹出动画；3) 点击遮罩或 ESC 关闭 |
| 验收标准 | 点击「新建话题」按钮弹出 glass modal，填写后创建成功，ESC/遮罩关闭 |
| 测试用例 | TBD |
| 影响模块 | packages/web (Sidebar + 新 Modal 组件) |
| 设计稿 | S3 创建话题 |
| 备注 | 从设计稿审查发现。FEAT-010 已回归 inline form，本需求升级为 modal 形态 |

### FEAT-018: 创建话题高级选项交互

| 字段 | 值 |
|---|---|
| ID | FEAT-018 |
| 标题 | 创建话题高级选项 — Segmented Control / YOLO 开关 / Permission Mode |
| 状态 | 已回归 |
| 版本 | v1.1.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 设计稿 S3 包含以下高级交互控件，当前实现为简陋的 select/checkbox，需升级为设计稿形态：1) Agent 类型选择：Segmented control 分段选择器 + 选中 glow 效果；2) YOLO Mode：iOS 风格 switch toggle（非 checkbox）；3) Permission Mode：Radio button 列表 + 每项描述文字（Default: 需审批/Accept Edits: 自动接受编辑/Plan Only: 仅规划/Bypass: 全自动）；4) Working Directory：Folder picker 按钮（非文本输入框） |
| 验收标准 | Agent 类型用 segmented control、YOLO 用 switch toggle、Permission 用 radio list + 描述 |
| 测试用例 | TBD |
| 影响模块 | packages/web (创建话题表单组件) |
| 设计稿 | S3 创建话题 |
| 备注 | 从设计稿审查发现。当前 select/checkbox 功能正确但视觉不达标 |

### FEAT-019: AgentStatusBar 完整交互

| 字段 | 值 |
|---|---|
| ID | FEAT-019 |
| 标题 | AgentStatusBar 完整交互 — 状态指示 + 计时器 + 快捷键 |
| 状态 | 已回归 |
| 版本 | v1.1.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 设计稿 S2 显示话题顶部有 AgentStatusBar 组件，当前仅有骨架但未细化。需补充：1) Agent 状态文字 (Thinking / Using tool / Idle) + 金色 pulse 动画；2) 已用时间计时器 (0:42 格式)；3) Stop 按钮 + ⌘. 快捷键提示；4) 状态跟随 agent.status 事件变化 |
| 验收标准 | 流式回复时顶部显示状态条（Thinking → Using tool → Idle），计时器实时更新，⌘. 可中止 |
| 测试用例 | TBD |
| 影响模块 | packages/web (TopicPanel + AgentStatusBar 组件) |
| 设计稿 | S2 流式生成中 |
| 备注 | 从设计稿审查发现。FEAT-006 提到 AgentStatusBar 骨架但未细化交互 |

### FEAT-020: Cron 管理卡片增强

| 字段 | 值 |
|---|---|
| ID | FEAT-020 |
| 标题 | Cron 管理卡片增强 — 筛选 / 错误展示 / Resume |
| 状态 | 待讨论 |
| 版本 | v1.3.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 设计稿 S7 显示定时任务管理有丰富的卡片交互，当前实现简陋。需补充：1) 筛选 chips (全部 / Active / Paused / Error)；2) Cron 卡片增强：来源话题 chip + 上次/下次执行时间 + 状态 badge；3) Error banner：显示错误详情 + 红色背景；4) 操作按钮增加 Resume / Retry（不仅仅是 Pause/Delete）；5) Hover 状态：蓝色边框 glow |
| 验收标准 | 筛选可切换、Error cron 显示错误详情、Pause 的 cron 可 Resume |
| 测试用例 | TBD |
| 影响模块 | packages/web (CronAdminView + cron-store) |
| 设计稿 | S7 定时任务管理 |
| 备注 | 从设计稿审查发现。FEAT-009 基础已回归，本需求为 UI 增强 |

### FEAT-021: 消息列表日期分割线

| 字段 | 值 |
|---|---|
| ID | FEAT-021 |
| 标题 | 消息列表日期分割线 |
| 状态 | 待讨论 |
| 版本 | v1.3.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 设计稿 S13 显示消息列表中有日期标签（如"今天 · 14:32"），按天分组消息。当前消息列表无日期分割，连续消息无法区分日期边界。需在 MessageList 中按 started_at 日期分组，渲染居中的日期分割线 |
| 验收标准 | 不同日期的消息之间显示日期标签，同一天内不重复显示 |
| 测试用例 | TBD |
| 影响模块 | packages/web (MessageList 组件) |
| 设计稿 | S13 iPhone |
| 备注 | 从设计稿审查发现 |

### FEAT-022: Plan Tab 进度追踪

| 字段 | 值 |
|---|---|
| ID | FEAT-022 |
| 标题 | Inspector Plan Tab 进度追踪 |
| 状态 | 已回归 |
| 版本 | v1.1.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 设计稿 S2 显示 Inspector 面板 Plan tab 有：1) Markdown 渲染的计划内容；2) Checkbox 进度追踪（可勾选已完成项）；3) 进度百分比显示；4) 预估时间 (est. time)。当前 PlanTab 仅渲染纯文本 plan 字符串 |
| 验收标准 | Plan 内容以 Markdown 渲染，checkbox 可交互，进度条/百分比实时更新 |
| 测试用例 | TBD |
| 影响模块 | packages/web (InspectorPanel PlanTab) |
| 设计稿 | S2 流式生成中 Inspector 面板 |
| 备注 | 从设计稿审查发现 |

### FEAT-023: iPhone 移动端专属布局

| 字段 | 值 |
|---|---|
| ID | FEAT-023 |
| 标题 | iPhone 移动端专属布局 |
| 状态 | 已回归 |
| 版本 | v1.1.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 设计稿 S13 显示 iPhone 专属布局，需单独适配：1) 抽屉式 Sidebar（左滑打开，覆盖在主面板上方）；2) 大标题导航栏 (Large Title)；3) 底部固定 Composer；4) Agent 状态条（顶部窄条）；5) Dynamic Island 适配（顶部 safe area）；6) Home Indicator Bar 适配（底部 safe area）；7) Inspector 面板改为底部 sheet |
| 验收标准 | iPhone 上打开体验与设计稿 S13 一致，sidebar 为抽屉式、composer 固定底部 |
| 测试用例 | TBD |
| 影响模块 | packages/web (ChatLayout + Sidebar + TopicPanel 响应式) |
| 设计稿 | S13 iPhone |
| 备注 | 从设计稿审查发现。与 FEAT-011 PWA 配合实施 |

### FEAT-024: Permission Mode UI 重构

| 字段 | 值 |
|---|---|
| ID | FEAT-024 |
| 标题 | Permission Mode UI 重构 — YOLO/普通 简化 |
| 状态 | 已回归 |
| 版本 | v1.1.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 创建编程话题时权限模式简化为两个选项：YOLO（跳过所有权限检查，Agent 自由操作）和 普通（Agent 修改文件时需逐一确认）。Default/AcceptEdits 由 PI Agent 在会话中动态决定（每次修改发 interaction.request），不在创建时选择。Plan 模式作为话题内可切换的独立开关（见 FEAT-025）。去掉了原来冗余的 permissionMode 下拉框 + YOLO checkbox + Plan checkbox |
| 验收标准 | 创建编程话题时只有 YOLO/普通 两个选项，带描述文字，交互清晰 |
| 测试用例 | 手动验证 |
| 影响模块 | packages/web (Sidebar 组件) |
| 备注 | 用户反馈：Default/AcceptEdits 是会话中动态行为，不应在创建时预设 |

### FEAT-025: Plan 模式话题内切换

| 字段 | 值 |
|---|---|
| ID | FEAT-025 |
| 标题 | Plan 模式话题内切换 — 编程话题 header 开关 |
| 状态 | 已回归 |
| 版本 | v1.1.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 编程话题进入后，在话题 header 提供 Plan 模式切换按钮。Plan 模式开启时 Agent 只读不修改文件；关闭时 Agent 按原始权限模式（default/acceptEdits/yolo）操作。按钮用金色高亮标识 Plan 状态。当前仅实现前端 UI，PI Agent 侧需配合支持动态切换（见 pi-agent-requirements.md C16） |
| 验收标准 | 编程话题 header 显示 Plan 切换按钮，点击切换高亮状态，PI Agent 收到模式切换指令 |
| 测试用例 | TBD |
| 影响模块 | packages/web (TopicPanel), packages/server, [external] PI Agent |
| 备注 | 用户需求：Plan 模式不应仅在创建时选，话题内也应可随时切换。PI 侧需求已写入 pi-agent-requirements.md §3.2 setPlanMode RPC + §10 AC |

### FEAT-026: S9 删除话题弹窗

| 字段 | 值 |
|---|---|
| ID | FEAT-026 |
| 标题 | S9 删除话题弹窗 — Glass modal + 产物策略选择 |
| 状态 | 已回归 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 设计稿 S9 实现：删除话题时弹出 Liquid Glass modal，包含红色垃圾桶 glyph、话题名称、产物数量摘要、mime chip 预览行。Radio 选项：「转入产物池(保留)」(带绿色推荐 badge) vs「跟随话题一起删除」(红色警告)。底栏 Esc 快捷键 + 确认删除按钮(红色渐变)。TopicItem hover 显示垃圾桶图标，系统话题不可删 |
| 验收标准 | Sidebar hover 普通话题出现删除图标 → 点击弹 glass modal → 产物预览 + radio 选择 → 确认删除 → 话题消失。系统话题不显示删除按钮 |
| 测试用例 | 手动验证 |
| 影响模块 | packages/web (DeleteTopicModal, TopicItem, Sidebar) |
| 设计稿 | S9 删除话题弹窗 |
| 备注 | 覆盖 FEAT-015 的 delete 部分 |

### FEAT-027: S6 @产物选择器升级

| 字段 | 值 |
|---|---|
| ID | FEAT-027 |
| 标题 | S6 @产物选择器升级 — Filter pills + Mime 图标 + 键盘导航 |
| 状态 | 已回归 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 设计稿 S6 实现：MessageInput 输入 @ 弹出升级版产物选择器 popover (640px glass modal)。Tab 栏（当前话题/产物池）含蓝色 count badge；搜索框 + filter pills（全部/表格/图片/文档）；分组列表（最近用过/本话题其它）；每行含 mime 色块图标 + 名称 + 来源话题 + 时间 + 大小；选中行高亮 + ↵ 引用提示；键盘导航（↑↓ 移动、Enter 选中、Tab 切 Tab、Esc 关闭）；底栏快捷键提示 |
| 验收标准 | 输入 @ 弹出选择器、↑↓ 键盘导航、Enter 选中插入 @mention、Tab 切换、filter pills 过滤、搜索正常 |
| 测试用例 | 手动验证 |
| 影响模块 | packages/web (MessageInput) |
| 设计稿 | S6 @产物选择器 |
| 备注 | 升级 FEAT-005/FEAT-008 的基础 @ mention picker |

---

### FEAT-028: Turn ID — 消息轮次聚合（server + 前端）

| 字段 | 值 |
|---|---|
| ID | FEAT-028 |
| 标题 | Turn ID — 消息轮次聚合（server + 前端） |
| 状态 | 已回归 |
| 版本 | v1.1.0 |
| 提出时间 | 2026-05-11 |
| 描述 | 适配层（PI Adapter）v1.2.0 C19 会在每轮 user message 时生成 `turnId`，该轮所有事件都携带该字段。本系统需配合改造：1) server 首次收到某个 `turnId` 时建立 turnId↔topicId 映射，后续同一 turnId 的事件直接归入对应 topic；2) `messages.history` 返回时同一 turnId 的 message 归为一组；3) 前端按 turnId 将相邻 assistant message 合并渲染，纯 thinking + stopReason=tool_use 的过渡 message 不再单独渲染成空泡；4) `artifact.created` 在主聊天流中展示产物创建卡片 |
| 验收标准 | 1) 编程 agent 对话不再出现纯 thinking 空白气泡；2) 同一轮 assistant 工作被聚合成一个连续工作流；3) artifact.created 在主聊天流可见；4) 刷新历史后聚合结构不变 |
| 测试用例 | TBD |
| 影响模块 | packages/protocol (PIEvent 增 turnId 字段), packages/server (event-router → turnId 映射, message.handler → history 按 turn 聚合), packages/web (MessageList → turn 合并渲染, MessageBubble → 过渡消息过滤, ws-client → turnId 消费) |
| 外部依赖 | PI Adapter v1.2.0 C19 (`.omc/plans/pi-agent-requirements.md` §2 v1.2.0) |

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
- **状态**: 已完成
- **当前**: `message.delta` 发送 snapshot 式全量文本
- **要求**: 改为增量 delta（每次只发新增文本片段，前端累加拼接）

### E2: edit 工具调用 → file.diff 事件翻译
- **状态**: 已完成
- **背景**: 编程对话中，Claude Code 已有 `edit` 内建工具，PI adapter 需拦截该 tool call
- **要求**: 提取 `path`/`before`/`after`，翻译为 `{ kind: 'file.diff', path, before, after, messageId }` 事件推给 server

### E3: write 工具调用 → artifact.created 事件翻译
- **状态**: 已完成
- **背景**: 编程对话中，Claude Code 已有 `write` 内建工具，PI adapter 需拦截该 tool call
- **要求**: 翻译为 `{ kind: 'artifact.created', artifactId, name, mime, sizeBytes, metadata }` 事件推给 server；产物系统依赖此能力

### E4: usage.delta 事件上报
- **状态**: 待改
- **版本**: 待定版本
- **要求**: 每次 `message.end` 后发送 `{ kind: 'usage.delta', messageId, model, inputTokens, outputTokens, cacheReadTokens?, cacheCreateTokens? }`

### E5: 工作区根目录配置 (FEAT-010 外部依赖)
- **状态**: 已完成 (PI v1.1.0 C15)
- **版本**: 待定版本
- **要求**: 收到 `createSession` 时自动在 `{workspaceRoot}/{topicId}` 创建工作目录

### E6: Turn ID — 每轮 assistant 工作聚合标识
- **状态**: 待改 (PI v1.2.0 C19, 本系统 FEAT-028)
- **版本**: 待定版本
- **要求**: 详见 `.omc/plans/pi-agent-requirements.md` §2 v1.2.0 C19 + 本文件 FEAT-028

### 其他已有外部需求
- PI Adapter 接口 (WebSocket + JSON-RPC)
- Claude Code SDK event → PIEvent 映射
- 通用 Workflow Tools 注入 (workflow_set_plan / workflow_upsert_todos / workflow_report_step)
- [external] TODO: PI Agent / Adapter 在正文输出计划或待办时，同步产生结构化 `plan.update` / `todo.update` 事件；不能只显示主聊天文本而不更新右侧 Inspector 面板
- Cron 集成 (触发回到原 session)
- 健康检查 /healthz
