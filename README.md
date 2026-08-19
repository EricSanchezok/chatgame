# chatgame

剧本驱动的 AI 聊天游戏框架：加载不同"剧本"即成为完全不同的游戏；同一剧本每次开局体验不同；一个剧本就是一个可以无限游玩的世界。

## 快速开始

```sh
npm install
npm run dev
```

打开 http://localhost:3000。

## 剧本与引擎

剧本是"世界"的声明式定义（18 模块，YAML）；引擎是"世界如何运转"的运行时。体验：

```sh
npm run play                                       # demo CLI（默认 Mock LLM，无 key 可跑）
CHATGAME_LLM_PROVIDER=vercel npm run play           # 真实 LLM（需配置 env）
npm run script:validate -- scripts/emberfall       # 校验示例剧本
npm test                                           # 全部测试
```

规格：[docs/game-design/script-format.md](docs/game-design/script-format.md)（剧本格式）、[docs/game-design/engine-runtime.md](docs/game-design/engine-runtime.md)（引擎运行时）。

## 文档

- [docs/README.md](docs/README.md) — 文档地图
- [docs/architecture.md](docs/architecture.md) — 系统总览
- [docs/game-design/](docs/game-design/README.md) — 游戏设计参考
- [docs/decisions/](docs/decisions/README.md) — 决策记录（为什么）
