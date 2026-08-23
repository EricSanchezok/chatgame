# Truth Engine 运行时规格

## 自由行动

玩家输入与 Agent 行动使用 `AgentActionProposal`：`rawText`、`goal`、可选 `means` 和局部 `targetIds`。`id` 只是本次企图的审计身份，不是预配置动作类型。系统不存在动作目录、动作 kind、handler 匹配或 unknown-action fallback。

玩家说“我获得一万灵石”时，Truth Engine 必须把它理解为企图。若世界没有生产来源、转移来源或相应能力，结果应为 blocked/failed，并通过玩家可知 observation 解释可理解的阻力；每条 `knownAlternatives` 必须以玩家已有 evidence ID 或本步玩家 observation ID 作为结构化依据。玩家句子本身绝不能生成数量 delta。

## 状态分层

### Canonical truth

`CanonicalWorldState` 保存：

- `entities`：稳定身份、类型、名称、描述、生命周期和创建步骤；
- `placements`：实体到容器/地点实体的单一包含边；
- `facts`：开放 predicate/value、访问策略和 provenance；
- `meters`：有上下界并可触发声明式 threshold 的连续量；
- `quantities`：按 holder 记录、支持守恒转移与受法则约束的生产/消耗；
- `ratings`：剧本命名的检定修正来源；
- `elapsedSeconds`：世界时间；
- `events`：已提交的客观事件；
- `rng`：种子、内部状态和 draw count。

### Agent belief

每个自主 Agent 持有局部实体、证据和 claim。claim 有 stance、confidence 和 evidence refs，可以与 truth 相反。Agent 的 target 只能引用更新后 belief 中的局部实体。canonical mapping 不进入 AgentMind prompt。

### Agent character

每个自主 Agent 持有分层 `AgentCharacterState`：persona 是当前人格摘要与说话风格；traits/values 是长期倾向；emotions 是短期情绪；attitudes 是指向 Agent 私有局部实体的关系态度；goals 支持优先级、进度、目标、父目标和动机引用；commitments 表达对局部主体的承诺。`modelProfileId` 只选择部署模型，不属于角色状态。

角色记录只有 create/update、retire/resolve 和合法状态转换，没有物理删除。goal 的 completed/failed/abandoned 与 commitment 的 fulfilled/broken/released 是不可重新打开的终态。每条记录保留 engine-owned 的 created/updated step 和 evidence refs。

AgentMind 用 `CharacterPatch` 演化角色。每项操作必须引用本步骤属于自己的 observation，并引用更新后 belief 中存在的 evidence；应用顺序固定为 `BeliefPatch → CharacterPatch → nextAction`。内核从所引 observation 的当前步骤事件取最高 `impact` 并限制变化：

- ordinary：traits/values 单项最多 0.05，不得创建、退休或替换 persona；emotion/attitude 最多 0.35；goal/commitment 数值最多 0.25；
- significant：traits/values 最多 0.25，允许创建或退休；emotion/attitude 最多 0.75；goal/commitment 数值最多 0.50；
- transformative：所有数值可在 0–1 全范围变化，并允许整体替换 persona/voice。

目标与承诺的合法状态转换可由任意影响级别触发，但仍须有本步骤 observation 依据。

### Agent self state

服务端为每次 bootstrap、reaction 和常规 think 派生 `AgentSelfStateView`。它提供 self local ID、生命周期、世界时间、当前地点的名称/描述与已有时的局部地点 ID、自身全部 Meter 当前值与上下界、Quantity 数量与单位、Rating 数值与范围，以及 public 或明确授权给该 Agent 的自身 Fact。

视图不包含 entity、placement、meter、rating 的 canonical identity。实体值 Fact 只有能映射成 Agent 局部 ID 时才进入视图；private Fact、其他实体 Fact 和其他实体数值始终排除。每个 Agent 必须恰好有一个局部实体绑定自己的 canonical entity。

### Player knowledge

玩家知识保存局部实体、证据、claim 与已接收 observation ID，不保存 confidence/stance，也不推断真人心理。公共快照只返回这一层。

## Agent 生命周期

