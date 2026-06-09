# Changelog

## 2026-06-09 [v1.10.38] — fix: Attention mirror 小批并行增量 rebuild

- Attention 增量 rebuild 将新增候选节点拆成单节点 LLM 解释请求，并以受控并发执行，降低长话题积压 delta 一次性解释导致的超时风险。
- 并发结果按原始候选顺序归并，snapshot 只 append 连续成功前缀；中间节点失败时，后续即使已成功返回也不会越序入库，留给下一轮 retry。
- 增加 `attention.rebuild.partial_degraded` 日志，记录部分成功提交后的失败位置、提交数量和尝试数量，便于线上排查。
- 新增回归测试覆盖并发乱序返回但按序 append、以及中间节点失败时只提交成功前缀。
- 版本显示更新为 `v1.10.38`。

## 2026-06-09 [v1.10.37] — fix: 中文文件名产物无法预览/下载

- 修复产物文件名含非 ASCII 字符（中文/日文/emoji）时，server 在 R2 下载出口将原始文件名直接写入 `content-disposition` 头，触发 Workers `Headers.set` 的 ByteString 异常，导致整个 GET 返回 500、预览与下载同时失败；纯 ASCII 文件名不受影响，表现为「部分文件可以、部分不行」。
- `content-disposition` 改为 RFC 6266/5987 规范写法：保留 ASCII 回退 `filename="..."`，并新增 `filename*=UTF-8''<percent-encoded>` 承载真实文件名；同时对 header 写入做防御性兜底，异常文件名不再阻断字节交付。
- 新增 `artifact-access.test.ts` 回归测试，覆盖中文名、emoji/混合脚本与 ASCII 回退。
- 版本显示更新为 `v1.10.37`。

## 2026-06-09 [v1.10.36] — feat: 移动端二维码照片配对

- 移动端连接 Helm 时不再只提示扫码，改为复用 PC 端二维码图片配对入口，可上传二维码照片或粘贴配对链接。
- 移动端额外提供“拍照识别二维码”入口，通过浏览器/PWA 的图片 capture 调起后置摄像头拍摄二维码照片并本地解码。
- 新增 `PairingScanCard` UI 回归测试，覆盖默认上传/粘贴入口和移动端拍照入口。
- 版本显示更新为 `v1.10.36`。

## 2026-06-09 [v1.10.35] — fix: Attention mirror 增量 snapshot rebuild

- Attention rebuild 改为以旧 snapshot 为权威状态进行增量 append：旧节点解释、评分和摘要冻结，只对新增节点调用 LLM，避免活跃长话题反复全量 review 触发超时。
- 增量追赶按批处理新增候选，并用旧 `raw_events_json` 的 event id 识别 delta，覆盖同毫秒消息场景；前端 rebuild 去重 key 加入 snapshot watermark，允许同一消息批次继续追后续分批。
- 聚合 review 限定在包含新节点的候选上，旧 capacity/content/branch 聚合不重新进入 LLM，降低对既有聚合结果的扰动。
- 新增回归测试覆盖新增节点冻结、full refresh、分批追赶、同毫秒 delta 与旧聚合冻结。
- 版本显示更新为 `v1.10.35`。

## 2026-06-09 [v1.10.34] — fix: Codex mirror 会话恢复

- Mirror adapter 升级到 `v1.11.19`：CodexBackend 恢复持久化会话时先调用 Codex app-server `thread/resume`，避免 session recreate 后直接 `turn/start` 触发 `[codex_error] thread not found`。
- Helm 版本显示更新为 `v1.10.34`。

## 2026-06-09 [v1.10.33] — feat: Attention mirror R5 语义聚合门禁

- Attention 聚合增加三类语义分层：`capacity` 容量 compact 直接执行，`content` 同话题聚合与 `branch` 支线收束先由本地算法提出候选，再交给 LLM 做后置门禁。
- 聚合候选经 LLM 生成语义标题、摘要、置信度和原因；通过 `aggregation_decisions_json` 冻结落库，稳定复用同一组的聚合决策。
- 当 LLM 判定 `content`/`branch` 不应聚合时，server 会二次 rebuild 并传入 block key，阻止同一组在本次投影中继续 collapse；容量 compact 不受门禁影响。
- 聚合冻结 key 使用原始 message ids，block key 使用 trace node ids，兼顾跨 rebuild 稳定性和树构建阶段的拦截能力。
- 新增 `attention-aggregation-decisions.ts` 与 6 项回归测试，覆盖标题摘要应用、冻结 store、防御解析、分支打回展开、多消息 content 打回展开。
- 版本显示更新为 `v1.10.33`。

## 2026-06-09 [v1.10.32] — perf: 注意力面板增量重建（冻结 LLM 层）

- 重建从「每次全量把所有候选塞进 LLM」改为**增量**：只对新候选调 LLM，旧候选复用上次快照的冻结解释（`conclusion`/`goalAlignment`/`userSummary`/`assistantSummary`/`aggregateTitle` 等）。冻结身份按节点 `source_message_ids` 集合，不受 `cand_N` 重排影响。
- 结构层（路由 / compact / 布局）仍每次全量重跑——保持确定性、稳定，且支持多层 rollup；只冻结贵且会漂移的 LLM 层。
- 根目标归一化文字（`normalized_goal`）钉死：目标未变时复用旧值，不让 LLM 每次重新措辞导致新节点归属抖动。**目标变更是唯一的全量重解释触发器**。
- 候选全部命中冻结（无新增）时直接跳过 LLM 调用。LLM prompt 大小不再随话题长度增长 → 收敛长话题的 `timeout`/`parse_error` 降级与 token 成本。
- 零 schema 改动：冻结状态复用现有快照的 `candidates_json`/`interpret_json`/`goal_json`。
- 新增 `attention-incremental.ts`（纯逻辑）+ `attention-incremental.test.ts`（12 项单测，覆盖冻结 key / 冻结表 / 增量划分 / 合并 / 目标钉死）。
- 设计文档：`attention-incremental-rebuild-design.md`。compact 聚合节点的 LLM 语义标题（R5）留作下一版。
- 版本显示更新为 `v1.10.32`。

