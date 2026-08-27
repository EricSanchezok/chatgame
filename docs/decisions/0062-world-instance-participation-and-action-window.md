# World Instance、Participant 与 ActionWindow

## Status
Superseded by [0064](0064-conversation-core-and-agent-perspective-observer.md)
Class: architecture

## Context and Problem Statement

以单个玩家目标为中心的 WorldSession/WorldRun 不能表达旁观、无人批量或实时演化、多个外部策略以及在任意 revision 加入或离开。把这些模式分别实现会产生多套状态机、持久化和实验事实源。

## Decision Drivers

- 单步、批量、实时、真人行动和 replay 必须调用同一世界推进入口。
- Participant 数量为零时不得等待输入。
- 多个外部 Agent 必须在同一 revision 上公平收集行动。
- 加入、认领、释放和超时必须具备 CAS 与幂等语义。
- 产品首版限制一个真人，但存储和内核不得固化该上限。

## Considered Options

- 扩展单玩家 WorldRun 状态机。
- 为无人实验和多人产品分别建立运行系统。
- 以复数 Participant、PolicyBinding 和持久 ActionWindow 为核心的 World Instance——所选路线。

## Decision Outcome

`WorldInstanceDocument` v12 保存 canonical `SimulationState`、复数 Participant、PolicyBinding、当前 ActionWindow、runtime 配置、scheduler 状态、运行记录和 execution references。World Instance 是唯一可演化资源；旁观不创建 Participant。

`WorldAdvanceRequest` 固定携带 expected revision、trigger、模拟秒数与外部行动。单步只调用一次；batch 和 realtime 只重复调用该入口。调度器对同一实例严格串行，不补算离线 backlog。

存在 external 策略时，实例在当前 revision 创建唯一 ActionWindow。窗口收齐所有 required Agent 的幂等提交后推进；到期缺失项由内核生成 typed noop；提交、超时与取消使用 generation CAS。按 AgentId 寻址的 `decisionRequests` 在 batch 中形成可恢复停止边界。

Participant 可在 revision 边界从 Origin 创建 Agent 或认领可用 Agent。认领成功后才公开完整角色私有视角；释放时明确选择 `model` 或 `idle`。产品 Principal Resolver 最多允许一个 active 真人，内部窗口协议和测试支持多个 Participant。

### Consequences

- interactive、headless、benchmark 与 replay 共用 Execution Ledger。
- 世界包可以不含 participation 配置，此时只能旁观和无人演化。
- 旧 Session/PlayerIntent API 与存档直接拒绝，不保留兼容路由。
- Arrival Generator 是准入后的只读表现 execution；失败使用剧本回退文本，不回滚角色准入。

## Pros and Cons of the Options

### 扩展单玩家 WorldRun

- 好：改动较少。
- 坏：玩家目标仍是世界推进的隐含前提，多人和无人模式继续是特例。

### 分离实验与产品运行时

- 好：各自状态机较简单。
- 坏：语义、指标和回放不可比较，形成第二套事实源。

### World Instance 与 ActionWindow

- 好：推进入口唯一，多人公平、无人即时、加入离开均有持久边界。
- 坏：需要显式 scheduler、窗口 CAS 和 Participant 投影。

## Links

- [0033](0033-persistent-streaming-world-runs.md) — 被本记录取代的单玩家 Session/WorldRun 资源。
- [0040](0040-resumable-player-intent.md) — 被 ActionWindow 外部输入取代的 PlayerIntent。
- [0049](0049-world-run-failure-and-stream-boundaries.md) — 被 World Instance 调度与窗口边界取代的 run 状态机。
- [0059](0059-unified-execution-kernel-and-ledger.md) — 唯一执行与证据存储。
- [0061](0061-unified-agent-and-external-policy.md) — 统一主体与策略来源。