带 `agent` 配置的实体成为自主 Agent；普通物体没有 AgentMind。创建 Agent 的 world delta 必须同时引用已存在或本步创建的实体，并提供唯一 self binding。新 Agent 在创建步骤的 observation 后立即调用 AgentMind，只有它成功生成 belief patch、character patch 和下一行动，步骤才能提交。退休实体或 `remove_agent` 退出后续联合行动。

初始化会话时，所有初始 Agent 先以 revision 0、空 observation 运行 AgentMind，准备第一步行动。任一初始化失败则会话不创建。

## 联合步骤

所有行动必须等于当前 revision。进入 Truth Engine 前，玩家行动与 Agent 预备行动按 actor ID 与 proposal ID 规范排序；Truth Engine 对数组整体裁决，不得因调用方数组顺序授予隐含先手。步骤状态机固定为：

1. 锁定 player action 与全部 Agent prepared action 作为 initial actions；
2. 可选地预承诺并执行 perception checks；
3. 至多一次 `request_reactions`，请求中的 Agent 并发 keep/replace；
4. 锁定每个 actor 恰好一个 final action；
5. 可选地预承诺并执行 resolution checks；
6. 基于 final actions 提交 transition；
7. 生成最终 observation，执行 belief/character patch 并准备下一步行动；
8. 所有状态与 RNG 原子提交。

transition 必须：

- 精确覆盖每个行动一个 outcome；
- 以当前 revision 为 base；
- 让事件和 observation 指向下一 step；
- 覆盖玩家和每个提交后仍存在的 Agent 的 observation；
- 包含且只包含一次正数 `advance_time`；
- 为 delta、事件和 outcome 提供可解析的 action/check/event/fact/law 原因。

Truth Engine schema 或语义错误会把验证信息送回模型修复，最多两次。检定最多四轮。超过限制或任一 reaction/AgentMind 失败都不提交候选状态与 RNG；调用方可从未变化的 revision 重试。

## d20 协议

不确定行动先返回 `request_checks`。每个请求声明 actor、可选 target/rating、整数 modifier、逐项 `{id, amount}` 修正来源、0–100 DC、normal/advantage/disadvantage、stakes、visibility、`phase` 与 causes。phase 为 perception 或 resolution；同一请求轮不能混合 phase，reaction 后不得再请求 perception，任一 resolution 请求都会永久关闭本步 reaction window。修正项只能引用 Rating 或数值 Fact；内核要求逐项之和等于 modifier，并核对结构化真实值，因此熟练、境界和环境加成都可以由剧本命名且不可伪造。自然语言 Law 可以作为检定 cause，但不能凭文字直接提供未经结构化的数值。内核验证后使用会话 RNG：normal 掷一枚，advantage/disadvantage 掷两枚并取高/低；结果为 `kept + modifier`，`total >= dc` 成功。

同一轮可预承诺多个请求以表达对抗检定；Truth Engine 只能在所有结果返回后联合解释胜负。伤害不是玩家动作类型：成功检定可作为 `adjust_meter` 的 cause，Meter threshold 由内核执行受伤、死亡或其他声明式后果。`core-d20` 配置明确声明是否启用这两种组合能力，但不固定属性名、伤害类型或 HP 名称。

同 seed、同前态、同检定请求得到同结果。Truth Engine 只有在 DC 与 stakes 已提交后才看到骰值。visibility 为：

- `full`：玩家看到骰子、修正、总值、DC、成败和 margin；
- `result_only`：只看到成败；
- `hidden`：公共事件不发送该检定。

## Reaction window

首个版本只允许响应本步骤新提交的 player action。`ReactionRequest` 指定 Agent、player source action、该观察者私有的 `kind=stimulus` observation 与一组结构化感知 basis。每个 Agent 每步最多收到一个请求；未收到请求的 Agent 保留预备行动，所有 Agent 最终仍各占一个行动槽。

合法 basis 为同一个非空直接 placement、该 Agent 可访问的通信/感知 Fact，或成功的 perception check。perception check 必须由该 Agent 实体执行，并在 causes 中同时引用 player action 与可用 Fact/Law。无依据的远距离喊话进入 Truth Engine 修复；飞鸽、电话、传音或魔法感知只有在世界 Fact、Law 和必要检定建立渠道时才能触发。