## 2026-06-08 [v1.10.31] — fix: 注意力面板「更新目标」丢失用户输入

- 修复 InspectorPanel 注意力面板里「更新目标」保存后未生效的问题：`onCreateGoal` 漏传弹窗输入的文本，导致 `createGoal` 回退到 `goalDraft`（当前激活目标的文本），落库的是默认目标副本，表现为「目标没新增、节点图不重绘」（与 LLM、目标数量上限均无关）。
- 现在 InspectorPanel 与 AttentionDrawer 一致透传用户输入文本。
- 新增 `attention-inspector-overlay.test.tsx` 回归测试，锁定「弹窗输入文本必须透传到 createGoal」。
- 版本显示更新为 `v1.10.31`。

## 2026-06-08 [v1.10.30] — fix: Codex Provider 缺模型时阻止创建话题

- 创建 Codex 话题时，如果当前 Codex Provider 没有可用模型，前端直接提示用户先编辑 Provider 补充模型，避免新会话静默回落到默认 Codex 配置后失败。
- 版本显示更新为 `v1.10.30`。

## 2026-06-08 [v1.10.29] — fix: generated artifact 预览失败原因透传

- generated artifact 按需上传失败时，server 透传真实错误 code/message，并带上 artifactId，避免前端误报为“暂不支持该产物”。
- 前端产物预览/下载按钮按 `file_not_found`、`file_unreadable`、`size_exceeded`、`artifact_forbidden` 等错误显示具体原因。
- generated artifact metadata 兼容 `path`、`filePath`、`file_path` 三种路径字段。
- 版本显示更新为 `v1.10.29`。

## 2026-06-08 [v1.10.28] — fix: Agent processing 状态条不再挤压消息列表

- 话题标题下方的 AgentStatusBar 改为浮层 overlay，processing/aborting 状态切换时不再占用 flex 布局高度，避免消息气泡被上下挤压。
- 状态点外层容器改为固定等宽等高圆形，避免 `px/py + rounded-full` 形成椭圆 pill。
- 版本显示更新为 `v1.10.28`。

## 2026-06-08 [v1.10.27] — feat: 输入框直接粘贴图片自动上传并引用

- 聊天输入框支持直接 Ctrl/⌘+V 粘贴图片：自动识别剪贴板图片并复用现有产物上传链路（`artifact.upload.init → PUT R2 → artifact.upload.complete`）。
- 粘贴图片合成唯一文件名 `pasted-<时间戳>-<rand>.<ext>`，上传完成后自动以 `@文件名` 引用进当前消息，无需手动再 @。
- 纯文本/非图片粘贴行为不受影响；附件按钮上传也同步改为上传后自动引用。
- 新增 `packages/web/src/lib/paste-image.ts`（mime→ext、唯一名生成、剪贴板图片提取），纯前端改动，不涉及协议/server。

## 2026-06-08 [v1.10.26] — feat: generated artifact 按需上传预览

- 前端 generated artifact 即使尚无 `r2_key` 也展示“上传并预览/上传并下载”，点击后复用 `artifact.download.init` 触发按需上传。
- Server 在下载本地 generated artifact 前请求 adapter 上传对应 `metadata.path`，上传完成后更新同一条 artifact 的 `r2_key/upload_status` 并返回签名预览 URL。
- Artifact 上传完成/失败支持更新既有 artifact，避免按需上传产生重复产物记录。
- 前端 `artifact.added` 同步 `upload_status/failure_message`，让按需上传结果能正确反映到产物面板。

## 2026-06-08 [v1.10.25] — fix: Codex provider 识别 apipass 分组

- 前端 provider 选择逻辑将 `apipass` 归一为 Codex 逻辑组。
- 创建 Codex 话题时可正确带上 apipass providerId，避免回落到默认 Codex OAuth 路径。

## 2026-06-08 [v1.10.24] — fix: Attention mirror 左侧绕线

- Attention mind map 的 React Flow 边改为按节点坐标选择连接 handle。
- 横向边固定走 `right -> left`，同列或回接边固定走 `bottom -> top`，避免左侧出现长贝塞尔绕线。

## 2026-06-08 [v1.10.23] — fix: Attention mirror 图节点避让与聚合边长

- Attention mind map 改为按可见边压缩列，聚合节点后的下一节点不再按原始 trace order 拉成长线。
- 投影输出增加坐标冲突避让，避免聚合/展开节点生成到同一位置。
- React Flow 拖拽缓存按投影签名隔离，展开/折叠或快照变化后不复用旧坐标。
- 用户拖拽节点松手后，如果与其它节点矩形重叠，会自动错开到最近空位。

## 2026-06-07 [v1.10.22] — fix: Sidebar 版本展示同步到最新补丁

- Sidebar 硬编码版本从 `v1.10.19` 更新到 `v1.10.22`，避免发版后左下角仍显示旧版本。

## 2026-06-07 [v1.10.21] — fix: Provider 切换按 group 生效，避免 Codex UI 状态错乱

- Sidebar / Provider 管理弹窗按 `claude-code` / `codex` / `pi-agent` 分组计算 active provider，不再用第一个全局 `isActive` 覆盖当前 tab。
- 切换 provider 的乐观更新只影响同组，保留其它组的 active 状态。

## 2026-06-07 [v1.10.20] — fix: Attention 快照按 topic 隔离，避免同目录重建读到旧图

- `useAttentionTrace` 在 topic 切换时清空本地 goals / activeGoal / snapshot / rebuild cache，并丢弃异步回来的旧 topic 数据。
- 读取 snapshot / rebuild 结果时校验 `snapshot.topic_id === 当前 topicId`，防止旧 goalId 的快照显示到新话题。
- 新增回归测试覆盖删除旧话题后重建同目录话题时，不展示旧 Attention 图。

## 2026-06-07 [v1.10.19] — fix: emitAggregateNode 支持嵌套模式，修复展开子 topic 重叠

