# Changelog

## 2026-06-03 [v1.8.11] — fix: 非 Claude Code 话题显示 model 选项 + 默认选首模型

- 输入框 model 选择器不再限定 `programming` agent_type，Codex 和 PI Agent 话题也能从绑定的 provider 中选择模型。
- 新话题自动选择 provider 配置的第一个模型作为默认值，不再显示 "—"。
- 版本显示更新为 `v1.8.11`。

## 2026-06-03 [v1.8.10] — fix: ProviderConfigModal isActive badge 文案修正

- ProviderConfigModal 中 `isActive`（当前激活）的 badge 从 "Default" 改为 "活跃"，颜色从金色改为绿色，与 `isDefault`（官方内置）语义分离。
- 版本显示更新为 `v1.8.10`。

## 2026-06-03 [v1.8.9] — fix: JWT 过期致 provider 401、创建话题失败、刷新后消息无响应

### AIT-208
- HTTP proxy（providers/workspace/mcp/plugins）改用 JIT JWT：每次请求使用 deviceCredential 即时签发 60s 短期 token，不再复用配对时 5 分钟过期 JWT。
- 页面刷新时自动用 deviceCredential 换取新 JWT 写入 PI_ADAPTER_WSS_URL，WS 连接不再因旧 JWT 过期而被 adapter 拒绝。
- DO 创建新话题 session 时同样即时刷新 JWT，避免长时间使用后新建话题失败（jwt_expired）。
- JWT clock skew tolerance 方案已与 adapter 侧对齐（±30s），adapter 侧补 TC-AIT-208-12/13。
- 版本显示更新为 `v1.8.9`。

## 2026-06-03 [v1.8.8] — rebrand: 应用更名 Helm + 舵轮 logo

### 品牌
- 应用正式更名为 **Helm**（接管 PI / Claude Code / Codex 等 CLI agent 的统一 GUI）。
- 新增舵轮 logo（`HelmLogo` 组件）：6 辐条 + 外圈 + 6 根粗握把 + 中心 hub + 顶部金色焦点；配套 `helm.` 字标。
- 左侧栏头像、空态、登录页全部替换为舵轮 mark + `helm.` 字标，替换原 “AC / agent-chat” 标识。
- 新增 `public/icon.svg`（蓝色 squircle + 白色舵轮，maskable）作为 favicon / PWA 图标；`manifest.webmanifest` 与页面 metadata 更名为 Helm。
- 版本显示更新为 `v1.8.8`。

## 2026-06-02 [v1.8.7] — fix: Helm 配对入口文案与异常提示分流

### AIT-216
- 普通配对入口改为“连接到 Helm”，电脑端描述为“上传 Helm 的配对二维码以完成配对流程”。
- 手机端普通配对入口描述为“扫描 Helm 二维码以完成配对流程”，不再显示额外底部提示。
- “请刷新二维码后，扫码/上传后再试”仅保留在主页面左下角连接异常弹窗中，电脑和手机浏览器均适用。
- 版本显示更新为 `v1.8.7`。

## 2026-06-02 [v1.8.6] — fix: 左下角 Agent 连接入口改为扫码配对路径

### AIT-216
- 左下角 Agent 状态入口不再打开手动 PI Adapter 配置；链路正常时展示连接状态、Adapter 地址、版本和设备配对信息。
- 链路异常时展示“请刷新二维码后，扫码/上传后再试”；PC 端提供上传二维码 / 粘贴配对链接，移动端提示使用系统相机扫码。
- 缺少 adapter 配置时默认进入扫码配对提示；手动 WSS + token 配置保留为 `NEXT_PUBLIC_ENABLE_PI_DEBUG_CONFIG=1` 的 debug 入口。
- 版本显示更新为 `v1.8.6`。

## 2026-06-01 [v1.8.5] — fix: 配对 JWT 场景 provider HTTP 鉴权

