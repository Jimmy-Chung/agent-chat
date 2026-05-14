# agent-chat — 需求清单

| 项目 | 值 |
|---|---|
| 当前版本 | v1.3.0 |
| 状态 | v1.3.0 已发布 |
| 更新时间 | 2026-05-14 |

---

## v1.3.0 — 需求范围

| 类别 | 需求 | 状态 | 说明 |
|---|---|---|---|
| 云端产物 | FEAT-016 R2 云端产物上传下载 | 已发布 | 上传、下载、Agent 消费产物内容 |
| 历史一致性 | FEAT-029 会话历史一致性优化 | 已发布 | PI 原始会话 / 本地投影视图一致性、旧 Topic 恢复、自愈 retry/recreate 链路已完成 |
| 消息时间体验 | FEAT-021 日期分割线 + FEAT-030 hover 时间戳 | 已发布 | 同一批处理消息列表时间分组与气泡时间戳细节 |

> 范围说明：除以上条目外，其它未完成或待讨论需求暂不纳入 `v1.3.0`，统一放入待定版本。

---

## 清单维护规则

- 每次新增需求或变更需求状态时，必须同步更新 Linear issue，并维护下方 `FEAT ID -> Linear ID` 映射。
- 新增需求时先检查已有 `FEAT-*` 编号；如果目标 ID 已存在或发生冲突，自动使用下一个未占用的 `FEAT-*` ID。
- 需求状态机：`待讨论 -> 开发中 -> 测试中 -> 待发布 -> 已发布`。
- Linear issue 必须标记 `Feature`，并按本地状态同步对应的 `status: ...` 标签；涉及 PI Adapter、Cloudflare、GitHub Actions 等外部系统时，同时标记 `External dependency`。
- 待讨论阶段沉淀需求、验收标准和 TC 场景清单；开发阶段根据 TC 编写自动化测试与代码。
- 本清单可公开发布；不得写入真实 token、鉴权值、密钥或环境变量值。

---

## Linear 映射

| FEAT ID | Linear ID |
|---|---|
| FEAT-001 | AIT-11 |
| FEAT-002 | AIT-10 |
| FEAT-003 | AIT-13 |
| FEAT-004 | AIT-12 |
| FEAT-005 | AIT-14 |
| FEAT-006 | AIT-15 |
| FEAT-007 | AIT-16 |
| FEAT-008 | AIT-18 |
| FEAT-009 | AIT-19 |
| FEAT-010 | AIT-17 |
| FEAT-011 | AIT-7 |
| FEAT-012 | AIT-20 |
| FEAT-013 | AIT-21 |
| FEAT-014 | AIT-22 |
| FEAT-015 | AIT-23 |
| FEAT-016 | AIT-5 |
| FEAT-017 | AIT-24 |
| FEAT-018 | AIT-25 |
| FEAT-019 | AIT-26 |
| FEAT-020 | AIT-27 |
| FEAT-021 | AIT-8 |
| FEAT-022 | AIT-29 |
| FEAT-023 | AIT-28 |
| FEAT-024 | AIT-30 |
| FEAT-025 | AIT-31 |
| FEAT-026 | AIT-32 |
| FEAT-027 | AIT-33 |
| FEAT-028 | AIT-34 |
| FEAT-029 | AIT-6 |
| FEAT-030 | AIT-9 |
| FEAT-031 | AIT-35 |
| FEAT-032 | AIT-36 |
| FEAT-033 | AIT-37 |
| FEAT-034 | AIT-38 |

---

## v1.0.0 — Part 1: 核心功能 (当前版本)

> 基于 `.omc/plans/autopilot-execution-plan.md` Part 1 (步骤 1-7)，PI Agent 侧改动不计入本仓库。

### FEAT-001: pnpm monorepo 脚手架

