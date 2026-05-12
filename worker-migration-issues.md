# v1.2.0 Workers 迁移问题记录

## 背景

将 server 从 Node.js (Fastify + ws + better-sqlite3) 迁移到 Cloudflare Workers (Hono + D1 + Durable Objects)。

## 问题清单

### 1. Token 鉴权失败 (test-token)

现象：前端输入 `test-token`，页面提示 token 错误。

原因：Worker 变量 `AGENT_CHAT_TOKEN` 和 `PI_ADAPTER_TOKEN` 需要在 Cloudflare Dashboard 配置 Secret，wrangler.toml 的 `[vars]` 不会自动同步。Dashboard Secrets 优先级高于 wrangler.toml vars。

解决：在 Dashboard 手动添加 Secret 后恢复正常。

### 2. Worker Route 不匹配 /ws 路径

现象：WebSocket 连接返回 404。

原因：Worker Route 配置为 `/ws/*`，只匹配 `/ws/xxx`，不匹配 `/ws` 本身。

解决：Route 改为 `/ws*`，同时匹配 `/ws` 和 `/ws?token=xxx`。

### 3. Pages 项目不存在

现象：CI 部署 Pages 时报 "project not found" (code 8000007)。

原因：`wrangler pages deploy` 不会自动创建 Pages 项目，需要先通过 Cloudflare REST API 创建。

解决：在 deploy-pages CI 步骤中增加 `curl` 调用 Cloudflare API 创建项目，容错处理 "already exists"。

### 4. Pages:Edit 权限缺失

现象：创建 Pages 项目的 API 调用返回权限错误。

原因：用户创建的 API Token 只有 Workers 权限。

解决：用户在大盘重新创建 Token，添加 Pages:Edit 权限。

### 5. D1 D1_EXEC_ERROR: incomplete input

现象：Worker 初始化时报错，migration 执行失败。

原因：`d1.exec()` 不能正确处理分号分隔的多条 SQL 语句，D1 只支持单条 `prepare().run()`。

解决：重写 `migrate.ts`，用 `execEach()` 拆分 SQL 逐条执行，替代所有 `d1.exec()` 调用。

### 6. Duplicate column name: turn_id / plan_mode

现象：ALTER TABLE ADD COLUMN 报重复列名。

原因：之前的部署部分执行了 DDL（列已存在），但 migration hash 未写入成功。重新部署时 migration 尝试再次 ALTER TABLE。

解决：所有 ALTER TABLE 包在 try/catch 中，INSERT migration hash 用 `INSERT OR IGNORE`，确保幂等。最终需要手动清空 D1 数据库重建。

### 7. D1 不支持 CHECK / FOREIGN KEY / AUTOINCREMENT

现象：CREATE TABLE 语句中包含这些约束时报错。

原因：D1 (SQLite) 在线 DDL 模式下不支持 CHECK 约束、外键引用、AUTOINCREMENT。

解决：移除所有 CHECK 约束、FOREIGN KEY 引用、AUTOINCREMENT 关键字。

### 8. nodeCrypto.randomBytes is not a function

现象：Worker 初始化时报 `nodeCrypto.randomBytes is not a function`，WebSocket 无法建立连接。

原因：`ulid` 包生成 ID 时需要随机数。它的环境检测逻辑：
1. 先查 `window.crypto` → Workers 没有 `window` 对象 → 失败
2. 回退 `require("crypto")` → esbuild 打包后 `randomBytes` 不可用 → 报错

Workers 实际有 `crypto.getRandomValues()`（Web Crypto API），但 ulid 不会去那里找。

当前方案：用 Web Crypto 重写了 ULID 实现（30 行），替换 ulid 包。两个替代思路：
- 一行 polyfill：`globalThis.window = globalThis`，让 ulid 的浏览器检测生效
- 直接换 `crypto.randomUUID()`，ID 格式从 ULID 变 UUID

### 9. Node.js 版本不匹配

现象：本地无法运行 `wrangler deploy --dry-run` 调试。

原因：Wrangler 要求 Node.js >= 22，本地环境为 Node.js 20。

影响：无法在本地预览 Worker 打包结果，调试依赖 CI 部署循环。

### 10. wrangler.toml [vars] 不生效

现象：wrangler.toml 中配置的变量在 Worker 中读取为空。

原因：Cloudflare Dashboard Secrets 优先级高于 wrangler.toml vars。一旦 Dashboard 有同名 Secret，wrangler.toml 的值被覆盖。

结论：所有敏感变量统一走 Dashboard Secret 管理，wrangler.toml 不配置任何 `[vars]`。

### 11. FTS5 porter tokenizer 导致 Worker 每次冷启动 500

现象：Worker 初始化失败，所有请求返回 500，前端显示"Token 错误？"。

原因：`migrate.ts` 末尾 `CREATE VIRTUAL TABLE messages_fts USING fts5(..., tokenize = 'porter unicode61')` 无 try/catch，D1 不支持 porter tokenizer 时直接抛出，`runMigrations()` 每次都失败。

解决：tokenizer 改为 D1 确定支持的 `unicode61`，加 try/catch 降级处理。

### 12. Deploy workflow 始终部署 dev/v1.2.0 旧代码

现象：GitHub Actions 显示部署成功，但线上 Worker 始终是旧代码（仍报 nodeCrypto 错误）。

原因：GitHub 仓库默认分支为 dev/v1.2.0，deploy workflow 的 `actions/checkout@v4` 无显式 `ref` 时 checkout 默认分支，`workflow_run` 的 `branches: [master]` 过滤器未按预期工作。

解决：两个 deploy workflow 均加 `ref: master`；用 GitHub API 将仓库默认分支改为 master。

### 13. Cloudflare 过滤 Upgrade 头，WebSocket 升级检测失败

现象：带正确 token 的 WebSocket 升级请求返回 426。

原因：Cloudflare CDN 在请求转发给 Worker 时过滤 `Upgrade` 头，`request.headers.get('Upgrade')` 始终返回 null。

解决：改用 `Sec-WebSocket-Key` 头检测 WebSocket 升级，该头不会被 Cloudflare 过滤。

### 14. DO RPC 因 compatibility_date 过旧不可用

现象：调用 `stub.setConfig()` 报 `TypeError: stub.setConfig is not a function`。

原因：Cloudflare DO RPC（直接通过 stub 调用 DO 方法）需要 `compatibility_date >= 2024-04-05`，wrangler.toml 配置为 `2024-01-01`。

解决：wrangler.toml `compatibility_date` 改为 `2024-04-05`。

---

## 架构层面的问题

迁移到 Workers 引入的额外复杂度：

- esbuild 打包行为不可预期：动态 `require()`、Node.js 内置模块的 shim 质量参差不齐
- D1 不是完整的 SQLite：DDL 限制多，语法差异需要逐个适配
- Durable Objects 的 WebSocket 模型与原始 ws 差异大，调试困难
- 本地无法运行 wrangler，调试完全依赖 CI + 线上日志
- Workers 免费计划有新的限制（如 `new_sqlite_classes` 替代 `new_classes`）

原 Node.js 架构 (Fastify + ws + better-sqlite3) 不存在上述问题。