### AIT-216
- Server provider/workspace HTTP proxy 在 `PI_ADAPTER_TOKEN` 为空时，从配对写入的 adapter WSS URL 中提取 `access_token` / `token`，并转为发往 adapter 的 `Authorization: Bearer ...`。
- 修复扫码配对后 WS 已连接但 provider 列表 401 `auth_invalid` 的问题。
- 版本显示更新为 `v1.8.5`。

## 2026-06-01 [v1.8.4] — fix: 桌面二维码图片识别增强

### AIT-216
- 桌面「上传二维码图片」解码改为多策略扫描：优先使用浏览器 `BarcodeDetector`，并补充 EXIF 方向、多尺度、旋转、中心裁剪和反色扫描，提升手机拍摄二维码图片的识别成功率。
- 版本显示更新为 `v1.8.4`。

## 2026-06-01 [v1.8.3] — fix: 配对流程对齐（平台 token → 设备验证码 → 进主页）

### AIT-216
- 修正 v1.8.2 的过度绕过：扫码 `/pair` **仍走平台 token（VerifyPlatform）**，只在 token 验过后**跳过 pi-adapter 配置**、直接进设备验证码页（与「网页直接访问 → pi-adapter 配置」并列）。有 token 则跳过平台 token 直达验证码。
- 配对成功后整页跳转 `/`（`window.location`），让 WsProvider 重新读取 localStorage（平台 token + 配对写入的连接配置）→ 直接进主页连接，不再卡在 pi-adapter 配置弹窗。
- 连带消除了「配对完又弹 AuthForm」的第二堵墙：`/ws` 用平台 token、adapter 用设备 JWT，各就各位，server 无需额外改动。

## 2026-06-01 [v1.8.2] — fix: /pair 不再被「输 token / 配 adapter」全局门拦截

### AIT-216
- `WsProvider` 是包裹所有页面的全局门（无 token → 输 Token；无 adapter 配置 → ConnectionConfigModal），导致扫码打开 `/pair` 的新设备被挡在配对页之前
- 修复：`/pair` 路由跳过该门，直接渲染配对页（配对端点本就免鉴权），且不触发主连接

> ⚠️ 已知后续墙：配对成功跳 `/` 后，设备仍无 `AGENT_CHAT_TOKEN`，会再遇 AuthForm —— 需 server `/ws` 接受设备 JWT 作鉴权（slice 5 server 侧待做）。

## 2026-06-01 [v1.8.1] — 设备配对：配对后接入连接链路

### AIT-216 切片 5（先跑通）
- 配对成功后 `applyPairedConnection` 把 adapter 地址 + JWT 写入 `PI_ADAPTER_WSS_URL`（`?access_token=<JWT>`）、清空 piToken
- 走现有 `浏览器 → server → adapter` 链路：server 原样把带 `access_token` 的 URL 连到 adapter，adapter 握手时验签（零 server 改动）

> ⚠️ 仍待优化：JWT 5min 过期后的**断线重连刷新**（重连前用 deviceCredential 换新 JWT）未做；端到端联调需 adapter 侧 WSS 实际接收 `?access_token=` 并验签放行。

## 2026-06-01 [v1.8.0] — 设备配对（首版 / 预览）

### AIT-216: 设备配对 server API + 凭证签发 + /pair 前端
- 新增云端配对 API：`/api/agent-chat/v1/pairing/*`（create/claim/desktop-status/verify/cancel）+ `/devices/token`（deviceCredential→短期 RS256 JWT）+ `/.well-known/jwks.json`
- D1 migration `0009`：`pairing_sessions` / `devices` / `signing_keys`（签名密钥首用自动生成持久化）
- 安全：desktopPollToken 只回 adapter，verificationCode 一次性/限频/过期，撤销在 mint 处兜底，JWT 绑定 `aud=adapterInstanceId`
- 前端 `/pair` 页（验证码流程）+ 桌面「上传二维码图片 / 粘贴链接」入口；连接弹窗并列「扫码配对」，原手动 WSS+token 连接保留不变
- 契约见 AIT-208「讨论结论」（agent-chat ↔ agent-adapter）

