# Truth Engine 运行时规格

## 自由行动

玩家输入与 Agent 行动使用 `AgentActionProposal`：`rawText`、`goal`、可选 `means` 和局部 `targetIds`。`id` 只是本次企图的审计身份，不是预配置动作类型。系统不存在动作目录、动作 kind、handler 匹配或 unknown-action fallback。

玩家说“我获得一万灵石”时，Truth Engine 必须把它理解为企图。若世界没有生产来源、转移来源或相应能力，结果应为 blocked/failed，并通过玩家可知 observation 解释可理解的阻力；`knownAlternatives` 只能引用玩家已经知道或本步观察到的途径。玩家句子本身绝不能生成数量 delta。

## 状态分层

### Canonical truth

`CanonicalWorldState` 保存：

- `entities`：稳定身份、类型、名称、描述、生命周期和创建步骤；
- `placements`：实体到容器/地点实体的单一包含边；
- `facts`：开放 predicate/value、访问策略和 provenance；
- `meters`：有上下界并可触发声明式 threshold 的连续量；
- `quantities`：按 holder 记录、支持守恒转移与受法则约束的生产/消耗；
- `ratings`：剧本命名的检定修正来源；
- `elapsedSeconds`：世界时间。

### Agent belief

每个自主 Agent 持有局部实体、证据和 claim。claim 有 stance、confidence 和 evidence refs，可以与 truth 相反。Agent 的 target 只能引用更新后 belief 中的局部实体。canonical mapping 不进入 AgentMind prompt。

### Player knowledge

玩家知识保存局部实体、证据、claim 与已接收 observation ID，不保存 confidence/stance，也不推断真人心理。公共快照只返回这一层。

## Agent 生命周期

带 `agent` 配置的实体成为自主 Agent；普通物体没有 AgentMind。创建 Agent 的 world delta 必须同时引用已存在或本步创建的实体。新 Agent 在创建步骤的 observation 后立即调用 AgentMind，只有它成功生成 belief patch 和下一行动，步骤才能提交。退休实体或 `remove_agent` 退出后续联合行动。

初始化会话时，所有初始 Agent 先以 revision 0、空 observation 运行 AgentMind，准备第一步行动。任一初始化失败则会话不创建。

## 联合步骤

所有行动必须等于当前 revision。Truth Engine 对数组整体裁决，不得因数组顺序授予隐含先手。transition 必须：

- 精确覆盖每个行动一个 outcome；
- 以当前 revision 为 base；
- 让事件和 observation 指向下一 step；
- 覆盖玩家和每个提交后仍存在的 Agent 的 observation；
- 包含且只包含一次正数 `advance_time`；
- 为 delta、事件和 outcome 提供可解析的 action/check/event/fact/law 原因。

Truth Engine schema 或语义错误会把验证信息送回模型修复，最多两次。检定最多四轮。超过限制或 AgentMind 失败都不提交候选状态。

## d20 协议

不确定行动先返回 `request_checks`。每个请求声明 actor、可选 target/rating、整数 modifier、modifier source、0–100 DC、normal/advantage/disadvantage、stakes、visibility 与 causes。内核验证引用后使用会话 RNG：normal 掷一枚，advantage/disadvantage 掷两枚并取高/低；结果为 `kept + modifier`，`total >= dc` 成功。

同 seed、同前态、同检定请求得到同结果。Truth Engine 只有在 DC 与 stakes 已提交后才看到骰值。visibility 为：

- `full`：玩家看到骰子、修正、总值、DC、成败和 margin；
- `result_only`：只看到成败；
- `hidden`：公共事件不发送该检定。

## 通用 delta

允许的世界变化为创建/退休/移动实体，设置/删除事实，设置/调整 Meter，转移/生产/消耗 Quantity，设置 Rating，推进时间，创建/删除 Agent。这里的枚举是事务指令集，不是玩家动作集；它限制状态写入形状，却不限制可以表达的世界语义。

事务在结构化克隆上应用，最后运行完整状态验证。Meter 超界、Rating 超界、负数量、无来源生产、未知引用、包含循环、重复 ID、无因果或 observation 漏人都会使候选失败。threshold 使用 `firedThresholdIds` 保证一次性触发。

## Observation 与信念更新

Truth Engine 为每个观察者分别输出表象。introduction 可以在服务端携带 canonical ID 以建立 binding，但传给 AgentMind 和浏览器前必须移除。`apparentClaims` 进入相应 belief/knowledge，不能自动写 truth。不同观察者可以收到不同甚至互相矛盾的表象。

每个 AgentMind 调用在一次结构化输出中先提交 `BeliefPatch`，再提交下一行动。修复次数最多两次。所有 AgentMind 并发执行；任一无效时整个世界步骤回滚。

## 审计与重放

每个 `CommittedStep` 保存 base/new revision、联合行动、检定结果、outcomes、事件、observations、delta operations 和 Agent belief patches。历史是已发生事实的审计证据；重放不重新调用模型。RNG 状态与 draw count 同步提交。

## WorldRun 边界

玩家目标可以跨多个步骤保持 active。宿主循环到 `completed`、`failed`、`requiresPlayerDecision`、取消或步骤上限。模型失败把 run 标为 retriable failed，但不回滚早先已持久化步骤。
