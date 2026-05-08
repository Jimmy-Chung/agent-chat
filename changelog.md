# Changelog

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
