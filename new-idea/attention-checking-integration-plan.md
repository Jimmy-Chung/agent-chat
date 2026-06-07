# Attention Checking 面板集成评估与落地计划

> 评估对象：把 `new-idea/attendtion-tracking`（Agent Trace Viewer）作为一个新面板「Attention Checking」集成到 agent-chat 右侧 InspectorPanel（现有 Todo / Plan / Artifacts / Cron 同级）。
>
> 核心诉求：关注用户在使用 Agent 过程中的**决策树**与**注意力锚点**——长程任务结束后 10 秒内看清「原始目标是什么、经历了哪些关键阶段、是否偏离目标」。
>
> 日期：2026-06-03 ｜ 状态：评估 + 计划（未动代码）

---

## 0. 结论先行

**能做，建议做。** 我们这边的数据基础比原项目更好，核心算法（聚合 / LLM 解析 / 投影）可以**大部分原样迁入**，真正要重写的只有两头：数据入口（parser）和渲染出口（图 → 适配窄面板）。

- 原项目核心 pipeline ≈ 1300 行可复用
- 需要新写的适配层 ≈ 400–600 行
- 不引入 React 兼容性风险（`@xyflow/react` peer dep 是 `react >=17`，我们是 React 19，✅）
- 主要不确定性集中在：**LLM 调用放哪**、**实时 vs 离线触发**、**窄面板可视化降级**

---

## 1. 治理结果差异（原项目 vs 我们）

### 1.1 原项目的治理链路

```
~/.claude/projects/*.jsonl (非结构化文本)
  → parser:   每行 JSON.parse + 启发式过滤 + 正则提取  → RawEvent[]
  → aggregator: 按"真实用户消息"切 Turn               → CandidateNode[] + planItems
  → interpreter: 整条轨迹一次 LLM 调用                → TraceNode[] (5-12 决策节点)
  → projector:  节点 → React Flow 横向决策树
```

原项目最脏的活都在 **parser 段**：
- `isHumanMessage` / `isVisibleText`：用前缀启发式（`<` 开头 = XML 系统注入，`{`/`[` 开头 = JSON 系统消息）剔除 Claude Code 注入的非人类消息
- `isGeneratedUserPrompt`：用正则硬编码识别「轮询 AIT-xxx」这类机器生成的 prompt
- `looksLikePlan` / `extractPlanItems`：从纯文本里猜哪段是计划、正则切条目
- Turn 切分：靠"遇到真实用户消息就开新 Turn"的启发式

### 1.2 我们的治理源（结构化，更干净）

我们的源不是 JSONL 文本，而是 **PI Adapter 的流式 `PIEvent`**，并且前端已经把它落成结构化数据：

| 数据 | 来源 | 位置 |
|---|---|---|
| 消息体 + 角色 | `Message`（`role: user/assistant/system/cron`） | `message-store` |
| 文本 / thinking / 工具调用 / 工具结果 / diff | `MessagePart.kind` | `partsByMessage` |
| Todo 全量快照 | `todo.update` payload | `todosByTopic` |
| Plan 文本 | `plan.update` payload | `planByTopic` |
| Turn 边界 | `Message.turn_id` / `PIEvent.turnId` | 已分好 |
| 原始目标 | topic 第一条 `role='user'` 消息 | `message-store` |

### 1.3 关键差异：治理结果会**更准、更省**

| 维度 | 原项目（JSONL） | 我们（PIEvent / Store） | 结论 |
|---|---|---|---|
| 真实用户消息识别 | 启发式过滤 XML/JSON 系统注入，**有误判** | `role` 字段直接区分，**零猜测** | ✅ 更准 |
| Turn 切分 | 靠"用户消息边界"启发式 | `turn_id` 现成 | ✅ 更准 |
| Todo 治理 | 从 `TodoWrite` 工具调用里翻 `input.todos` | `todosByTopic` 已是结构化数组 | ✅ 省一步 |
| Plan 治理 | 正则从文本猜计划 + 切条目 | `plan.update` 直接给 plan 文本 | ✅ 省一步 |
| 机器生成 prompt（轮询等） | 正则硬编码识别 | 我们能用 `role='cron'` / `cron_run_id` 精确标记 | ✅ 更准 |
| 数据完整度 | 一次性读完整 JSONL（离线） | 流式，可能"截至当前" | ⚠️ 见 §4.2 |