> ⚠️ 预览：配对握手→拿凭证→换 JWT→落地已可用；**paired 设备用 JWT 直连 adapter WSS 的实时数据连接**为后续切片，本版配对入口尚不能真正建立会话。

## 2026-05-31 [v1.7.30] — provider 话题级绑定 + 别名模型映射 + 工具卡片修复

### AIT-214: provider 话题级绑定
- `topics` 表新增 `current_provider_id`（additive migration `0008`），建话题时落库
- 协议 `Topic` / `topicSchema` 新增 `current_provider_id`（nullable，向后兼容）
- 话题内模型下拉改为按"本话题绑定 provider"取数；切换 active provider 只影响新建话题，不再让已开话题下拉撒谎

### AIT-201: provider 别名模型下拉 + modelMapping 录入/展示
- claude-code 分组下拉用别名 `opus/sonnet/haiku`；provider 编辑表单可录入「别名→真实模型」映射并提交 adapter
- 配了映射的话题选框展示「opus → glm5.1」，透传给 adapter 的仍是别名（由 adapter 经 `ANTHROPIC_DEFAULT_*_MODEL` 解析）
- 服务端/协议层零改动（`/providers` 透明代理已覆盖 `modelMapping` 双向透传）

### AIT-213: 工具卡片 edit 文件后永久 loading
- `upsertSnapshotPart` 去重从 `id || kind` 收紧为严格按 `id`，修复同一消息多工具调用互相覆盖导致 `toolResults` 错位、卡片永久转圈
- 附：消息气泡宽内容溢出修复（`overflow-x:auto` + `min-w-0`）

### 测试 / 工具
- 协议变更门禁：R-006 链路压测 20/20 PASS、R-007 分层验证 l1-2/l2/l3 全过（均对真实 adapter）
- `link-stress` 支持经 env 指定真实 adapter（对齐 link-verify）
- 版本显示更新为 `v1.7.30`

## 2026-05-31 [v1.7.29] — cron.triggered 无 session 场景全局分发

### AIT-195: cron.triggered 无 session 场景的全局分发
- 协议层 `cronTriggeredPayloadSchema` 新增 `prompt` 字段，`cronTriggeredSchema` 新增 `originTopicActive` 字段
- Server event-router: `cron.triggered` 无 `originTopicId` 时不再丢弃事件，改为从 cron job DB 回退查找
- 始终广播 `cron.triggered`（含 topic 存活标识）；topic 存活时自动 `createSession` + `sendUserMessage` 执行 cron
- 前端 ws-client: 收到 `originTopicActive=false` 的 `cron.triggered` 时 push warning Toast 通知用户
- 版本显示更新为 `v1.7.29`

## 2026-05-30 [v1.7.28] — 定时任务弱话题关联与通知分流

### BUG-066: 定时任务强依赖创建话题导致删除后不可持续通知
- cron_jobs 去掉对 topics 的级联外键，删除/归档话题不再删除定时任务，也不再销毁其 PI session
- cron.run.completed 永远触发 Web Push；原话题仍可用时同步写入一条 `cron` 角色话题通知，原话题已删除时只走全局通知
- 前端按活跃话题分流：当前正打开原话题时只显示话题内通知；打开其他话题或原话题已删除时弹全局 Toast
- 版本显示更新为 `v1.7.28`

## 2026-05-29 [v1.7.27] — PI 话题创建与审批交互修复

### BUG-063: seq reorder buffer 导致迟到低 seq 事件永久卡住，审批弹窗不显示
- server PI event router 的 gap flush 改为处理迟到低 seq 事件，避免 `message.start` 永久滞留在 reorder buffer
- web 端 orphan interaction 渲染兜底：有 `messageId` 但本地消息尚未出现时，也能在消息列表底部展示审批/选择卡
- 补充回归测试覆盖高 seq `interaction.request` 先到、低 seq `message.start` 后到的场景

### BUG-064: 创建 PI 话题时未按 PI Provider 分组传递 providerId
- 普通话题创建按当前 Provider tab 选择 active providerId，切到 PI 分组时会传 PI Provider，不再误取 Claude/Codex 分组的 active provider
- 编程话题继续按 extension 选择 Claude Code / Codex 对应分组 provider
- 版本显示更新为 `v1.7.27`