- `emitAggregateNode` 在展开父节点内被调用时走嵌套偏移（Y: SUBGRAPH_Y + 深度*140, X: order*280），不再用全局 MAIN_Y 跟主节点重叠。

## 2026-06-07 [v1.10.18] — fix: Attention 动态树节点重叠

- `BRANCH_Y` 230→360：分支节点往下移，避开展开子节点底部（原 ~290px vs 230px 重叠 60px）。
- 分支深度间距 90→140：每层分支之间留足空间。
- 嵌套/Exchange 子项 X 间距 250→280：节点宽度 240px 不再挤压。

## 2026-06-07 [v1.10.17] — fix: Attention LLM 输出截断 + 前端透传错误原因

- `MAX_OUTPUT_TOKENS` 2400→4096，`DEFAULT_TIMEOUT_MS` 45s→60s。10 节点以上场景 DeepSeek 输出打满 2400 tokens 触发 `length` 截断 → JSON 不完整 → `parse_error`，40s+ 耗时也踩 45s 超时线，均已实测验证。
- 前端 `llmUnavailable: boolean` → `llmUnavailableReason: string | null`，面板/Inspector/Drawer 均展示具体失败原因（`parse_error`/`timeout`/`upstream_429` 等），不再只有模糊的"LLM 不可用"。

## 2026-06-07 [v1.10.16] — fix: Attention 面板样式细调 + 移除旧 chrome 头部

- 移除旧的 chrome 头部（目标输入框、目标 pills、创建目标按钮），目标管理统一走节点内"更新目标" modal。
- Canvas 区域补齐设计稿元素：Legend（底部左，蓝/橙/虚线图例）、Pan hint（底部右，"拖拽平移 · 滚轮缩放"）、径向渐变背景。
- 详情面板样式对齐 S16 设计稿：scroll padding `14px 16px 18px` + items gap `10px`；section 标题 10px uppercase letter-spacing；消息卡片 border-radius 12px + padding 11px 12px + body 13px；工具行 border-radius 10px + padding 9px 11px。
- 目标更新 modal scrim 从全 panel 修正为 topbar 以下（`top: 52px`）。
- 支线节点标题字号 13px（设计稿一致）；当前节点正确展示 `.nsub` 副标题。

## 2026-06-07 [v1.10.15] — feat: Attention 全尺寸面板 UI 重做（S16 设计稿）

- Attention 抽屉顶部栏：SVG 图标 + "Attention" 标题 + 重置视图按钮，去掉旧的二级 chrome header。
- Canvas 节点样式全面对齐设计稿：目标节点蓝色边框+光晕、当前节点橙色脉冲动画（`attn-node-cur`）、支线节点蓝色虚线边框、聚合节点浅蓝边框；连接边主链蓝色实线、支线蓝色虚线。
- 新增"更新目标" modal：点击目标节点内联按钮弹出，含文本区 + 历史 radio 列表 + 剩余次数计数器。
- 详情面板宽度 340→384px；Filter tabs 重设计（All/Message/Todo/Plan/Tools 含数量角标），Todo 从 plan 独立拆出。
- 节点头 chips 重设计：role chip（monospace）+ 当前节点 chip（橙色脉冲点）+ Focus 准星图标。
- 修复展开节点互相叠压 bug：nested/exchange 节点 x-step 从 120/180px 增至 250px。
- 版本显示更新为 `v1.10.15`。

## 2026-06-07 [v1.10.14] — feat: Attention 节点时间线与运行事件持久化

- 新增 `topic_runtime_events` 持久化 adapter 推送的 `todo.update` / `plan.update`，刷新后可恢复最新 todo/plan 状态。
- Attention server rebuild 读取持久化 runtime events，把 todo/plan 纳入节点 rawEvents 与 planItems。
- Attention 右侧详情改为节点边界内的时间线，支持 `all` / `message` / `tools` / `plan` 筛选并按时间顺序展示。
- Attention LLM degraded 日志增加 prompt/response 长度、耗时、finish_reason、parseError 等 diagnostics，便于区分 timeout、截断和结构错误。
- 版本显示更新为 `v1.10.14`。

## 2026-06-07 [v1.10.13] — fix: Attention 面板明细、目标与快照交互

- Attention 消息明细优先展示真实 raw message，并把 adapter choice/approval 的问题与候选项纳入节点明细。
- 恢复图节点右上角 Focus 定位入口，并让展开后的子交互节点定位到各自原始消息。
- 普通 Attention 面板与全尺寸面板共用同一份快照数据，普通节点展示补齐首/中/末节点延长线。
- 全尺寸面板顶部改为 `attention panel` 标题，移除历史名改名模块；默认目标外最多允许 2 个新目标，目标按钮 hover 显示完整内容。
- 读取大快照时增加加载态；已有有效快照不再被 idle 自动重绘覆盖，目标切换或消息源变化时仍触发完整重绘。
- 版本显示更新为 `v1.10.13`。

## 2026-06-06 [v1.10.12] — fix: Attention LLM 输出解析兼容

- Attention interpret 输出 token 上限从 700 提高到 2400，降低大图 JSON 被截断导致 `parse_error` 的概率。
- server 解析 LLM 输出时兼容 markdown code fence、前后解释文本、result/output/data 包装字段、items/results 数组和 snake_case 字段。
- 新增解析兼容回归测试，覆盖 code fence、包装对象和 snake_case 输出。
- 版本显示更新为 `v1.10.12`。

## 2026-06-06 [v1.10.11] — fix: Attention 大会话重绘超时

- Attention server rebuild 的 LLM interpret timeout 从 12s 提高到 45s，覆盖历史会话和目标切换后的完整会话重绘。
- 前端触发 rebuild 的请求 timeout 提高到 55s，避免前端先于 server 中断。
- 版本显示更新为 `v1.10.11`。

## 2026-06-06 [v1.10.10] — feat: Attention 计算下沉到 server