> **一句话**：原项目把 60% 工程量花在「从脏文本里还原结构」，这部分我们几乎不用做——我们的数据天生就是结构化的。代价是要写一个 **`Message[]+MessagePart[]+todos+plan → RawEvent[]` 的适配器**，但这比原 parser 简单得多（无启发式、无正则猜测）。

---

## 2. 代码迁入 vs 重写

### 2.1 原项目代码体量（已实测）

| 文件 | 行数 | 迁入策略 |
|---|---:|---|
| `pipeline/aggregator.ts` | 449 | **直接迁入**（纯函数，输入 RawEvent[]） |
| `pipeline/interpreter.ts` | 326 | **迁入 + 改 provider**（LLM 调用抽象掉） |
| `pipeline/projector.ts` | 526 | **迁入**（若保留图）／**部分用不上**（若降级列表） |
| `types/index.ts` | 78 | **直接迁入** |
| `parser/claudeCodeParser.ts` | 314 | **不迁入，重写**为 Store→RawEvent 适配器（更短） |
| `provider/deepseek.ts` | 32 | **重写**为我们的 LLM provider（见 §4.1） |
| `provider/config.ts` | 23 | 改成走我们的配置 |
| `hooks/useTraceProcessor.ts` | 249 | **迁入 + 改造**（数据源换成 store） |
| `hooks/useMultiSession.ts` | 118 | 暂不需要（我们一个面板对应一个 topic） |
| `components/TraceDAG.tsx` | 669 | 看可视化决策（§4.3）：保留 / 降级 |
| `components/NodeCard.tsx` | 453 | 迁入 + 重做样式（套我们的 design tokens） |
| `components/GoalAnchorBar.tsx` | 122 | 迁入 + 重做样式 |
| 其余 | — | FileUpload/ProgressPanel/ProviderPanel 多数不需要 |

### 2.2 可复用 vs 重写的成本估算

| 模块 | 来源 | 工作量 |
|---|---|---|
| 类型 `types` | 直接迁入 | ~0.5d |
| 聚合 `aggregator` | 直接迁入（基本不改） | ~0.5d |
| 解析 `interpreter` | 迁入 + 抽象 LLM provider | ~1d |
| 数据适配器（新写，替代 parser） | **重写** | ~1.5d |
| LLM provider（走 server） | **重写** | ~1d |
| 触发/编排 hook | 迁入 + 改数据源 | ~1.5d |
| 可视化（窄面板列表版） | 部分重写 + 套 token | ~2–3d |
| 可视化（全屏图版，可选 P2） | 迁入 TraceDAG + 套 token | +2–3d |
| InspectorPanel 接线 + Tab | 新写 | ~0.5d |
| 测试（pipeline 单测 + 适配器单测） | 新写 | ~1.5d |

**纯重写的话**核心算法（聚合 + 决策节点提炼 + 目标距离）要复刻原项目几百行精调过的启发式与 prompt 工程，成本至少翻倍且容易踩坑——**不建议重写，建议迁入核心 + 重写两端**。

> 估算总量（不含全屏图）：**约 8–10 人日**；含全屏图 React Flow 版：**约 11–13 人日**。

---

## 3. 做成什么样（产品形态）

### 3.1 入口

InspectorPanel 顶部 Tab 增加第 5 个：`Todo ｜ Plan ｜ Artifacts ｜ Cron ｜ Attention`。
折叠态侧边竖条同步加一个图标。