## 2026-05-29 [v1.7.26] — 流式 delta 顺序修复

### BUG-062: 流式 delta 乱序导致 assistant 文本语序错乱
- server PI event router 增加 session 级短窗口 seq reorder queue，非 health 事件按 `seq` 顺序落库和广播
- 防止 `message.end` 越过前面的 `message.delta`，避免刷新后文本按到达顺序错拼
- 补充线上 `das.` 场景回归测试，乱序重放后落库为 `好的，先放一放，需要的时候再继续。`
- 版本显示更新为 `v1.7.26`

## 2026-05-29 [v1.7.25] — 会话失败错误展开

### BUG-061: Adapter 返回对象错误时 createSession 只显示 [object Object]
- server 新增 `errorDetail`，统一展开 Error、RPC error、嵌套 error payload 与普通对象
- PI RPC error reject 保留 adapter 原始错误详情，`topic.session_create.failed` 与前端 `PI_SESSION_FAILED` 不再退化成 `[object Object]`
- PI adapter WebSocket 在 ready 前关闭时返回可读 `ws_close_<code>` 与 close reason，便于识别缺失/无效 PI token 等鉴权问题
- 版本显示更新为 `v1.7.25`

## 2026-05-29 [v1.7.24] — Adapter URL scheme 兼容

### BUG-060: Adapter socket URL 以 https:// 保存时 createSession 失败
- protocol `buildPiWsUrl` 统一把 `https://` / `http://` socket URL 规范化为 `wss://` / `ws://`
- 前端连接配置保存前也规范化 adapter socket URL，避免 localStorage 继续保留错误 scheme
- 修复线上 `topic.session_create.failed` 中 `WebSocket Constructor: The url scheme...` 导致 `pi_session_id=null` 的问题
- 版本显示更新为 `v1.7.24`

## 2026-05-28 [v1.7.23] — 会话创建失败恢复

### BUG-059: topic 已创建但 PI session 创建失败后无法自动恢复
- server 将 topic session 创建流程抽为共享 gateway，统一记录 `topic.session_create.started/succeeded/failed`
- 失败日志补充 `trigger`、`adapterUrl`、topic 信息、createSession params 与错误 `code/name/message`
- 选中已落库但 `pi_session_id=null` 的普通话题时自动重试 `createSession`，避免一次瞬时失败留下永久不可用话题
- 版本显示更新为 `v1.7.23`

## 2026-05-28 [v1.7.22] — 线上版本显示与会话创建诊断

### BUG-058: 线上版本仍显示 v1.7.20，且 topic.create 会话失败缺少可查询细节
- 修复 Sidebar 底部版本号仍硬编码为旧版本的问题，版本显示更新为 `v1.7.22`
- server 在 `topic.create` 调用 PI adapter `createSession` 失败时写入审计日志，记录错误 `code/name/message`
- `PI_SESSION_FAILED` 推送错误中附带失败详情，便于线上直接确认 adapter/PI 返回的真实原因
- 验证：`pnpm --filter @agent-chat/server typecheck`、`pnpm --filter @agent-chat/server test -- topic-do topic-handler server-logs`、`pnpm --filter @agent-chat/server build`、`pnpm --filter @agent-chat/web test -- ws-client-dispatch`、`pnpm --filter @agent-chat/web typecheck`、`pnpm --filter @agent-chat/web build`

## 2026-05-28 [v1.7.21] — AIT-187 流式尾部截断修复

