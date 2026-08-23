# Living World Engine

Living World Engine（活世界引擎）是剧本驱动的开放世界 AI 游戏引擎。玩家提交的是任意自然语言目标，而不是动作菜单中的 `actionId`；所有自主 Agent 基于各自有限认知同时行动，唯一 Truth Engine 依据世界真相、法则与检定联合裁决，并在每个世界步骤原子持久化。

## 快速开始

```sh
npm install
DEEPSEEK_API_KEY=... OPENAI_API_KEY=... XAI_API_KEY=... npm run dev
```

打开 <http://localhost:3000>。默认 [模型目录](docs/game-design/model-gateway.md) 配置 DeepSeek、OpenAI 与 xAI，因此启动时三个密钥都必须存在。单供应商部署应通过 `LIVINGWORLD_MODEL_CATALOG_PATH` 指向只声明该 provider 与所需 profile 的完整目录。运行时没有默认模型、别名、环境字段覆盖、mock 或供应商 fallback。

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

`test:live:deepseek` 使用测试 fixture 实际执行 AgentMind 初始化和一个 Truth Engine 世界步骤；它读取同一模型目录，因此需要该目录声明的全部密钥，不打印或持久化密钥。

## 从哪里开始读

- [系统架构](docs/architecture.md)
- [世界剧本格式](docs/game-design/script-format.md)
- [Truth Engine 运行时](docs/game-design/engine-runtime.md)
- [模型目录与 Gateway](docs/game-design/model-gateway.md)
- [沉浸会话壳与流式 API](docs/game-design/presentation.md)
- [决策日志](docs/decisions/README.md)
