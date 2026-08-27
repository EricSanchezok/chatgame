# Living World Engine

Living World Engine（活世界引擎）是剧本驱动的开放世界 AI 游戏引擎。玩家提交的是任意自然语言目标，而不是动作菜单中的 `actionId`；所有自主 Agent 基于各自有限认知同时行动，唯一 Truth Engine 依据世界真相、法则与检定联合裁决，并在每个世界步骤原子持久化。

## 快速开始

```sh
npm install
DEEPSEEK_API_KEY=... npm run dev
```

打开 <http://localhost:3000>。默认[模型目录](docs/game-design/model-gateway.md)注册 DeepSeek、OpenAI 与 xAI；只有世界或 Agent 实际选择某家供应商的 Profile 时才要求对应密钥，缺失时显式失败且不 fallback。仓库参考世界使用 DeepSeek；默认 Truth Engine 与 Agent Profile 均为 `deepseek-v4-flash` 非思考模式。运行时没有默认模型、别名、环境字段覆盖或生产 mock。

`npm run dev` 使用 SQLite Execution Ledger 持久记录完整执行证据；正常运行、Inspector、重放和实验读取同一事实源。数据包含参与者输入与世界秘密，存储和访问边界见[运行时可观测性](docs/game-design/runtime-observability.md)。

仓库中的[参考世界工程](worlds/README.md)提供可审阅、可校验的可玩内容，但应用不会自动安装；初次进入会看到导入入口。用于测试契约的最小世界位于 `test/fixtures/open-world-script/`，不作为产品内容安装。

## 常用命令

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run world:validate -- <world-directory>
npm run world:import -- <world.zip> [--replace]
npm run test:live:deepseek
npm run check:fast
npm run check:all
```

`test:live:deepseek` 使用 Blackmarsh 实际执行 48 个内置 Agent 的无人步骤，再从 Origin 创建一名真人控制角色并提交“我现在在哪里”；两条路径都必须形成 revision。命令只要求世界实际引用的 `DEEPSEEK_API_KEY`，不打印或持久化密钥。

## 从哪里开始读

- [系统架构](docs/architecture.md)
- [世界剧本格式](docs/game-design/script-format.md)
- [Truth Engine 运行时](docs/game-design/engine-runtime.md)
- [模型目录与 Gateway](docs/game-design/model-gateway.md)
- [World Instance API 与参与体验](docs/game-design/presentation.md)
- [决策日志](docs/decisions/README.md)
