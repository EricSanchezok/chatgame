# chatgame

chatgame 是剧本驱动的开放世界 AI 游戏引擎。玩家提交的是任意自然语言目标，而不是动作菜单中的 `actionId`；所有自主 Agent 基于各自有限认知同时行动，唯一 Truth Engine 依据世界真相、法则与检定联合裁决，并在每个世界步骤原子持久化。

## 快速开始

```sh
npm install
npm run dev
```

打开 <http://localhost:3000>。仓库不捆绑可玩世界；初次进入会看到导入入口。用于测试契约的最小世界位于 `test/fixtures/open-world-script/`，不作为产品内容安装。

真实模型默认使用 OpenAI-compatible provider：

```sh
CHATGAME_LLM_API_KEY=... npm run dev
```

若环境只提供 `DEEPSEEK_API_KEY`、`DEEPSEEKAPIKEY` 或 `deepseekapikey`，运行时自动使用 `https://api.deepseek.com/v1` 与 `deepseek-chat`。可选变量为 `CHATGAME_LLM_BASE_URL`、`CHATGAME_LLM_MODEL`、`CHATGAME_TRUTH_MODEL`、`CHATGAME_AGENT_MODEL`、`CHATGAME_LLM_TIMEOUT_MS` 与 JSON 对象 `CHATGAME_LLM_PROFILE_MODELS`；最后一项可把任意 `modelProfileId` 映射到不同模型，单次远程请求默认在 120 秒中止。`CHATGAME_LLM_PROVIDER=mock` 只用于确定性测试，不提供真实游戏裁决质量。

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

`test:live:deepseek` 使用测试 fixture 实际执行 AgentMind 初始化和一个 Truth Engine 世界步骤；它需要上述任一 DeepSeek 密钥变量，不打印或持久化密钥。

## 从哪里开始读

- [系统架构](docs/architecture.md)
- [世界剧本格式](docs/game-design/script-format.md)
- [Truth Engine 运行时](docs/game-design/engine-runtime.md)
- [工作台与流式 API](docs/game-design/presentation.md)
- [决策日志](docs/decisions/README.md)