| 字段 | 值 |
|---|---|
| ID | FEAT-001 |
| 标题 | pnpm monorepo 脚手架 |
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
| 版本 | v1.3.0 |
| 提出时间 | 2026-05-12 |
| 描述 | 优化 topic 历史记录与 Agent session 的一致性模型。页面展示历史以 agent-chat DB 为准，保留 thinking / tool / interaction / artifact 等过程信息；PI / Claude session 作为 Agent 上下文源。首次发送后等待 5 秒；5 秒内只要 Adapter 有任何信息回复（包括 syncing、ack、progress、assistant event），都视为链路有响应。若 5 秒内无响应或明确失败，系统自动尝试一次 retry session 流程。自动 retry 失败、超时或无响应时，在用户消息旁显示红点；用户点击红点后进入 loading 并执行手动 retry。自动 retry 不消耗用户的 2 次手动 retry 机会；第 2 次手动 retry 仍失败时，判定为永久失败，revert 并丢弃该 pending 用户消息。最终 revert 后的极小概率迟到事件不做专门保障，按黑天鹅异常处理。 |
| 验收标准 | 1) UI 历史从 agent-chat DB 恢复，刷新后 thinking/tool/artifact 等过程信息不丢；2) 首次发送 5 秒内无响应时自动进入 retry session 流程；3) 任意 Adapter 回复（包括 syncing）都会阻止红点进入；4) 首次 retry 失败或无响应时，用户消息旁显示红点；5) 点击红点后显示 loading 并重试；6) 手动 retry 失败后恢复红点；7) 自动 retry 不消耗用户手动 retry 次数；8) 刷新后保留红点和剩余手动 retry 次数；9) 手动 retry 2 次仍失败时，消息被 revert 并从正常聊天历史中丢弃；10) Adapter 已接收或 replay 成功后，消息保持为 delivered，不再显示异常状态。 |
| 测试用例 | HC-001~HC-010（会话历史一致性与 retry 交互，待开发阶段转为自动化测试） |
| 影响模块 | packages/server, packages/protocol, packages/web, [external] PI Adapter |
| 备注 | 纳入 v1.3.0。Adapter 外部依赖见 Linear AIT-59：recreateSession、sendUserMessage.clientMessageId 幂等投递，以及 Adapter 的任意明确回复可作为链路恢复信号。 |

#### FEAT-029 测试用例

| 用例 ID | 测试内容 | 通过标准 |
|---|---|---|
| HC-001 | 刷新页面后从 agent-chat DB 恢复历史 | thinking、tool、interaction、artifact 等过程信息仍可展示，不依赖 PI/Claude 原始会话重放 |
| HC-002 | 首次发送 5 秒内收到普通 ack / assistant event | 消息进入 delivered 或继续正常流式状态，不显示红点 |
| HC-003 | 首次发送 5 秒内收到 syncing / progress | 视为链路有响应，不触发红点和自动 retry |
| HC-004 | 首次发送 5 秒无响应后自动 retry 成功 | 自动 retry session 流程执行后消息进入 delivered，用户无感知异常 |
| HC-005 | 自动 retry 失败或无响应 | 用户消息旁显示红点，消息保持 pending/retryable 状态 |
| HC-006 | 用户点击红点触发手动 retry | 红点变为 loading，执行 retry session 流程 |
| HC-007 | 第一次手动 retry 失败 | loading 结束后恢复红点，剩余手动 retry 次数为 1 |
| HC-008 | 手动 retry 成功 | 消息进入 delivered，红点消失，后续 assistant 事件正常归入该轮 |
| HC-009 | 刷新页面恢复 retry 状态 | 红点状态和剩余手动 retry 次数保留；自动 retry 不消耗 2 次手动机会 |
| HC-010 | 第二次手动 retry 仍失败 | 消息被 revert 并从正常聊天历史中丢弃，流程结束 |

### FEAT-030: 消息 hover 时间戳布局微调

| 字段 | 值 |
|---|---|
| ID | FEAT-030 |
| 标题 | 消息 hover 时间戳布局微调 |
| 状态 | 已发布 |
| 版本 | v1.3.0 |
| 提出时间 | 2026-05-12 |
| 描述 | 优化消息时间戳展示。桌面端 hover 时显示时间戳，时间戳放在气泡外侧靠近边缘；移动端无 hover，改为长按消息显示时间戳。UsageBadge 共存策略本版本先不处理。 |
| 验收标准 | 1) 桌面端 hover 消息时，在气泡外侧靠近边缘显示时间戳；2) 不 hover 时不显示时间戳，不干扰阅读；3) 移动端长按消息显示时间戳；4) 时间戳不撑高消息气泡、不遮挡正文；5) 多行消息、流式消息、ToolCard、DiffCard 场景布局稳定；6) 本版本不处理 UsageBadge 共存。 |
| 测试用例 | MT-001~MT-006（消息时间戳展示，待开发阶段转为自动化测试） |
| 影响模块 | packages/web |
| 备注 | 纳入 v1.3.0，与 FEAT-021 消息列表日期分割线一并处理 |

