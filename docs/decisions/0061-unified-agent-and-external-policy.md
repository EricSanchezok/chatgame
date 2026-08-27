# 统一 Agent 与外部策略

## Status
Accepted
Class: architecture

## Context and Problem Statement

运行时把真人角色放在独立 `PlayerState` 中，并把 `player` 设为保留 actor。该结构让真人缺少与自主 Agent 相同的位置、身份和私有认知，也使无人世界无法推进；它还把产品接入方式混入了仿真主体模型。

## Decision Drivers

- 真人、自主模型、脚本和回放控制的角色必须共享一种主体状态。
- 世界必须能在没有真人时持续演化。
- 真人不得获得 canonical identity、其他主体认知或隐藏真相。
- 外部控制期间不得由模型推断真人的信念、情绪或下一步。
- 策略来源必须可替换而不改变执行算法和数学模型。

## Considered Options

- 保留独立 PlayerState，并为无人运行伪造玩家 noop。
- 把真人输入直接作为世界级动作，不创建角色。
- 所有可行动角色统一为 Agent，策略来源由运行时 `PolicyBinding` 指定——所选路线。

## Decision Outcome

`SimulationState.agents` 是唯一主体集合。每个 Agent 都绑定 canonical Entity、位置、私有 belief、character 与局部 identity；`AgentActionProposal.actorId` 只接受 `AgentId`，`player` 不再是保留身份。

`PolicyBinding` 将每个 Agent 绑定到 `model`、`external`、`idle` 或 `replay` 策略。模型策略执行 AgentMind；外部策略提交真人行动且不运行 AgentMind；idle 产生引擎拥有的 typed noop；replay 从指定 execution 读取已记录行动。策略绑定属于运行实例，不进入世界数学状态。

观察仍按 AgentId 投递。外部 Participant 只能读取其所控制 Agent 的授权视角；认领角色不改变角色的历史、位置或私有认知。世界步骤从 `WorldAdvanceRequest` 收集策略输出，并在零 Participant 时直接执行全部自主策略。

### Consequences

- 无人运行和真人参与使用同一执行入口。
- Agent 可以拥有任意语义 ID，包括 `player`，但该名字没有系统特权。
- 外部控制期间的角色心理保持原样；释放后可选择补齐观察并恢复 AgentMind，或保持 idle。
- 旧 `PlayerState`、`PlayerKnowledgeState`、世界根级 `player.yaml` 与 player 特判直接拒绝，不提供迁移层。

## Pros and Cons of the Options

### 独立 PlayerState

- 好：沿用既有会话和 UI。
- 坏：重复主体模型，阻塞无人演化和多人扩展，并持续制造权限特判。

### 世界级真人动作

- 好：输入协议最小。
- 坏：真人没有角色位置、历史和认知，无法形成可持续的世界身份。

### 统一 Agent 与策略绑定

- 好：主体语义唯一，无人、单人和多人共享算法与提交协议。
- 坏：准入、行动窗口和角色投影必须由独立产品层实现。

## Links

- [0031](0031-epistemic-multi-agent-truth-engine.md) — 被本记录取代的 PlayerState 主体边界。
- [0048](0048-engine-owned-runtime-identities.md) — 运行时身份与语义身份边界。
- [0062](0062-world-instance-participation-and-action-window.md) — Participant 接入和多人协调。
