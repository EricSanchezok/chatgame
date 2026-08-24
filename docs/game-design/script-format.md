# 世界剧本格式 v6

世界包是一个严格目录。它定义初始世界与法则，不定义玩家动作，不携带可执行代码或客户端 UI。

## 目录

```text
world-id/
├── script.yaml
├── laws.yaml
├── mechanics.yaml
├── player.yaml
└── entities/
    └── *.yaml
```

根目录只允许这四个文件和 `entities/`；实体目录只允许普通 `.yaml`/`.yml` 文件。额外目录、额外文件和符号链接都拒绝。至少需要一个实体。`actions.yaml`、`engine/`、`ui/` 与任何旧格式模块都是错误。

所有对象使用 strict zod schema，未知字段拒绝。语义 ID 必须是 NFC，不能带首尾空白或控制字符，规范 UTF-8 最多 128 字节，并在相应命名空间永久单义；`__proto__`、`prototype`、`constructor`、`player` Agent ID 与 `rt:` 前缀是保留身份，不能由世界内容占用。运行时发生记录使用引擎专有的 `rt:<kind>:<sha256>` 命名空间。

## `script.yaml`

```yaml
schema_version: 6
id: immortal-realms
name: 万域修途
version: 1.0.0
description: 横跨多个大陆与宗门的修行世界。
model_profiles:
  perception: truth-fast
  reaction_routing: truth-fast
  resolution: truth-strong
  transition: truth-strong
  causal_verifier: verifier-strong
```

`id` 匹配 `[a-z0-9][a-z0-9-]*`；目录名不承担身份，安装目标使用 manifest ID。五个 `model_profiles` 字段分别引用允许 `truth-perception`、`truth-reaction-routing`、`truth-resolution`、`truth-transition` 与 `causal-verifier` 的 Profile。每个字段都必填，可以指向同一 Profile，也可以按推理强度和成本拆分，不存在默认值。

## `laws.yaml`

```yaml
disclosure:
  default_check_visibility: full
laws:
  - id: time-passes
    text: 每个世界步骤都推进正数时间。
    severity: hard
  - id: spirit-stone-conservation
    text: 灵石只能转移，除非存在获准的矿脉或炼制来源。
    severity: hard
```

至少一条法则。法则是 Truth Engine 的语义宪法，也是生产/消耗与因果引用的合法来源。`severity` 为 hard/soft；它表达裁判优先级，不是玩家动作限制。

## `mechanics.yaml`

```yaml
rule_packages:
  - id: core-d20
    version: 1.1.0
    config:
      damageUsesMeters: true
meters:
  - id: health
    name: 生命
    min: 0
    max: 20
    thresholds:
      - id: death-at-zero
        when: { operator: lte, value: 0 }
        effects:
          - { kind: set_lifecycle, lifecycle: retired }
quantities:
  - id: spirit-stone
    name: 灵石
    unit: 枚
    production_law_ids: []
    consumption_law_ids: [spirit-stone-conservation]
ratings:
  - id: resolve
    name: 决心
    min: -5
    max: 10
random_distributions:
  - id: four-six-total
    description: 独立抽取四次六槽结果并求和。
    steps:
      - id: total
        count: 4
        outcomes: [1, 2, 3, 4, 5, 6]
        aggregate: sum
  - id: conditional-group-size
    description: 四分之一概率触发，触发后独立抽取四次四槽结果并求和。
    steps:
      - id: triggered
        count: 1
        outcomes: [false, false, false, true]
        aggregate: first
      - id: group-size
        count: 4
        outcomes: [1, 2, 3, 4]
        aggregate: sum
        when: { step_id: triggered, equals: true }
```

`rule_packages` 至少包含一个服务端已注册包。引用由包 ID、精确版本和严格 JSON 配置组成；世界目录不能提供代码。默认注册表提供 `core-d20@1.1.0`，其中 `apply-meter-impact` 根据已提交 resolution check 确定性派生 Meter 变化，并拒绝直接 `adjust_meter` 绕过。未知包、规则、版本不符、重复引用和多余配置拒绝。