#### FEAT-030 测试用例

| 用例 ID | 测试内容 | 通过标准 |
|---|---|---|
| MT-001 | 桌面端 hover 用户消息 | 时间戳显示在用户气泡外侧靠近边缘，不遮挡正文 |
| MT-002 | 桌面端 hover assistant 消息 | 时间戳显示在 assistant 气泡外侧靠近边缘，不撑高消息气泡 |
| MT-003 | 桌面端非 hover 状态 | 时间戳不显示，不影响消息阅读和布局 |
| MT-004 | 移动端长按消息 | 长按后显示时间戳；无 hover 环境下仍可查看时间 |
| MT-005 | 多行消息、流式消息、ToolCard、DiffCard | 时间戳显示不造成布局跳动、遮挡或内容错位 |
| MT-006 | UsageBadge 存在的消息 | 本版本不处理共存策略，但不得因时间戳改动导致 UsageBadge 原有展示回归 |

### FEAT-016: R2 云端产物上传下载

| 字段 | 值 |
|---|---|
| ID | FEAT-016 |
| 标题 | R2 云端产物上传下载 |
| 状态 | 已发布 |
| 版本 | v1.3.0 |
| 提出时间 | 2026-05-10 |
| 描述 | agent-chat 只做产物控制面，不做文件数据面中转。文件上传/下载只发生在 IM 或 Agent 与 Cloudflare R2 之间；Adapter 与 agent-chat 之间不传输文件正文。用户可在聊天输入框通过附件上传；Agent 在话题中产生中间产物时也会触发产物上传。用户上传和 Agent 中间产物都进入 X-Buffer 产物体系，并按 topic 分类展示。默认产物属于当前 topic；删除 topic 时，用户可选择将产物迁移到全局产物池，或跟随 topic 删除。 |
| 验收标准 | 1) 用户附件可上传到 R2 并生成当前 topic artifact；2) Agent 中间产物可上传到 R2 并生成当前 topic artifact；3) X-Buffer 按 topic 展示话题产物，全局产物池展示已迁移产物；4) 删除 topic 时可选择迁移产物到全局或跟随删除；5) @产物 后 Adapter 收到 metadata + signed download URL，而不是文件正文；6) 话题产物和全局产物都可打开预览；7) 文件上传/下载数据面不经过 agent-chat 与 Adapter 之间的链路。 |
| 测试用例 | R2-001~R2-018（R2 产物上传下载、Adapter 反向 RPC 与预览，开发阶段转为自动化测试） |
| 影响模块 | packages/server, packages/web, [external] Agent Adapter, Cloudflare R2 |
| 备注 | 纳入 v1.3.0；从 FEAT-008 拆出，FEAT-008 为本地产物系统（已发布），本需求为 R2 云端部分。Adapter 外部依赖见 Linear AIT-60：中间产物直传 R2、仅回报 metadata、消费 @产物 时自行通过 signed download URL 拉取内容。 |

#### FEAT-016 测试用例