- Attention 节点生成、LLM interpret、主线/支线治理、聚合投影和快照落库迁移到 server，前端只负责读取快照、触发重绘和渲染。
- 新增 `/attention/goals/:goalId/rebuild`，server 基于 D1 的 messages、message_parts、interactions 重建图，不再依赖前端上传 prompt/rawEvents/candidates/nodes。
- LLM timeout/degraded 时只记录 degraded reason，不写入空图假快照，避免刷新后出现单个假节点或右侧无明细。
- Attention 纯算法迁入 protocol 共享模块，web 侧保留原路径 re-export，主线/支线/聚合逻辑保持一致。
- 新增 server rebuild 和前端 server-owned hook 回归测试。
- 版本显示更新为 `v1.10.10`。

## 2026-06-06 [v1.10.9] — fix: Attention 空图不再显示根占位节点

- AIT-233：修复 Attention 展开面板在没有有效 trace 节点时仍渲染目标 root 占位，导致看起来“只有一个节点”且右侧没有消息明细的问题。
- 空图状态现在显示为空态，LLM 配置不可用时再显示配置提示，避免假节点误导。
- 新增回归测试覆盖 `nodes=[]` 时不渲染动态树和右侧明细。
- 版本显示更新为 `v1.10.9`。

## 2026-06-06 [v1.10.8] — fix: Attention 空快照与目标入口恢复

- AIT-233：修复默认目标创建出的空快照壳会被前端当成有效快照，导致刷新后短暂显示节点、随后被 LLM 配置提示覆盖的问题。
- Attention 完整展开层恢复目标输入框和目标历史控件，避免右侧 Inspector 展开时无法设置目标。
- Attention interpret 降级时记录不含密钥和 prompt 的 server-log，便于确认 LLM 配置或上游失败原因。
- 新增空快照过滤回归测试，确认空目标壳不会被当作可展示图。
- 版本显示更新为 `v1.10.8`。

## 2026-06-06 [v1.10.7] — feat: Attention 目标历史与快照持久化

- AIT-232：Attention 图按目标历史落库，每个目标拥有固定 id、固定目标内容和独立快照，避免刷新或重开话题后图结构不稳定。
- 默认目标使用话题第一条用户消息并进入历史；用户可创建新目标，历史目标支持改名但不改变目标内容。
- 切换历史目标会基于当前完整会话重新绘制并覆盖该目标最新快照。
- LLM 不可用时，有快照则展示旧图并提示无法重绘；无快照则只提示配置 LLM。
- 新增服务端目标快照接口测试和前端目标历史/LLM 不可用场景测试。
- 版本显示更新为 `v1.10.7`。

## 2026-06-06 [v1.10.6] — fix: Attention 聚合节点展开失效

- 修复 Attention 图和详情面板各自计算投影，导致点击聚合节点后展开状态没有同步到图上的问题。
- 12 轮以内的同一业务目标多轮对话不再提前合并成一个 candidate，只有超过上限时才做容量压缩。
- 新增回归测试覆盖聚合节点点击展开、12 轮以内多候选保留。
- 版本显示更新为 `v1.10.6`。

## 2026-06-06 [v1.10.5] — fix: Attention 多轮话题节点压缩

- 修复多轮同一业务目标对话超过候选上限后，Attention 候选层可能整体压成 1 个节点的问题；现在会按容量拆成多个聚合候选，保留完整回合明细。
- 左下角工作区目录改为固定显示区域，读取失败或未连接时显示状态，不再像被删除。
- 版本显示更新为 `v1.10.5`。

## 2026-06-06 [v1.10.4] — feat: Attention 面板支持自定义目标并落库

- Attention 面板顶部新增目标输入框，支持用户显式指定当前话题的目标。
- 目标会落库到 topic，刷新页面或重新进入话题后仍会恢复，并继续作为 Attention 树的优先锚点。
- 未填写目标时，Attention 树仍回退到话题第一条用户消息。
- 清空目标后会回退到默认锚点。
- 版本显示更新为 `v1.10.4`。

## 2026-06-06 [v1.10.3] — feat: Attention 节点支持 Focus 回跳

- Attention 节点详情右上角新增 `Focus` 按钮，可回跳到该节点对应的第一条来源消息。
- 点击后消息面板会平滑滚动到目标消息，并进行短暂高亮，方便用户确认定位结果。
- 聚合节点默认落到第一条来源消息，保持定位动作稳定。
- 版本显示更新为 `v1.10.3`。

## 2026-06-06 [v1.10.2] — fix: adapter 选择交互阻塞链路

- 修复 adapter `interaction.request` 的原始 `interactionId` 被 agent-chat 重新生成，导致用户选择后 adapter/CLI 无法匹配等待中的 tool call，出现 `[cli_error] CLI produced no output` 且后续回复认为用户跳过选择的问题。
- 选择项现在原样回传 adapter，不再把前端展示用的短 label 当作实际 choice payload。
- Attention 面板纳入 adapter 选择/审批事件，用户选择会进入轨迹输入；LLM 解释改为输出用户侧归纳、AI 侧归纳、节点标题、同问题域判断与收束判断，节点展示优先使用语义摘要而不是照搬原话。
- 新增 server/web 回归测试覆盖 `toolu_*` interaction id 保留、choice 原样转发、前端点击发送原始 option。
- 版本显示更新为 `v1.10.2`。

## 2026-06-06 [v1.10.1] — fix: 模型重选持久化与 Attention 配置门禁

- 修复已有话题重新选择模型时，如果当前 live session 模型切换失败会阻止 `current_model` 落库的问题；现在先保存话题模型，再尽力同步当前会话。
- Attention 面板不再使用本地摘要/相似度兜底；云端 Attention LLM 不可用时不渲染推断内容，并提示配置正确的 LLM。
- 版本显示更新为 `v1.10.1`。

## 2026-06-06 [v1.10.0] — feat: SOP 工作流重构

- SOP 中心改为可创建、编辑、预览、删除的用户 SOP 管理入口，不再种子化内置模板。
- SOP 定义调整为 `instruction`、`inputContract`、必填 `outputContract`、可选 plan/todos，并移除 SOP 级 `workflowMode`。
- 新建话题支持选择多个 SOP 并拖拽排序，创建时写入 SOP 快照，后续编辑源 SOP 不影响已创建话题。
- 多 SOP 按顺序组合为工作流，后一个 SOP 默认接收前一个 SOP 的输出。
- 话题菜单新增“生成 SOP”，可基于当前完整会话历史生成草稿并进入预览编辑保存流程。
- 版本显示更新为 `v1.10.0`。

