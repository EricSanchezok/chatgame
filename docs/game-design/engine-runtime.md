# Truth Engine 运行时规格

## 自由行动

玩家输入与 Agent 行动使用 `AgentActionProposal`：`rawText`、`goal`、显式 nullable `means` 和局部 `targetIds`。`id` 只是本次企图的审计身份，不是预配置动作类型。系统不存在动作目录、动作 kind、handler 匹配或 unknown-action fallback。

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

### Player knowledge

玩家知识保存局部实体、证据、claim 与已接收 observation ID，不保存 confidence/stance，也不推断真人心理。公共快照只返回这一层。

## Agent 生命周期

带 `agent` 配置的实体成为自主 Agent；普通物体没有 AgentMind。每个 Agent 保存自己的 `modelProfileId`，因此同一世界内可混合 DeepSeek、OpenAI、xAI 或其他目录 Profile。创建 Agent 的 world delta 必须同时引用已存在或本步创建的实体，使用目录中允许 `agent-mind` 的 Profile，并把 `nextAction` 设为 `null`。新 Agent 在创建步骤的 observation 后立即调用 AgentMind，只有它成功生成 belief patch 和下一行动，步骤才能提交。退休实体或 `remove_agent` 退出后续联合行动。

初始化会话时，所有初始 Agent 先以 revision 0、空 observation 运行 AgentMind，准备第一步行动。任一初始化失败则会话不创建。

## 联合步骤

所有行动必须等于当前 revision。进入 Truth Engine 前，联合输入按 actor ID 与 proposal ID 规范排序；Truth Engine 对数组整体裁决，不得因调用方数组顺序授予隐含先手。transition 必须：

- 精确覆盖每个行动一个 outcome；
- 以当前 revision 为 base；
- 让事件和 observation 指向下一 step；
- 覆盖玩家和每个提交后仍存在的 Agent 的 observation；
- 包含且只包含一次正数 `advance_time`；
- 为 delta、事件和 outcome 提供可解析的 action/check/event/fact/law 原因。

Truth Engine schema 或语义错误会把验证信息送回模型修复，最多两次。检定最多四轮。超过限制或任一 AgentMind 失败都不提交候选状态；调用方可从未变化的 revision 重试。

## d20 协议

不确定行动先返回 `request_checks`。每个请求声明 actor、可选 target/rating、整数 modifier、逐项 `{id, amount}` 修正来源、0–100 DC、normal/advantage/disadvantage、stakes、visibility 与 causes。同一检定 ID 和同一修正来源都只能出现一次；修正项只能引用 Rating 或数值 Fact。内核要求逐项之和等于 modifier，并核对结构化真实值，因此熟练、境界和环境加成都可以由剧本命名且不可伪造。自然语言 Law 可以作为检定 cause，但不能凭文字直接提供未经结构化的数值。内核验证后使用会话 RNG：normal 掷一枚，advantage/disadvantage 掷两枚并取高/低；结果为 `kept + modifier`，`total >= dc` 成功。

同一轮可预承诺多个请求以表达对抗检定；Truth Engine 只能在所有结果返回后联合解释胜负。伤害不是玩家动作类型：成功检定可作为 `adjust_meter` 的 cause，Meter threshold 由内核执行受伤、死亡或其他声明式后果。`core-d20` 配置明确声明是否启用这两种组合能力，但不固定属性名、伤害类型或 HP 名称。

同 seed、同前态、同检定请求得到同结果。Truth Engine 只有在 DC 与 stakes 已提交后才看到骰值。visibility 为：

- `full`：玩家看到骰子、修正、总值、DC、成败和 margin；
- `result_only`：只看到成败；
- `hidden`：公共事件不发送该检定。

## 通用 delta

允许的世界变化为创建/退休/移动实体，设置/删除事实，设置/调整 Meter，转移/生产/消耗 Quantity，设置 Rating，推进时间，创建/删除 Agent。这里的枚举是事务指令集，不是玩家动作集；它限制状态写入形状，却不限制可以表达的世界语义。

