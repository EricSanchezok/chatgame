# 引擎拥有运行时身份与语义身份不可重绑

## Status

Accepted
Class: architecture

## Context and Problem Statement

AgentMind、reaction 与 Truth 各阶段曾把 action、check、random、mechanic、event 和 observation 的持久 ID 交给模型生成。多个并发 Agent 很自然会各自返回 `act-001`，而冲突直到联合行动组装时才暴露；重试仍会从同一存档读取相同冲突。历史校验对不同技术 ID 的跨步唯一性也不一致，部分语义记录还能用同一 ID 改绑主体或定义，导致因果引用和私有历史不再单义。

## Decision Drivers

- 同一个持久 ID 在整个世界历史中只能表示一个不可变的发生记录或语义身份。
- 并发完成顺序、进程重启和同一 revision 重试不得改变技术 ID，也不得额外消耗 RNG。
- 模型负责开放语义内容，不得拥有 actor、revision、step 或审计记录身份等内核事实。
- 引用必须在提交前解析，存档恢复必须能仅凭持久历史重放并验证。
- 剧本与模型仍需命名 entity、agent、fact 等世界语义对象，不能把所有 ID 都改成不可读的内核句柄。

## Considered Options

- 继续接受模型 ID，仅在最终数组发现重复时失败。
- 在冲突发生后给模型增加一轮“换 ID”修复。
- 提交前为重复 ID 追加随机后缀或全局计数器。
- 模型只输出 draft 与 proposal-local alias，由引擎确定性分配运行时身份，并对语义身份执行不可重绑规则——所选路线。

## Decision Outcome

运行时身份使用 `rt:<kind>:<sha256>`。哈希输入是规范 tuple，至少包含固定世界 hash、目标 revision、记录 kind，以及调用阶段、所有者、轮次和稳定序号中适用于该记录的部分。生成器不读取时间、UUID、进程级计数器或 RNG；并发 Agent 以 actor ID 归位，因此同一前态与同一候选重试得到相同身份。

模型输出契约与持久契约分开。AgentMind 只生成 belief/character operations 与行动内容，引擎注入 patch 的 Agent/base revision 以及 action ID、actor 与 base revision；reaction keep 保留原 action，replace 获得独立身份。Truth 的 check、random、mechanic、event、outcome 与 observation 使用局部 alias 表达候选内引用；引擎先验证 alias 单义，再统一分配持久 ID，并重写 cause、result、source event 与 alternative 引用。alias 不进入持久状态。

语义 ID 规范化为 NFC，必须与 trim 后相同，不含控制字符，不超过 128 个 UTF-8 字节，也不能占用 `rt:`。`player` 在 Agent 命名空间永久保留，玩家实体不能绑定 Agent。Agent、被删除的 Fact 与 Agent 私有局部身份保留全寿命 tombstone；Fact、Meter、Rating、Quantity 与 belief claim 的身份 tuple 不可重绑，Evidence 只能追加或以完全相同内容幂等重放。Meter threshold 触发集合和所有派生技术身份只由内核维护。

完整状态使用 strict schema，并固定完整的 pre-bootstrap canonical truth、Agent 状态与玩家状态作为 replay base；其 hash 进入世界运行时契约。bootstrap 为每个初始 Agent 保存 belief、character 与 prepared action 的原子 commit。每个步骤保存不可变的玩家输入 ledger、initial/final action、belief/character patch 与下一轮 prepared action；恢复时从 replay base 依序应用 bootstrap commit、世界 operation、observation、认知 patch 和下一行动，再与完整持久 truth、Agent cognition、玩家 knowledge/binding/intent 精确比较。intent 与 input ID 也进入全历史 tombstone；同一 intent 只能追加未使用的 clarification，新 goal 必须以全新身份开始，并由 WorldRun 输入账本证明步骤间的 completed、failed 或 cancelled 边界。

typed history ledger 同时验证运行时 ID 的全历史单义性、引用的时间作用域、当步存活 actor、bootstrap/model audit 覆盖、Agent 生命周期和语义身份 tuple。prepared action 必须与上一步或 bootstrap 已承诺内容逐字段相同；action 在 initial/final 两个审计投影中可以复用同一 ID，但内容 hash 必须相同，reaction replace 必须使用新 ID。模型 invocation ID 也按 world hash、revision、role、subject 与 ordinal 重新计算，不能只检查 `rt:` 外形。

世界脚本 schema 为 v6，运行状态为 v8，会话文档由 [0049](0049-world-run-failure-and-stream-boundaries.md) 定义为 v9。旧版本直接拒绝，不提供迁移或兼容读取。

### Consequences

- 多 Agent 使用相同常见 alias 不会冲突，因果引用在历史中保持单义。
- 模型 schema 更小，actor、revision 与 observer 等可信元数据不再由两个写入者重复声明。
- transition materialization 增加一次候选内引用重写，但它发生在任何状态写入和 RNG 提交前。
- 更严格的 ID 与 tombstone 规则会拒绝过去可加载的世界或存档，因此需要显式版本断代。

## Pros and Cons of the Options

### 最终数组再拒绝

- 好：无需改变模型输出契约。
- 坏：并发冲突无法归因给单个模型调用，失败会持久化到下一步并在重试时重复。

### 模型修复 ID

- 好：保留模型生成字段。
- 坏：让无语义价值的字符串消耗模型调用，仍不能保证跨步或跨记录类型的历史单义性。

### 随机后缀或全局计数器

- 好：容易获得进程内唯一值。
- 坏：重试、恢复和并发调度顺序会改变历史身份，也可能让失败候选消耗未来 ID。

### 引擎确定性身份与语义身份不变量

- 好：技术事实只有一个写入者，可重放、可验证，并从根上消除整类碰撞。
- 坏：需要拆分模型 draft 与持久 schema，并一次性升级世界和存档版本。

## Links

- [0031](0031-epistemic-multi-agent-truth-engine.md) — 同 revision 联合行动与认知隔离。
- [0035](0035-truth-engine-hardening-and-verifiable-audit.md) — 完整状态与历史审计。
- [0037](0037-agent-evolution-self-awareness-and-reaction-window.md) — AgentMind 与 reaction 生命周期。
- [0039](0039-pinned-world-runtime-contract.md) — 固定世界 hash 与存档断代。
- [0049](0049-world-run-failure-and-stream-boundaries.md) — 失败、取消与流边界。
- [事故复盘 0016](../postmortems/0016-runtime-identity-collision-and-reconnect-loop.md) — 重复行动 ID 如何被终态重连放大。
