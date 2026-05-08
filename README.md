# agent-chat

Agent 友好型个人 IM — Web/PWA,用对话外壳承载 AI Agent 的复杂工作流(流式输出/工具调用/文件修改/审批/定时任务/产物管理)。

## 安装

```bash
pnpm install
```

## 启动开发

```bash
# 三服务同时启动
pnpm dev

# 或分别启动
pnpm -F mock-pi dev    # Mock PI: ws://127.0.0.1:7331
pnpm -F server dev     # 后端: http://127.0.0.1:8080
pnpm -F web dev        # 前端: http://localhost:3000
```

## 常用命令

```bash
pnpm -r typecheck      # 类型检查
pnpm -r build          # 构建
pnpm -r test           # 测试
pnpm format            # 格式化
```
