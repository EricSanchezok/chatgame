# 世界剧本格式 v2

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
schema_version: 2
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
  persona: 谨慎，重视职责。
  goals: [守住石门, 弄清旅人的来意]
  belief:
    local_entities: []
    evidence: []
    claims: []
    bindings: []
```

`placement` 为另一个实体 ID 或 null。Fact value 为 text、number、boolean、entity 或 none；access 为 public、private 或指定 agent IDs。Meter/Rating 引用目录定义并受范围约束；Quantity 初值非负。同一实体可选 `agent`，没有该块就只是普通对象。

## 信念种子

Agent belief 包含：

- `local_entities`：该 Agent 自己使用的身份与描述；
- `evidence`：observation/testimony/inference/assumption，带 step；
- `claims`：subject local ID、开放 predicate/value、stance、0–1 confidence 和 evidence refs；
- `bindings`：服务端初始化用的局部 ID 到一个或多个 canonical ID 映射。

claim 可以与 truth 冲突。作者可明确写“玩家相信钥匙是真的”，同时 canonical fact 写“钥匙是假的”；loader 不会替作者纠正认知。

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

loader 验证实体、placement、fact entity value、Agent entity、玩家实体、Meter/Quantity/Rating 定义、binding canonical IDs、claim subject/evidence、范围、数量、唯一 ID 与 placement 无环。初始 Agent 可以没有 `nextAction`；创建会话时 AgentMind 统一初始化。

## 规模

格式不限制地点层级、实体 kind、predicate、Agent 人格或目标。大陆、位面、宗门、城市和房间都可以是实体并由 placement 组织。当前 loader 一次加载完整包；超大内容的分片与按需加载尚未成为 v2 契约，作者在此之前应根据模型上下文与 Agent 成本控制初始活动规模。
