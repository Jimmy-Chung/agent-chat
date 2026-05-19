# agent-chat — Bug 清单

| 项目 | 值 |
|---|---|
| 当前版本 | v1.5.2 |
| 更新时间 | 2026-05-19 |

> 版本说明：顶部版本表示当前大版本线。`v1.2.x` 的补丁修复记录保留在“v1.2.x 修复过程记录”中；`v1.3.0` 发布相关 bug 直接记录在本清单中。

---

## 清单维护规则

- 每次新增 bug 或变更 bug 状态时，必须同步更新 Linear issue，并维护下方 `BUG ID -> Linear ID` 映射。
- 新增 bug 时先检查已有 `BUG-*` 编号；如果目标 ID 已存在或发生冲突，自动使用下一个未占用的 `BUG-*` ID。
- Bug 状态机：`新建 -> 处理中 -> 已修复 -> 重新打开`；建单后确认不是 bug 或无需修复时，状态改为 `已关闭`。
- Linear issue 必须标记 `Bug`，并按本地状态同步对应的 `status: ...` 标签；涉及 PI Adapter、Cloudflare、GitHub Actions 等外部系统时，同时标记 `External dependency`。
- 本清单可公开发布；不得写入真实 token、鉴权值、密钥或环境变量值。

---

## Linear 映射

| BUG ID | Linear ID |
|---|---|
| BUG-001 | AIT-39 |
| BUG-002 | AIT-40 |
| BUG-003 | AIT-41 |
| BUG-015 | AIT-42 |
| BUG-016 | AIT-43 |
| BUG-017 | AIT-44 |
| BUG-018 | AIT-45 |
| BUG-019 | AIT-46 |
| BUG-020 | AIT-47 |
| BUG-021 | AIT-48 |
| BUG-022 | AIT-49 |
| BUG-023 | AIT-50 |
| BUG-024 | AIT-51 |
| BUG-025 | AIT-52 |
| BUG-026 | AIT-53 |
| BUG-027 | AIT-54 |
| BUG-028 | AIT-55 |
| BUG-029 | AIT-56 |
| BUG-030 | AIT-57 |
| BUG-031 | AIT-58 |
| BUG-032 | AIT-105 |
| BUG-033 | AIT-107 |
| BUG-034 | AIT-109 |
| BUG-035 | AIT-110 |
| BUG-036 | AIT-112 |
| BUG-037 | AIT-114 |
| BUG-038 | AIT-124 |

---

## 未完成

### BUG-037: PI Adapter 未发送 message.end 导致消息永远卡在 streaming

| 字段 | 值 |
|---|---|
| ID | BUG-037 |
| 标题 | PI Adapter 未发送 message.end 导致消息永远卡在 streaming |
| 状态 | 已修复 |
| 发现时间 | 2026-05-16 |
| 修复时间 | 2026-05-16 |
| 影响模块 | packages/server/src/pi/event-router.ts, packages/server/src/db/repos/message.repo.ts |
| 描述 | assistant 消息永远卡在 `streaming` 状态，前端显示"正在回复…"但无内容。PI adapter 在 abort/error/断连时不发送 `message.end`，导致数据库中消息无 `finished_at`。 |
| 根因 | 消息从 `streaming` → `done` 的唯一路径是 PI adapter 发送 `message.end` 事件。adapter 在中断、错误、断连场景漏发。server 端无防护机制。 |
| 修复方案 | 1) Server 安全网：`session.health { disconnected }` 时 finalize 所有 streaming 消息为 done + error；2) PI adapter 侧补发 `message.end`（adapter 团队已确认修复）。 |

### BUG-038: keepalive_ack 双向心跳 + health probe 60s + RPC 重试机制

