# 通用因果断言、受信任规则钩子与分阶段模型 Profile

## Status

Accepted
Class: architecture

## Context and Problem Statement

既有严格提交能证明 causal reference 指向存在的 action、check、event、fact 或 law，却不能证明引用在语义上足以推出效果。模型可以把一次失败检定引用到“行动成功”的 outcome，也可以引用任意合法法则为数值变化背书；这种“引用完整、语义不完整”无法仅靠 ID 存在性解决。另一方面，把所有裁决交给一个 Truth 模型会混合感知、反应路由、检定、状态转移和复核职责，使早期随机承诺可能在后续修复时被重开，也无法按调用点选择不同推理能力和成本的模型。

代码可以完整判断结构、引用、数值、状态机、守恒和可枚举前提；开放世界中“原因是否相关”“叙事效果是否合理”仍需要开放语义推理。目标不是预设代码优于模型或模型优于代码，而是让每项职责归属能够实际完整承担它的一侧，并为可增强的机制提供单一扩展路径。

## Decision Drivers

- 已提交 check、Fact、位置、数值与生命周期前提必须由代码重新求值，不能相信模型自述。
- 题材机制应由服务端受信任包扩展，世界包不能携带代码，玩家动作仍保持开放自然语言。
- 规则钩子必须产生唯一派生写入路径，并能拒绝模型直接绕过，不能留下双轨实现。
- 开放语义因果需要独立复核，但复核器不能拥有修改状态的权限。
- perception、reaction routing、resolution、transition、causal verification 与 Agent 调用点必须分别可配置 Profile。
- 后阶段修复不得重开 reaction、改变已提交检定或消耗额外 RNG。
- 状态、世界、模型目录与持久化契约直接断代，不提供兼容层。

## Considered Options

- 全部交给确定性代码：只有在世界语义能被完整形式化时采用；当前开放自然语言世界无法由有限通用代码完整判断因果相关性。
- 全部交给单一 LLM：保留最大语义弹性，但数值、引用、守恒、随机承诺和权限只能依赖模型自律，无法构成严格提交。
- 保留单一 Truth 调用，只增加更多引用字段：实现最小，但继续混合阶段，新增字段仍可能只是另一种自述。
- 通用断言 + 受信任规则钩子 + 独立语义复核 + 分阶段 Profile——所选路线。

## Decision Outcome

Truth Engine 使用只能前进的阶段状态机。`truth-perception` 可多轮提交 perception checks；`truth-reaction-routing` 恰好调用一次；`truth-resolution` 可多轮提交 resolution checks；`truth-transition` 生成候选；`causal-verifier` 对已通过确定性事务验证的候选独立 accept/reject。因果否决与 transition 校验错误最多修复两次，只重新调用 transition 和必要的 verifier，不重开 earlier stages。每个阶段保存独立模型审计。

世界 manifest 为五个 Truth 调用点分别声明 Profile。Agent 为 bootstrap、mind 与 reaction 分别声明 Profile。模型目录 schema v2 使用八个精确角色；Gateway 不做角色映射或隐式复用。同一具体 Profile 可以显式配置给多个调用点，也可以让高推理需求使用强模型、机械路由使用轻模型。

每个 operation、`MechanicInvocation`、event 和 outcome 同时携带 causal refs 与至少一个 `CausalAssertion`。断言内核支持 check result、Fact 相等/缺失、实体缺失/生命周期、位置/共同位置、Meter/Quantity/Rating 比较与时间比较。断言按操作顺序在候选状态上求值；引用 check 时必须存在同 ID 的结果断言，Quantity 生产/消耗必须引用该定义相应 law allowlist 中的法则。求值结果进入 `CommittedStep`。

`RulePackageRegistry` 同时提供严格配置、规则目录、严格调用输入、确定性 resolver 与直接操作验证。模型只提交规则 ID 和输入，代码派生带 mechanic 原因的操作。`core-d20@1.1.0` 首个规则为 `apply-meter-impact`：它核对 resolution check、预期结果、接收者与 Meter 归属；启用该组合时，含 check cause 的直接 `adjust_meter` 被拒绝。

同一 `WorldRepository` 持有加载、导入和运行共同使用的唯一 `RulePackageRegistry`，避免世界在一个 Registry 下通过校验、却在另一个 Registry 下执行。规则 resolver 只接收隔离快照，返回值必须再次通过严格 operation schema；mechanic provenance 由 Registry 统一添加，规则实现不能自行伪造。

独立因果复核器读取前态、行动、检定、规则结果、候选与断言结果，可以把 finding 精确指向 check、operation、mechanic、event、outcome 或 observation，并报告无关原因、缺失前提、不必要检定、检定矛盾、法则规避、效果不匹配、影响夸大或观察不一致。它的 schema 没有 operation 或 patch，只能否决并提供 repair hint。最终提交保存规则调用/结果、断言结果、accept 报告与全部阶段审计。

世界剧本使用 schema v5，SimulationState 使用 schema v7，WorldSessionDocument 使用 schema v8，ModelCatalog 使用 schema v2。旧契约直接拒绝，无迁移、默认值或双轨读取。

### Consequences

- 确定性机制不再依赖模型“说自己满足前提”，失败位置可定位到具体 target 和 assertion。
- 开放语义仍受模型能力上限制约，但可以独立选择更强 verifier/transition Profile，并由代码保证其权限只有否决。
- 一次世界步固定增加多个 Truth 调用；Profile 拆分可控制成本，但不减少严格阶段数。
- 通用断言是可继续扩展的声明式规则内核，不演变成动作白名单；复杂且真正确定的题材机制进入规则包。
- 契约字段和历史记录显著增加，换来可审计、可回放的因果保证。

## Pros and Cons of the Options

### 全部交给确定性代码

- 好：完全可重放、低推理成本、结果稳定。
- 坏：必须先完整形式化开放世界语义；有限通用规则无法判断任意自然语言原因与效果是否相关，最终会退化成题材硬编码或动作白名单。

### 全部交给单一 LLM

- 好：上下文统一，开放语义表达最自由，调用链最短。
- 坏：无法独立证明数值、守恒、引用、阶段与随机承诺，模型同时提案和自审，错误没有权限边界。

### 单一 Truth + 更多引用字段

- 好：改动小，保留现有调用结构。
- 坏：引用存在性仍不等于前提成立；修复会重新进入混合阶段，模型强度和成本不能按职责配置。

### 断言、钩子、独立复核与分阶段 Profile

- 好：代码与模型各自承担适合完整执行的职责，确定性和开放语义都可单独增强；规则写入、阶段和复核权限都是单一路径。
- 坏：调用次数、schema、审计与测试矩阵扩大，世界作者必须显式配置更多 Profile 和法则授权。

## Links

- [0031](0031-epistemic-multi-agent-truth-engine.md) — 联合语义裁决与认知隔离。
- [0032](0032-open-world-facts-and-d20-kernel.md) — 开放动作与严格数值事务内核。
- [0035](0035-truth-engine-hardening-and-verifiable-audit.md) — 严格结构化输出、公开边界与审计基础。
- [0036](0036-multi-provider-model-gateway-and-fair-scheduler.md) — Profile、供应商 Gateway 与公平调度。
- [0037](0037-agent-evolution-self-awareness-and-reaction-window.md) — 有限反应窗口与 Agent 调用生命周期。
- [引擎运行时规格](../game-design/engine-runtime.md) — 当前阶段、断言、规则和提交契约。
- [模型目录与 Gateway](../game-design/model-gateway.md) — schema v2 角色与 Profile 契约。
- [世界剧本格式](../game-design/script-format.md) — schema v5 Profile 与法则授权格式。