### BUG-057: message.end 越过尾部 delta 导致刷新后正文截断
- server PI 事件去重从 session 级 max seq 改为 per-session seen seq 集合，允许较小 seq 的 late delta 在未见过时继续处理
- session 断连后对仍处于 `streaming` 的消息启动延迟 finalizer，超时后收口为 `aborted`，避免 DB 永久 streaming
- web 端收到 `message.end` 后若又收到 late text/thinking delta，会从已持久化 part 续写并更新最终 snapshot
- 与 adapter 侧确认最终成因：adapter 旧链路允许 `message.end` 越过仍在合并/限速队列的尾部 `message.delta`，agent-chat 旧 max-seq 去重进一步丢弃 late delta
- 17:34 `das.` 真实样本验证修复后 adapter sent、agent-chat received、D1/history 对齐，D1 为 `done/end_turn`
- 验证：`pnpm --filter @agent-chat/server test -- pi-event-router`、`pnpm --filter @agent-chat/server typecheck`、`pnpm --filter @agent-chat/server build`、`pnpm --filter @agent-chat/web test -- ws-client-dispatch`、`pnpm --filter @agent-chat/web typecheck`、`pnpm --filter @agent-chat/web build`
- 版本显示更新为 `v1.7.21`

## 2026-05-28 [v1.7.20] — 线上日志查询修复

### BUG-056: server logs 持久化与 Pages 转发
- server `/server-logs` 从进程内数组改为写入 D1 `audit_log`，避免 Worker / DO isolate 切换后查询为空
- `/server-logs` 支持 `sessionId`、`topicId`、`messageId`、`turnId`、`from`、`to`、`limit` 过滤
- Cloudflare Pages 静态站新增 `_redirects`，让 `agent-chat.jimmy-jam.com/server-logs` 与 `/servers-logs` 转发到 Worker 日志接口
- 版本显示更新为 `v1.7.20`

## 2026-05-28 [v1.7.19] — 定时任务标签搜索与投影补全

### AIT-186: cron 标签贯通与搜索
- cron 协议补齐 `tags`，支持创建/编辑/列表/上报统一透传
- server cron 投影新增 `tags_json`，并通过 `cron.edit` / `cron.updated` / `cron.created` 同步到 D1
- cron admin 页面支持按标签、表达式、任务名、来源话题搜索
- Inspector 中的 Cron 面板展示标签 chips
- 版本显示更新为 `v1.7.19`

## 2026-05-27 [v1.7.18] — 定时任务 Adapter 真源联调

### AIT-185: agent-chat 侧 cron 投影改造
- 协议补齐 `updateCron` / `listCronRuns`，并扩展 cron 定义与 run history 字段，支持 `originTopicId`、`providerGroup`、`timezone`、`createdAt/updatedAt`、`durationMs` 等 adapter 真源数据
- server 对外统一使用 adapter 生成的 `cronId`；D1 行 ID 仅作为兼容投影字段 `localCronId` 返回
- `cron.pause` / `cron.resume` / `cron.delete` / `cron.edit` 均按 adapter `cronId` 查找投影并转发，`cron.edit` 改为调用 `updateCron`，不再 delete + create
- PI 事件路由支持 `cron.updated` / `cron.deleted`，并用 adapter `cronId` 对齐 `cron.triggered` 与 `cron.run.completed`
- web cron store 保留 `localCronId`，但列表去重、操作与 run 关联均以 adapter `cronId` 为准
- 版本显示更新为 `v1.7.18`

### 联调
- 已与 `workspace-pi-adapter.jimmy-jam.com` adapter `v1.10.5` 完成联调
- 验证 `listCrons`、`listCronRuns`、`createCron`、`updateCron`、`pauseCron`、`resumeCron`、`deleteCron`
- 临时测试 cron 已清理，最终 `listCrons` 返回空列表

## 2026-05-27 [v1.7.17] — Codex 话题子类型显示修复

### BUG-055: 保留 topic programming spec，避免 Codex 话题回退显示 Claude Code
- 修复前端 `ws-client` topic 映射把 `programming_spec_json` / `general_spec_json` 固定置空的问题
- 新建或更新 Codex programming 话题后，header 可从原始 `programming_spec_json.extension` 读取并显示 `Codex`
- 验证：新增 `ws-client-topic-mapping` 单测覆盖 Codex topic spec 保留

## 2026-05-27 [v1.7.16] — Programming 子类型显示与创建一致性修复

