# chatgame

剧本驱动的 AI 聊天游戏框架：加载不同"剧本"即成为完全不同的游戏；同一剧本每次开局体验不同；一个剧本就是一个可以无限游玩的世界。

## 快速开始

```sh
npm install
npm run dev
```

打开 http://localhost:3000。

## 剧本

剧本是"世界"的声明式定义（18 模块，YAML）。示例与校验：

```sh
npm run script:validate -- scripts/emberfall   # 中式奇幻小镇示例
npm run script:validate -- scripts/starlight   # 科幻空间站示例
npm test                                       # schema + 语义校验测试
```

格式规格见 [docs/game-design/script-format.md](docs/game-design/script-format.md)。

## 文档

- [docs/README.md](docs/README.md) — 文档地图
- [docs/architecture.md](docs/architecture.md) — 系统总览
- [docs/game-design/](docs/game-design/README.md) — 游戏设计参考
- [.agents/notes/](.agents/notes/README.md) — 决策记录（为什么）
