# agent-chat — 需求清单

| 项目 | 值 |
|---|---|
| 当前版本 | v1.0.0 |
| 状态 | 开发中 (Part 1) |
| 更新时间 | 2026-05-09 |

---

## v1.0.0 — Part 1: 核心功能 (当前版本)

> 基于 `.omc/plans/autopilot-execution-plan.md` Part 1 (步骤 1-7)，PI Agent 侧改动不计入本仓库。

### FEAT-001: pnpm monorepo 脚手架

| 字段 | 值 |
|---|---|
| ID | FEAT-001 |
| 标题 | pnpm monorepo 脚手架 |
| 状态 | 待讨论 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 初始化 pnpm monorepo: packages/protocol, server, web, mock-pi。含 tsconfig.base.json, biome.json, .gitignore, .npmrc, CI (GitHub Actions), README |
| 验收标准 | `pnpm install && pnpm -r typecheck && pnpm -F web build && pnpm format --check` 全绿 |
| 测试用例 | TC-001: monorepo 脚手架验收 |
| 影响模块 | 根目录配置 |
| 对应步骤 | Step 1 |

### FEAT-002: 协议层类型定义

| 字段 | 值 |
|---|---|
| ID | FEAT-002 |
| 标题 | 协议层类型定义 (packages/protocol) |
| 状态 | 待讨论 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 定义所有跨进程消息的 TypeScript 类型 + zod schema: PIEvent (message/tool/file/todo/plan/interaction/cron/usage), PI RPC 方法签名, 前后端 WS 事件, 领域类型, WS 帧编解码 |
| 验收标准 | `pnpm -F protocol typecheck && pnpm -F protocol test` 全绿, zod schema 测试覆盖 ≥90% |
| 测试用例 | TC-002: zod schema 正反例解析 |
| 影响模块 | packages/protocol |
| 对应步骤 | Step 2 |
| 备注 | 协议层冻结后改动须在 commit message 标注 `protocol: BREAKING` |

### FEAT-003: Mock PI Server

| 字段 | 值 |
|---|---|
| ID | FEAT-003 |
| 标题 | Mock PI Server (packages/mock-pi) |
| 状态 | 待讨论 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 本地 WebSocket 服务模拟 PI Adapter 全部 RPC + 事件流。含 fixture 事件流 (simple-text / tool-use / file-edit / approval / cron-trigger), scenario runner 按 content 关键词匹配 fixture 并按真实节奏推流, Bearer 鉴权 |
| 验收标准 | mock-pi dev 启动后 healthz 200, ws client 连接 + createSession + sendUserMessage("hi") → 收到 start/delta/end 三条事件 |
| 测试用例 | TC-003: 每个 fixture 跑通 |
| 影响模块 | packages/mock-pi |
| 对应步骤 | Step 3 |

### FEAT-004: 后端核心服务

| 字段 | 值 |
|---|---|
| ID | FEAT-004 |
| 标题 | 后端核心服务 (packages/server) |
| 状态 | 待讨论 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | Fastify + SQLite (drizzle) + WebSocket Hub + PI Adapter 客户端 + R2 presigned URL + Token 鉴权 + 系统话题 seed。包含: DB schema (users/topics/messages/message_parts/FTS5/artifacts/cron_jobs/cron_runs/interactions/usage_records/audit_log), WS handler (topic/message/interaction/cron/artifact/search), PI client 自动重连 + seq 续传, 流式 delta 100ms/32KB/end batch flush |
| 验收标准 | 三窗口跑 mock-pi + server, `curl localhost:8080/healthz` 200, 单测 + 集成测试覆盖 ≥70% |
| 测试用例 | TC-004: 后端单测 + 集成测试 |
| 影响模块 | packages/server |
| 对应步骤 | Step 4 |

### FEAT-005: 前端骨架 + 状态管理

| 字段 | 值 |
|---|---|
| ID | FEAT-005 |
| 标题 | 前端骨架 + 状态管理 (packages/web) |
| 状态 | 待讨论 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | App Router + 主布局三栏 (TopicSidebar / 对话主区 / RightPanel) + Zustand stores (topics/messages/agent-status/todos/plan/artifacts/interactions/usage) + WS client 自动重连 + seq 续传 + Token 鉴权页。视觉粗糙,不打磨细节,所有值用 CSS 变量占位 |
| 验收标准 | 三窗口跑 mock-pi + server + web, 浏览器输入 token → sidebar 显示系统话题 → 点击进入 → 看到空 message list |
| 测试用例 | TC-005: stores + WS router 测试 |
| 影响模块 | packages/web |
| 对应步骤 | Step 5 |

### FEAT-006: 核心消息组件

