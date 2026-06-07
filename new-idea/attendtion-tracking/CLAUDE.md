# Agent Trace Viewer — 项目说明

## 核心定位

这是一个**注意力锚点（Attention Anchor）**工具，不是日志查看器。

**最重要的设计原则**：把一段 Agent 会话的全程，压缩成 5-12 个人类能看懂的决策节点。用户不应该、也不需要读完所有工具调用。目标是帮用户在长程任务结束后，10 秒内看清楚：原始目标是什么、经历了哪些关键阶段、是否偏离了目标。

**不是什么**：不是工具调用的流水账，不是 debug 日志，不是性能分析器。

---

## 项目结构

```
src/
├── types/index.ts              # 核心类型：RawEvent, TraceNode, GoalAnchor, TraceExchange
├── parser/claudeCodeParser.ts  # 解析 Claude Code JSONL → RawEvent[]
├── pipeline/
│   ├── aggregator.ts           # 事件 → 候选节点 + groupExchanges
│   ├── interpreter.ts          # LLM 解析：一次调用 → 5-12 个决策节点
│   └── projector.ts            # 节点 → React Flow 图数据（含横向树布局）
├── provider/
│   ├── deepseek.ts             # DeepSeek API client（OpenAI 兼容）
│   └── config.ts               # localStorage 持久化
├── hooks/
│   ├── useTraceProcessor.ts    # 主流水线 hook（单会话）
│   └── useMultiSession.ts      # 多会话时间线 hook
└── components/
    ├── GoalAnchorBar.tsx       # 固定顶栏：目标 + 目标距离指示
    ├── TraceDAG.tsx            # React Flow 图（自定义节点/边）
    ├── NodeCard.tsx            # 右侧节点详情面板（含 Plan/Todo）
    ├── ProviderPanel.tsx       # DeepSeek API key 配置
    ├── FileUpload.tsx          # JSONL 上传（多文件/文件夹）
    └── ProgressPanel.tsx       # 处理进度显示
```

---

## 一、JSONL 数据治理

### 1.1 输入格式

Claude Code 对话文件位置：`~/.claude/projects/<id>/*.jsonl`

每行一个 JSON 对象，两种主要格式：

```jsonl
{"type":"user","message":{"role":"user","content":"用户的原始输入"},"timestamp":"2024-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."},{"type":"tool_use","id":"...","name":"Read","input":{...}}]},"timestamp":"..."}
```

多个 JSONL 文件（同一项目不同日期分割的）可以**合并上传**，系统按时间戳排序后当成一条连续会话处理。

### 1.2 Parser 输出：RawEvent[]

`claudeCodeParser.ts` 把每行 JSON 解析成结构化的 `RawEvent`，一个 JSONL 条目可能展开为多个 RawEvent：

```typescript
type RawEvent = {
  id: string
  ts: number           // Unix 毫秒时间戳
  kind: 'tool_use' | 'thinking' | 'plan' | 'todo' | 'message'
  role?: 'user' | 'assistant'
  turn_id?: string
  payload: Record<string, unknown>
  source_line?: number
}
```

**种类说明：**

| kind | 来源 | payload 关键字段 |
|------|------|-----------------|
| `message` | user/assistant 的文字内容 | `text`, `role` |
| `tool_use` | assistant 调用工具 | `name`(工具名), `input`, `output` |
| `thinking` | assistant 的 thinking 块 | `text` |
| `todo` | TodoWrite 工具调用 | `input.todos[]`（`content`, `status`, `depth`） |
| `plan` | 消息中的计划条目 | `items[]`（`text`, `status`, `depth`） |

**GoalAnchor 提取**：Parser 同时找到第一条真实用户消息，作为整个会话的原始目标（`raw_query`）。

---

## 二、多 Turn 数据治理

### 2.1 区分真实用户消息

并非所有 `role=user` 的消息都是用户输入。Claude Code 会注入系统 XML 消息（如 `<task-notification>`、`<search_results>`）。过滤规则：

```typescript
function isHumanMessage(text: string): boolean {
  if (!text?.trim()) return false
  if (text.trim().startsWith('<')) return false   // XML 系统注入
  if (text.trim().startsWith('{') || text.trim().startsWith('[')) return false  // JSON 系统消息
  return true
}
```

### 2.2 以用户消息为边界切分 Turn

按顺序遍历 `RawEvent[]`，遇到真实用户消息就开启新 Turn：

```
Turn 1: [用户消息A] → [thinking] → [tool_use x3] → [assistant回复]
Turn 2: [用户消息B] → [thinking] → [tool_use x2] → [assistant回复]
Turn 3: [用户消息C] → ...
```

每个 Turn 产生一个 `CandidateNode`：

```typescript
type CandidateNode = {
  user_message: string         // 用户原话
  user_messages: string[]      // 合并多条时的原始列表
  user_kind: UserMessageKind   // 'question'|'proposal'|'choice'|'evidence'|'instruction'
  exchanges: TraceExchange[]   // 该 Turn 的完整交互记录
  thinking: RawEvent[]
  tools: RawEvent[]
  messages: RawEvent[]
  ts_start: number
  ts_end: number
}
```

