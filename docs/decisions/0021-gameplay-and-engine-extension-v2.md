# 玩法与引擎扩展契约 v2

## Status
Proposed
Class: architecture

## Context and Problem Statement

现有世界步进已接通多数声明式系统，但任务目标、重复任务、跨午夜日程、声望阈值、逐边旅行、知识过滤和剧本生命周期仍存在契约与运行时不一致。剧本只能注册孤立动作、条件和效果，无法以确定性生命周期实现班次、周期结算和持续系统。

## Decision Drivers

- 引擎继续持有时间、资源、任务、知识和规则的唯一权威。
- validator、运行时、HTTP 和 UI 对同一动作与任务目标使用同一类型。
- 通用生命周期允许复杂剧本出现，但框架不理解剧本专属状态。
- 未注册或不可执行的声明必须响亮失败。

## Considered Options

- 继续扩充现有松散对象并由各剧本自行解释。
- 把班次、证据、空间站系统等玩法写进框架。
- 建立强类型动作、目标与生命周期扩展 v2。

## Decision Outcome

采用 Engine Extension v2。玩家回合接收带可选结构化 `intentHint` 的 `TurnInput`，参数由共享类型表达并由引擎重新验证；动作预检返回权威的可执行性、原因、耗时、资源与风险。扩展增加 `onSessionStart`、`onTurnResolved`、`onHour`、`onDayBoundary`，每个 hook 只返回不可变世界状态与摘要。

任务目标、重复生命周期、时间窗口、声望阈值、逐边旅行、规则注册、事件文本选择、needs/status/progression 和秘密知识管线由通用契约统一。剧本专属算法和状态只存在于剧本扩展与 `runtimeState`。未知规则机制、错误目标和没有处理器的声明在校验时失败。

## Pros and Cons of the Options

### 松散对象由剧本解释

- 好：短期改动少。
- 坏：validator、UI 和运行时继续漂移，两个剧本会产生互不兼容的私有协议。

### 专属玩法写进框架

- 好：内置剧本实现直接。
- 坏：破坏剧本驱动原则，框架会积累世界名称与专属分支。

### 强类型契约与生命周期 v2

- 好：规则可验证、可预览、可测试，复杂剧本共享时序能力而不共享专属含义。
- 坏：扩展 API 与存档断代，要求所有内置剧本同步迁移。

## Links

- [0004](0004-game-first-principles.md) — 游戏第一性原理。
- [0008](0008-engine-completeness.md) — 被本记录取代的运行时完备化决策。
- [0022](0022-ui-host-and-script-extension-v3.md) — 消费动作预检与扩展状态的 UI 契约。
