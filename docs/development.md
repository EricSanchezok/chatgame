# 开发指南

## 前置条件

- Git
- Node.js 22 或受依赖支持的更新 LTS

## 工作流

1. 阅读根 `AGENTS.md` 和与改动相关的当前规格。
2. 非平凡改动在同一变更更新 `docs/decisions/`；已发布缺陷同时写 postmortem。
3. 代码标识符与注释用英文，文档和决策记录用中文。
4. 每完成一个可独立验证的工作单元，按触碰表面运行测试，并立即创建只包含当前任务改动的本地 commit；pre-commit hook 强制运行四个治理门禁。
5. 用户明确要求不 commit、只评审或只诊断时不创建 commit；未完成、门禁失败或无法与其他未提交改动安全分离时，说明原因并保持未提交。
6. 本地 commit 是防丢与回滚检查点；未经用户明确要求不 push。

## 配置

- `LIVINGWORLD_DATA_ROOT`：本地数据目录，默认 `.livingworld/`；世界版本、会话与 WorldRun 统一存放在 `livingworld.sqlite`。
- `LIVINGWORLD_MODEL_CATALOG_PATH`：完整模型目录，默认 `config/models.yaml`。
- 每个 provider 的密钥环境变量由目录 `api_key_env` 指定；仅当世界或 Agent 实际引用该 provider 的 Profile 时才要求对应密钥。仓库参考世界只需要 `DEEPSEEK_API_KEY`。
- `npm run dev` 默认启用 `full` 运行日志；显式设置 `LIVINGWORLD_OBSERVABILITY=off|metrics|full` 可以覆盖，测试与生产未显式配置时默认关闭。模式、目录、敏感数据边界、segment 与总量配置见 [运行时可观测性](game-design/runtime-observability.md#模式与-payload-所有权) 和 [文件 sink、轮转与健康](game-design/runtime-observability.md#文件-sink轮转与健康)。

模型、思考强度、超时、输出上限、角色与并发只在 [模型目录与 Gateway](game-design/model-gateway.md) 定义。环境变量不提供逐字段覆盖。

性能基线使用 `npm run diagnose:runtime -- --agents 1,10,50 --steps 1,10,100`；真实供应商采样使用 `npm run diagnose:live -- --steps 3`。命令输出契约见 [运行时可观测性](game-design/runtime-observability.md#诊断命令)。

## 关键约束

引擎保持服务端；公共 DTO 放在 `src/shared/world-api.ts`。不要重新引入动作枚举、旧存档迁移、剧本可执行代码、浏览器端 truth 或第二套状态提交路径。前端组件只消费 `--cg-*` 颜色变量。
