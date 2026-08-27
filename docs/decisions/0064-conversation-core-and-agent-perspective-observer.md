# 会话核心与 Agent 视角旁观

## Status
Accepted
Class: architecture

## Context and Problem Statement

World Instance 同时服务真人体验与无人演化。把它表现为公共事件仪表盘会丢失游戏的自然语言会话核心，也会迫使旁观者接触 canonical truth 或缺乏可理解的主体视角。Participant 准入、无人推进与调试器需要共享同一实例和执行事实，但使用彼此隔离的投影。

## Decision Drivers

- 真人体验必须以 World 旁白、角色行动和角色 Observation 组成单轴会话。
- 无人演化必须可从任一 Agent 的授权视角观察，且不能伪装成该 Agent 提交行动。
- Origin 创建、任意空闲 Agent 接管与退出必须发生在 revision 边界并保持策略表完整。
- 对话不得成为独立事实源；刷新、重试和进程重启后必须由持久状态得到同一结果。
- 普通体验、Observer 与本地受信任 Inspector 必须使用不同权限投影。

## Considered Options

- 以公共事件仪表盘作为 Participant 与 Observer 的统一页面。
- 为聊天另建消息数据库，并把 World Instance 作为后端执行器。
- 保留唯一 World Instance，以持久 Arrival、Participant intent、Observation 与 Agent 私有状态投影会话和 Observer 流——所选路线。

## Decision Outcome

`WorldInstanceDocument` v13 保留复数 Participant、PolicyBinding、ActionWindow、scheduler、advance 与统一 Execution Ledger 引用，并为 Participant 持久化 Arrival；intent 持久化 Agent、advance 与提交身份。对话只由 Arrival、intent、advance 和 committed Observation 投影，失败 advance 投影安全失败消息并关闭窗口。

创建实例必须选择 Origin 或 Observer。准入界面先以可横向切换的同级卡片展示全部 Origin 与 Observer，选定 Origin 后才进入名字、外观和动机表单；Origin 图片来自可选世界资产，缺失时由宿主渲染默认卡面。Origin 在同一创建事务中完成 bootstrap、准入和持久 Arrival；确认前不创建实例。普通新游戏只通过 Origin 创建新 Agent。Observer 不创建 Participant，可推进世界、选择任一 Agent 并读取 [0068](0068-unified-agent-perspective.md) 定义的统一视角。

控制转移在一个 revision CAS 中完成。Observer 可以接管任意存活且未被 external 策略占用的 Agent；Participant 可以退出到 Observer 或直接切换角色。原角色恢复 model 策略并记录 `resumeFromRevision`，接管角色获得新的持久 Arrival。

`/play/:instanceId` 使用 assistant-ui 会话主舞台。Participant composer 只提交自然语言行动；服务端自动创建 `participant_action` advance 与 ActionWindow，一次提交最多推进一步。Observer 使用同一消息流的只读形态，推进、Agent 切换和接管位于 footer。

可拖动控制球提供存档、设置与视角工具。WorldInspector 读取独立的受信任 DTO，默认隐藏，只有显式开启调试器设置后出现。实例更新 SSE 只发送重新读取提示，不携带世界、Ledger 或私有数据。

世界包 schema 为 v9，`SimulationState` 保持 v9，World Instance 为 v13，公共 API 为 v8。`participation.yaml` 只声明 Origin；缺失时仍允许 Observer 无人演化和接管已有 Agent。

### Consequences

- 对话、Observer、Inspector 和实验仍共享一个 canonical state 与 Execution Ledger，不维护聊天事实副本。
- Agent 视角旁观只能看到所选 Agent 的私有状态；切换选择不会获得跨 Agent 聚合认知。
- Participant 模式不提供批量或实时推进；这些能力只属于 Observer。
- Inspector 与高级角色控制是显式开启的本地工具，默认体验保持沉浸。

## Pros and Cons of the Options

### 公共事件仪表盘

- 好：无人控制按钮集中，状态容易概览。
- 坏：Participant 失去会话玩法；公共投影无法表达某个 Agent 的有限认知。

### 独立聊天数据库

- 好：消息查询直接，前端可独立演进。
- 坏：形成第二套事实源，提交、重试与回放可能和 canonical history 分叉。

### World Instance 派生会话与 Observer

- 好：刷新、幂等、权限和回放共享同一证据；两种体验保持清晰。
- 坏：投影必须稳定关联 Arrival、intent、advance、Observation 与 revision。

## Links

- [0023](0023-layout-theme-and-accessibility-v2.md) — 会话布局、主题与无障碍约束。
- [0055](0055-trusted-world-evolution-inspector.md) — 本地受信任 WorldInspector。
- [0056](0056-control-state-and-settings-grouping.md) — 控制球与设置分组。
- [0059](0059-unified-execution-kernel-and-ledger.md) — 唯一执行与证据存储。
- [0061](0061-unified-agent-and-external-policy.md) — Agent 与策略来源统一。
- [0062](0062-world-instance-participation-and-action-window.md) — 被本记录取代并保留其 World Instance 与多人窗口边界。
- [0063](0063-eager-reference-execution.md) — 唯一内置执行算法。
