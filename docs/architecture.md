# 架构总览

chatgame 是剧本驱动的 AI 游戏框架。系统分层：

| 层 | 职责 |
|---|---|
| 剧本（Script） | 内容载体：世界观、背景、人物、机制配置。框架加载剧本即成为对应游戏 |
| 引擎核心（Engine Core） | 世界状态与游戏进程：时间推进、事件调度、机制执行、存档/读档 |
| 机制层（Mechanisms） | 通用机制：角色属性与记忆、背包、战斗、生命值等；由剧本配置或扩展 |
| LLM 桥（LLM Bridge） | 把世界状态与玩家动作转化为叙事与角色行为 |
| 界面（UI） | 聊天界面 + 世界状态展示 |

核心原则（决策依据见 [第一性原理决策记录](decisions/0004-game-first-principles.md)）：

- 剧本决定"世界是什么"，机制层决定"世界如何运转"，LLM 决定"世界如何回应"。
- 引擎管状态与规则（规范性），LLM 管叙事与行为（随机性）。
- 游戏状态是引擎管理的真实数据，不以对话文本为载体。

## 模块地图

```
src/script/   契约层：剧本格式 schema（zod strict）+ 校验（validate.ts / validate-presentation.ts）
src/engine/   引擎运行时：世界状态、回合循环（PDVA）、机制、事件/任务、双轨状态描述层、存档、表现层
├── mechanics/   通用机制：inventory / needs / status / combat / progression（不可变快照 + 纯函数）
├── narrative/   LLM 桥：provider + prompt + 意图解析 + 一致性校验（Mock / Vercel AI SDK）
└── media/       MediaProvider 接缝（off / mock；真实文生图/TTS 为 V2）
src/server/   服务托管：EngineHost（会话注册表 + 串行队列）+ script-import（web 与 CLI 共用的导入核心）
src/app/      UI + Route Handlers：沉浸聊天式前端（launcher / game）+ lib/theme / lib/audio / lib/api
```

各层详情见 [docs/game-design/](game-design/README.md) 规格；架构决策见 [docs/decisions/](decisions/README.md)。