| 字段 | 值 |
|---|---|
| ID | BUG-038 |
| 标题 | keepalive_ack 双向心跳 + health probe 60s + RPC 重试机制 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-19 |
| 修复时间 | 2026-05-19 |
| 修复版本 | v1.5.2 |
| 影响模块 | packages/server/src/pi/client.ts, packages/protocol/src/pi-rpc.ts |
| 描述 | PI WebSocket 连接在长时间无活动后断开，且 PI RPC 调用无重试机制，遇到瞬时故障直接失败。 |
| 根因 | 缺少双向 keepalive_ack 心跳和 health probe 机制，RPC 调用无重试保护。 |
| 修复方案 | 新增双向 keepalive_ack 心跳帧、60s 间隔 health probe、PI RPC 调用重试机制。 |

### BUG-036: Thinking 阶段 Stop 按钮失效 + 计时器无法停止

| 字段 | 值 |
|---|---|
| ID | BUG-036 |
| 标题 | Thinking 阶段 Stop 按钮失效 + 计时器无法停止 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-15 |
| 修复时间 | 2026-05-15 |
| 影响模块 | packages/web/src/components/chat/MessageInput.tsx, packages/web/src/lib/ws-client.ts |
| 描述 | PI 在 thinking 阶段回复一条消息后长时间无新事件：1) 计时器持续跑，因为 `agent.status: idle` 未到达；2) `message.end` 未到达时 `isStreaming` 永远 true，用户点 Stop 后虽然 server 广播了 `agent.status: idle`，但 `streamingTopicId` 未清除，Stop 按钮仍在且再点无视觉反馈。另外，`message.end` 已到达（`isStreaming = false`）但 `agent.status` 仍为 thinking 时，Stop 按钮消失，用户完全无法中断。 |
| 根因 | Stop 可见条件只绑定 `isStreaming`，未考虑 agent 处于活跃非 streaming 状态；`agent.status: idle` 事件处理时未同步清理残留 streaming 状态。 |
| 修复方案 | 1) `MessageInput` 新增 `isAgentActive` 计算，`showStopButton = isStreaming \|\| isAgentActive`；2) `ws-client` 在 `agent.status: idle` 处理中，若 `streamingTopicId` 匹配则强制 `endStreaming` 并将消息标为 `aborted`。 |

### BUG-033: 手机宽度下 @ 产物选择弹窗横向溢出

| 字段 | 值 |
|---|---|
| ID | BUG-033 |
| 标题 | 手机宽度下 @ 产物选择弹窗横向溢出 |
| 状态 | 处理中 |
| 发现时间 | 2026-05-14 |
| 修复版本 | v1.4.0（已在 v1.4.0 stash 中修复，待合并） |
| 影响模块 | packages/web（MessageInput / @ 产物选择弹窗） |
| 描述 | 在手机宽度下，聊天输入框的 @ 产物选择弹窗仍按桌面宽度渲染，出现横向溢出，影响当前话题/产物池筛选与键盘提示区域显示。 |
| 根因 | 弹窗宽度硬编码为 640px，窄屏下溢出 viewport。 |
| 修复方案 | 宽度改为 min(640px, calc(100vw - 32px))；filter pills 加 overflow-x: auto；底部快捷键提示窄屏隐藏。 |

当前其余本仓库内处于 `新建`、`处理中` 或 `重新打开` 的阻断 bug 暂无。

---

## v1.3.1 修复过程记录

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.3.1 | 2026-05-15 | 修复 BUG-034 发消息立即重试问题；修复 BUG-035 产物预览失效 |

---

## v1.3.0 修复过程记录

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.3.0 | 2026-05-14 | 发布 FEAT-016 / FEAT-029 / FEAT-021 / FEAT-030；修复 BUG-032 旧 Topic 恢复后 Adapter session attach / recreate 链路异常 |

---

## v1.2.x 修复过程记录

