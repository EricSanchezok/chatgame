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
- `CHATGAME_MODEL_CATALOG_PATH`：完整模型目录，默认 `config/models.yaml`。
- 每个 provider 的密钥环境变量由目录 `api_key_env` 指定；默认目录需要 `DEEPSEEK_API_KEY`、`OPENAI_API_KEY` 与 `XAI_API_KEY`。

模型、思考强度、超时、输出上限、角色与并发只在 [模型目录与 Gateway](game-design/model-gateway.md) 定义。环境变量不提供逐字段覆盖。

## 关键约束

引擎保持服务端；公共 DTO 放在 `src/shared/world-api.ts`。不要重新引入动作枚举、旧存档迁移、剧本可执行代码、浏览器端 truth 或第二套状态提交路径。前端组件只消费 `--cg-*` 颜色变量。