Meter 的 `max` 必须大于 `min`，阈值位于范围内；threshold effect 为 `set_lifecycle` 或 `set_fact`。Quantity 通过 `production_law_ids` 与 `consumption_law_ids` 分别列出授权法则；空列表表示禁止相应操作，转移始终守恒。Rating 是剧本命名的通用检定修正，`max >= min`。

`random_distributions` 可省略，默认空数组。每个分布包含稳定 ID、说明和 1–100 个有序 step；每个 step 的 `count` 为 1–100，`outcomes` 是 2–100 个等概率槽位，允许重复值以表达权重。outcome 只能是非空字符串、安全整数、布尔值或 null；槽位顺序和重复次数都是运行契约的一部分。

导入按 canonical 稳定序列化后的实际 UTF-8 字节执行资源边界：单 outcome 至多 256 B，单分布至多 32 KiB，且单分布所有 step 的 `count` 合计至多 1,024；单个世界至多声明 256 个分布，完整 catalog 至多 512 KiB。边界值有效，超过一个分布、UTF-8 字节或一次声明抽取即拒绝；运行步骤的聚合预算见[离散随机协议](engine-runtime.md#离散随机协议)。

`aggregate: first` 要求 `count: 1`，返回一次抽取；`aggregate: sum` 要求所有 outcome 为安全整数并返回安全整数总和；`aggregate: values` 按抽取顺序返回完整数组。`when` 可省略或为 null；存在时只能用 `step_id` 引用本分布中更早且聚合结果不是 values 的 step，并以 `equals` 精确匹配 scalar 结果。条件不满足的 step 被标记 skipped，不抽取且不消耗 RNG。运行时如何预承诺、断言与重放这些分布见 [离散随机协议](engine-runtime.md#离散随机协议)。

## `entities/*.yaml`

```yaml
id: gatekeeper
kind: person
name: 守门人
description: 谨慎的石门守卫。
placement: courtyard
facts:
  - id: keeper-duty
    predicate: duty
    value: { kind: text, value: guard-the-gate }
    description: 他受命看守石门。
    access: { kind: private }
meters:
  - { id: "health:gatekeeper", definition_id: health, current: 15 }
quantities:
  - { definition_id: spirit-stone, amount: 20 }
ratings:
  - { id: "resolve:gatekeeper", definition_id: resolve, value: 3 }
agent:
  id: gatekeeper
  model_profiles:
    bootstrap: agent-strong
    mind: agent-fast
    reaction: agent-fast
  character:
    persona:
      summary: 谨慎，重视职责。
      voice: 简短克制，先询问再判断。
    traits:
      - { id: cautious, description: 面对陌生人时谨慎求证。, strength: 0.8 }
    values:
      - { id: duty, description: 重视守门职责。, strength: 0.9 }
    emotions:
      - { id: alertness, description: 对陌生人保持警觉。, intensity: 0.4 }
    attitudes:
      - id: toward-traveler
        subject_id: traveler
        description: 尚未信任这名旅人。
        intensity: 0.5
    goals:
      - id: guard-gate
        description: 守住石门。
        priority: 0.9
        progress: 0
        motivated_by_ids: [duty]
      - id: understand-traveler
        description: 弄清旅人的来意。
        priority: 0.6
        progress: 0
        target_ids: [traveler]
        motivated_by_ids: [cautious]
    commitments:
      - id: dawn-watch
        description: 答应同伴值守到天亮。
        priority: 0.8
        subject_ids: [self]
  belief:
    local_entities:
      - { id: self, name: 我, description: 石门守卫。, status: observed }
      - { id: traveler, name: 旅人, description: 门前的陌生人。, status: observed }
    evidence: []
    claims: []
    bindings:
      - { local_entity_id: self, canonical_entity_ids: [gatekeeper] }
      - { local_entity_id: traveler, canonical_entity_ids: [player] }
```

`placement` 为另一个实体 ID 或 null。Fact value 为 text、number、boolean、entity 或 none；access 为 public、private 或指定 agent IDs。Meter/Rating 引用目录定义并受范围约束；Quantity 初值非负。同一实体可选 `agent`，没有该块就只是普通对象。Agent ID 不能是 `player`，Agent 不能绑定玩家实体，不同 Agent 也不能共享 canonical entity；删除后的 Agent ID 在世界历史中不能重新创建。`model_profiles` 的三个必填字段分别引用允许 `agent-bootstrap`、`agent-mind` 与 `agent-reaction` 的 Profile；不同调用点和不同 Agent 都可独立选择 Provider/Profile。

loader 对规范化 manifest、laws、mechanics、player 与按实体 ID 排序的 entities 计算 `worldHash`；random distribution 的有序 steps 和 outcome 槽位因此参与内容身份。YAML 中的初始 Fact 不声明 provenance；运行态统一生成 `{ kind: "world_seed", id: worldHash }`，不得借用任意 Law 伪装世界种子来源。

## 角色种子

`character.persona.summary` 是 Agent 角色配置中唯一必填的内容字段。`persona.voice` 默认为空字符串，traits、values、emotions、attitudes、goals 和 commitments 数组都默认为空。

trait/value 使用开放 `description`、0–1 strength 和默认 active 的 status。emotion 使用开放描述、0–1 intensity 和 active/resolved；attitude 额外以 `subject_id` 指向本 Agent belief 中的局部实体，并使用 active/retired。

goal 包含开放 description、0–1 priority/progress、局部 `target_ids`、可选 `parent_goal_id`、指向 trait/value/commitment 的 `motivated_by_ids`，状态默认为 active，也可为 suspended/completed/failed/abandoned。trait、value 与 commitment 在同一 Agent 内共享 ID 命名空间，使未带 kind 的动机引用保持单义。commitment 包含开放 description、0–1 priority、局部 `subject_ids`，状态默认为 active，也可为 fulfilled/broken/released。

每层记录可用 `evidence_ids` 引用 belief seed evidence。剧本不填写 created/updated step；loader 在初始步骤写入 0，动态创建由事务内核写入创建步骤。运行时演化规则见 [引擎运行时规格](engine-runtime.md#agent-character)。

## 信念种子

Agent belief 包含：

- `local_entities`：该 Agent 自己使用的身份与描述；
- `evidence`：observation/testimony/inference/assumption，带显式 nullable `sourceId` 与 step；
- `claims`：subject local ID、开放 predicate/value、stance、0–1 confidence 和 evidence refs；
- `bindings`：服务端初始化用的局部 ID 到一个或多个 canonical ID 映射。

claim 可以与 truth 冲突。作者可明确写“玩家相信钥匙是真的”，同时 canonical fact 写“钥匙是假的”；loader 不会替作者纠正认知。

每个 Agent 必须恰好有一个局部实体 binding 包含自己的 entity ID。该局部实体是 `AgentSelfStateView` 的 self identity；缺失或多个 self binding 都会使世界拒绝加载。

## `player.yaml`

```yaml
entity_id: player
local_entities:
  - id: self
    name: 我
    description: 我所扮演的旅人。
    status: observed
evidence: []
claims: []
bindings:
  - local_entity_id: self
    canonical_entity_ids: [player]
```

玩家 claim 没有 stance/confidence；这是玩家角色已知内容，不是模型对真人心理的判断。`entity_id` 必须存在。

## 引用与状态校验

loader 验证实体、placement、fact entity value、Agent entity、唯一 self binding、角色局部引用与 evidence、玩家实体、Meter/Quantity/Rating 定义、random distribution 的顺序引用与聚合约束、binding canonical IDs、claim subject/evidence、Profile 存在性与角色、范围、数量、唯一 ID 与 placement 无环。loader 将初始 Agent `nextAction` 设为 null；创建会话时 AgentMind 统一初始化。

## 规模

格式不限制地点层级、实体 kind、predicate、Agent 人格或目标。大陆、位面、宗门、城市和房间都可以是实体并由 placement 组织。loader 一次加载完整包；作者应根据模型上下文与 Agent 成本控制初始活动规模。

loader 只接受 `schema_version: 6`。旧世界包直接拒绝，不提供兼容字段或迁移路径。超大内容的分片与按需加载尚未成为 v6 契约。