| 小版本 | 日期 | 内容 |
|---|---|---|
| v1.2.21 | 2026-05-12 | 修复 BUG-030 Workers ULID 运行时报错；修复 BUG-031 Workers 访问控制与 WebSocket 心跳断线 |
| v1.2.22 | 2026-05-12 | 修复 D1 FTS5 porter tokenizer 导致 Worker 初始化 500 |
| v1.2.23 | 2026-05-12 | 修复 Workers PI Adapter 访问凭证传递异常；恢复 Durable Object `user.message` 的 v1.1.0 发送语义 |
| v1.2.24 | 2026-05-13 | 修复 Inspector Cron 跨话题泄漏；修复 artifact metadata.path 透传；恢复新版 @ 产物选择器 UI |
| v1.2.25 | 2026-05-13 | 修复 Inspector Cron selector 返回新数组导致 React 最大更新深度错误 |
| v1.2.26 | 2026-05-13 | 升级 GitHub Actions 到 Node 24 runtime，消除 Node 20 action 弃用风险 |
| v1.2.27 | 2026-05-13 | 清理公开文档中的访问凭证、访问控制与环境配置细节 |

---

## 已修复

### BUG-034: 发消息后立即触发重试，未等待 5 秒响应窗口

| 字段 | 值 |
|---|---|
| ID | BUG-034 |
| 标题 | 发消息后立即触发重试，未等待 5 秒响应窗口 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-15 |
| 修复时间 | 2026-05-15 |
| 修复版本 | v1.3.1 |
| 影响模块 | packages/server（message-delivery.ts、pi/client.ts） |
| 描述 | 用户发送消息后，系统未等待 FEAT-029 定义的 5 秒响应窗口，直接进入自动重试流程，消息瞬间出现红点。 |
| 根因 | `ensureDeliverableSession` 在 PI 连接失败时立即返回 null，绕过了 5 秒 timer。自动重试循环无延迟，飞速执行后将消息置为 needs_retry。 |
| 修复方案 | 在 `deliverUserMessage` 非手动路径中，首次 `attemptDelivery` 失败后补足距发送时刻的剩余时间（最小 AUTO_RETRY_DELAY_MS），保证与 FEAT-029 规格对齐。 |

### BUG-035: 产物预览失效（popup 被拦截 + 生成产物无 r2_key）

| 字段 | 值 |
|---|---|
| ID | BUG-035 |
| 标题 | 产物预览失效（popup 被拦截 + 生成产物无 r2_key） |
| 状态 | 已修复 |
| 发现时间 | 2026-05-15 |
| 修复时间 | 2026-05-15 |
| 修复版本 | v1.3.1 |
| 影响模块 | packages/web（InspectorPanel）、packages/server（artifact-control.ts） |
| 描述 | 点击"预览"按钮无效，窗口不打开，没有任何提示。 |
| 根因 | 1) `window.open()` 在 WS 回调异步上下文中调用，被浏览器弹窗拦截器静默阻止；2) PI 生成产物 `r2_key` 为空，`initArtifactDownload` 抛出异常，前端未处理 error 事件。 |
| 修复方案 | 同步点击时先 `window.open('about:blank')` 获取 window 引用，URL 到达后设置 `location.href`；同步监听 `agent-chat:error` 捕获 `ARTIFACT_DOWNLOAD_UNAVAILABLE` 后关闭空窗并提示。 |

### BUG-032: 旧 Topic 恢复后 Adapter session attach / recreate 链路异常

| 字段 | 值 |
|---|---|
| ID | BUG-032 |
| 标题 | 旧 Topic 恢复后 Adapter session attach / recreate 链路异常 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-14 |
| 修复时间 | 2026-05-14 |
| 修复版本 | v1.3.0 |
| 影响模块 | packages/server/src/pi/client.ts, packages/server/src/pi/event-router.ts, packages/server/src/ws/message-delivery.ts |
| 描述 | 旧 Topic 刷新或重新进入后，已绑定的 Adapter session 在 attach 失败、recreate 后 seq 重置、或连接失败回收等路径上会导致消息无回复、进入 needs_retry，无法继续正常会话。 |
| 根因 | 1) `recreateSession()` 成功后未继续 `attachSession()`；2) server 仅按 `sessionId` 记录 `lastSeq`，误杀 recreate 后从小值重新开始的新事件流；3) 旧 Topic attach 失败后没有自愈到 recreate，且临时 PI 连接失败路径未及时回收。 |
| 修复方案 | 在 `PiClient` 中补齐 `recreateSession -> attachSession`，为 recreate 成功后清理 `lastSeqBySession` 增加内部 lifecycle 事件，并让 `enterTopicSession()` 在 attach 失败时自动 fallback 到 recreate；同时补充回归测试与 E2E 适配。 |