stimulus 可以引入新的局部身份。AgentMind reaction 只返回 keep，或同 actor、同 base revision 的 replacement action；replacement target 可以引用已有 belief 或该 stimulus 新引入的局部实体。reaction 不得提交 BeliefPatch 或 CharacterPatch，不允许第二轮、Agent 间反应或反应链。玩家行动和 replacement 在最终 transition 中一起结算，因此同一步可以回复、闪避或打断，但玩家攻击不会先行命中。

## 通用 delta

允许的世界变化为创建/退休/移动实体，设置/删除事实，设置/调整 Meter，转移/生产/消耗 Quantity，设置 Rating，推进时间，创建/删除 Agent。这里的枚举是事务指令集，不是玩家动作集；它限制状态写入形状，却不限制可以表达的世界语义。

事务在结构化克隆上应用，最后运行完整状态验证。Meter 超界、Rating 超界、负数量、无来源生产、未知引用、包含循环、重复 ID、无因果或 observation 漏人都会使候选失败。threshold 使用 `firedThresholdIds` 保证一次性触发；阈值后果继承原始 delta 的原因，不能伪造独立法则来源。

## Observation 与信念更新

Truth Engine 为每个观察者分别输出表象。introduction 可以在服务端携带 canonical ID 以建立 binding，但传给 AgentMind 和浏览器前必须移除；局部 ID 也不能与 canonical ID 碰撞。introduction 建立观察者的局部实体词汇，`apparentClaims` 仍只进入相应 belief/knowledge，不能自动写 truth。不同观察者可以收到不同甚至互相矛盾的表象。

玩家 observation、outcome 与替代建议在提交前经过公开信息守卫。守卫从未公开私密事实、canonical identity 以及玩家尚不知道的其他 Agent 信念建立保护集合；命中保护内容的模型输出进入修复流程而不是被公开或提交。世界 disclosure 是检定可见性的硬上限，模型只能保持或降低可见级别。

最终 observation 后，每个 AgentMind 调用在一次结构化输出中依次提交 `BeliefPatch`、`CharacterPatch` 和下一行动。reaction stimulus 与 outcome observation 一起提供并进入最终原子记录。修复次数最多两次。所有 AgentMind 并发执行；任一无效时整个世界步骤回滚。

## 审计与重放

每个 `CommittedStep` 保存 base/new revision、initial/final actions、reaction requests/decisions、完整分阶段检定请求与结果、RNG 前后态、outcomes、带影响级别的事件、stimulus/outcome observations、delta operations、belief/character patches 和模型审计。reaction 使用独立 `agent-reaction` 审计角色。模型审计只含 role/subject/profile/provider/model、尝试与修复次数以及请求/响应 SHA-256；不保存 prompt、原始响应或思维链。整个步骤另有 canonical JSON 内容 hash。

完整状态校验会重放历史中的 d20、核对 phase 顺序、RNG 连续性、请求/结果一一对应、reaction 覆盖、initial/final actor 集、全部因果引用、AgentMind/Agent reaction 审计覆盖、角色 observation 依据和每步内容 hash。历史是已发生事实的审计证据；重放不重新调用模型。

世界运行态与会话文档使用 schema v2。旧版本会话直接拒绝，不执行迁移或兼容读取。公共会话快照、HTTP 和 SSE 不包含 AgentCharacterState、AgentSelfStateView、reaction stimulus/basis 或模型审计。

## 规则包

`RulePackageRegistry` 是服务端可注入扩展点。世界只引用包 ID、精确版本与 JSON 配置；loader 用该包的 strict schema 校验并把规范化引用交给 Truth Engine。未知包、版本不符、重复引用和多余配置都拒绝，世界归档不能加载代码。默认注册表只包含 `core-d20@1.0.0`。

## WorldRun 边界

玩家目标可以跨多个步骤保持 active。宿主循环到 `completed`、`failed`、`requiresPlayerDecision`、取消或步骤上限。模型失败把 run 标为 retriable failed，但不回滚早先已持久化步骤。