## 2026-06-05 [v1.9.18] — fix: 话题列表与顶部控件 UI 修正

- 左侧话题目录标签改为标题下方第二行展示，去掉目录展开箭头，并统一用 Tooltip 展示完整目录。
- 普通话题右侧数字从产物数量改为后台话题 assistant 新消息未读数，选中话题后清零。
- 底部工作区目录增加 Tooltip 展示完整路径。
- 去掉左侧栏顶部收起按钮；输入框 placeholder 改为 Enter 发送提示，移除 `/` 命令入口。
- 顶部运行状态条去掉 `Processing → ...` 与 `⌘. Stop` 文案；话题顶部右侧只显示「普通 / Claude Code / Codex」，不再显示模型名。
- Plan/工具菜单层级提高，避免弹层被遮挡。
- 版本显示更新为 `v1.9.18`。

## 2026-06-05 [v1.9.17] — fix: 消息重复（补完 streaming 窗口）

- v1.9.9 的落库幂等防线仅覆盖 `done` 状态消息；若重放发生在消息仍 `streaming` 时，DB 已有完整文本但被二次累加导致翻倍（线上 topic `01KT70M4W6BSAE4TZC115PJFTA` 37 条消息受影响）。
- 在文本/thinking 累加落库时增加内容级幂等检查：若 DB 已有 part 的内容已包含待追加的 delta 文本，视为重放直接丢弃。正常流式 delta 永远是增量的，不会误丢弃。
- 修复受影响话题的全部 37 条翻倍消息数据。
- 版本显示更新为 `v1.9.17`。

## 2026-06-05 [v1.9.16] — fix: 输入框 Stop 状态陈旧收敛

- `needs_retry` 不再视为 Agent active，避免可重试消息让输入框持续停在 Stop。
- 历史恢复或停留页面时，超过 2 分钟仍为 `pending` 的用户消息会在前端收敛为 `needs_retry`，释放 Stop 并保留重试入口。
- 版本显示更新为 `v1.9.16`。

## 2026-06-05 [v1.9.15] — fix: 目录展示规则修正

- 保留左侧底部「工作区目录」的完整 workspace root 展示。
- 话题目录展开详情、新建话题工作目录提示等非 footer 位置统一展示去掉 workspace root 后的目录。
- 版本显示更新为 `v1.9.15`。

## 2026-06-05 [v1.9.14] — fix: 话题目录标签与目录搜索

- 话题列表和话题顶部标题新增工作目录标签，展示时去掉 workspace root，并对长路径截断；hover 可查看完整目录标签。
- 搜索框 placeholder 改为「搜索话题或目录」；以 `/` 开头搜索时按话题目录匹配，候选结果展示话题名和目录。
- 新建话题名以 `/` 开头时在输入阶段提示，并禁止创建提交。
- `topics.list` 协议 schema 保留 topic spec json，避免刷新后目录标签缺失。
- 版本显示更新为 `v1.9.14`。

## 2026-06-05 [v1.9.13] — fix: server 分配消息 partId，避免历史回放重复

- 修复实时消息和 history replay 使用不同 part identity 导致前端重复展示同一段内容的问题。
- WS 事件新增 server-assigned `partId`，覆盖 `message.delta`、`tool.call`、`tool.result`、`file.diff`。
- server 落库、广播和 history replay 统一使用同一个 message part id；前端只消费 server 下发的 `partId`，旧事件保留兼容兜底。
- 增加协议、server 路由、用户消息发送、web store 回归测试，锁定实时流与历史回放的 part id 一致性。
- 版本显示更新为 `v1.9.13`。

## 2026-06-05 [v1.9.12] — fix: 输入框草稿按话题隔离、topic 创建绑定默认模型

- 修复切换话题后输入框仍显示上一个话题草稿的问题。
- 输入框文本和 artifact mention chips 改为按 `topicId` 保存；发送成功只清空当前话题草稿，切回原话题可恢复未发送内容。
- 创建 topic 时，如果选中的 provider 配了 models，则把第一个 model 作为默认 model 一起传给 server，并在 `createSession.initialModel` 中原子下发给 Adapter。
- provider 没有配置 models 时不传 model，输入框也不显示 model selector。
- 模型切换失败时不再直接写 `current_model`，避免 UI/DB 显示的模型和真实 session 模型分叉。
- 版本显示更新为 `v1.9.12`。

## 2026-06-05 [v1.9.11] — fix: 高密度 PI 事件路由收敛

- 修复高密度输出下 topic 卡在 Thinking：PI 事件路由 Promise 交给 Durable Object `waitUntil` 托管，避免异步队列未 drain 就被生命周期回收。
- 修复 `lastSeq` 推进时机：只有事件成功完成落库/广播路由后才记录为已处理，避免 reconnect/recreate 跳过“已收到但未落库”的终止事件。
- 增加 `agent.status idle` 兜底收敛：若 DB 里仍有残留 `streaming` 消息，会结束为 `aborted` 并广播 `message.end`，避免刷新后继续卡住。
- 版本显示更新为 `v1.9.11`。

## 2026-06-05 [v1.9.10] — fix: Attention 展开收起动画

- 优化 Attention 全尺寸面板打开/关闭状态：打开时从右侧向左展开，关闭时向右收起后再卸载，避免硬切。
- 版本显示更新为 `v1.9.10`。

## 2026-06-05 [v1.9.9] — fix: 消息重复 + 会话重连红点

