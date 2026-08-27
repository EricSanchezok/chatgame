# 世界剧本格式 v9

世界包定义初始世界、法则、机制和可选的参与方式。它不定义玩家动作，不携带可执行代码，也不能提供自定义客户端 UI。

## 目录

```text
world-id/
├── script.yaml
├── laws.yaml
├── mechanics.yaml
├── participation.yaml       # 可选
├── entities/
│   └── *.yaml
└── assets/                  # 可选
    └── **/*.{png,webp,avif}
```

根目录只允许以上文件和目录；`entities/` 只允许普通 YAML 文件，`assets/` 只允许普通文件，任何符号链接、额外文件和额外目录都拒绝。至少需要一个 Entity。所有 YAML 对象使用 strict schema，未知字段拒绝。

语义 ID 必须是 NFC，不能带首尾空白或控制字符，规范 UTF-8 最多 128 字节，并在所属命名空间单义。`__proto__`、`prototype`、`constructor` 与 `rt:` 前缀保留给运行时；`player` 没有系统特权，可以作为普通 Agent 的语义 ID。运行时发生记录使用 `rt:<kind>:<sha256>` 身份。

## `script.yaml`

```yaml
schema_version: 9
id: immortal-realms
name: 万域修途
version: 1.0.0
description: 横跨多个大陆与宗门的修行世界。
runtime_defaults:
  simulated_seconds: 1
  realtime_interval_ms: 30000
  action_window_ms: 60000
model_profiles:
  perception: truth-fast
  reaction_routing: truth-fast
  resolution: truth-strong
  transition: truth-strong
  causal_verifier: verifier-strong
  grounding: truth-fast
  observation: truth-fast
  arrival: truth-fast
  dynamic_agent:
    bootstrap: agent-strong
    mind: agent-fast
    reaction: agent-fast
```

`id` 匹配 `[a-z0-9][a-z0-9-]*`；目录名不承担世界身份。`runtime_defaults` 分别规定默认模拟步长、实时触发间隔和外部行动窗口，World Instance 或实验 manifest 可以覆盖它们。三个值都是正整数，并受 schema 上限约束。

Profile 分别绑定 perception、reaction routing、resolution、transition、causal verifier、action grounding、observation renderer、arrival generator 和动态 Agent 的 bootstrap/mind/reaction 角色。所有字段必填并由模型目录验证；Truth 不能从模型输出中改写供应商、模型或 Profile。

## `laws.yaml`

```yaml
disclosure:
  default_check_visibility: full
laws:
  - id: time-passes
    text: 每个世界步骤都推进正数时间。
    severity: hard
```

至少定义一条法则。`severity` 为 `hard` 或 `soft`；它表达裁决优先级，不是行动枚举。`default_check_visibility` 为 `full`、`result_only` 或 `hidden`。

## `mechanics.yaml`

```yaml
rule_packages:
  - id: core-d20
    version: 1.1.0
    config: { damageUsesMeters: true }
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
random_distributions: []
```

`rule_packages` 至少引用一个服务端注册的精确版本；世界不能提供规则代码。Meter 阈值可以设置 lifecycle 或 Fact。Quantity 的生产与消耗分别由法则授权，转移保持守恒。Rating 是通用检定修正。

离散随机分布由有序 step 组成。每个 step 声明等概率 outcome 槽位、抽取次数、`first | sum | values` 聚合和可选的前序条件；重复槽位表达权重。运行时在抽取前固定请求，并用 seeded RNG 执行。完整预算和提交语义见[Truth 与随机承诺](engine-runtime.md#truth-与随机承诺)。

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
    persona: { summary: 谨慎，重视职责。, voice: 简短克制。 }
    traits: []
    values: []
    emotions: []
    attitudes: []
    goals:
      - id: guard-gate
        description: 守住石门。
        priority: 0.9
        progress: 0
        target_ids: []
        motivated_by_ids: []
    commitments: []
  belief:
    local_entities:
      - { id: self, name: 我, description: 石门守卫。, status: observed }
    evidence: []
    claims: []
    bindings:
      - { local_entity_id: self, canonical_entity_ids: [gatekeeper] }
```

`placement` 为另一个 Entity ID 或 null。Fact value 为 text、number、boolean、entity 或 none；access 为 public、private 或指定 Agent。Meter、Quantity 和 Rating 必须引用 `mechanics.yaml` 中的定义并满足范围约束。

`agent` 可选；存在时，该 Entity 是可行动主体的 canonical 身体。Agent 拥有独立 character、belief、局部 identity 和模型 Profile。不同 Agent 不能共享 canonical Entity，每个 Agent 必须恰有一个 local binding 指向自身 Entity。没有 `agent` 的 Entity 仍可作为地点、物品、组织或其他世界对象。

Character 的 persona summary 必填，其他 facets 可为空。Belief 的 local entities、evidence、claims 和 bindings 构成该 Agent 的私有认知；claim 可以与 canonical truth 冲突。剧本不填写运行时 revision、step、provenance、lifecycle ledger 或时间戳，这些字段由 loader 和执行内核物化。

## `participation.yaml`

缺失该文件时，世界没有 Origin：可以以 Observer 身份单步、批量和实时演化，也可以接管已有 Agent，但不能通过普通新游戏创建角色。

```yaml
origins:
  - id: courtyard-wanderer
    title: 庭院旅人
    fantasy: 带着未知来历抵达石门。
    description: 从一名没有既定历史的旅人开始。
    entity_kind: person
    spawn_entity_id: courtyard
    persona: 好奇而谨慎。
    default_goal: 弄清这里发生了什么。
    relationship_hooks: [守门人会留意你的来意。]
    risks: [陌生身份可能引起怀疑。]
    resources: []
    image:
      path: origins/wanderer.webp
      alt: 一名站在石门庭院中的旅人
    fallback_arrival: 你站在石门庭院里，周围的世界仍在自行运转。
```

Origin 定义身份幻想、出生位置、初始 persona、默认 goal、关系钩子、风险、资源、可选 Agent Profile、可选静态图片和入场生成失败时的回退文本。Participant 只能提供显示名称、外观描述和自由动机；引擎确定性创建 Entity、Agent、goal、资源和语义 ID，不让 LLM 修改出生点或数值。Observer 接管初始或运行时创建的存活 Agent 不依赖 Origin。

## 静态资源

资源只允许真实 PNG、WebP 和 AVIF；拒绝 SVG、动画和伪造扩展名。单文件不超过 4 MiB，世界总计不超过 32 MiB，宽高均不超过 4096 像素。Origin 图片必须提供用途化 alt 文本。

导入时按内容计算 SHA-256，运行时通过 hash 只读服务。世界 content hash 覆盖 manifest、法则、机制、实体、参与配置以及资源内容身份。

## 引用与加载

loader 验证 Entity、placement 无环、Fact、Agent self binding、character/belief 局部引用、Meter/Quantity/Rating、random distribution、Profile、Origin spawn/resource/image、数量和所有 ID 唯一性。初始 Agent 的 `nextAction` 由引擎设为 null；初始 lifecycle、Fact provenance、character 时间戳和运行时身份由引擎注入。

loader 只接受 `schema_version: 9`。旧世界包直接拒绝，不提供迁移或兼容层。