### 3.2 面板内容（窄栏版，主推 P1）

```
┌─────────────────────────────┐
│ 🎯 目标锚点                   │  ← GoalAnchorBar 降维：
│ 「修复 SSE 端口泄漏」          │     第一条用户消息 → LLM 提炼 ≤20 字
│ ●●●○○ 目标距离：偏离中 ⚠️      │     最近3节点偏离则橙色脉动
├─────────────────────────────┤
│ 决策节点（5–12）              │  ← 纵向列表（不是图），每个节点：
│ ① 定位端口泄漏根因    ●绿     │     - conclusion（≤15字）
│ ② 加日志复现         ●绿     │     - goal_distance 色条（绿/黄/橙）
│ ③ 改 adapter 重连逻辑 ●黄     │     - 「N 轮」可展开看子交互
│ ④ ⤷ 跑偏去查 D1 schema ●橙   │     - 点节点 → 详情（NodeCard）
│ ⑤ 回归测试           ●绿     │
└─────────────────────────────┘
```

- **节点 = 决策树的一层**：原项目的三层结构（Phase → ExchangeGroup → Exchange）在窄栏里用「展开/收起」纵向呈现，而非横向图。
- **目标距离色条**：绿（紧贴 <0.35）/ 黄（中性）/ 橙（偏离 >0.65），与原项目映射一致。
- **偏离提示**：最近 3 个节点任一 `goal_distance ≥ 0.65` → 锚点橙色脉动「当前行为与起始目标距离拉大，是有意为之吗？」

### 3.3 全屏决策树图（可选 P2）

面板右上「⛶ 展开」→ 全屏 modal 用原项目 `TraceDAG`（React Flow 横向树 + 分支检测上下分流）。窄面板放不下完整图，这是图的正确归宿。

### 3.4 触发方式（关键产品决策，见 §4.2）

推荐：**手动「分析本话题」按钮 + 会话空闲自动节流**，而非每条消息实时重算。

---

## 4. 三个关键卡点 + 推荐方案

### 4.1 LLM 调用放哪

| 方案 | 说明 | 取舍 |
|---|---|---|
| A. 前端直调（原项目做法） | 用户填 DeepSeek key，localStorage | 简单，但 key 暴露在前端、Workers 架构里不统一 |
| **B. 走 server 代理（推荐）** | 新增 server 路由 `/attention/interpret`，server 持有 key 调 LLM | 与现有架构一致、key 安全、可缓存结果 |
| C. 纯本地 fallback（无 LLM） | 用余弦相似度算目标距离 + 截断摘要 | 0 成本但 conclusion 质量差，仅作降级 |

> 推荐 **B 为主 + C 兜底**：原项目本来就内置了无 LLM 的 fallback（cosine 目标距离 + 本地摘要），server 不可用时自动降级，不阻断面板。

### 4.2 实时增量 vs 离线分析

| 方案 | 说明 | 取舍 |
|---|---|---|
| 实时每条重算 | 每来一条消息重跑 pipeline+LLM | ❌ LLM 成本高、抖动 |
| **手动触发 + 空闲节流（推荐）** | 按钮「分析」+ agent.status 回到 idle 后延时自动跑一次 | ✅ 成本可控、结果稳定 |
| 纯离线 | 仅会话结束后看 | 体验差，长会话中途看不了 |

> 推荐：**节点聚合（aggregator，纯本地）可实时**，让用户随时看到"截至当前的决策骨架"；**LLM 提炼（conclusion/目标距离）按需触发**（手动或 idle 节流），二者解耦。这正好契合原项目"aggregator 不依赖 LLM、interpreter 才依赖"的分层。

### 4.3 可视化形态