- 修复会话重建后**助手消息重复**：`recreateSession` 不再以 `lastSeq:0` 要求 adapter 全量重放；并在落库层对已 `done` 的消息丢弃重放 delta（幂等兜底），避免内容被二次累加。
- 修复空闲后**重连/重建被 `jwt_expired` 拒绝导致的红点**：在每次新建 adapter WS 连接前用 `deviceCredential` 重新签发 access_token（覆盖 create/reconnect/recreate），重试不再因过期凭证失败。
- 日志保真：adapter 连接失败不再记成 `[object Object]`，改为真实 code/message；连接日志屏蔽 `access_token`。
- 版本显示更新为 `v1.9.9`。

## 2026-06-05 [v1.9.8] — fix: Attention 展开层遮挡与收起

- 修复 Attention 全尺寸展开层透明度过高的问题，展开层改为明确的高不透明背景，不再继承全局 glass modal 透明度。
- 全尺寸面板打开后，点击面板区域以外的聊天区会自动收起。
- 版本显示更新为 `v1.9.8`。

## 2026-06-04 [v1.9.7] — fix: Attention 右栏展开体验

- Attention tab 右上角箭头恢复与其他 tab 一致的折叠行为。
- 点击窄态节点图仍可展开全尺寸动态树，但改为右侧面板自身向左展开，不再使用浮在整页上的 portal drawer，也不挤压消息区。
- 全尺寸动态树右上角显示 `>`，点击回到右栏窄态。
- 移除窄态 Attention 顶部统计条，以及全尺寸动态树内部的二级工具条。
- 版本显示更新为 `v1.9.7`。

## 2026-06-04 [v1.9.6] — fix: 可展开多输入聚合节点

- 修复动态树中 compact 后的多条用户输入显示为 `2 条用户输入` / `3 条用户输入` 的问题，节点标题改为根据内部用户消息生成内容概要。
- 多输入 compact 节点现在会作为聚合节点渲染，并支持展开查看内部每条用户输入。
- 新增回归测试，覆盖多输入聚合节点的标题、聚合类型和展开子节点。
- 版本显示更新为 `v1.9.6`。

## 2026-06-04 [v1.9.5] — release: Attention 动态树

- 发布右侧 Inspector Attention tab：窄态只聚焦当前注意力节点，全尺寸态以悬浮 overlay 展示动态树与右侧详情。
- 动态树以用户消息为节点主体，支持主线/虚线支线、聚合展开、当前节点高亮、节点拖拽和拖拽坐标保持。
- 右侧详情按时间线展示用户/AI 消息明细，并把 thinking、工具调用、todo、plan 归并为可展开执行明细。
- 移除旧的多方案注意力图原型，只保留动态树治理模型。
- 版本显示更新为 `v1.9.5`。

## 2026-06-04 [v1.9.5-alpha.16] — experiment: 移除旧注意力图方案

- 移除 Attention X 中除动态树以外的旧方案入口：阶段聚合、多层树、目标支链、Plan/Todo 图、选项决策图。
- 删除对应的独立 projector 原型和回归测试，减少实验代码分支。
- 保留动态树治理仍需要的 Plan/Todo 关联和选择决策识别；选择决策逻辑内联进 conversation-tree。
- 版本显示更新为 `v1.9.5-alpha.16`。

## 2026-06-04 [v1.9.5-alpha.15] — experiment: 右侧 Attention Tab

- 右侧 Inspector 第一个 tab 改为 Attention，并暂时隐藏原 Plan tab 入口。
- Attention 窄态只展示当前进行中的注意力节点，使用左右遮罩收束视线，不默认展开完整图。
- Attention tab 的右上角按钮改为展开箭头，点击后以悬浮 overlay 打开全尺寸动态树，不挤压聊天窗口。
- 全尺寸动态树打开时聚焦当前节点，并保留右侧消息/执行详情栏；再次点击箭头可缩回右栏窄态。
- 桌面顶部原独立 Attention 按钮隐藏，移动端仍保留入口。
- 版本显示更新为 `v1.9.5-alpha.15`。

## 2026-06-04 [v1.9.5-alpha.14] — experiment: 优化节点拖拽闪烁

- 修复节点拖动时闪烁/抖动严重的问题：拖拽变更改为通过 React Flow `applyNodeChanges` 更新现有节点，不再每帧重建整张图节点。
- `fitView` 从持续 prop 改为初始化时执行一次，避免拖动期间视口反复参与布局计算。
- 版本显示更新为 `v1.9.5-alpha.14`。

## 2026-06-04 [v1.9.5-alpha.13] — experiment: 修复节点拖拽受控状态

- 修复动态图节点仍无法拖拽的问题：React Flow 受控节点现在通过 `onNodesChange` 写回本地坐标。
- 拖拽后的节点位置会在当前图面内保留；节点被折叠、移除或历史刷新后会清理过期坐标。
- 版本显示更新为 `v1.9.5-alpha.13`。

## 2026-06-04 [v1.9.5-alpha.12] — experiment: 拖拽节点与时间线详情

- Attention X 动态树节点和旧注意力图节点支持拖拽，便于临时整理复杂分叉图面。
- 右侧详情改为“消息明细”时间线：用户消息和 AI 概要按发生顺序交错展示，长消息限制高度并提供查看详情。
- Thinking、工具调用、Todo、Plan 合并为“执行明细”列表，并用类型标识区分；移除重复的 Text 明细分类。
- 新增详情结构回归测试，防止右侧面板退回按用户/AI/Text 分散分类。
- 版本显示更新为 `v1.9.5-alpha.12`。

## 2026-06-04 [v1.9.5-alpha.11] — experiment: 可读节点标题

- 修复节点概要标题出现 `adapter / 那边 / 边已 / 已经...` 这类重叠 token 片段的问题。
- 标题生成改为清洗后的用户短语/首句片段，保持用户消息为节点主体；AI 概要仍只放右侧详情。
- 新增回归测试，禁止动态图节点标题渲染重叠 bigram 片段。
- 版本显示更新为 `v1.9.5-alpha.11`。

## 2026-06-04 [v1.9.5-alpha.10] — experiment: 节点概要标题

- 动态树节点标题不再使用原始用户消息硬截断；短消息完整显示，长消息生成关键词概要标题。
- 聚合节点标题改为聚合范围概要，不再直接截取第一条用户原文。
- 原始用户消息继续在右侧详情“用户信息”和事件明细中完整展示。
- 版本显示更新为 `v1.9.5-alpha.10`。