### BUG-031: Workers 访问控制失效 + WebSocket 心跳超时断线

| 字段 | 值 |
|---|---|
| ID | BUG-031 |
| 标题 | Workers 访问控制失效 + WebSocket 心跳超时断线 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 修复版本 | v1.2.21 |
| 影响模块 | packages/server/src/worker.ts, packages/server/src/ws/topic-do.ts, packages/web/src/lib/ws-client.ts |
| 描述 | 配置访问凭证后，前端仍提示连接断开。 |
| 根因 | Workers 迁移后连接初始化顺序与访问控制配置同步不完整，且前端缺少心跳保活。 |
| 修复方案 | 调整连接初始化与访问控制校验顺序，补充前端心跳保活。 |

### BUG-030: Workers 中 ulid 包报 nodeCrypto.randomBytes is not a function

| 字段 | 值 |
|---|---|
| ID | BUG-030 |
| 标题 | Workers 中 ulid 包报 nodeCrypto.randomBytes is not a function |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 修复版本 | v1.2.21 |
| 影响模块 | packages/server/src/db/repos/*.ts, packages/server/src/lib/ulid.ts |
| 描述 | Worker 初始化时报错，WebSocket 无法建立连接。 |
| 根因 | `ulid` 包环境检测顺序不适配 Workers：Workers 无 `window`，包回退到 Node `crypto`，但 esbuild 打包后的 `randomBytes` 不可用。 |
| 修复方案 | 移除 npm `ulid` 依赖，用 Web Crypto API (`crypto.getRandomValues`) 实现本地 ULID。 |

### BUG-029: Inspector Cron selector 返回新数组导致 React 最大更新深度错误

| 字段 | 值 |
|---|---|
| ID | BUG-029 |
| 标题 | Inspector Cron selector 返回新数组导致 React 最大更新深度错误 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-13 |
| 修复时间 | 2026-05-13 |
| 修复版本 | v1.2.25 |
| 影响模块 | packages/web/src/components/layout/InspectorPanel.tsx |
| 描述 | v1.2.24 修复 Inspector Cron 按话题隔离后，前端进入页面报 `Maximum update depth exceeded`。 |
| 根因 | `useCronStore((s) => s.crons.filter(...))` selector 每次调用都会返回新的数组引用，React 19 / Zustand 会认为 snapshot 持续变化。 |
| 修复方案 | selector 只订阅稳定的原始 `s.crons`；组件内用 `useMemo` 根据 `activeTopicId` / `topicId` 派生过滤后的 Cron 列表。 |

### BUG-028: 聊天窗 @ 产物池选择器回退到旧 UI

| 字段 | 值 |
|---|---|
| ID | BUG-028 |
| 标题 | 聊天窗 @ 产物池选择器回退到旧 UI |
| 状态 | 已修复 |
| 发现时间 | 2026-05-13 |
| 修复时间 | 2026-05-13 |
| 修复版本 | v1.2.24 |
| 影响模块 | packages/web/src/components/layout/TopicPanel.tsx, packages/web/src/components/layout/MessageInput.tsx, packages/web/src/components/chat/MessageInput.tsx |
| 描述 | 聊天窗口输入 `@` 选择产物池时，UI 回退成旧版窄弹层。 |
| 根因 | 项目中存在两套同名 `MessageInput`；`TopicPanel.tsx` 仍从 `./MessageInput` 引用旧版。 |
| 修复方案 | `TopicPanel.tsx` 改为引用 `@/components/chat/MessageInput`，删除旧版 layout MessageInput。 |

### BUG-027: artifact.created 的 metadata.path 在 server → IM 链路丢失

| 字段 | 值 |
|---|---|
| ID | BUG-027 |
| 标题 | artifact.created 的 metadata.path 在 server → IM 链路丢失 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-13 |
| 修复时间 | 2026-05-13 |
| 修复版本 | v1.2.24 |
| 影响模块 | packages/server/src/pi/event-router.ts, packages/server/src/ws/topic-do.ts, packages/protocol/src/ws-events.ts, packages/web/src/lib/ws-client.ts, packages/web/src/components/layout/InspectorPanel.tsx |
| 描述 | Adapter 侧 artifact payload 中 `metadata.path` 正确，但 IM / Inspector 显示路径异常。 |
| 根因 | server → client 的 `artifact.added` / `artifact.list` payload 未透传 `metadata_json`，前端也把该字段固定为 `null`。 |
| 修复方案 | `artifactSchema` 增加 `metadata_json`；server 广播和 list 透传；前端 store 保存并优先展示 `metadata.path`。 |

### BUG-026: Inspector Cron Tab 未按当前话题隔离

| 字段 | 值 |
|---|---|
| ID | BUG-026 |
| 标题 | Inspector Cron Tab 未按当前话题隔离 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-13 |
| 修复时间 | 2026-05-13 |
| 修复版本 | v1.2.24 |
| 影响模块 | packages/web/src/components/layout/InspectorPanel.tsx, packages/web/src/stores/cron-store.ts |
| 描述 | 在一个会话中创建定时任务后，切到其它会话仍能在 Inspector Cron Tab 看到。 |
| 根因 | Todo / Plan 按 topic 读取，但 Cron store 是全局数组，Inspector 直接展示全量 crons。 |
| 修复方案 | Inspector / CronTab 按 `originTopicId === activeTopicId` 过滤。 |

### BUG-025: Durable Object user.message 未恢复 v1.1.0 发送语义

| 字段 | 值 |
|---|---|
| ID | BUG-025 |
| 标题 | Durable Object user.message 未恢复 v1.1.0 发送语义 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 修复版本 | v1.2.23 |
| 影响模块 | packages/server/src/ws/topic-do.ts |
| 描述 | v1.2.0 迁移到 Durable Objects 后，线上 `user.message` 路径只尝试转发 PI，不创建用户消息、不广播用户消息、不返回 PI/session 错误。 |
| 根因 | v1.1.0 的真实发送路径在 `message.handler.ts`，迁移到 DO 时内联 `user.message` 分支未完整移植旧 handler 语义。 |
| 修复方案 | DO `user.message` 恢复写库、广播、搜索索引、PI session 恢复/等待和错误事件。 |

### BUG-024: Workers PI Adapter 访问凭证传递异常

| 字段 | 值 |
|---|---|
| ID | BUG-024 |
| 标题 | Workers PI Adapter 访问凭证传递异常 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 修复版本 | v1.2.23 |
| 影响模块 | packages/server/src/pi/client.ts |
| 描述 | v1.2.0 迁移到 Cloudflare Workers 后，server 连接 PI Adapter 时未正确携带访问凭证。 |
| 根因 | Workers 运行时的 WebSocket 能力与原 Node.js 实现存在差异。 |
| 修复方案 | 改为 Workers 兼容的访问凭证传递方式。 |

### BUG-023: Cloudflare 过滤 Upgrade 头，WebSocket 升级检测失败

| 字段 | 值 |
|---|---|
| ID | BUG-023 |
| 标题 | Cloudflare 过滤 Upgrade 头，WebSocket 升级检测失败 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 影响模块 | packages/server/src/worker.ts |
| 描述 | Worker 对所有 WebSocket 升级请求返回 426。 |
| 根因 | Cloudflare CDN 转发给 Worker 时过滤 `Upgrade` 头。 |
| 修复方案 | 改用 `Sec-WebSocket-Key` 头检测 WebSocket 升级请求。 |

### BUG-022: DO RPC (stub.setConfig) 因 compatibility_date 过旧不可用

| 字段 | 值 |
|---|---|
| ID | BUG-022 |
| 标题 | DO RPC (stub.setConfig) 因 compatibility_date 过旧不可用 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 影响模块 | packages/server/wrangler.toml |
| 描述 | 调用 `stub.setConfig()` 时报 `TypeError: stub.setConfig is not a function`。 |
| 根因 | Cloudflare DO RPC 需要 `compatibility_date >= 2024-04-05`。 |
| 修复方案 | `wrangler.toml` compatibility_date 改为 `2024-04-05`。 |

### BUG-021: Deploy workflow 始终部署 dev/v1.2.0 旧代码而非 master

| 字段 | 值 |
|---|---|
| ID | BUG-021 |
| 标题 | Deploy workflow 始终部署 dev/v1.2.0 旧代码而非 master |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 影响模块 | .github/workflows/deploy.yml, .github/workflows/deploy-pages.yml |
| 描述 | GitHub Actions 显示部署成功，但线上 Worker 始终是旧代码。 |
| 根因 | GitHub 默认分支为 `dev/v1.2.0`，deploy workflow checkout 未显式 `ref: master`。 |
| 修复方案 | 两个 deploy workflow 均加 `ref: master`，并将仓库默认分支改为 master。 |

### BUG-020: FTS5 porter tokenizer 导致 Worker 初始化报错，所有请求返回 500

| 字段 | 值 |
|---|---|
| ID | BUG-020 |
| 标题 | FTS5 porter tokenizer 导致 Worker 初始化报错，所有请求返回 500 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-12 |
| 修复版本 | v1.2.22 |
| 影响模块 | packages/server/src/db/migrate.ts |
| 描述 | Worker 冷启动时 `runMigrations()` 抛错，所有请求返回 500。 |
| 根因 | D1 不支持 `porter unicode61` tokenizer，且 FTS5 创建无 try/catch。 |
| 修复方案 | tokenizer 改为 `unicode61`，并用 try/catch 包裹，FTS5 不可用时降级为 warn。 |

### BUG-019: 定时任务仍在话题内但管理页缺失

| 字段 | 值 |
|---|---|
| ID | BUG-019 |
| 标题 | 定时任务仍在话题内但管理页缺失 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-12 |
| 修复时间 | 2026-05-13 |
| 影响模块 | 待补充 |
| 描述 | 用户已设置 3 个定时任务，但只有 1 个能在“定时任务管理”系统话题中查到，另外 2 个在原话题内仍然存在，但管理页缺失。 |
| 根因 | 已解决，待补充修复细节。 |
| 修复方案 | 已解决，待补充修复细节。 |

### BUG-018: 消息在页面刷新后丢失 — bufferPartDelta 替换而非累加

| 字段 | 值 |
|---|---|
| ID | BUG-018 |
| 标题 | 消息在页面刷新后丢失 — bufferPartDelta 替换而非累加 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-11 |
| 修复时间 | 2026-05-11 |
| 影响模块 | packages/server/src/db/repos/message.repo.ts |
| 描述 | 用户与 Agent 对话后刷新页面，消息内容丢失，只看到最后一个 delta 片段。 |
| 根因 | `bufferPartDelta` 对 text/thinking 类型使用 `existing.contentJson = contentJson` 直接替换；但 PI Agent 发送的是增量 delta，每个 delta 只包含新增文本。 |
| 修复方案 | 对 text/thinking 类型的 part，解析 JSON 后累加 `content` 字段：`prevData.content = (prevData.content ?? '') + newData.content`。 |

### BUG-017: Plan 内容更新过程挤压页面布局

| 字段 | 值 |
|---|---|
| ID | BUG-017 |
| 标题 | Plan 内容更新过程挤压页面布局 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-11 |
| 修复时间 | 2026-05-11 |
| 影响模块 | packages/web/src/components/layout/ChatLayout.tsx, packages/web/src/components/layout/InspectorPanel.tsx |
| 描述 | Plan 内容在流式更新或切换显示时，页面布局被挤压变形。 |
| 根因 | Inspector 所在列和 tab 内容区缺少 overflow/min-width 约束。 |
| 修复方案 | ChatLayout `<aside>` 加 `overflow-hidden`；InspectorPanel tab 区加 `overflow-x-hidden min-w-0`；Plan markdown 容器加 `overflow-hidden`。 |

### BUG-016: Stop 后输入框无法回到可编辑状态

| 字段 | 值 |
|---|---|
| ID | BUG-016 |
| 标题 | Stop 后输入框无法回到可编辑状态 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-11 |
| 修复时间 | 2026-05-11 |
| 影响模块 | packages/server/src/ws/handlers/interaction.handler.ts |
| 描述 | 点击 Stop 中止 Agent 后，输入框持续 disabled。 |
| 根因 | abort handler 只向 PI 发送 `abortSession` RPC，没有 broadcast `agent.status: idle`。 |
| 修复方案 | abort handler 发送 RPC 后立即广播 `agent.status: idle`。 |

### BUG-015: 长 URL 在消息气泡中被截断

| 字段 | 值 |
|---|---|
| ID | BUG-015 |
| 标题 | 长 URL 在消息气泡中被截断 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-11 |
| 修复时间 | 2026-05-11 |
| 影响模块 | packages/web/src/components/chat/MarkdownRenderer.tsx |
| 描述 | 消息中包含长 URL 时，末尾内容被截断不可见。 |
| 根因 | Markdown 容器裁切且 `<a>` 标签未设置换行策略。 |
| 修复方案 | `<a>` 标签增加 `overflowWrap: 'break-word'` 和 `wordBreak: 'break-all'`。 |

### BUG-003: 允许创建同名话题

| 字段 | 值 |
|---|---|
| ID | BUG-003 |
| 标题 | 允许创建同名话题 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-10 |
| 修复时间 | 2026-05-10 |
| 影响模块 | packages/server/src/ws/handlers/topic.handler.ts, packages/server/src/db/repos/topic.repo.ts |
| 描述 | 用户可以创建多个同名话题。 |
| 根因 | `createTopic` 直接插入 DB，无同名检查。 |
| 修复方案 | 新增 `getTopicByName` 查重，创建前同名返回 `DUPLICATE_NAME`。 |

### BUG-002: PI Agent 创建定时任务时不知道当前时间 + 定时任务未出现在管理器

| 字段 | 值 |
|---|---|
| ID | BUG-002 |
| 标题 | PI Agent 创建定时任务时不知道当前时间 + 定时任务未出现在管理器 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-10 |
| 修复时间 | 2026-05-11 |
| 影响模块 | packages/server/src/pi/event-router.ts |
| 描述 | Agent 创建定时任务时不知道当前时间；创建的任务没有出现在系统管理话题。 |
| 根因 | PI Agent 侧需注入当前时间；server 缺少 `cron.created` 事件处理。 |
| 修复方案 | `event-router.ts` 新增 `cron.created` 处理，持久化并广播 `cron.upserted`。 |

### BUG-001: message.delta 累加逻辑错误 — 使用 setStreamingText 替换而非 appendDelta 追加

| 字段 | 值 |
|---|---|
| ID | BUG-001 |
| 标题 | message.delta 累加逻辑错误 — 使用 setStreamingText 替换而非 appendDelta 追加 |
| 状态 | 已修复 |
| 发现时间 | 2026-05-10 |
| 修复时间 | 2026-05-10 |
| 影响模块 | packages/web/src/lib/ws-client.ts, packages/web/src/stores/message-store.ts |
| 描述 | 前端错误地使用 `setStreamingText()` 替换整个文本，而不是追加 delta。 |
| 根因 | ws-client 对 PI 协议 delta 模式理解错误。 |
| 修复方案 | 改用 `appendDelta()`，并补充流式渲染节流和 stream-safe markdown 容错。 |