事务在结构化克隆上应用，最后运行完整状态验证。Meter 超界、Rating 超界、负数量、无来源生产、未知引用、包含循环、重复 ID、无因果或 observation 漏人都会使候选失败。threshold 使用 `firedThresholdIds` 保证一次性触发；阈值后果继承原始 delta 的原因，不能伪造独立法则来源。

## Observation 与信念更新

Truth Engine 为每个观察者分别输出表象。introduction 可以在服务端携带 canonical ID 以建立 binding，但传给 AgentMind 和浏览器前必须移除；局部 ID 也不能与 canonical ID 碰撞。`apparentClaims` 进入相应 belief/knowledge，不能自动写 truth。不同观察者可以收到不同甚至互相矛盾的表象。

玩家 observation、outcome 与替代建议在提交前经过公开信息守卫。守卫从未公开私密事实、canonical identity 以及玩家尚不知道的其他 Agent 信念建立保护集合；命中保护内容的模型输出进入修复流程而不是被公开或提交。世界 disclosure 是检定可见性的硬上限，模型只能保持或降低可见级别。

每个 AgentMind 调用在一次结构化输出中先提交 `BeliefPatch`，再提交下一行动。修复次数最多两次。所有 AgentMind 并发执行；任一无效时整个世界步骤回滚。

## Prompt 与上下文

Truth Engine 与 AgentMind 分别使用版本化 system prompt。模型上下文是规范 JSON envelope，包含 contract/prompt 版本、world/session/run 身份、revision、step 与显式 trust boundary。玩家文本、玩家 intent、Agent action 与 observation 中嵌入的指令都是数据，不能修改 system 职责、输出 schema 或世界权威。

Truth Engine 暂时获得完整上下文：世界名称与描述、法则、披露规则、已解析的规则包裁决语义、完整 canonical truth、全部已提交行动/检定/结果/事件/operations/observations 语义历史、玩家知识/绑定/当前目标、每个 Agent 的人格/目标/belief/绑定/待执行行动、当前联合行动、已承诺检定/结果、允许动态 Agent 使用的 Profile 以及修复时的结构化验证问题。本阶段不执行区域裁剪、RAG 或历史压缩。

AgentMind 只获得自身人格、目标、belief、去 canonical 的局部绑定标记、自身可见的完整主观历史、自身上一行动与可感知 outcome、本轮 observations 和结构化修复问题。它不获得 canonical truth、canonical ID、其他 Agent belief 或隐藏检定。OpenAI/xAI 由原生 strict JSON Schema 承载输出契约；DeepSeek 按官方 JSON mode 要求在 provider prompt 中附加精简 schema 和合法示例。完整调用协议见 [模型目录与 Gateway](model-gateway.md)。

## 审计与重放

每个 `CommittedStep` 保存 base/new revision、联合行动、完整检定请求与结果、RNG 前后态、outcomes、事件、observations、delta operations、Agent belief patches 和模型审计。模型审计包含 catalog/prompt 版本与 hash、role/subject/profile/provider/实际 model、原生推理配置、结构化输出模式、传输/语义尝试、队列/执行耗时、token、finish reason、provider request ID 和请求/响应 SHA-256；不保存密钥、prompt、原始响应或思维链。整个步骤另有 canonical JSON 内容 hash。

完整状态校验会重放历史中的 d20、核对 DC 先于骰值记录、RNG 连续性、请求/结果一一对应、全部因果引用、AgentMind 审计覆盖和每步内容 hash。历史是已发生事实的审计证据；重放不重新调用模型。

## 规则包

`RulePackageRegistry` 是服务端可注入扩展点。世界只引用包 ID、精确版本与 JSON 配置；loader 用该包的 strict schema 校验并把规范化引用交给 Truth Engine。未知包、版本不符、重复引用和多余配置都拒绝，世界归档不能加载代码。默认注册表只包含 `core-d20@1.0.0`。

## WorldRun 边界

玩家目标可以跨多个步骤保持 active。宿主循环到 `completed`、`failed`、`requiresPlayerDecision`、取消或步骤上限。取消会中止排队/在途模型批次并丢弃当前未提交候选步骤。模型失败把 run 标为 retriable failed，但不回滚早先已持久化步骤。
