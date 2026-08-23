# Agent 心智演化、自身状态投影与有限反应窗口

## Status

Accepted
Class: architecture

## Context and Problem Statement

独立信念图让 Agent 可以误解世界并持续行动，但单一人格文本和字符串目标不能表达角色在事件中形成、调整或放弃长期倾向、情绪、态度、目标与承诺。AgentMind 只看到主观 belief 时也无法可靠知道自身生命、位置、资源和能力。联合步骤若直到最终 observation 才让 Agent 感知玩家新行动，则面对面对话、闪避和打断都只能延迟一轮；若改成永久玩家先结算，又会破坏同 revision 联合裁决的公平性。

## Decision Drivers

- 角色必须能依据亲历事件持续演化，同时限制普通事件造成突兀的人格重写。
- 自身身体状态必须精确可见，但不能借自身视图获得 canonical identity 或其他主体秘密。
- 玩家新行动可以触发同一步回复或防御，但玩家行动不能在 Agent 反应前提前命中或改变世界。
- 远距离刺激必须有世界内通信、感知事实或成功检定作为依据。
- 反应次数、行动数量、随机承诺、模型输出和最终提交必须可验证、可回滚、可重放。
- 部署模型选择不能混入角色人格状态。

## Considered Options

- 保留静态人格和目标，只让 belief 与行动变化。
- 永久采用玩家先行动、NPC 后行动的顺序结算。
- 允许任意主体触发无限反应链。
- 分层角色状态 + 去 canonical ID 自身投影 + 玩家刺激的一轮有限反应 + 最终联合裁决——所选路线。

## Decision Outcome

每个 Agent 使用分层 `AgentCharacterState`，包含 persona、traits、values、emotions、attitudes、goals 与 commitments。AgentMind 的常规输出按 `BeliefPatch → CharacterPatch → nextAction` 应用；角色操作必须引用本步骤属于该 Agent 的 observation 和有效 evidence。persona 只能由 transformative 事件替换，长期、短期与动机数值分别按 ordinary/significant/transformative 影响级别限制变化幅度；语义身份、目标、承诺与状态变化至少需要 significant 事件，retire/resolve 还必须通过对应数值归零的幅度校验。目标与承诺使用不可重新打开的终态。时间和 provenance 字段由内核写入，不提供物理删除操作。`modelProfiles.bootstrap/mind/reaction` 保持部署配置身份，不属于角色演化；精确角色契约见 [0042](0042-causal-assurance-and-staged-model-profiles.md)。

服务端从 canonical truth 派生 `AgentSelfStateView`。视图包含局部 self identity、生命周期、世界时间、位置名称与描述、自身 Meter/Quantity/Rating 和有权读取的自身 Fact；canonical entity、placement、meter、rating identity、private Fact 和其他实体状态不进入视图。每个初始或动态 Agent 都必须恰好有一个局部实体绑定自身 canonical entity。

世界步骤保留同 revision 预提交和最终联合裁决，在两者之间加入至多一轮 reaction window。Truth Engine 可以先请求 perception checks，再为本步骤 player action 返回 `request_reactions`；被请求 Agent 并发返回 keep 或同 actor、同 revision 的 replacement action。任何 resolution check 开始后窗口永久关闭，窗口后不再允许 perception check、第二轮 reaction 或反应链。未被请求的 Agent 保留预备行动，最终每个 actor 仍只有一个行动。

ReactionRequest 的 stimulus 是观察者私有 observation，可以引入临时局部身份；结构化 basis 必须证明玩家与 Agent 处于同一个非空直接 placement、存在该 Agent 可访问且以玩家或 Agent 为结构化端点的通信/感知 Fact，或存在引用玩家行动及 Fact/Law 的成功 perception check。AgentMind reaction 不得更新 belief 或 character；stimulus 与最终 observation 一同进入原子提交，常规 AgentMind 随后才更新心智并准备下一行动。

`CommittedStep` 保存 initial/final actions、reaction requests/decisions、character patches、分阶段检定与 `agent-reaction` 模型审计，并把它们纳入内容 hash、恢复校验和重放。任一 Truth Engine、reaction、AgentMind 或事务验证失败都连同本步 RNG 一起回滚。公共 API 与 SSE 只投影玩家 outcome、公开检定、玩家 observation 和公开会话状态。

世界剧本使用 schema v5，SimulationState 使用 schema v6，WorldSessionDocument 使用 schema v7。所有会进入状态字典或引用图的 ID 拒绝 JavaScript 原型保留键，避免模型输出、世界包或持久化文档污染对象原型。旧版本直接拒绝，不提供迁移或双轨兼容。

### Consequences

- Agent 可以形成长期发展弧线，并能区分短期情绪、关系态度、目标和承诺。
- 同一步对话和防御需要额外的 Agent 模型调用，但只有 Truth Engine 明确请求 reaction 时才发生。
- Truth Engine 仍负责开放语义判断，内核负责验证刺激渠道、阶段顺序、幅度、引用和原子性。
- 一轮有限反应避免永久玩家先手，也避免反应链造成无界延迟和不稳定结算。
- schema 断代使世界作者和存档持有者必须使用完整的新契约。

## Pros and Cons of the Options

### 保留静态人格与目标

- 好：状态和模型输出最小，历史验证简单。
- 坏：角色只能积累事实，无法形成可信的发展、关系变化或目标生命周期。

### 永久玩家先结算

- 好：玩家输入后立即得到 NPC 响应，时序直观。
- 坏：攻击、移动和资源变化会在 NPC 防御前成为事实，玩家获得系统性先手，并破坏联合冲突公平。

### 无限反应链

- 好：可以表达任意复杂的即时互动。
- 坏：调用次数和延迟无上界，行动可能被反复替换，随机预承诺与原子重放难以验证。

### 分层演化、自身投影与一轮有限反应

- 好：角色发展、身体自知和同一步互动同时成立，并保留唯一最终行动集与原子提交点。
- 坏：共享契约、模型 schema、历史审计和测试矩阵显著扩大。

## Links

- [0031](0031-epistemic-multi-agent-truth-engine.md) — 独立信念图、预备行动与联合 Truth Engine。
- [0035](0035-truth-engine-hardening-and-verifiable-audit.md) — 结构化验证、公开边界和可验证审计。
- [0036](0036-multi-provider-model-gateway-and-fair-scheduler.md) — 模型 Profile、严格结构化输出、公平调度与审计。
- [0042](0042-causal-assurance-and-staged-model-profiles.md) — 分阶段 Truth 与 Agent Profile、因果复核。
- [引擎运行时规格](../game-design/engine-runtime.md) — 当前心智、反应和提交契约。
- [世界剧本格式](../game-design/script-format.md) — schema v5 角色种子格式。
