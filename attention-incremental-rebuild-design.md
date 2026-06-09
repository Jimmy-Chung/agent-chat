# Attention 面板：增量重建设计（敲定版）

日期：2026-06-09
状态：已讨论敲定，待开工
取代：`attention-incremental-rebuild-discussion.md` 中的「选项 B」（其「冻结路由 / 增量布局」方向会破坏多层 rollup，已废弃）

---

## 0. 核心结论一句话

**只冻结 LLM 层（每个节点的语义解释），结构层每次全量重跑。**

结构层（aggregate → 路由 → compact → 布局）是纯本地、确定性、毫秒级的，重跑没有成本；而且**必须**重跑——多层 rollup 和「新节点对完整主线比对」都依赖它每次重新涌现。贵且会漂移的只有 LLM 解释，它才是冻结对象。

---

## 1. 代码事实依据（为什么能这么设计）

调查 `packages/protocol/src/attention/` + `packages/server/src/routes/attention.ts` 得到：

1. **整棵树的结构（分组 / 嵌套 / 多层 compact）100% 确定性，不调 LLM。**
   - `decideRoute`（conversation-tree.ts:433）只读 `tokenSimilarity` + `goal_distance` + `user_kind` + child 数阈值。
   - 多层 rollup = `enforceLayerLimits`（:406）递归自身（:427-430），纯本地。
2. **LLM 对结构的唯一影响 = 每节点一个标量 `goal_distance`**，由 `goalAlignment`（0-10）经 `goalAlignmentToDistance` 映射（orchestrator.ts:79）。
3. **`goalAlignment` 相对「总目标」判定**（attention.ts:61「与总目标的相关程度」），是节点内在属性，判定只需「目标 + 该节点」，不需邻居 → 天生可冻结、可严格增量。
4. **`sameTopic`/`closeCurrentTopic` 虽由 LLM 产出（依赖邻居上下文），但树和投影器一次都没消费**（grep 确认仅在 web/orchestrator.ts 透传）。唯一带邻居非确定性的字段，对真实结构零影响。
5. **compact 节点标题当前是机械模板**：`'已 compact：' + 第一个子节点标题`（conversation-tree.ts:344），不概括内容。
6. **根目标节点文字 `normalized_goal`** 来自话题第一条 user 消息（store-adapter.ts:113），可被 LLM 的 `normalizedGoal` 每次重新措辞覆盖（orchestrator.ts:68）→ 是结构层唯一会漂移的非确定输入。

---

## 2. 敲定的规则

### R1 · LLM 层冻结（每节点）
- 冻结字段：`goalAlignment`→`goal_distance`、`userSummary`、`assistantSummary`、`aggregateTitle`。
- 每次 rebuild 只对**新增节点**调 LLM；已冻结节点直接复用，永不重读原文。
- 冻结 key = **节点的 `source_message_ids` 集合 hash**（不是合成的 `cand_N` id，后者在 >12 重分桶时会变）。同一组 source 消息复现 → 命中复用；成员变化 → 视为新节点，重算一次（与 compact 标题同理）。

### R2 · 结构层每次全跑（不冻结）
- `aggregate` → `decideRoute` → `enforceLayerLimits` → mind-map projector → layout 全量重算。
- 纯本地、确定性：输入（冻结的 `goal_distance` + 节点文字）不变 → 输出稳定，节点数不再漂移。
- **必须全跑**：新节点 D 的归属是拿冻结的 A/B/C 文字 + D 重新算主线相似度（`topicText` 聚合主线全部 turn 文字，conversation-tree.ts:250-269）；多层 rollup（A1.1+A1.2+A1.3→A1）也靠它每次重新涌现。冻结结构 = 破坏这两者。

### R3 · 根目标节点钉死
- 根目标节点文字（`normalized_goal`）**第一次定下后钉死**，之后 rebuild 不再让 LLM 重新措辞。
- 仅当**用户主动修改目标**时更新。
- 目的：让 `decideRoute` 的主线比对基准恒定，消除新节点归属的无故抖动。

