# 模型输出字段所有权与动态 Agent Profile 来源

## Status

Accepted
Class: architecture

## Context and Problem Statement

Truth 与 AgentMind 的结构化输出曾复用完整持久 schema，导致模型必须回填 revision、step、phase、生命周期、来源账本、模型 Profile 和时间戳。引擎随后又覆盖其中一部分，形成两个写入者；字段值即使没有语义选择空间，也会占用输出长度并制造无意义的 repair。与此同时，Agent、Entity、Fact 与私有认知记录的可读 ID 本来就是世界语义，不能被技术身份规则一并收走。

## Decision Drivers

- LLM 只承担开放语义与逻辑判断，不填写可由当前执行上下文唯一确定的字段。
- Agent、Entity、Fact、局部实体、claim、goal 等语义 ID 继续由剧本或模型命名。
- check、random、mechanic、event 与 observation 仍需 proposal-local alias 表达同一候选内的引用。
- 每个持久字段只有一个写入者，模型 draft 必须通过 strict schema 拒绝越权字段。
- 算法候选契约、固定提交内核与未来稀疏算法的替换边界保持不变。

## Considered Options

- 继续复用持久 schema，由引擎静默覆盖模型字段。
- 允许模型输出完整对象，仅校验其运行时字段等于上下文。
- 取消模型命名的全部 ID，给每个语义对象增加隐藏 UUID。
- 分离模型 draft 与持久 schema，由唯一 materialization 路径注入运行时字段——所选路线。

## Decision Outcome

模型 draft 与持久类型分离。Truth check draft 不含 `phase`；reaction stimulus 与 apparent claim 不含 `id`；transition 不含 `baseRevision`，event 不含 `step`，observation 不含 `step` 和固定 `kind`。新 Entity 不含 lifecycle 与创建步，Fact 不含 provenance，Meter 不含 threshold ledger，动态 Agent 不含模型 Profile、角色时间字段和初始 action。AgentMind evidence draft 不含 `step`。Action grounding 不含 `actionId` 与 `actorId`，二者由调用槽位注入。这些字段由执行内核按当前状态、阶段和稳定序号一次性补全，补全后才进入 `CanonicalCommitter`。

模型继续命名 Agent、Entity、Fact、Meter、Rating、局部实体、evidence、claim、trait、goal 等语义 ID，也可原样引用已有 ID。check、random、mechanic、event 与 observation 的响应内 ID 是局部 alias；引擎在候选进入验证前将其确定性重写为 `rt:` 身份。apparent claim 与 reaction stimulus 没有模型 alias，由引擎按所属 Observation 与 ordinal 生成身份。本决策落实而不取代 [0048](0048-engine-owned-runtime-identities.md) 的语义身份边界。

世界清单通过 `model_profiles.dynamic_agent` 唯一定义运行时创建 Agent 的 bootstrap、mind 与 reaction Profile。Truth 只定义动态 Agent 的语义身份、实体绑定、角色、初始认知与私有映射；引擎从已固定的 `WorldRuntimeContract` 注入 Profile，并在同一步调用 AgentMind bootstrap。

世界脚本 schema 为 v8，`WorldInstanceDocument` 为 v12，`SimulationState` 为 v9。旧世界和实例直接拒绝，不提供兼容层。Truth prompt 为 v9，AgentMind prompt 为 v7，模型上下文契约为 v9，唯一内置算法为 `eager-reference@1`；`WorldExecutionAlgorithm` 公共接口不变。

### Consequences

- 模型 JSON 更短，运行时字段不再触发无意义的 schema repair。
- 模型伪造 revision、step、phase、Profile、provenance 或时间戳会在 draft schema 边界被拒绝。
- 新模型角色必须先声明字段所有权，再分别定义 draft 与持久 schema，不能复用完整状态对象图省事。
- 动态 Agent 不能逐实例选择供应商；需要不同 Profile 的世界必须在世界清单或未来算法配置中显式建模。

## Pros and Cons of the Options

### 引擎静默覆盖

- 好：不需要拆分 schema。
- 坏：两个写入者掩盖契约错误，模型仍为无选择空间的字段付费。

### 模型回填并做相等校验

- 好：可以较快发现伪造值。
- 坏：仍增加输出长度与 repair 面积，且没有提供额外语义信息。

### 全部 ID 改为隐藏 UUID

- 好：技术唯一性规则表面统一。
- 坏：破坏世界语义命名与可读引用，并引入不必要的双重身份层。

### 独立 draft 与唯一 materialization

- 好：字段所有权可由类型和 strict schema执行；语义 ID、候选别名与运行时身份边界清晰。
- 坏：需要维护成对类型，并在新增持久字段时明确它属于模型还是引擎。

## Links

- [0031](0031-epistemic-multi-agent-truth-engine.md) — Truth、AgentMind 与认知隔离。
- [0048](0048-engine-owned-runtime-identities.md) — 运行时身份和语义身份边界。
- [0059](0059-unified-execution-kernel-and-ledger.md) — 算法候选与固定提交内核。
- [引擎运行时](../game-design/engine-runtime.md) — 当前模型调用与 materialization 规格。
- [剧本格式](../game-design/script-format.md) — `model_profiles.dynamic_agent` 世界声明。
