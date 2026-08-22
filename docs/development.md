# 开发指南

## 前置条件

- Git
- Node.js 22 或受依赖支持的更新 LTS

## 工作流

1. 阅读根 `AGENTS.md` 和与改动相关的当前规格。
2. 非平凡改动在同一变更更新 `docs/decisions/`；已发布缺陷同时写 postmortem。
3. 代码标识符与注释用英文，文档和决策记录用中文。
4. 按触碰表面运行测试；提交前必须运行四个治理门禁。
5. 未经用户明确要求不 commit 或 push。

## 配置

- `CHATGAME_SCRIPTS_ROOT`：安装世界目录，默认 `scripts/`。
- `CHATGAME_DATA_ROOT`：会话数据目录，默认 `.chatgame/`。
- `CHATGAME_LLM_PROVIDER`：`vercel` 或仅测试用的 `mock`。
- `CHATGAME_LLM_BASE_URL`、`CHATGAME_LLM_API_KEY`、`CHATGAME_LLM_MODEL`：OpenAI-compatible provider。
- `CHATGAME_TRUTH_MODEL`、`CHATGAME_AGENT_MODEL`：分别覆盖裁判与 AgentMind 模型。

## 关键约束

引擎保持服务端；公共 DTO 放在 `src/shared/world-api.ts`。不要重新引入动作枚举、旧存档迁移、剧本可执行代码、浏览器端 truth 或第二套状态提交路径。前端组件只消费 `--cg-*` 颜色变量。
