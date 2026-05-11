# agent-chat

Agent 友好型个人 IM — Web/PWA 形态,用 iMessage 般的对话外壳承载 AI Agent 的复杂工作流。

## 技术栈

- 前端: Next.js 15 (App Router) + React 19 + TypeScript 5 + Tailwind v4 + Zustand
- 后端: Node 22 + TypeScript + Fastify 5 + ws + better-sqlite3 + drizzle-orm
- 协议层: `packages/protocol` — 纯 TS 类型 + zod schema
- Markdown: react-markdown + remark-gfm + shiki
- 工具: pnpm 9 + Biome (代替 ESLint+Prettier)
- Mock: `packages/mock-pi` — 本地模拟 PI Agent

## 仓库布局

```
agent-chat/
├── packages/protocol/    ← 共享 TS 类型 + zod schema
├── packages/server/      ← Fastify 后端
├── packages/web/         ← Next.js 前端
├── packages/mock-pi/     ← 本地 mock PI server
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
└── .omc/plans/           ← 设计文档 (只读参考)
```

## 外部系统标记

涉及 PI Agent 侧改动的需求，在 `project_feature_list.md` 中用 `[external]` 标记，格式：
```
[external] TODO: 具体改动内容
```
便于搜索 `grep "\[external\]" project_feature_list.md` 快速定位所有外部依赖。

## 调试日志

现在可以通过 `https://logs.jimmy-jam.com/logs` 查看 PI Agent 与 server 交互日志。排查消息链路、session 建立、PI 事件转发问题时优先结合该日志入口定位。

## 开发约定

- 所有 visual 值用 CSS 变量 (design tokens),颜色/圆角/间距/字号/阴影一律 `var(--xxx)`
- 不写死 PI 远端地址,走 `process.env.PI_ADAPTER_URL`
- Token 鉴权: `AGENT_CHAT_TOKEN`,前端 localStorage + Bearer header
- 每步骤完成后跑 typecheck + smoke 测试再进下一步
- 详细设计文档在 `.omc/plans/`,关键文件:
  - `agent-chat-design.md` — 完整工作计划 (架构/数据模型/协议/UI/风险/验收)
  - `autopilot-execution-plan.md` — Part 1 执行步骤 (7 步)
  - `pi-agent-requirements.md` — PI Agent 侧改动需求 (**本仓库不实现,另仓库处理**)
  - `ui-brief.md` — UI 视觉与交互规范
  - `test-plan.md` — 测试计划

## PI Agent 现状

现在已有真实 PI Agent 可连接。默认使用真实 PI Agent（通过 `PI_ADAPTER_URL` 环境变量），除非用户手动指定使用 mock-pi。

- **真实 PI Agent**: 生产环境，server 通过 `PI_ADAPTER_URL` 连接
- **mock-pi** (`packages/mock-pi`): 仅在用户明确要求或单元测试/E2E 测试时使用

## PI Adapter 访问信息

| 环境 | 地址 |
|---|---|
| 本地 (mock-pi) | `ws://127.0.0.1:7331/api/agent-chat/v1/socket` |
| 远程 (PI Agent) | `wss://pi-adapter.jimmy-jam.com/api/agent-chat/v1/socket` |
| 健康检查 | `https://pi-adapter.jimmy-jam.com/healthz` |
| Token | `1234` |

启动开发环境时：
- 连真实 PI: 只启动 server + web（`pnpm -F server dev & pnpm -F web dev`）
- 用 mock-pi: 启动全部三个服务（`pnpm dev`）

## 端口约定

- mock-pi: `127.0.0.1:7331`
- server: `127.0.0.1:8080`
- web (next dev): `127.0.0.1:3000`

## 常用命令

```bash
pnpm install               # 安装依赖
pnpm -r typecheck          # 全量类型检查
pnpm -r build              # 构建
pnpm -r test               # 测试
pnpm format                # 格式化
pnpm dev                   # 三服务同时启动
```

## Bug 清单 (project_bug_list.md)

- 用户报告 bug → 追加至 project_bug_list.md（状态：待修复），ID 递增（BUG-XXX）
- 修复后 → 更新状态为「已修复」，填写根因与修复方案
- 回归测试通过 → 状态置为「已验证」
- 新会话启动时主动提醒是否有待回归条目

## Bug 修复流程

核心原则：先找根因，再动代码。不允许在没读懂代码的情况下试错式改动。

1. 先读相关代码、查日志、追调用链，尝试定位根因
2. 一次"尝试" = 一轮完整调查，最多 5 次
3. 找到根因 → 写入 project_bug_list.md 的根因字段 → 再动代码
4. 5 次仍未定位 → 进入试改模式，在 bug 条目里标注"根因未明"
5. 修复后跑回归；通过 → 状态「已修复」等用户验证；不通过 → 回到第 1 步

## 需求清单 (project_feature_list.md)

- 用户提的需求以 plan 结尾 → 加入 project_feature_list.md 的需求池
- 需求池条目需与用户确认归属版本
- 已开工或做完的临时/未计划需求也必须补录（标注「未计划」）

工作流：
1. 收集 → 追加至需求池（状态：待讨论），分配 FEAT-XXX ID
2. 确认 → 归属版本，状态：已确认
3. 拆测试用例 → 需求确认后同步产出 TC-XXX
4. 开发 → 状态：开发中
5. 回归测试 → 状态：已回归
6. 发版 → changelog 对应条目加上版本号标记

## 发版

发版流程统一维护在 release.md。简要约定：

- 版本号：bug 修复升 z（patch），含 FEAT 升 y（minor）
- 分支：dev/vX.Y.0（功能版本）、fix/vX.Y.Z（修复版本），主干永远是 master
- Commit：一个特性一个 commit，标题格式 FEAT-XXX: <描述> 或 BUG-XXX: <描述>
- 合并：--no-ff merge 到 master
- Tag：annotated tag 打在 merge commit 上
- 新版本由用户主动声明开启，Claude 不自行开新版本

## 回归测试（强制）

每次提交版本（合并到 master / 打 tag）前，**必须**通过回归测试集（`test-plan.md` 中的 R-001 ~ R-005），全绿才能发版。

回归测试必须以单元测试（vitest）或 E2E 测试（Playwright）的形式存在，不允许纯手工验证。

```bash
pnpm -r test       # 单元测试必须全绿
pnpm test:e2e      # E2E 测试必须全绿
```

当前回归覆盖：鉴权 (R-001)、消息链路 (R-002)、话题独立 WS (R-003)、删话题清理 (R-004)、断线重连 (R-005)。详见 `.omc/plans/test-plan.md`。