| 字段 | 值 |
|---|---|
| ID | FEAT-006 |
| 标题 | 核心消息组件 (MessageBubble / ToolCard / DiffCard / ApprovalCard / ThinkingBlock / AgentStatusBar / TodoPanel / PlanPanel) |
| 状态 | 待讨论 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 所有 message_part 类型的渲染组件骨架。MessageBubble 根据 role 切样式 (user 右蓝 / assistant 左玻璃 / system 居中紫 / cron 顶部金条), 内部按 part.kind 渲染 MarkdownContent / ThinkingBlock / ToolCard / DiffCard。ApprovalCard 三状态 (pending/approved/rejected) |
| 验收标准 | 触发 fixture tool-use 跑通看到 ToolCard, file-edit 看到 DiffCard, approval 看到 ApprovalCard pending → 点同意 → approved |
| 测试用例 | TC-006: 组件渲染测试 |
| 影响模块 | packages/web |
| 对应步骤 | Step 6 |

### FEAT-007: 流式逻辑 + stream-safe Markdown

| 字段 | 值 |
|---|---|
| ID | FEAT-007 |
| 标题 | 流式逻辑 + stream-safe Markdown |
| 状态 | 待讨论 |
| 版本 | v1.0.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 流式 delta 合并到同一气泡不刷屏不闪烁。message-aggregator 累加 delta, stream-safe-markdown 状态机检测未闭合代码块/列表/表格并虚拟补全。ESC + StopButton abort。性能: 1k delta 期间 FPS ≥50 |
| 验收标准 | fixture simple-text 1000 delta FPS ≥50 无 flash, 代码块未闭合不崩, ESC abort 生效 |
| 测试用例 | TC-007: stream-safe corner cases (未闭合 ``` / ** / [] / 表格 / 列表 / HTML 实体 / 中文切边界) |
| 影响模块 | packages/web |
| 对应步骤 | Step 7 |
| 备注 | 本期最大技术点 |

---

## 需求池 (待讨论)

> 以下需求来自设计文档 `agent-chat-design.md §1 范围内`,归入 Part 2 或后续版本。

### FEAT-008: 产物系统

| 字段 | 值 |
|---|---|
| ID | FEAT-008 |
| 标题 | 产物系统 (Artifacts) |
| 状态 | 待讨论 |
| 版本 | v1.0.0 (Part 1 基础) / v1.1.0 (完善) |
| 提出时间 | 2026-05-09 |
| 描述 | 话题级产物 + 产物池 (跨话题共享, R2), @产物引用语法, 删话题弹窗 (转产物池/一并删除) |
| 验收标准 | TBD |
| 测试用例 | TBD |
| 影响模块 | server, web |
| 对应步骤 | 设计文档 Phase 5 |

### FEAT-009: 定时任务管理

| 字段 | 值 |
|---|---|
| ID | FEAT-009 |
| 标题 | 定时任务管理 (Cron) |
| 状态 | 待讨论 |
| 版本 | v1.0.0 (Part 1 基础) / v1.1.0 (完善) |
| 提出时间 | 2026-05-09 |
| 描述 | 话题内自然语言创建 cron, 触发结果回到原话题, 系统话题"定时任务管理"列表/暂停/编辑/删除 |
| 验收标准 | TBD |
| 测试用例 | TBD |
| 影响模块 | server, web |
| 对应步骤 | 设计文档 Phase 5 |

### FEAT-010: 创建话题向导 + SOP 模板

| 字段 | 值 |
|---|---|
| ID | FEAT-010 |
| 标题 | 创建话题向导 + SOP 模板系统 |
| 状态 | 待讨论 |
| 版本 | v1.1.0 |
| 提出时间 | 2026-05-09 |
| 描述 | 创建话题向导 (programming/general 分支表单), SOP 模板库 (内置 + 用户自建), 模板预填 plan/todos |
| 验收标准 | TBD |
| 测试用例 | TBD |
| 影响模块 | server, web |
| 对应步骤 | 设计文档 Phase 4 |

### FEAT-011: PWA + 部署

| 字段 | 值 |
|---|---|
| ID | FEAT-011 |
| 标题 | PWA + 部署 + 优化 |
| 状态 | 待讨论 |
| 版本 | v1.1.0 |
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

## 不在本仓库范围的需求

> 以下需求归 PI Agent 仓库实现,详见 `.omc/plans/pi-agent-requirements.md`

- PI Adapter 接口 (WebSocket + JSON-RPC)
- Claude Code SDK event → PIEvent 映射
- 通用 Workflow Tools 注入 (workflow_set_plan / workflow_upsert_todos / workflow_report_step)
- Cron 集成 (触发回到原 session)
- 用量上报 (每条 message 后 usage.delta)
- 健康检查 /healthz
