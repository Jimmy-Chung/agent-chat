# agent-chat

Agent 友好型个人 IM — Web/PWA 形态，用 iMessage 般的对话外壳承载 AI Agent 的复杂工作流。

## 系统架构

```
浏览器 (PWA) ──WSS──→ Cloudflare Workers (server) ──WSS/HTTP──→ PI Adapter (另台电脑, CF Tunnel 暴露)
  前端页面            D1 + Durable Objects                   Agent 执行引擎
```

- **前端页面**：Next.js 15 (App Router) PWA，部署在 Cloudflare Pages
- **Server**：Cloudflare Workers（Hono + Durable Objects + D1），负责 WebSocket 网关、消息路由、数据持久化
- **PI Adapter**：运行在另一台电脑上，通过 Cloudflare Tunnel 暴露外网地址（`pi-adapter.jimmy-jam.com`），server 通过 WSS + HTTP 协议连接 adapter 进行 Agent 会话管理与事件转发

## 技术栈

- 前端: Next.js 15 (App Router) + React 19 + TypeScript 5 + Tailwind v4 + Zustand
- Server: Hono + Cloudflare Workers + Durable Objects + D1 + drizzle-orm
- 协议层: `packages/protocol` — 纯 TS 类型 + zod schema
- Markdown: react-markdown + remark-gfm + shiki
- 工具: pnpm 9 + Biome (代替 ESLint+Prettier)
- Mock: `packages/mock-pi` — 本地模拟 PI Agent

## 仓库布局

```
agent-chat/
├── packages/protocol/    ← 共享 TS 类型 + zod schema
├── packages/server/      ← Cloudflare Workers 后端
├── packages/web/         ← Next.js 前端
├── packages/mock-pi/     ← 本地 mock PI server
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
└── .omc/plans/           ← 设计文档 (只读参考)
```

## 开发约定

- 所有 visual 值用 CSS 变量 (design tokens)，颜色/圆角/间距/字号/阴影一律 `var(--xxx)`
- 不写死 PI 远端地址，走 `process.env.PI_ADAPTER_URL`
- Token 鉴权: `AGENT_CHAT_TOKEN`，前端 localStorage + Bearer header
- 每步骤完成后跑 typecheck + smoke 测试再进下一步
- 涉及 PI Agent 侧改动的需求，在 Linear issue 中用 `[external]` 标记
- 详细设计文档在 `.omc/plans/`，关键文件:
  - `agent-chat-design.md` — 完整工作计划 (架构/数据模型/协议/UI/风险/验收)
  - `autopilot-execution-plan.md` — Part 1 执行步骤 (7 步)
  - `pi-agent-requirements.md` — PI Agent 侧改动需求 (**本仓库不实现，另仓库处理**)
  - `ui-brief.md` — UI 视觉与交互规范
  - `test-plan.md` — 测试计划

## 调试日志

| 端 | 地址 |
|---|---|
| 本项目 (server) | `https://agent-chat-server.jimmychung038.workers.dev/server-logs` |
| 对端 (PI Adapter) | `https://workspace-pi-adapter.jimmy-jam.com/logs` |

排查消息链路、session 建立、PI 事件转发问题时优先结合两边的日志入口定位。

## PI Agent 连接

| 环境 | 地址 |
|---|---|
| 本地 (mock-pi) | `ws://127.0.0.1:7331/api/agent-chat/v1/socket` |
| 远程 (PI Agent) | `wss://pi-adapter.jimmy-jam.com/api/agent-chat/v1/socket` |
| 健康检查 | `https://pi-adapter.jimmy-jam.com/healthz` |
| Token | `***` |

默认使用真实 PI Agent（通过 `PI_ADAPTER_URL` 环境变量），除非用户明确要求使用 mock-pi。

启动开发环境：
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

## 发版 — 版本号同步位置

发版流程见全局 CLAUDE.md（四、五）。每次发版必须同步更新以下文件：

- `packages/web/src/components/layout/Sidebar.tsx` — 界面显示的版本号
- `changelog.md` — 新增版本条目
- Linear milestone — 版本内所有 issue 状态

## 链路测试（通讯协议变更强制）

**每次通讯协议相关变更（protocol 层 schema、PI 事件类型、WS 帧格式、RPC 接口）必须跑完以下全部测试，全绿才能合并。**

### R-006 链路压力测试

```bash
pnpm -F server dev                # 先启动 server + adapter
pnpm -F server test:link-stress   # 再跑压测
```

脚本位置：`packages/server/scripts/link-stress.ts`
场景定义：`packages/server/scripts/link-stress/scenarios.ts`

### R-007 链路分层验证

```bash
npx tsx packages/server/scripts/link-stress/link-verify.ts [l0|l1-1|l1-2|l2|l3|all]
```

### 常规回归

```bash
pnpm -r test       # 单元测试必须全绿
pnpm test:e2e      # E2E 测试必须全绿
```

当前回归覆盖：鉴权 (R-001)、消息链路 (R-002)、话题独立 WS (R-003)、删话题清理 (R-004)、断线重连 (R-005)、链路压测 (R-006)、链路分层验证 (R-007)。详见 `.omc/plans/test-plan.md`。

## 需求讨论模式

本项目在跨系统讨论中的角色：**agent-chat**。多系统协作协议见全局 CLAUDE.md（六）。