### BUG-054: Header 子类型只显示名称，创建时保持所选子类型
- 移除 header 中 `Claude Code` / `Codex` 前面的 `›` 前缀，子类型作为 `Programming` 下的只读文本展示
- 创建 Programming 话题时，`providerId` 只选择与当前 extension 同组的 active provider，避免全局 active provider 覆盖用户创建时选择的子类型
- 验证：新增 `provider-selection` 单测覆盖同组 provider 选择和跨组不回退

## 2026-05-27 [v1.7.15] — Extension 选择器改为只读显示

### BUG-053: 移除 header Extension 下拉箭头和交互，改为只读展示
- `ExtensionDropdown` 组件在 header 显示 "›Claude Code" / "›Codex"，原为 button + chevron + 下拉菜单的可切换选择器
- 修复：移除 button 交互、chevron 图标和下拉弹窗，改为纯只读的 span 展示，保留 › prefix + label 样式

## 2026-05-27 [v1.7.14] — flushParts 写竞争修复 + Stop 后重连上下文保留

### BUG-052 (Q1): 修复 flushParts 并发写竞争导致 message_parts duplicate ordinal
- `bufferPartDelta` 在大小阈值触发时以 fire-and-forget 方式调用 `flushParts`，多个 flush 并发执行时会对同一 ordinal 位置产生竞争，造成 text/thinking part 写入重复 ordinal、内容截断
- 修复：引入 `flushLock` promise 链，所有 flush 调用串行执行，避免 DB ordinal 分配时的并发冲突

### BUG-052 (Q3 server 侧): Durable Object 休眠后重连使用正确 lastSeq
- DO 休眠后，内存中的 `PiClient` 及 `lastSeqBySession` 全部丢失，重连时 `attachSession` 以 `lastSeq=0` 发送，导致 adapter 全量重放或（grace period 超时后）上下文归零（失忆）
- 修复：`PiClient.onLastSeqUpdate` hook 在每次 seq 推进时写入 DO 持久存储；`ensureSession` 在重连前读取并通过 `restoreLastSeq` 恢复，使 `attachSession` 携带正确游标

## 2026-05-27 [v1.7.13] — 工作区目录读取防抖修复

### BUG-051: 新建 Programming 话题输入 `/` 后工作区选择器闪烁
- 修复新建话题 Working Directory 输入 `/` 时，工作区读取失败后自动 effect 反复重试，导致选择器在「读取中/错误」之间持续闪烁的问题
- `loadWorkspace` 增加 in-flight guard，避免输入框 `onChange` 与自动 effect 同时触发并发请求
- 自动读取失败后停止自动重试，保留 UI 内「重试」按钮用于手动恢复
- 关闭新建话题弹窗时清理 workspace 缓存与错误状态，避免下次打开继承旧错误
- 验证：`PATH=/opt/homebrew/bin:$PATH pnpm --filter @agent-chat/web typecheck` 通过；`PATH=/opt/homebrew/bin:$PATH pnpm --filter @agent-chat/web test -- workspace-path` 通过；`PATH=/opt/homebrew/bin:$PATH pnpm --filter @agent-chat/web build` 通过

## 2026-05-27 [v1.7.12] — 工作区根目录快捷选择

### AIT-177: 新建 Programming 话题支持 workspace 相对路径
- 新增 `/api/agent-chat/v1/workspace` 代理接口，转发到 Adapter 的 `/api/agent-chat/v1/workspace`
- 新建话题的 Working Directory 输入 `/` 时读取工作区根目录与一级子目录，并按输入内容展示候选
- 输入 `/项目名` 会解析为 `workspacePath/项目名` 后再创建话题；没有匹配目录时同样按该路径交给 Adapter 作为新工程目录
- 同目录话题校验改用解析后的绝对 cwd，避免 workspace 快捷路径绕过重复检查

## 2026-05-26 [v1.7.9] — 恢复 Pages 跨域 Worker 路由

