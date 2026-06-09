# Attention 面板：全量重建 vs 增量重建

日期：2026-06-08

## 背景

当前 Attention 面板的 rebuild 机制是**全量重建**：每次话题有新消息且 agent 进入 idle 后，前端调 `POST /rebuild`，服务端把所有消息重新转为 RawEvent、重新聚合为候选节点、全部塞进 LLM prompt 让 DeepSeek 解释、重新构建 trace nodes、重新走 conversation tree 路由、重新布局 mind map。

**问题**：消息数线性增长 → LLM prompt 线性膨胀 → 超时/解析失败概率上升 + token 成本线性增长 + 旧节点的 `goalAlignment`/`conclusion`/`branch|main` 可能因为上下文变化而漂移。

## 两个选项

### 选项 A：保持全量重建（现状）

**做法**：不动。

**优点**：
- 实现简单，无状态管理复杂度
- 每次结果自洽（同一次 LLM 调用内所有节点的 interpretation 共享同一上下文）
- 如果 LLM 对旧节点的判断确实需要修正（比如后续消息揭示了之前理解有误），全量重建能自动修正

**缺点**：
- **成本线性增长**：消息数 N → prompt 约 N×200 tokens → 每次 rebuild 的 LLM 调用费随话题长度攀升
- **超时风险**：长话题的 prompt 可能触发 60s 超时（DB 里已有 `degraded_reason: timeout` 的记录）
- **解析风险**：prompt 越长，DeepSeek 返回不合规 JSON 的概率越大（DB 里已有 `degraded_reason: parse_error`）
- **旧节点漂移**：用户看到第 3 个节点的 `goalAlignment` 上次是 8，这次变成 5，不可解释
- **浪费**：前面 8 个节点的 LLM 结果已经写入过快照，下次 rebuild 又全部重算一遍

### 选项 B：改为增量重建

**做法**：
1. **冻结旧节点的 LLM 结果**：快照里已有的候选节点（按 `id` 匹配），复用 `conclusion`/`goalAlignment`/`userSummary`/`assistantSummary`/`aggregateTitle`/`sameTopic`/`closeCurrentTopic`
2. **只对新候选调 LLM**：`buildInterpretPrompt` 只包含上次快照没有的新候选，prompt 大小恒定（≈ 1-2 个候选）
3. **冻结旧节点的路由**：`governConversationTree` 里已有 `relation` 的节点不重新跑 `decideRoute`，新节点追加
4. **增量布局**：旧节点 position 不动，新节点接在末尾
5. **聚合触限时才 compact**：只在直连子节点超过阈值（如 8 个）时对旧节点做 compact，不是每次 rebuild

**优点**：
- **LLM 成本恒定**：不管话题多长，每次 rebuild 只调一次 LLM，prompt 大小恒定（1-2 个候选）
- **不会超时/解析失败**：prompt 不再膨胀
- **旧节点稳定**：用户看到的树不会「无故变化」
- **响应快**：增量 rebuild 几乎即时

**缺点和瓶颈**：

| 问题 | 严重度 | 说明 |
|------|--------|------|
| **错误冻结** | ⚠️ 中 | 如果 LLM 对某个节点的首次解释是错的（比如把支线误判为主线），冻结后永远无法自动修正 |
| **目标变更** | ⚠️ 中 | 用户改了 `attention_target`（目标），旧节点是在旧目标下解释的，需要全部重新解释。解法：目标变更时触发一次全量 rebuild |
| **聚合边界** | ⚠️ 中 | `aggregate()` 中 `compactTurnsToPhases()` 会在候选 >12 时合并旧候选。增量模式下，新增第 13 个候选时，前面 12 个可能需要重新合并。解法：合并只影响被合并的节点，不影响其他已冻结节点 |
| **路由漂移** | 🔴 低 | `decideRoute()` 用 token 相似度做 main/branch 判定。如果新节点的内容改变了主线主题词的分布，旧节点的路由虽已冻结，但新节点的路由仍可能「接错位置」。解法：路由只看最近 N 个节点的主题特征，不受旧节点影响 |
| **布局退化** | 🟡 低 | 增量布局（新节点总接在末尾）可能导致视觉上不理想。解法：每 N 次增量重建后做一次全量重布局（不含 LLM，只重算 position） |
| **缓存一致性** | ⚠️ 中 | 如果消息被删除或修改，候选节点可能不再对应任何真实事件。当前没有消息删除功能，但未来需要考虑。解法：消息变更时校验候选节点是否还有效，无效则移除 |
| **goalDistance 漂移** | 🟡 低 | `goalDistance` 的一部分来自 LLM 的 `goalAlignment`（冻结了），另一部分来自 `computeGoalDistance()` 的本地相似度计算（不冻结）。增量模式下本地计算的结果可能因新增主线文本而变化。解法：冻结时连 goalDistance 一起冻结，不在后续 rebuild 中重新计算 |
| **DB 存储** | 🟡 低 | 当前快照是整条 JSON 覆盖写。增量模式需要支持按节点读写。解法：新增 `attention_trace_nodes` 表，每个节点一行；或者快照 JSON 中维护节点级别的 `frozen: true` 标记 |

## 建议

**短期**（v1.12 之前）：改增量。

核心原因：当前最大的痛点是「长话题 rebuild 经常 degraded」。`01KTJRZ310...`（26 条消息 → `parse_error`）和 `01KTH3N35...`（55 条消息 → `timeout`）就是证据。随着话题越来越长，全量 rebuild 会越来越不可靠。

增量改造的范围可控：
- `aggregate()` 增加 `sinceEventId` 参数，只处理新事件
- `buildInterpretPrompt()` 增加 `skipCandidateIds` 参数，过滤已解释的候选
- `buildTrace()` 增加 `existingNodes` 参数，旧节点复用，新节点追加
- `governConversationTree()` 增加 `frozenRelationMap`，旧节点跳过路由
- `upsertAttentionGoalSnapshot()` 支持部分更新

**长期**：全量重建仍保留为「修复」入口。用户可在面板中手动触发「重新分析」，走一次全量 rebuild，用于修正错误冻结或目标变更后的重算。

## 待讨论

1. **「消息删除/编辑」是否需要**？如果不需要，缓存一致性简单很多。
2. **目标变更**是否总是触发全量 rebuild？还是用户手动触发？
3. **冻结粒度的选择**：冻结到 candidate 级（一次用户消息对应一个候选节点），还是冻结到 turn 级？