## 2026-06-04 [v1.9.5-alpha.09] — experiment: 分层容量 compact

- 为 Attention X 动态树增加同层容量治理：直接可见子节点软阈值 8、上限 10，超过后生成 `capacity_compact` 聚合 topic。
- 容量 compact 会保护当前路径和最近节点，只聚合旧的同层上下文；compact 节点仍可展开，内部继续遵守同层上限。
- 修复聚合 topic 含多条 trace 时投影重复连边的问题。
- 版本显示更新为 `v1.9.5-alpha.09`。

## 2026-06-04 [v1.9.5-alpha.08] — experiment: 长回复追问路由兜底

- 修复长 AI 回复场景下，用户短追问因摘要截断和 cosine 被长文本稀释而误判成支线的问题。
- 将 AI 回复摘要保留长度从 120 提升到 520，并在路由相似度中加入“短用户输入覆盖率”。
- 新增 outboard research 长前言回归：境外投资调研后要求把主要国家和资金画成图，会继续主线。
- 版本显示更新为 `v1.9.5-alpha.08`。

## 2026-06-04 [v1.9.5-alpha.07] — experiment: 追问路由与分层详情

- 修复动态树把“基于上一轮 AI 回复的追问”误判成支线的问题；例如境外投资调研后要求把主要国家和资金画成图，会继续主线。
- 聚合节点增加明确展开/收起按钮视觉，展开后可继续看到子 topic 聚合节点，支持逐层展开到子节点/子子节点。
- 右侧详情改为按选中节点范围展示用户信息、AI 信息概要、Plan/Todo、Text、Thinking、工具调用明细。
- 版本显示更新为 `v1.9.5-alpha.07`。

## 2026-06-04 [v1.9.5-alpha.06] — experiment: 目标关系驱动的动态树路由

- 将 Attention X 动态树路由从时间间隔/问句数量等启发式，改为围绕初始目标、上一轮 AI 回复、当前主线和活动支线的关系判断。
- 支线从发生前最近的主线用户节点分叉，回到目标相关内容后继续主线，避免支线挂到最早主线节点导致图面难读。
- 新增 todo web 应用 + 天气插话场景回归：天气问题聚合为虚线支线，刷新按钮效果回到主线。
- 版本显示更新为 `v1.9.5-alpha.06`。

## 2026-06-04 [v1.9.5-alpha.05] — experiment: 单主线虚线支线与可展开聚合子图

- 将 Attention X 画布收敛为用户注意力图：只渲染目标、用户节点和聚合节点，不再把 topic/plan/decision 平铺到画布。
- 主线使用实线从左到右推进，支线使用虚线从主线节点分叉；支线完成后可折叠为主线/支线上的聚合节点。
- 聚合节点支持点击展开，展开后显示内部局部主线，也可包含内部虚线支线。
- 版本显示更新为 `v1.9.5-alpha.05`。

## 2026-06-04 [v1.9.5-alpha.04] — experiment: 用户消息主体的时间分叉树

- 动态树节点主体统一改为用户消息：无论单 turn、多条用户消息、还是聚合节点，图上优先展示用户的问题/意图/行动计划。
- AI 回复、工具调用、计划和聚合过程保留在右侧详情栏，不再作为图节点标题抢占用户注意力。
- 动态树布局改为按事件时间从左到右推进；讨论支线时从当前节点向下分叉，回到主线后继续向右发展。
- 版本显示更新为 `v1.9.5-alpha.04`。

## 2026-06-04 [v1.9.5-alpha.03] — experiment: 动态树支线关系与聚合详情

- 重构 Attention X 动态树治理：使用 active topic stack 维护子话题层级，支线不再全部平铺为独立分支。
- 支持子话题解决/切换后归档聚合，保留聚合原因、子节点、回合数和工具事件，并在右侧详情栏展示。
- 动态树默认选中最新 turn，当前节点在图上高亮闪烁；聚合节点可作为单层入口查看被聚合内容。
- 版本显示更新为 `v1.9.5-alpha.03`。

## 2026-06-04 [v1.9.5-alpha.02] — experiment: 动态聊天树治理模型

- 将 Attention X 从卡片/列表式投影改为 `chat history -> evolving topic tree` 治理模型，先生成稳定的 `goal / topic / turn / plan / decision` 树，再由图层渲染。
- 支持主目标链、偏离目标支线、active path 展开、旧子话题聚合，以及 plan/todo/choice 挂载到相关 turn。
- 新增动态树默认视图，打开 Attention X 时直接显示连续/分散的思维导图式节点图。
- 版本显示更新为 `v1.9.5-alpha.02`。

## 2026-06-04 [v1.9.5-alpha.01] — experiment: Attention X 多方案图面板

- 基于 `attention-x` 实验分支增加 Attention X 临时面板，可在当前话题历史上切换查看阶段聚合、多层树、目标支链、Plan/Todo、选项决策五种图方案。
- 新增五组纯 projector 原型与回归测试，用于评估长对话目标链路、子话题聚合/展开、支线偏离、计划锚点和选择决策边。
- 版本显示更新为 `v1.9.5-alpha.01`。

## 2026-06-04 [v1.9.4] — fix: session 重建保留 provider 绑定

- 修复 General / PI Agent 话题在 session restore、select retry、message delivery recreate 后丢失 `providerId` 的问题。
- 重建 session 时从 topic 的 `current_provider_id` 回填 provider，避免 adapter 只收到 model、无法解析 provider 而报 `No API key found for undefined`。
- 补充回归测试覆盖 topic 绑定 provider/model 的 session params。
- 版本显示更新为 `v1.9.4`。

## 2026-06-04 [v1.9.3] — fix: Provider 错误提示友好化

- 将 PI Agent 返回的 provider API key/OAuth/额度/账单类内部错误映射为用户可行动中文提示。
- 避免把 `No API key found for undefined`、`node_modules` 文档路径等内部诊断直接作为聊天内容展示。

