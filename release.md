# agent-chat — 发版指南

## 版本号规则

| 变更类型 | 版本变化 | 示例 |
|---|---|---|
| Bug 修复 | z +1 (patch) | v1.0.0 → v1.0.1 |
| 包含 FEAT | y +1, z → 0 (minor) | v1.0.1 → v1.1.0 |
| 重大架构变更 | x +1, y/z → 0 (major) | v1.1.0 → v2.0.0 |

新版本由用户主动声明开启,Claude 不自行开新版本。

## 分支策略

| 分支类型 | 命名规则 | 用途 |
|---|---|---|
| 主干 | `master` | 稳定代码,永远可部署 |
| 功能开发 | `dev/vX.Y.0` | 一个 minor 版本的所有 FEAT |
| Bug 修复 | `fix/vX.Y.Z` | 一个 patch 版本的 BUG 修复 |
| 个人特性 | `feat/FEAT-XXX-short-desc` | 单个 FEAT 的开发分支 (可选) |

## Commit 格式

```
FEAT-XXX: <简短描述>
BUG-XXX: <简短描述>
chore: <描述>          # 无关 FEAT/BUG 的杂项
protocol: BREAKING ...  # 协议层破坏性变更
```

## 发版检查清单

### 1. Pre-flight

- [ ] 所有 FEAT/BUG 在分支上有 commit 且 ID 前缀格式正确
- [ ] `pnpm -r typecheck` 通过
- [ ] `pnpm -r test` 通过
- [ ] `pnpm -r build` 通过

### 2. 更新文档

- [ ] `changelog.md` — 添加版本条目,列出 FEAT/BUG
- [ ] `project_feature_list.md` — 本版本 FEAT 状态改为「已回归」
- [ ] `project_bug_list.md` — 本版本 BUG 状态改为「已修复」

### 3. 合并到 master

```bash
git checkout master
git merge --no-ff <branch> -m "Merge branch '<branch>' — vX.Y.Z release"
```

`--no-ff` 必须使用,保留分支拓扑。

### 4. 打 Tag

```bash
MERGE_SHA=$(git rev-parse HEAD)
git tag -a vX.Y.Z $MERGE_SHA -m "vX.Y.Z: 改动1 + 改动2 + ..."
```

Tag 必须打在 merge commit 上,不是最后一个 dev commit。

### 5. Push

```bash
git push && git push --tags
```

### 6. 清理

```bash
git branch -d <branch>           # 安全删除,只删已合并的
```

### 7. 下一个版本

提醒用户声明下一个版本号。Claude 不自行开新版本。

## 注意事项

- 绝不 `git push --force` on master
- Tag 必须在 merge commit 上
- 新版本由用户主动声明,Claude 不主动开
- `git branch -d` (小写 d) 是安全的,拒绝删除未合并分支