| 用例 ID | 测试内容 | 通过标准 |
|---|---|---|
| R2-001 | 用户附件请求 presigned upload URL | server 返回限定 object、方法、content-type、content-length 的短期上传 URL |
| R2-002 | 用户附件直传 R2 | IM 直接上传到 R2，agent-chat 不接收文件正文 |
| R2-003 | upload complete 创建 topic artifact | 上传完成后 DB 写入 artifact metadata / object key / name / mime / size / topicId，并广播到当前 topic |
| R2-004 | 单条消息附件限制 | 单文件超过 20MB、单条超过 5 个附件、并发超过 5 个时被拒绝或排队处理 |
| R2-005 | Agent 中间产物请求或接收 presigned upload URL | Agent/Adapter 可使用该 URL 直接上传到 R2，不通过 agent-chat 传正文 |
| R2-006 | Agent 中间产物 upload complete | 上传完成后仅回报 metadata/object key，agent-chat 生成当前 topic artifact |
| R2-007 | @产物消费 | server 传给 Adapter artifact metadata + signed download URL，不传文件正文 |
| R2-008 | signed download URL 授权 | IM 和 Adapter 使用同一套短期 signed URL 授权；第一版有效期 10 分钟 |
| R2-009 | 话题产物预览 | topic artifact 可打开预览；图片/PDF/文本类按定义展示，文本类最多读取前 256KB |
| R2-010 | 全局产物预览 | 全局产物池 artifact 可打开同一套预览组件 |
| R2-011 | 删除 topic 时迁移产物 | 用户选择保留时，topic artifact 迁移到全局产物池，R2 object 保留 |
| R2-012 | 删除 topic 时跟随删除产物 | 用户选择删除时，topic artifact 记录删除，并清理对应 R2 object 或进入可追踪清理流程 |
| R2-013 | Adapter 通过 WS 反向 RPC 申请中间产物 upload URL | agent-chat 返回 artifactId/uploadId/uploadUrl/method/expiresAt/maxBytes/headers，且不传输文件正文 |
| R2-014 | Adapter 中间产物 upload complete | agent-chat 根据 uploadId 创建/更新 topic artifact，状态为 uploaded，并广播 artifact.added |
| R2-015 | Adapter 中间产物 upload failed | agent-chat 创建/更新 upload_failed artifact，记录失败 code/message，并广播给 UI 展示 |
| R2-016 | failed artifact 展示与使用限制 | Inspector/X-Buffer 显示失败文件名和原因；预览、下载、@ 引用均不可用 |
| R2-017 | Adapter signed download URL refresh | Adapter 通过反向 RPC 获取新的 download URL；权限不匹配或 artifact 不存在时返回 rpc.error |
| R2-018 | Adapter artifact RPC 权限校验 | sessionId 必须能映射到 topic；topicId 不匹配、uploadId 过期、artifact 无权访问时拒绝 |

### FEAT-009: 定时任务管理

| 字段 | 值 |
|---|---|
| ID | FEAT-009 |
| 标题 | 定时任务管理 (Cron) |
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
| 版本 | v1.2.0（部署）/ 待定版本（PWA 本体） |
| 提出时间 | 2026-05-09 |
| 描述 | manifest + SW, Cloudflare 部署（前端 Pages + 后端 Workers），Lighthouse PWA/Performance ≥90, iPhone 实测 |
| 验收标准 | Lighthouse PWA ≥90, iPhone 添加到主屏幕可启动 |
| 测试用例 | 详细测试用例见 `.omc/plans/cloudflare-migration-plan.md`（HR-001~008, DO-001~013, P-001~005）；下方为概要 |
| 影响模块 | web, 部署配置 |
| 对应步骤 | 设计文档 Phase 6 |
| 备注 | Cloudflare 部署部分已完成：Workers、Pages、CI/CD 已成功部署。PWA 本体不纳入 v1.3.0，先放入待定版本。 |

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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
| 版本 | v1.1.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 设计稿 S3 显示创建话题为 glass-3 毛玻璃模态弹窗（带半透明遮罩层），当前实现为 Sidebar 内嵌表单。需将创建话题从内联表单改为独立 Modal，包含：1) glass-3 背景 + backdrop blur 遮罩；2) 居中弹出动画；3) 点击遮罩或 ESC 关闭 |
| 验收标准 | 点击「新建话题」按钮弹出 glass modal，填写后创建成功，ESC/遮罩关闭 |
| 测试用例 | TBD |
| 影响模块 | packages/web (Sidebar + 新 Modal 组件) |
| 设计稿 | S3 创建话题 |
| 备注 | 从设计稿审查发现。FEAT-010 已发布 inline form，本需求升级为 modal 形态 |

### FEAT-018: 创建话题高级选项交互

| 字段 | 值 |
|---|---|
| ID | FEAT-018 |
| 标题 | 创建话题高级选项 — Segmented Control / YOLO 开关 / Permission Mode |
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 开发中 |
| 版本 | 待定版本 |
| 提出时间 | 2026-05-10 |
| 描述 | 设计稿 S7 显示定时任务管理有丰富的卡片交互，当前实现简陋。需补充：1) 筛选 chips (全部 / Active / Paused / Error)；2) Cron 卡片增强：来源话题 chip + 上次/下次执行时间 + 状态 badge；3) Error banner：显示错误详情 + 红色背景；4) 操作按钮增加 Resume / Retry（不仅仅是 Pause/Delete）；5) Hover 状态：蓝色边框 glow |
| 验收标准 | 筛选可切换、Error cron 显示错误详情、Pause 的 cron 可 Resume |
| 测试用例 | TBD |
| 影响模块 | packages/web (CronAdminView + cron-store) |
| 设计稿 | S7 定时任务管理 |
| 备注 | 从设计稿审查发现。FEAT-009 基础已发布，本需求为 UI 增强；不纳入 v1.3.0，先放入待定版本 |