> 线上确认 `agent-chat.jimmy-jam.com` 当前并未把 `/api/*` 与 `/ws` 接入同源 Worker，本版本先恢复到稳定可用的 Pages 跨域访问 `workers.dev` 方案。

### BUG-050: 回退到 `workers.dev` 作为 Pages 的后端入口
- 前端 `server-url` 恢复 `agent-chat.jimmy-jam.com` / `.pages.dev` 走 `wss://agent-chat-server.jimmychung038.workers.dev/ws`
- Pages 构建 workflow 恢复注入 `NEXT_PUBLIC_WS_URL`，确保静态产物固定指向 Worker 后端
- 保留 `v1.7.8` 中新增的 gateway 发送诊断日志，继续用于 Adapter 联调

## 2026-05-26 [v1.7.8] — 同源 Pages/Worker 路由修复 + 发送链路诊断增强

> 当前线上 `agent-chat.jimmy-jam.com` 的 Pages 与 server 已经同源部署，本版本去掉历史上的外部 Worker 强制分流，并补齐首轮发送失败时可提供给 Adapter 的网关侧诊断信息。

### BUG-048: 同源部署不再强制跳到外部 Worker 域名
- 前端 `server-url` 删除对 `agent-chat.jimmy-jam.com` / `.pages.dev` 的硬编码 Worker 路由，默认走当前页面同源 `/ws`
- Pages 部署 workflow 不再注入 `NEXT_PUBLIC_WS_URL`，避免构建期把旧的外部 Worker 地址继续写死进产物
- 线上同源部署下，Provider HTTP proxy / token 校验 / push 订阅 / WS 连接统一回到页面所在域名

### BUG-049: server 发送链路补充可交付给 Adapter 的网关诊断日志
- `/server-logs` 除 Adapter 入站 PI 事件外，新增 gateway 出站日志：`sendUserMessage.dispatch/ack/failed/session_busy`
- session 恢复链路新增 `session.reconnect/reconnect_failed/recreate/recreate_failed` 诊断项
- 每条诊断日志附带 `topicId`、`sessionId`、`messageId`、`clientMessageId`、`attempt`、`status` 和截断后的 payload 预览，便于和 Adapter 侧日志按轮次对齐

## 2026-05-26 [v1.7.7] — AIT-175 推送交互恢复 + Aborting 收口

> 合并处理线上「KKK」话题中 push 已到但前端仍卡 thinking、以及对话结束后状态条长期停在 `Aborting` 的问题。

### BUG-047 (AIT-175): push interaction 可恢复 + abort 状态本地收尾
- `messages.history` 增加 pending interactions 回放；前端重连、切回 topic 或点击通知后能恢复「你要推到哪个仓库」这类 choice/approval 卡片
- Service Worker 前台可见窗口时抑制重复系统通知；点击通知会聚焦已有 PWA 窗口并路由到目标 topic
- 前端 WS 断线不再本地伪造 `aborting`，避免连接问题污染 agent 状态
- 用户点击 Stop 后，server 调用 adapter abort 后会本地 finalize streaming 消息并广播 `agent.status: idle`，避免状态条永久停在 `Aborting`
- `message.end(stopReason=tool_use)` 不再触发“有新回复”push，避免工具调用中间态打扰用户
- 补充针对 foreground reconnect、Service Worker push、pending interaction history、abort finalize 的单测

## 2026-05-26 [v1.7.6] — History reload 清理 Aborting 状态残留

> 针对线上 topic `01KSH0ZRX44ZJ61CT9HHMHZ5XW` 的状态排查：DB 历史中消息已全部完成，但前端仍可能保留断线时本地设置的 `aborting` 状态。

### UI 状态收口
- `messages.history` 返回后，根据该 topic 的消息状态重新校准 agent 状态
- 当历史中不存在 `streaming` / `pending` / `retrying` / `needs_retry` 消息时，强制清理 `aborting` 残留并置为 `idle`
- 保留真实活跃消息场景：如果 history 中仍有 active message，不覆盖 `processing` 状态
- 新增 `message-store` 单测覆盖无活跃消息清理 `aborting` 与有活跃消息不误清

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