### 2.3 TraceExchange：单轮交互的完整记录

每个 Turn 产生一个 `TraceExchange`，记录了这一轮的关键信息：

```typescript
type TraceExchange = {
  id: string
  user_message: string
  user_kind: UserMessageKind
  prev_ai_summary?: string      // 上一轮 AI 回答的摘要（触发本次提问的上下文）
  assistant_summary: string     // 本轮 AI 所有回复的合并摘要
  assistant_actions: AssistantActionKind[]
  event_ids: string[]           // 关联的原始事件 ID
  tool_count: number
  ts_start: number
  ts_end: number
}
```

**`prev_ai_summary` 的作用**：在 aggregator 里，每次 flush 后记录当前 AI 摘要作为下一轮的"触发上下文"，实现因果链追溯——用户为什么会问下一个问题。

---

## 三、聚合策略

### 3.1 一级聚合：Turn → CandidateNode（最多 12 个）

原始 Turn 可能有几十甚至上百个，`compactTurnsToPhases` 按语义规则合并：

**合并条件（满足任一则合并到上一节点）：**
- 低信号用户消息：`user_kind` 为 `choice` 或 `evidence`
- 消息长度 ≤ 18 字符
- 内容匹配轮询/继续类关键词（"ok", "继续", "轮询" 等）
- 纯 UUID/ID 字符串

**强制新建节点条件（满足任一则不合并）：**
- `user_kind` 为 `question` 或 `proposal`（用户主动发起新话题）
- 时间间隔 > 20 分钟
- 上一节点工具调用 + 消息数 > 12

**硬上限**：最多 12 个 CandidateNode。超出时按均匀分桶再合并。

### 3.2 二级聚合：Exchange → ExchangeGroup（每 Phase 最多 12 个）

当用户点击 Phase 节点展开子层时，该 Phase 的 `exchanges[]`（可能有几十条）再次聚合：

```typescript
function groupExchanges(exchanges: TraceExchange[], maxGroups = 12): ExchangeGroup[]
```

聚合规则：
- `question`/`proposal` 类型的 exchange → 作为新组的边界
- 超出 12 组时均匀分桶
- 每组产生一个合成 `TraceExchange`（取第一条的 user_message，最后一条的 assistant_summary）

---

## 四、子节点层级（递归展开树）

### 4.1 三层结构

```
Level 0  Phase Node（5-12 个）    ← 整条会话的顶层决策阶段
  Level 1  ExchangeGroup Node     ← Phase 内部的子话题分组（≤12）
    Level 2  Exchange Leaf Node   ← 单轮原始对话（叶子，不再分组）
```

每一层都保持 ≤ 12 个节点，超出就向下推一层。

### 4.2 展开规则

- Phase Node 底部出现「N 轮」按钮（当 `user_message_count > 1` 时）
- 点击展开：子节点在父节点**正下方**横向排列（左 → 右），父节点 → 第一个子节点通过落边（childDropEdge）连接，子节点之间横向链（childLineEdge）连接
- 手风琴行为：展开一个节点时，同级其他节点自动收起

### 4.3 节点 ID 命名规则

```
Phase 节点:       node_1, node_2, ...              （来自 TraceNode.id）
ExchangeGroup:    node_1__g0, node_1__g1, ...       （phaseId + '__g' + index）
Exchange Leaf:    node_1__g0__e0, node_1__g0__e1, ...
```

`__` 分隔层级，用于手风琴逻辑（判断同级 = 相同父路径 + 相同深度）。

### 4.4 布局算法（横向树）

使用自定义树宽度算法（非 dagre），保证父节点的 X = 子树起始 X：

```
subtree_width(node) = max(NODE_W, Σ subtree_width(children) + gaps)
Phase[i].x = Σ(subtree_width(Phase[0..i-1])) + gaps
```

这保证右侧 Phase 节点自动跟子树宽度对齐，不重叠。

---

## 五、摘要处理

### 5.1 AI 回复摘要（本地 fallback）

无 LLM 时，`summarizeAssistantActivity` 把该 Turn 的所有 assistant 文字消息合并成摘要：

```typescript
const texts = messages
  .map((m) => m.payload.text ?? '')
  .filter((t) => t.trim().length > 0)
const combined = texts.join(' ')
return compactText(combined, 120)  // 截断到 120 字符
```

注意：取**所有**非空回复合并（不是只取第一条），避免多轮回复信息丢失。

### 5.2 LLM 摘要（有 API key 时）

整条轨迹**一次** LLM 调用，让模型看到完整上下文后输出每个节点的：
- `conclusion`（15 字以内）：该阶段完成了什么
- `goalAlignment`（0-10）：与原始目标的相关程度

Prompt 结构（每个候选节点一行）：

```
总目标：「...」

[0] 用户：「...」
    [上一步 AI 说]：「...」   ← prev_ai_summary（因果链）
    模型：tool1, tool2 | 回复：「...」

[1] 用户：「...」
    ...

请为每条生成 conclusion 和 goalAlignment，返回 JSON 数组。
```

### 5.3 目标归一化