| 方案 | 说明 | 取舍 |
|---|---|---|
| 直接塞 React Flow 图 | TraceDAG 原样进窄面板 | ❌ 面板太窄，横向树展不开 |
| **窄栏纵向列表 + 全屏图（推荐）** | 面板用列表，点「展开」进全屏 React Flow | ✅ 兼顾随手看 + 深看 |
| 只做列表 | 不引入 @xyflow/react | 省一个依赖，但丢了决策树的空间感 |

> 兼容性已确认：`@xyflow/react@12` peer dep = `react >=17`，我们 React 19 ✅，可放心引入（仅全屏图用到，可做 dynamic import 不拖累首屏）。

---

## 5. 落地计划（分阶段）

### Phase 0 — 适配层 + 算法迁入（骨架，~3d）
1. 迁入 `types` / `aggregator` / `interpreter` 到 `packages/web/src/lib/attention/`（或独立 `packages/attention-core`）
2. 新写 **数据适配器** `storeToRawEvents(messages, parts, todos, plan)`：替代原 parser
3. interpreter 的 `callDeepSeek` 抽象成 `interpret(prompt): Promise<string>` 接口
4. 单测：喂一段真实 topic 的 store 快照，跑出 CandidateNode[]，断言节点数 ≤12、目标锚点正确

### Phase 1 — Server LLM 代理（~1.5d）
5. server 新增 `/attention/interpret` 路由（持有 key，OpenAI 兼容）
6. 前端 provider 走 server；无 server 时降级本地 cosine fallback
7. 结果缓存（按 topic + 最后消息 ts 做 key，避免重复算）

### Phase 2 — 窄面板 UI（~3d）
8. InspectorPanel 加第 5 个 Tab `Attention` + 折叠竖条图标
9. GoalAnchorBar / 决策节点列表 / NodeCard 迁入并套 design tokens（CSS 变量）
10. 触发：「分析本话题」按钮 + idle 节流自动跑
11. 目标距离色条 + 偏离脉动提示

### Phase 3 —（可选）全屏决策树图（~2–3d）
12. 「展开」→ 全屏 modal，dynamic import `@xyflow/react` + 迁入 TraceDAG
13. 分支检测（连续偏离节点上下分流布局）

### Phase 4 — 回归（~1.5d）
14. pipeline 单测 + 适配器单测
15. 真实 topic 端到端验证（mock-pi 跑一个长会话 → 看决策树）
16. 注意：本需求**不涉及通讯协议变更**（纯前端消费已有 store 数据 + 一个独立 server 路由），无需跑 R-006/R-007 链路压测；只跑 `pnpm -r test` + 相关 e2e

---

## 6. 成本与开销

### 6.1 工程成本
- **P1（窄面板可用版，不含全屏图）：约 8–10 人日**
- **P2（含全屏 React Flow 图）：约 11–13 人日**

### 6.2 运行开销
| 项 | 开销 | 控制手段 |
|---|---|---|
| LLM 调用 | 每次分析整条轨迹**一次** LLM 调用（原项目设计，非每节点一次） | 按 topic+末条 ts 缓存；手动/节流触发 |
| Token 用量 | 输入≈候选节点摘要（已压缩），输出 ≤200 tokens/次 | max_tokens 限制；候选节点硬上限 12 |
| 前端 bundle | 列表版几乎 0 新依赖；全屏图 +@xyflow/react(~官方 gzip 数十KB) | 全屏图 dynamic import，不进首屏 |
| Server | 一个无状态代理路由 + KV/D1 缓存（可选） | 轻量 |

### 6.3 不需要的开销
- ❌ 不改通讯协议 → 不触发链路压测门禁
- ❌ 不动 adapter / mock-pi
- ❌ 不引入新的持久化（分析结果可纯前端内存 / 可选缓存）

---