### R4 · 全量重建的唯一触发器 = 目标变更
- 用户改目标 → 所有冻结的 `goal_distance`（相对旧目标判定）失效 → 触发一次全量 LLM 重解释。
- 此外不存在自动全量重建。
- 长期保留「重新分析」手动按钮作为兜底（修正错误冻结 / 跨收束话题重聚合等罕见 case）。

### R5 · compact 节点标题：LLM 生成 + 按成员集合冻结
机械前缀表达不了「聚了什么」，改为 LLM 生成有意义标题。**两段式**，保持 protocol 纯净：

```
结构层（纯，protocol）：建树时遇 compact 组，产出
    { membershipKey = sorted(childNodeIds) hash, childTitles(按权重/关联度排序), 占位标题 }
    —— 不调 LLM
            ↓
标题层（orchestrator，紧挨现有 interpret 调用）：
    按 membershipKey 查冻结库
      命中 → 用冻结标题
      未命中 → 批量调 LLM（喂子标题，产一条标题）→ 写回冻结库
```

- **冻结 key = 成员集合 hash**：同一分组永久同一标题；分组成员一变（chunk 边界挪）→ 重新生成（它现在概括的是不同内容，本就该变）。
- **可异步 / 懒填**：面板先显示机械占位「已 compact：…」，LLM 标题落库后替换，永不阻塞建树。
- **可退化**：LLM 失败（timeout/parse_error）→ 退回机械模板，与现有 `degraded_reason` 容错一致。
- **多层自动成立**：高层 compact 喂的是下层**已冻结的标题**，每层成本恒定 → 天然产出「A1」这类有意义父标题。

### R6 · 消息删除 / 编辑（近期不支持）
- 当前系统无删改消息功能 → 冻结库无需失效校验，实现大幅简化。
- 标注为未来工作：若将来支持删改，需对冻结库（按 `source_message_ids`）做失效校验，被删改消息所属节点的冻结结果作废重算。

---

## 3. 改造面（实现清单）

| 模块 | 改动 |
|---|---|
| `aggregator.ts` | 照常全量产候选（纯本地，便宜）。不需 `sinceEventId`。 |
| interpret（server `attention.ts` / `orchestrator.ts`） | 只对未冻结候选（按 `source_message_ids` key 未命中者）调 LLM；结果与冻结结果按 key 合并 |
| `buildTrace`（orchestrator） | 用「新解释 + 冻结解释」合并后的结果建 trace node |
| `conversation-tree.ts` | 保持纯；`enforceLayerLimits` 产出 compact 组的 `{membershipKey, childTitles}` 供标题层消费；`normalized_goal` 改为读钉死值 |
| 新增 · 标题层 | compact 标题的查/批量生成/冻结/退化（在 orchestrator 层） |
| 存储 | 见 §4 |

---

## 4. 存储（待最终选型，建议如下）

两类冻结数据，建议都按 key 存、支持节点级读写（而非整条 JSON 覆盖）：

1. **节点解释冻结库**：key = `source_message_ids` hash，value = `{goalAlignment, userSummary, assistantSummary, aggregateTitle}`。
2. **compact 标题冻结库**：key = 成员集合 hash，value = `title`。

落地形态二选一：
- **A**（建议）：新增 `attention_trace_nodes` 表，节点一行，含上述冻结字段 + key。读写粒度细，天然支持增量。
- **B**：沿用快照大 JSON，但在节点级加 `frozen: true` 标记 + key 字段。改动小，但每次仍整条覆盖写。

---

## 5. 成本特征

- **LLM 调用**：每次 rebuild 仅解释新增 1-2 个节点（prompt 恒定）+ 偶发的 compact 标题（仅分组变化时，批量一次）。**不随话题长度增长。**
- **本地结构层**：全量重跑，毫秒级，确定性。
- **超时 / parse_error**：随 prompt 恒定而消失（当前 DB 里的 `timeout`/`parse_error` 记录正是全量膨胀所致）。

---

## 6. 仍开放 / 待确认

- §4 存储选型 A vs B（工程选型，开工时定）。
- compare 时「按权重和关联度」给 compact 标题层排序子标题——权重用 turnCount / goalDistance / recency 哪个，prompt 构造细节，实现时定。