第一条用户消息可能很长，`normalizeGoalAnchor` 用 LLM 提炼成 ≤ 20 字的核心目标句。无 API key 时直接截断原文。

---

## 六、Todo、Plan 与目标距离

### 6.1 Todo 数据

来源：`TodoWrite` 工具调用，`kind = 'todo'`，`payload.input.todos` 是全量数组（每次写入覆盖）。

**治理方式**：
- 全局层面：`aggregator` 去重后输出 `planItems[]`，显示在侧边栏
- 节点层面：`NodeCard` 取该节点 `event_ids` 内**最后一个** `todo` 事件（最新状态），展示当前 Todo 快照

```typescript
const last = todoEvents[todoEvents.length - 1]
const todos = last.payload.input.todos  // 全量当前状态
```

**显示优先级**：进行中 > 待完成 > 已完成（已完成灰化 + 删除线）。

### 6.2 Plan 数据

来源：消息内容中解析出的计划条目，`kind = 'plan'`，`payload.items[]`。

**治理方式**：
- 全局层面：同样汇入 `planItems[]` 侧边栏
- 节点层面：`NodeCard` 收集该节点内所有 `plan` 事件的 items，去重后按 `depth` 缩进显示

Plan 用于 `matchToPlan` 对齐：用余弦相似度判断节点是否在执行某个计划项（`alignment: 'on_track'`）。

### 6.3 Goal Distance（目标距离）

**计算方式（两套）：**

**有 LLM 时**：`goalAlignment` 由模型打 0-10 分，转换为距离：
```typescript
goal_distance = 1 - goalAlignment / 10
```

**无 LLM 时（余弦相似度 fallback）**：
```typescript
function computeGoalDistance(goalText: string, nodeText: string): number {
  return 1 - cosine(tokenize(goalText), tokenize(nodeText))
}
```
对中英文分词，过滤停用词，计算词频向量余弦相似度。

**可视化映射：**

| goal_distance | 颜色 | 含义 |
|---------------|------|------|
| < 0.35 | 绿色 | 紧贴目标 |
| 0.35 ~ 0.65 | 黄色 | 中性 |
| > 0.65 | 橙色 | 偏离目标 |

**GoalAnchorBar 行为**：最近 3 个节点中任意一个 goal_distance ≥ 0.65 时，锚点变橙色并轻微脉动，提示「当前行为与起始目标距离拉大，是有意为之吗？」

**子层级的 goal_distance**：ExchangeGroup/Exchange 节点的 goal_distance 是相对于所在 Phase 的目标（`conclusion ?? user_message`）计算，而非顶层目标。每一层都有自己的"子目标距离"。

---

## 七、语义分支检测

会话中若干连续节点明显偏离主目标，被检测为"偏离分支"：

**检测逻辑（fallback，无 LLM）**：
- 连续 2+ 个节点 `goal_distance ≥ 0.62` → 开始分支
- 遇到 `goal_distance < 0.38` → 结束分支
- 分支最小长度 2 个节点

**布局**：分支节点水平排列在主线**上方**（Y = -260px）或**下方**（Y = +230px），交替排列，不占主干空间。主干 Phase 节点不受分支影响。

---

## 八、多会话时间线

多个 JSONL 文件可作为独立会话加载，按时间戳对齐展示在同一横轴：

```
X 轴 = (node.ts_start - globalMin) / totalRange × 3200px
Y 轴 = sessionIndex × LANE_HEIGHT（每会话独立泳道）
```

每个会话有独立颜色，节点用 `TimelineNode`（紧凑样式）渲染。

---

## 九、嵌入为子应用

### 核心 Pipeline（可独立复用）

```typescript
// 1. 解析
const { events, goalAnchor } = parseClaudeCodeJsonl(jsonlContent)

// 2. 聚合（输出候选节点，不依赖 LLM）
const { candidates, planItems } = aggregate(events)

// 3. LLM 解析（可选，无 API key 时降级为本地 fallback）
const traceNodes = await interpretTrace(candidates, events, goalAnchor, planItems, config, onProgress)

// 4. 分支检测（可选）
const finalNodes = await detectBranches(traceNodes, goalAnchor, config)

// 5. 投影为图数据（含展开状态）
const graphData = projectExpandableTree(finalNodes, expandedNodes, goalAnchor, collapsedBranches)
```

### 关键外部依赖

- `@xyflow/react`：图渲染（可替换为其他图库，仅需实现 `GraphData` 接口）
- `dagre`：已移除（现用自定义树布局）
- DeepSeek API（OpenAI 兼容）：可替换为任意 OpenAI 兼容 endpoint

### 状态管理约定

- 所有处理逻辑封装在 `useTraceProcessor` hook，无全局状态
- 图展开状态（`expandedNodes: Set<string>`）由宿主应用管理
- 节点选中（`selectedNodeId`）由宿主管理，NodeCard 作为受控组件

---

## 技术栈

- React 18 + TypeScript + Vite（SPA，后续迁入 Next.js）
- @xyflow/react（React Flow v12）
- Tailwind CSS（暗色主题）
- DeepSeek API（OpenAI 兼容接口）

## 开发

```bash
npm install
npm run dev      # 启动开发服务器
npm run build    # 构建
```