### FEAT-021: 消息列表日期分割线

| 字段 | 值 |
|---|---|
| ID | FEAT-021 |
| 标题 | 消息列表日期分割线 |
| 状态 | 已发布 |
| 版本 | v1.3.0 |
| 提出时间 | 2026-05-10 |
| 描述 | 消息列表按浏览器本地时间对 `started_at` 做自然日分组，在日期边界渲染居中的日期分割线。当前消息列表无日期分割，连续消息无法区分日期边界。 |
| 验收标准 | 1) 使用用户浏览器本地时区计算消息日期；2) 不同日期的消息之间显示日期标签；3) 同一天内不重复显示日期分割线；4) 刷新历史后日期分组稳定；5) 流式消息追加时不导致已有分割线抖动。 |
| 测试用例 | ML-001~ML-005（消息日期分割线，待开发阶段转为自动化测试） |
| 影响模块 | packages/web (MessageList 组件) |
| 设计稿 | S13 iPhone |
| 备注 | 纳入 v1.3.0，与 FEAT-030 消息 hover 时间戳微调一并处理 |

#### FEAT-021 测试用例

| 用例 ID | 测试内容 | 通过标准 |
|---|---|---|
| ML-001 | 同一天消息列表 | 不显示重复日期分割线；同一天内消息连续展示 |
| ML-002 | 跨自然日消息列表 | 浏览器本地时间日期发生变化处显示居中日期分割线 |
| ML-003 | 今天 / 昨天 / 更早日期格式 | 日期标签按本地时间稳定格式化，用户可理解日期边界 |
| ML-004 | 空消息列表和单条消息 | 空列表不报错；单条消息最多显示一个对应日期分割线 |
| ML-005 | 历史加载与流式追加 | 刷新历史或追加流式消息时，已有日期分割线不抖动、不重复 |

### FEAT-022: Plan Tab 进度追踪

| 字段 | 值 |
|---|---|
| ID | FEAT-022 |
| 标题 | Inspector Plan Tab 进度追踪 |
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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
| 状态 | 已发布 |
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

### E7: recreateSession — 覆盖式重建丢失的 Agent Session
- **状态**: 待改 (PI v1.3.0 C23, 本系统 FEAT-029)
- **版本**: v1.3.0
- **要求**: Adapter 新增 `recreateSession({ sessionId, kind, ...spec })` RPC。仅当原 session 明确不存在或损坏时,允许用同一个 `sessionId` 重建执行上下文;如果只是临时不可用、仍可 attach 或正在 streaming,必须返回明确错误,不能覆盖。详见 `.omc/plans/pi-agent-requirements.md` C23。

### E8: sendUserMessage.clientMessageId — 用户消息 retry 幂等投递
- **状态**: 待改 (PI v1.3.0 C24, 本系统 FEAT-029)
- **版本**: v1.3.0
- **要求**: Adapter 的 `sendUserMessage` 支持 `clientMessageId`。同一 `sessionId + clientMessageId` 的 retry 必须幂等: 已接收/处理中/已完成时返回同一结果,不能重复创建 assistant turn;请求体不一致时返回 `idempotency_conflict`。agent-chat retry 明确失败后会撤销 pending 用户消息。详见 `.omc/plans/pi-agent-requirements.md` C24。

### 其他已有外部需求
- PI Adapter 接口 (WebSocket + JSON-RPC)
- Claude Code SDK event → PIEvent 映射
- 通用 Workflow Tools 注入 (workflow_set_plan / workflow_upsert_todos / workflow_report_step)
- [external] TODO: PI Agent / Adapter 在正文输出计划或待办时，同步产生结构化 `plan.update` / `todo.update` 事件；不能只显示主聊天文本而不更新右侧 Inspector 面板
- Cron 集成 (触发回到原 session)
- 健康检查 /healthz