## 7. 风险

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| LLM 提炼质量不稳定（conclusion 跑偏） | 中 | prompt 工程依赖模型；中英文混合 | 复用原项目调好的 prompt；保留 cosine fallback；结果可人工不信任时折叠 |
| 窄面板信息密度 vs 可读性 | 中 | 5–12 节点 + 子层在窄栏里可能挤 | 手风琴展开（同级互斥，原项目已实现）；全屏图兜底 |
| 实时数据"截至当前"不完整 | 低-中 | 会话进行中决策树是半成品 | 标注「分析时间点」；idle 后自动刷新 |
| 数据适配器漏映射边界情况 | 中 | system/cron 消息、空 turn、并发工具调用 | 适配器单测覆盖；cron 消息用 `role='cron'` 显式归类 |
| @xyflow/react 与 Next.js 15 SSR | 低 | 图库需 client-only | `'use client'` + dynamic import ssr:false |
| 范围蔓延（多会话时间线等原项目特性） | 中 | 原项目有多会话泳道等特性，易被带入 | P1 严格只做单 topic；多会话明确划到 backlog |

---

## 8. 多 Runtime 统一治理（Claude Code / Codex / PI 都能要）

### 8.1 我们有三类 runtime（代码实证）

```
pi-rpc.ts:19           extension: 'claude-code' | 'codex'
provider-selection.ts  ProviderGroup = 'claude-code' | 'codex' | 'pi-agent'
                                          ↑claude code     ↑coders     ↑pi
```

- 每个 topic 创建时绑定 `agent_type`（`programming` / `general`）+ `current_provider_id`（immutable）
- `programming` 走 `claude-code` / `codex` extension；`general` 走 `pi-agent`
- 即：每个 topic **自己知道**它属于哪个 runtime

### 8.2 为什么一套算法同时支持三种

原项目绑死 **Claude Code 的 JSONL 原生格式**（content blocks / tool_use_id / 注入 XML），换 agent 就失效。

我们的注意力适配器**不接原生格式**，接的是 adapter 归一化后的**统一 `PIEvent`**。无论底层是 claude-code / codex / pi-agent，事件最终都被拍平成同一套抽象：

```
message.delta · tool.call · tool.result · todo.update · plan.update · thinking
```

pipeline 消费的是这层 runtime 无关的抽象 → **一套算法天然覆盖三种 runtime**。"每个类型都有决策图"不是写三套，而是同一套自动适配。

### 8.3 两种粒度

| 粒度 | 说明 |
|---|---|
| 每 topic 一张图 | topic 已绑 provider，天然分流；claude-code 会话出 claude-code 决策树，codex 出 codex 的 |
| 按 runtime 横向聚合（可选 P2） | 同一 runtime 的多 topic 决策树并排，对比不同 agent 的行为模式 |

### 8.4 per-runtime 差异处理（加标签，非重写）

| 差异点 | 处理 |
|---|---|
| thinking / todo / plan 支持度不同（codex / pi-agent 未必发 `plan.update`） | 缺失则降级；目标距离仍可用 cosine 算 |
| 工具集语义不同 | 节点摘要带 `runtime` 标签，让 LLM 拿到上下文 |
| 目标锚点来源 | 三者一致（topic 第一条 user 消息），无差异 |

> **代价评估**：相比单 runtime，多 runtime 支持仅多出「适配器里读 topic 的 runtime 标签 + 个别事件缺失的降级分支」，约 **+1 人日**，不改变 §5 的 Phase 结构。

---

## 9. 建议下一步

1. 先拍板三个卡点（§4）：LLM 放 server（推荐 B）／触发用手动+节流（推荐）／可视化用列表+全屏图（推荐）
2. 在 Linear 建 Feature issue，按 §5 的 Phase 拆 TC，分配 milestone
3. 从 Phase 0 适配层 + 算法迁入开始（风险最低、最能验证可行性的一步）

> 备注：原项目代码现在在 `new-idea/attendtion-tracking/`，是独立 Vite SPA（React 18）。迁入时按 monorepo 约定放入 `packages/`，React 18→19 对这些纯函数 pipeline 无影响，仅组件层需注意 React 19 的细节。
