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

可选变量为 `CHATGAME_LLM_BASE_URL`、`CHATGAME_LLM_MODEL`、`CHATGAME_TRUTH_MODEL` 与 `CHATGAME_AGENT_MODEL`。`CHATGAME_LLM_PROVIDER=mock` 只用于测试与本地管线验证，不提供真实游戏裁决质量。

## 常用命令

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run world:validate -- <world-directory>
npm run world:import -- <world.zip> [--replace]
npm run check:fast
npm run check:all
```

## 从哪里开始读

- [系统架构](docs/architecture.md)
- [世界剧本格式](docs/game-design/script-format.md)
- [Truth Engine 运行时](docs/game-design/engine-runtime.md)
- [工作台与流式 API](docs/game-design/presentation.md)
- [决策日志](docs/decisions/README.md)
