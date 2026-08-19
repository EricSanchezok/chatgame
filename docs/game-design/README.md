# 游戏设计参考

这里放游戏设计层面的参考文档——"世界如何运转"的规格，一个主题一页：

| 文档 | 内容 |
|---|---|
| [script-format.md](script-format.md) | 剧本格式 v1.0：18 模块 + theme/assets 两个可选表现模块 + 附录 A-G |
| [engine-runtime.md](engine-runtime.md) | 引擎运行时 v1：回合循环、判定、防作弊、双轨状态、LLM 桥、存档、表现层 |
| [presentation.md](presentation.md) | 表现层 v1：UI 结构、Route Handlers、主题系统、资产管线、多剧本管理 |
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

决策依据见 [决策记录 0005](../decisions/0005-script-format-v1.md)。

## 引擎运行时

引擎运行时 v1 已实现：`src/engine/`（回合循环 + 判定 + 防作弊 + 双轨状态 + LLM 桥 + 存档 + 表现层）。规格见 [engine-runtime.md](engine-runtime.md)；演示：

```sh
npm run play   # demo CLI（默认 Mock LLM，无 key 可跑）
```

决策依据见 [决策记录 0007](../decisions/0007-engine-runtime.md)。

## 表现层

表现层 v1 已实现：`src/app/`（沉浸聊天式 UI + Route Handlers）+ `src/server/`（EngineHost 会话托管 + 剧本导入）。规格见 [presentation.md](presentation.md)；演示：

```sh
npm run dev   # 开发服务器（启动器 + 游戏 UI）
```

决策依据见 [决策记录 0012](../decisions/0012-ui-theme-assets-multiscript.md)。

规则：

- 这里写"当前如何运转"的规格；"为什么这么设计"写进 [决策记录](../decisions/README.md)。
- 有第一份内容时再创建对应文件，避免空目录占位。