## 2026-06-04 [v1.9.2] — fix: 防止前端重复 WebSocket 连接

- 修复 `WsClient.connect()` 在 WebSocket 仍处于 `CONNECTING` 时可再次创建连接的问题，避免同一页面同时收到两份实时 delta 导致回复显示双份。
- 补充回归测试覆盖连接中重复调用 `connect()` 不会创建第二个 socket。
- 版本显示更新为 `v1.9.2`。

## 2026-06-04 [v1.9.1] — fix: General 话题支持 cwd 创建

- 修复 General 话题创建时 cwd 被错误塞进 programming spec，导致协议校验/adapter createSession 失败的问题。
- 协议补齐 `general.cwd`，server 持久化到 `general_spec_json` 并透传给 adapter。
- cwd 去重和前端目录展示统一支持 Programming / General 两类话题。
- 版本显示更新为 `v1.9.1`。

## 2026-06-03 [v1.9.0] — feat: Attention 实时注意力面板

- 新增「注意力」面板（对话区头部入口）：把会话实时压缩成 5–12 个决策节点，呈现原始目标 / 关键阶段 / 是否偏离目标。
- S1 数据适配 + 聚合骨架：`storeToRawEvents` 从已有 store 数据（消息/parts/todos/plan）产出决策骨架，无 LLM、纯前端。
- S2 server `/attention/interpret` 薄 LLM 代理：用 agent-chat 自配的 OpenAI 兼容 LLM（Worker secret）提炼 conclusion + 目标距离；未配置/失败自动降级。
- S3 实时增量编排：turn 落定触发一次 interpret，历史冻结，进行中节点 cosine 占位；server 不可用全程 cosine 兜底。
- S4 宽 drawer + 窄列表 + React Flow 实时图（`@xyflow/react`，dynamic import 不进首屏）。
- S5 目标距离弱提示：cosine / goalAlignment 映射为绿/黄/橙色条，子层相对所在 Phase 目标；v1 仅弱提示、不做脉动告警。
- 部署提示：分析 LLM 需在 Worker 配 `ATTENTION_LLM_API_KEY`/`ATTENTION_LLM_BASE_URL`/`ATTENTION_LLM_MODEL`，未配则自动降级为本地 cosine。
- 版本显示更新为 `v1.9.0`。

## 2026-06-03 [v1.8.19] — fix: footer 工作区目录独立成行 + 头部目录标签/工具下拉

- 侧边栏 footer 工作区目录改为单独一行（在「已连接」上方），不再被状态徽标挤压截断；hover 显示完整路径。
- 对话区头部新增工作目录标签：所有 agent 类型通用，显示剥除工作区根目录后的相对路径，过长截断，hover 显示完整目录。
- 类型标签去掉 `Programming` 前缀，直接显示 `Claude Code` / `Codex`，并修复 Codex 标签拼接半圆导致的显示异常。
- 头部 `Plan` / `MCP` 收进带下拉箭头的工具菜单，Plan 开启状态在收起时仍以金色高亮提示。
- `workspacePath` 提升到 `ws-store` 共享，头部与侧边栏使用同一份根路径做前缀剥离。
- 版本显示更新为 `v1.8.19`。

## 2026-06-03 [v1.8.18] — fix: footer 显示完整 workspace 根路径

- 侧边栏 footer 工作区路径从末段目录名改为完整绝对路径。
- 版本显示更新为 `v1.8.18`。

## 2026-06-03 [v1.8.17] — fix: workspace 接口补 deviceCredential

- `fetchWorkspaceBrowse` 补齐 `deviceCredential` + `adapterInstanceId`，配对路径下 workspace 数据正常加载。
- 修复：创建话题路径候选、footer 工作区根目录、话题 cwd 标签。
- 版本显示更新为 `v1.8.17`。

## 2026-06-03 [v1.8.16] — feat: 话题项显示工作目录标签 + 展开/折叠

- 每个话题项在名称左边显示相对工作目录标签（等宽字体 pill）。
- 点击 `▾` 箭头展开/折叠详情（agent type、完整 cwd 路径）。
- 删除按钮 z-index 修复，不再被容器裁剪。
- 版本显示更新为 `v1.8.16`。

## 2026-06-03 [v1.8.15] — refactor: 创建话题弹窗统一工作目录、移除 Permission Mode radio

- General 话题与 Programming 统一：都有工作目录输入框，留空自动创建。
- 移除 Permission Mode 4 选 1 radio，仅保留 YOLO 开关。
- 清理未使用的 RadioCard 组件。
- 版本显示更新为 `v1.8.15`。

## 2026-06-03 [v1.8.14] — feat: 侧边栏 footer 显示工作区目录

- WS 连接时自动从 `/workspace` 接口获取根路径，在 footer 显示最后一段目录名（hover 看完整路径）。
- 版本显示更新为 `v1.8.14`。

## 2026-06-03 [v1.8.13] — UI polish: 状态条、model fallback、气泡样式

- AgentStatusBar 闲时隐藏（idle + connected），仅活跃或异常时显示。
- PI Agent 话题 fallback provider 限定 pi-agent group，不再误选 Claude Code/Codex provider。
- 消息气泡去掉外层 overflow-x 滚动条（代码块自带），user 气泡去掉蓝外发光。
- 版本显示更新为 `v1.8.13`。

## 2026-06-03 [v1.8.12] — refactor: 侧边栏结构重组对齐设计稿

- 侧边栏重组为三层：新建话题 → 话题区(flex:1,含搜索+列表+fade mask) → 底部浓缩栏 → Footer。
- System 话题（定时任务/产物池/SOP）从列表中移除，改为底部图标按钮（带数字徽章）。
- Provider 标签从侧边栏中部移除，改为底部「插件管理」popover（含 Provider tabs + 快速切换 + 管理入口）。
- TopicItem 间距微调对齐设计稿（column-gap 9px, padding 8px 9px 9px）。
- 话题列表新增 CSS fade mask 渐变淡出。
- 版本显示更新为 `v1.8.12`。

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
