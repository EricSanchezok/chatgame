# 世界剧本格式 v3

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

所有对象使用 strict zod schema，未知字段拒绝。YAML ID 应稳定且在相应命名空间唯一。

## `script.yaml`

```yaml
schema_version: 3
id: immortal-realms
name: 万域修途
version: 1.0.0
description: 横跨多个大陆与宗门的修行世界。
```

`id` 匹配 `[a-z0-9][a-z0-9-]*`；目录名不承担身份，安装目标使用 manifest ID。

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
    version: 1.0.0
    config:
      opposedChecks: true
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
    allow_production: false
    allow_consumption: true
ratings:
  - id: resolve
    name: 决心
    min: -5
    max: 10
```

`rule_packages` 至少包含一个服务端已注册包。引用由包 ID、精确版本和严格 JSON 配置组成；世界目录不能提供代码。默认注册表提供 `core-d20@1.0.0`，其两个布尔配置声明对抗检定组合与 Meter 伤害组合。未知包、版本不符、重复引用和多余配置拒绝加载。

Meter 的 `max` 必须大于 `min`，阈值位于范围内；threshold effect 为 `set_lifecycle` 或 `set_fact`。Quantity 明确是否允许生产/消耗；转移始终守恒。Rating 是剧本命名的通用检定修正，`max >= min`。

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
  model_profile_id: agent-default
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

`placement` 为另一个实体 ID 或 null。Fact value 为 text、number、boolean、entity 或 none；access 为 public、private 或指定 agent IDs。Meter/Rating 引用目录定义并受范围约束；Quantity 初值非负。同一实体可选 `agent`，没有该块就只是普通对象。

## 角色种子

`character.persona.summary` 是 Agent 角色配置中唯一必填的内容字段。`persona.voice` 默认为空字符串，traits、values、emotions、attitudes、goals 和 commitments 数组都默认为空。

trait/value 使用开放 `description`、0–1 strength 和默认 active 的 status。emotion 使用开放描述、0–1 intensity 和 active/resolved；attitude 额外以 `subject_id` 指向本 Agent belief 中的局部实体，并使用 active/retired。

goal 包含开放 description、0–1 priority/progress、局部 `target_ids`、可选 `parent_goal_id`、指向 trait/value/commitment 的 `motivated_by_ids`，状态默认为 active，也可为 suspended/completed/failed/abandoned。commitment 包含开放 description、0–1 priority、局部 `subject_ids`，状态默认为 active，也可为 fulfilled/broken/released。

每层记录可用 `evidence_ids` 引用 belief seed evidence。剧本不填写 created/updated step；loader 在初始步骤写入 0，动态创建由事务内核写入创建步骤。运行时演化规则见 [引擎运行时规格](engine-runtime.md#agent-character)。

## 信念种子

Agent belief 包含：

- `local_entities`：该 Agent 自己使用的身份与描述；
- `evidence`：observation/testimony/inference/assumption，带 step；
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

loader 验证实体、placement、fact entity value、Agent entity、唯一 self binding、角色局部引用与 evidence、玩家实体、Meter/Quantity/Rating 定义、binding canonical IDs、claim subject/evidence、范围、数量、唯一 ID 与 placement 无环。初始 Agent 可以没有 `nextAction`；创建会话时 AgentMind 统一初始化。

## 规模

格式不限制地点层级、实体 kind、predicate、Agent 人格或目标。大陆、位面、宗门、城市和房间都可以是实体并由 placement 组织。loader 一次加载完整包；作者应根据模型上下文与 Agent 成本控制初始活动规模。

loader 只接受 `schema_version: 3`。旧世界包直接拒绝，不提供兼容字段或迁移路径。
