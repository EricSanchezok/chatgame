# 游戏设计参考

这里放游戏设计层面的参考文档——"世界如何运转"的规格，一个主题一页：

| 文档 | 内容 |
|---|---|
| [script-format.md](script-format.md) | 剧本格式 v1.0：18 模块字段定义 + 附录 A-G（当前规格） |
| time.md | 时间机制：时间流逝、日程、事件调度 |
| character.md | 角色机制：属性、记忆、关系 |
| inventory.md | 背包机制 |
| combat.md | 战斗机制：生命值、伤害结算 |

## 剧本格式

剧本格式 v1.0 已定稿：`script-format.md`（人类契约）+ `src/script/schemas/`（zod 机器契约）+ `scripts/emberfall/`、`scripts/starlight/`（示例剧本）。校验命令：

```sh
npm run script:validate -- scripts/emberfall
npm run script:validate -- scripts/starlight
```

决策依据见 [.agents/notes/implemented/game-design/2026-08-18-script-format.md](../../.agents/notes/implemented/game-design/2026-08-18-script-format.md)。

规则：

- 这里写"当前如何运转"的规格；"为什么这么设计"写进 [.agents/notes/](../../.agents/notes/README.md)。
- 有第一份内容时再创建对应文件，避免空目录占位。
