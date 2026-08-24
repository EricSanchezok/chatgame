# 认知分叉的多智能体 Truth Engine

## Status
Accepted
Class: architecture

## Context and Problem Statement

固定动作目录把自由文本压缩为剧本预先枚举的 `actionId`，无法表达未配置目标；叙事阶段又能通过 mechanics tags 直接修改状态，使输入过度受限而输出缺少因果约束。世界还只有一份真相状态，NPC 没有可与真相冲突的主观认知，也不能作为共同世界中的自主行动者并发演化。

## Decision Drivers

- 玩家和自主实体必须能提出任意自然语言行动。
- 世界真相、个体认知与个体观察必须彼此分离。
- 面向玩家与 Agent 的结果叙事必须经过观察者专属 Observation，不能从内部裁决摘要旁路公开。
- 错误信念、误认身份与不存在的主观实体必须可持久化。
- 每个世界步骤必须让所有自主 Agent 基于同一前态行动。
- LLM 负责开放语义裁决，状态提交仍需原子、可审计且结构有效。
- 动态出生或召唤的自主实体必须进入后续世界步骤。

## Considered Options

- 保留有限动作并扩大动作目录。
- 每个 Agent 持有完整世界副本并各自结算。
- 只有当前场景 Agent 行动，场外实体冻结。
- 单一真相世界 + 独立稀疏信念图 + 全体联合行动 + Truth Engine——所选路线。

## Decision Outcome

运行时由 `CanonicalWorldState`、每个 Agent 的 `AgentBeliefState` 与人类玩家的 `PlayerKnowledgeState` 组成。信念图使用 Agent 私有局部实体身份，允许事实、描述和实体存在性与真相冲突；Truth Engine 不得用真相自动改写信念。

自主实体拥有 `AgentMind`，普通物体只有 `Entity`。每个已提交世界步骤包含所有存活 Agent 基于同一 base revision 产生的自由 `AgentActionProposal`；联合输入按稳定身份规范排序，不能从调用方数组顺序获得隐含先手。玩家原文与 Agent 提案共同交给 Truth Engine；不存在预配置 action kind、目录 `actionId` 或未知动作降级，proposal 自身的 id 只用于本次因果审计。

Truth Engine 负责联合语义裁决并提出检定、客观事件、状态 delta 和逐观察者 observation。`ActionOutcome` 的 summary 与 known alternatives 是服务端内部裁决审计，不是公共叙事接口；玩家 UI 的 outcome 文本只能汇总玩家自己的 `kind=outcome` Observation，AgentMind 的本步与历史 outcome 只获得 status，所有可见结果文本只来自该 Agent 自己的 Observation。非 LLM 事务内核只检查 schema、引用、数值、provenance、随机承诺和原子性。Truth Engine 与 AgentMind 的非法输出最多修复两次；失败步骤不提交。

每个已提交 transition 必须为玩家和提交后每个存活 Agent 至少提供一条非空 summary 的 `kind=outcome` Observation。每个 AgentMind 在一次调用中解释自己刚收到的 Observation、提交 BeliefPatch，并产生下一步骤行动。新创建的自主实体在创建步骤内完成心智初始化，随后参与全体联合行动。人类玩家的状态只记录可知信息，不由模型推断真人心理。

### Consequences

- 自由度来自开放行动和 LLM 世界模型，不来自不断扩大的动作白名单。
- 20–50 个 Agent 的首版每步会产生大量模型调用；首版以语义正确为目标，不引入场景激活或场外近似。
- LLM 成为语义裁判后不保证同输入产生同一叙事分支；已提交 delta、观察、信念 patch 和随机结果构成可回放事实。
- Observation 是唯一面向观察者的结果文本接口。首版由 Truth Engine 直接生成，后续可在该接口前加入感知投影器。

## Pros and Cons of the Options

### 扩大固定动作目录

- 好：沿用现有解析与确定性 handler。
- 坏：任何目录都无法覆盖自然语言开放世界，剧本作者仍需预知玩家行为。

### 每个 Agent 持有完整世界副本

- 好：主观世界概念直观。
- 坏：复制、同步和冲突成本随 Agent 数量爆炸，多个裁判会产生多个互不兼容的物理现实。

### 只运行当前场景 Agent

- 好：成本低、延迟小。
- 坏：场外世界冻结，不满足持续演化世界的语义。

### 单一真相与独立稀疏信念图

- 好：物理事实只有一个提交点，同时允许每个 Agent 持有错误认知并自主行动。
- 坏：需要显式处理局部身份、观察隔离、联合冲突和大量并发模型调用。

## Links

- [0004](0004-game-first-principles.md) — 游戏第一性原理。
- [0007](0007-engine-runtime.md) — 被本记录取代的固定动作 PDVA 运行时。
- [0014](0014-llm-context-management.md) — 被主观信念上下文取代的全局对话摘要。
- [0015](0015-memory-strength-retrieval-supersede.md) — 被信念、证据和观察链取代的旧记忆模型。
- [引擎运行时规格](../game-design/engine-runtime.md) — 当前运行时参考。
