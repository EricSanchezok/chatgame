# 剧本格式规格（Script Format Specification）v1.1

> 本文档是 chatgame 剧本格式 v1.1 的**人类契约**。机器契约见 `src/script/schemas/`（zod strict），两者一一对应；任何不一致以 schema 为准，且必须在同一变更内修复。
>
> 一个剧本 = 一个世界。加载不同剧本即成为完全不同的游戏；同一剧本每次开局体验不同；一个剧本可无限游玩。本文档定义"剧本必须回答的问题"——世界观、时间、机制、实体、事件、任务、叙事资产与运行策略——全部通过**纯配置**表达（无代码、无表达式字符串）。

## 目录

- [0. 总则](#0-总则)
- [1. script.yaml — 元信息](#1-scriptyaml--元信息)
- [2. world.yaml — 世界宪法](#2-worldyaml--世界宪法)
- [3. time.yaml — 时间机制](#3-timeyaml--时间机制)
- [4. mechanics.yaml — 机制配置](#4-mechanicsyaml--机制配置)
- [5. actions.yaml — 动作词表](#5-actionsyaml--动作词表)
- [6. plot.yaml — 承诺骨架](#6-plotyaml--承诺骨架)
- [7. director.yaml — 导演系统](#7-directoryaml--导演系统)
- [8. worldgen.yaml — 开局随机化](#8-worldgenyaml--开局随机化)
- [9. run.yaml — 运行策略](#9-runyaml--运行策略)
- [10. safety.yaml — 内容边界](#10-safetyyaml--内容边界)
- [11. origins/ — 玩家出身](#11-origins--玩家出身)
- [12. npcs/ — NPC](#12-npcs--npc)
- [13. locations/ — 地点](#13-locations--地点)
- [14. items/ — 物品](#14-items--物品)
- [15. factions/ — 势力](#15-factions--势力)
- [16. events/ — 事件池](#16-events--事件池)
- [17. tasks/ — 任务模板](#17-tasks--任务模板)
- [18. narrative/ — 叙事资产](#18-narrative--叙事资产)
- [19. theme.yaml — 主题（可选）](#19-themeyaml--主题可选)
- [20. assets.yaml — 资产索引（可选）](#20-assetsyaml--资产索引可选)
- [附录 A. 内置动作库](#附录-a-内置动作库26-个)
- [附录 B. base_class 实体基类](#附录-b-base_class-实体基类)
- [附录 C. 条件代数 op 全集](#附录-c-条件代数-op-全集)
- [附录 D. 效果代数 kind 全集](#附录-d-效果代数-kind-全集)
- [附录 E. 引用完整性矩阵](#附录-e-引用完整性矩阵)
- [附录 F. 版本与扩展性契约](#附录-f-版本与扩展性契约)
- [附录 G. 完整示例剧本片段](#附录-g-完整示例剧本片段)

---

## 0. 总则

### 0.1 目录结构（强制）

一个剧本 = 一个目录。目录名必须等于 `script.yaml` 中的 `id`（小写连字符）。全部 18 个模块中，`script.yaml`、`world.yaml`、`time.yaml`、`mechanics.yaml`、`actions.yaml`、`plot.yaml`、`director.yaml`、`worldgen.yaml`、`run.yaml`、`safety.yaml`、`origins/`、`npcs/`、`locations/`、`narrative/` 为**必选**；`items/`、`factions/`、`events/`、`tasks/` 为**可选**（但强烈建议提供；"无限游玩"依赖事件与任务供给）。`engine/` 与 `ui/` 为**可选代码目录**（见 §0.6）。

```
scripts/<id>/
├── script.yaml      # 1. 元信息（必）
├── world.yaml       # 2. 世界宪法（必）
├── time.yaml        # 3. 时间机制（必）
├── mechanics.yaml   # 4. 机制配置（必）
├── actions.yaml     # 5. 动作词表（必）
├── plot.yaml        # 6. 承诺骨架（必）
├── director.yaml    # 7. 导演系统（必）
├── worldgen.yaml    # 8. 开局随机化（必）
├── run.yaml         # 9. 运行策略（必）
├── safety.yaml      # 10. 内容边界（必）
├── origins/         # 11. 玩家出身（必，≥1）
├── npcs/            # 12. NPC（必，≥1）
├── locations/       # 13. 地点（必，≥1）
├── items/           # 14. 物品（可选）
├── factions/        # 15. 势力（可选）
├── events/          # 16. 事件池（可选）
├── tasks/           # 17. 任务模板（可选）
├── narrative/       # 18. 叙事资产（必）
│   ├── opening.yaml #    开场场景（必）
│   ├── style.yaml   #    文风指南（必）
│   ├── lore/        #    设定条目（可选）
│   ├── examples/    #    示例对话（可选）
│   └── event_texts/ #    事件文本模板（可选）
├── theme.yaml       # 19. 主题（可选）：调色板/字体/动效 + by_location
├── themes/          #    附加主题包（可选，同一 schema）
├── assets.yaml      # 20. 资产索引（可选）：立绘/场景/图标/语音/音效
├── assets/          #    资产文件目录（布局约定见 §20）
├── engine/          #    可选：服务端扩展代码（§0.6）
│   └── index.ts     #      默认导出 (ctx: EngineExtensionContext) => void
└── ui/              #    可选：前端扩展代码（§0.6）
    └── index.tsx    #      默认导出 (ctx: ScriptUiContext) => void
```

### 0.2 纯配置原则

- **核心逻辑用配置**：所有规则用"条件代数"（附录 C）与"效果代数"（附录 D）的结构化对象表达。
- **代码目录是可选扩展缝**：需要超越配置表达力的剧本，可在 `engine/`（服务端规则扩展）与 `ui/`（前端表现扩展）写代码（§0.6）；**无代码目录的剧本完全合法**，等价于纯配置剧本。
- **禁止字符串插值/公式求值**：条件值、效果量、概率权重均为字面量（配置面内）。
- 剧本声明"什么"，引擎决定"怎么"：机制算法、注入策略、校验执行均属引擎。

### 0.6 代码目录（engine/ 与 ui/，可选）

剧本代码与框架同权（**信任剧本作者**；本地部署、作者即玩家）。`engine/` 代码在服务端运行（fs/YAML/API key 可达），`ui/` 代码在浏览器运行（React 组件，仅可访问框架注入的 props 与 CSS 变量 `--cg-*`）。

- **engine/index.ts**（服务端扩展）：默认导出 `(ctx: EngineExtensionContext) => void`；可注册：
  - `registerEffect(kind, handler)` — 自定义效果种类（`effect` 的 `kind` 不在内置集合时运行时裁决；未注册的 kind 在剧本校验时报错）。
  - `registerConditionSource(source, evaluator)` — 自定义条件源（`condition.source` 任意字符串；未注册源在校验与运行期均报错）。
  - `registerActionHandler(id, handler)` — 自定义动作处理器（`actions[].handler` 引用；内置动作在声明 handler 时用自定义实现覆盖）。handler 纯规划并返回 `{rejected?, costs?, timeCost?, execute}`；`execute(state, grade)` 只在真实结算中调用一次，预检不得 dry-run。
  - handler 均以不可变快照工作；自定义持久状态写入 `WorldState.runtimeState`（引擎不解释内容，随存档 v5 持久化）。
- **ui/index.tsx**（前端扩展）：默认导出 `(ctx: ScriptUiContext) => void`，`ctx.register(slot, { component, position?, order? })`；槽位见表现层规格 [presentation.md](presentation.md) 的 UI 拓扑。组件 props 由框架按槽位注入；未注册槽位回退框架默认组件。
- **编译与缓存**：`engine/` 由 esbuild 编译为 CJS（`createRequire` 加载），`ui/` 编译为 ESM browser bundle（react 外部化，宿主单实例共享）；产物缓存于 `.chatgame/build/<id>/`（内容 hash 失效，gitignore）。
### 0.3 ID 契约

- 实体 `id` 全局唯一（跨文件）、小写连字符（`^[a-z][a-z0-9-]*$`）、发布后**不得更改**（存档迁移前提）。
- 跨文件引用（如 `home: emberfall-tavern`）必须指向存在的 id，由语义校验层逐边检查（附录 E）。

### 0.4 运行态隔离

- 剧本文件**禁止携带运行时状态**（无时间戳、无进程内可变值、无随机结果）。
- 所有可变状态属引擎的 WorldState：世界定义实例 + 事件日志 + 玩家状态 + RNG 种子。

### 0.5 版本契约

- `schema_version` 必须为 `"1.1"` 且与引擎支持版本**严格相等**。
- 2.0 之前只允许**加法演进**（新增可选字段、新增动作/effect/op）；破坏性变更必须升大版本。
- 引擎仅加载与其声明版本严格相等的剧本。

---

## 1. script.yaml — 元信息

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `id` | string | ✅ | 小写连字符；必须等于目录名 |
| `name` | string | ✅ | 剧本显示名 |
| `description` | string | ✅ | 一句话介绍（作者/玩家可见） |
| `schema_version` | string | ✅ | 固定 `"1.1"` |
| `language` | string | ✅ | 剧本内容语言代码（如 `zh`、`en`） |
| `tone` | string[] | ✅ | 情感基调（如 `悬疑`、`温情`），约束 LLM 文风 |
| `author` | string | ✅ | 作者名 |
| `credits` | string | ❌ | 致谢/来源 |
| `ext` | object | ❌ | 自由扩展位（引擎版本化消费） |

```yaml
id: emberfall
name: 灰烬镇
description: 蒸汽与魔法并存的边陲小镇，矿脉枯竭，人心浮动
schema_version: "1.1"
language: zh
tone: [悬疑, 温情]
author: chatgame-team
```

---

## 2. world.yaml — 世界宪法

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `background` | string | ✅ | 长文世界背景（LLM 世界观锚点） |
| `rules` | array | ✅ | 引擎执行的声明式世界规则；每项 `{id, text, mechanism?}` |
| `taboos` | array | ✅ | LLM 叙事禁区；每项 `{id, text, severity: hard\|soft}` |
| `glossary` | array | ❌ | 术语表；每项 `{term, aliases[], definition}`，约束 LLM 术语一致性 |
| `ext` | object | ❌ | 扩展位 |

规则语义：

- `rules`：**引擎执行**——违反即状态变更被拒/回滚。
- `taboos`：**LLM 遵守**——`hard` 违反即引擎侧重试/截断；`soft` 违反即降级处理（警告）。
- `glossary`：注入 LLM 上下文，保证专有名词一致。

```yaml
background: "灰烬镇坐落在黑石山脉脚下……矿脉在三年前枯竭，镇民靠残存的炼金工坊与过路商队维生。"
rules:
  - id: no-matter-creation
    text: "任何人不能凭空创造物品"
    mechanism: inventory
  - id: magic-needs-material
    text: "魔法需要施法材料"
    mechanism: combat
taboos:
  - id: no-secret-leak
    text: "不得让 NPC 透露未满足揭露条件的秘密"
    severity: hard
glossary:
  - term: 灰烬
    aliases: [烬]
    definition: 黑石矿脉炼金残渣，镇名的由来
```

---

## 3. time.yaml — 时间机制

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `unit` | string | ✅ | 固定 `"hour"` |
| `day_length_hours` | integer | ✅ | >0 |
| `calendar` | object | ✅ | `months[] {name, days}`（≥1）、`weekdays[]`（≥1） |
| `seasons` | array | ❌ | `{name, start(月-日), weather_table[] {weather, weight}}` |
| `festivals` | array | ❌ | `{id, name, date(月-日), event?(事件 id)}` |
| `schedules` | array | ✅ | 命名作息模式；`{id, entries[] {from, to, activity, location?}}`，NPC 引用 |
| `world_advances` | boolean | ✅ | 玩家离线时世界是否推进 |
| `advance_mode` | string | ✅ | 固定 `"rule_based"`（离线推进用规则驱动，成本分层） |
| `advance_scope` | string[] | ✅ | 子集：`schedules\|needs\|events\|factions\|time_events`；离线推进的确定性范围 |
| `ext` | object | ❌ | 扩展位 |

```yaml
unit: hour
day_length_hours: 24
calendar:
  months:
    - { name: 一月, days: 31 }
    - { name: 二月, days: 28 }
  weekdays: [周一, 周二, 周三, 周四, 周五, 周六, 周日]
seasons:
  - name: 春
    start: 03-01
    weather_table: [ { weather: 晴, weight: 5 }, { weather: 雨, weight: 3 } ]
schedules:
  - id: tavern_keeper
    entries:
      - { from: 08:00, to: 22:00, activity: 开店, location: emberfall-tavern }
      - { from: 22:00, to: 08:00, activity: 睡觉, location: emberfall-home }
world_advances: true
advance_mode: rule_based
advance_scope: [schedules, needs, time_events]
```

---

## 4. mechanics.yaml — 机制配置

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `stats` | array | ✅ | `{name, min, max, initial, description}`；剧本声明属性名，引擎提供统一数值语义 |
| `skills` | array | ❌ | `{name, min, max, initial, description}` |
| `needs` | array | ❌ | `{name, min, max, initial, decay_per_day, thresholds[] {level, label, effects[]}}` |
| `status_effects` | array | ❌ | `{id, name, kind, description?, effects[], duration?, stackable}`；`kind` 为自由文本标签（如 buff/debuff/neutral，引擎不消费，仅作者分类） |
| `inventory` | object | ✅ | `{capacity, stacking}` |
| `currency` | object | ✅ | `{name, symbol, initial}` |
| `combat` | object | ✅ | `{damage_types[], defense_types[], hp_stat(引用 stats 名), threat_gauge {max, on_full(引用 run.yaml 软失败策略)}}` |
| `progression` | array | ❌ | `{source: stat_check\|skill_check\|task\|event, target, amount, cap?}` |
| `ext` | object | ❌ | 扩展位 |

属性名由剧本声明，但**剧本不能定义新机制类型或算法**——新机制 = 引擎新版本 + schema_version 提升。

`needs[].thresholds` 是持久化边沿触发：数值首次进入阈值区间时施加效果，停留期间不重复；恢复离开后再次进入才可重触发。`progression` 只增长触发行为对应的实体（默认玩家）与对应 target，不广播到所有 NPC。

```yaml
stats:
  - { name: strength, min: 1, max: 20, initial: 10, description: 力量 }
  - { name: charisma, min: 1, max: 20, initial: 10, description: 魅力 }
skills:
  - { name: persuasion, min: 0, max: 20, initial: 0, description: 说服 }
needs:
  - name: hunger
    min: 0
    max: 100
    initial: 80
    decay_per_day: 20
    thresholds:
      - { level: 30, label: 饥饿, effects: [ { kind: stat, direction: add, target: player, stat: strength, value: -2 } ] }
inventory: { capacity: 20, stacking: true }
currency: { name: 金币, symbol: "g", initial: 50 }
combat:
  damage_types: [physical, fire, arcane]
  defense_types: [armor, ward]
  hp_stat: hp
  threat_gauge: { max: 100, on_full: soft_failure_consequence }
progression:
  - { source: skill_check, target: persuasion, amount: 1, cap: 20 }
```

---

## 5. actions.yaml — 动作词表

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `actions` | array | ✅ | 从内置动作库（附录 A，26 个）**选择**并配置，或声明**自定义动作**（`handler` 引用剧本 `engine/` 扩展注册的处理器，§0.6） |
| 每项 | object | — | `{id, enabled, display_name?, resolve?, conditions?, costs?, effects?, llm_freedom, cooldown?, handler?}` |
| `ext` | object | ❌ | 扩展位 |

`resolve` 在声明 `handler` 时可省略（处理器拥有结算语义）；否则必填。动作 `id` 允许下划线（兼容内置 `use_item`）。

`resolve`：

- `{type: stat_check, stat, dc}` — 属性检定（d20 + 属性 vs DC）
- `{type: skill_check, skill, dc}` — 技能检定
- `{type: opposed_check, stat, npc_stat}` — 对抗检定（双方属性）
- `{type: auto}` — 必然成功
- `{type: narrative_only}` — 纯叙事，无引擎结算

`llm_freedom`：`narration`（过程即兴、结果引擎定）| `process`（过程即兴、结果 LLM 定）| `result`（结果也引擎定）。

```yaml
actions:
  - id: talk
    enabled: true
    resolve: { type: auto }
    llm_freedom: narration
  - id: persuade
    enabled: true
    resolve: { type: skill_check, skill: persuasion, dc: 12 }
    llm_freedom: narration
  - id: attack
    enabled: true
    resolve: { type: stat_check, stat: strength, dc: 12 }
    effects:
      - { kind: stat, direction: add, target: npc1, stat: hp, value: -5 }
    llm_freedom: process
```

剧本可禁用/改名/配置内置动作；**自定义动作逻辑**通过 `handler` 引用剧本 `engine/index.ts` 注册的处理器（§0.6）——未注册的 handler id 在剧本校验和运行期均报错。客户端的权威 `ActionPreview` 将声明成本与 handler 计划中的动态货币/物品/资源成本合并，并采用计划耗时。

---

## 6. plot.yaml — 承诺骨架

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `commitments` | array | ✅ | `{id, description, type, trigger, must_happen, deadline?, related?}` |
| `ext` | object | ❌ | 扩展位 |

`type`：自由文本（引擎不分支读取，仅作者分类）；约定俗成取值：

- `secret_reveal` — 某秘密最终被揭露；`trigger.condition` 为揭露条件
- `time_event` — 某时间点必发生；`trigger.time` 为时间
- `condition_event` — 条件满足必发生；`trigger.condition`

`trigger`：`{time? {day, month?, hour?} | condition?(条件代数)}`。

`deadline`：`{time|condition, on_miss {escalation_text, effects[]}}`。

承诺是"什么必须发生"不是"怎么发生"——引擎记录承诺清单并在 LLM 输出后校验（NCP-Bench 依据）。

```yaml
commitments:
  - id: elara-secret-reveal
    description: "艾拉的秘密最终被揭露"
    type: secret_reveal
    trigger:
      condition: { all: [ { source: relationship, key: elara, op: gte, value: 60 } ] }
    must_happen: true
    deadline:
      time: { day: 90 }
      on_miss:
        escalation_text: "秘密以另一种方式浮出水面"
        effects: [ { kind: flag, direction: set, target: player, flag: mine-secret-leaked } ]
    related: { secrets: [mine-secret], npcs: [elara] }
  - id: mine-anniversary
    description: "矿难三周年纪念日，全镇事件"
    type: time_event
    trigger: { time: { month: 1, day: 3 } }
    must_happen: true
    related: { events: [anniversary] }
```

---

## 7. director.yaml — 导演系统

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `tension` | object | ✅ | `variables[] {name, source, min, max, initial}`（张力变量，事件选择的输入） |
| `event_selection` | object | ✅ | `policy: weighted_by_band`、`bands[] {band, weight_multiplier}`（张力带加权） |
| `pacing` | object | ✅ | `crisis_density`、`breather_min_interval`、`difficulty_ramp` |
| `novelty` | object | ✅ | `seen_tracking: true`、`cooldown_default`（新鲜度调度） |
| `ext` | object | ❌ | 扩展位 |

事件选择按玩家状态（张力带加权）而非纯随机/纯固定（RimWorld Storyteller 剧本化）。

```yaml
tension:
  variables:
    - { name: danger, source: threat_gauge, min: 0, max: 100, initial: 10 }
event_selection:
  policy: weighted_by_band
  bands:
    - { band: [0, 30], weight_multiplier: 0.8 }
    - { band: [30, 70], weight_multiplier: 1.0 }
    - { band: [70, 100], weight_multiplier: 1.3 }
pacing: { crisis_density: 0.3, breather_min_interval: 2, difficulty_ramp: 0.05 }
novelty: { seen_tracking: true, cooldown_default: 3 }
```

---

## 8. worldgen.yaml — 开局随机化

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `randomize` | array | ✅ | `{target, jitter?, pool?, distribution: uniform\|weighted}` |
| `fixed` | array | ✅ | 显式白名单：承诺、世界规则、术语表、禁忌永不随机 |
| `seed` | object | ✅ | `policy: per_run`（每次开局不同） |
| `ext` | object | ❌ | 扩展位 |

`target` ∈ `npc_stats|npc_placement|secret_holder|faction_stance|weather|season|item_placement|starting_event`。

```yaml
randomize:
  - target: npc_stats
    jitter: 0.1
  - target: secret_holder
    pool: [elara, inspector, priest]
    distribution: weighted
  - target: weather
    distribution: uniform
fixed: [plot_commitments, world_rules, glossary, taboos]
seed: { policy: per_run }
```

---

## 9. run.yaml — 运行策略

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `death_policy` | object | ✅ | `{mode, soft_failure?, world_continue?, hard_reset?}` |
| `meta_progression` | object | ✅ | `{keep[], reset[], unlocks[]}` |
| `memory` | object | ✅ | `tier_retention_days {major, minor, trivial}`（major 0 = 永久） |
| `context_compaction` | object | ✅ | `policy: summarize_archive`、`retention_tiers`（引用 memory） |
| `ext` | object | ❌ | 扩展位 |

`death_policy.mode`：

- `soft_failure` — 威胁条过高→移送副作用地点（Fallen London 式）；`{gauge_ref, threshold, consequence {location, effects[], narrative}}`
- `world_continue` — 世界延续，玩家换角色；`{succession: heir_pool\|new_character, state_kept[]}`
- `hard_reset` — 世界重置；`{world_reroll: reroll_worldgen\|keep_world}`

```yaml
death_policy:
  mode: soft_failure
  soft_failure:
    gauge_ref: threat_gauge
    threshold: 100
    consequence:
      location: emberfall-infirmary
      effects: [ { kind: stat, direction: add, target: player, stat: hp, value: -5 } ]
      narrative: "你在昏迷中醒来，躺在诊疗室的病床上……"
meta_progression:
  keep: [flags, lore, relations_overview]
  reset: [stats, inventory, location, currency]
  unlocks:
    - { flag: returned_visitor, grant: [new_origin_miner_foreman] }
memory:
  tier_retention_days: { major: 0, minor: 90, trivial: 30 }
context_compaction:
  policy: summarize_archive
  retention_tiers: [major, minor]
```

---

## 10. safety.yaml — 内容边界

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `content_classes` | array | ✅ | 内容类标签（自由文本；剧本约定 11 类：`violence\|romance\|horror\|profanity\|self_harm\|sexual\|drugs\|gambling\|politics\|religion\|crime`） |
| `allowed` | object | ✅ | `{class: max_intensity}`；强度为自由文本（剧本约定 `none\|mild\|moderate\|intense\|explicit`） |
| `forbidden` | array | ✅ | 内容类列表（完全禁止） |
| `age_rating` | string | ✅ | 如 `16+`、`18+` |
| `ext` | object | ❌ | 扩展位 |

声明级契约：执行（过滤管道）属引擎。

```yaml
content_classes: [violence, romance, horror, profanity, self_harm, sexual, drugs, gambling, politics, religion, crime]
allowed:
  violence: intense
  romance: moderate
  horror: intense
  profanity: mild
  self_harm: none
  sexual: none
  drugs: mild
  gambling: moderate
  politics: mild
  religion: mild
  crime: moderate
forbidden: [self_harm, sexual]
age_rating: "16+"
```

---

## 11. origins/ — 玩家出身

一文件一出身。`{id, name, description, difficulty?, stats?, skills?, items[], starting_location, starting_currency, starting_relations[], starting_knowledge[], exclusive_leads[], denied_actions[], exclusive_to?}`

- `stats/skills`：`{override}` 覆盖剧本默认值
- `starting_relations[]`：`{npc, value, type?, description?}`（type/description 均为自由文本，作者用自然语言表达关系质地）
- `starting_knowledge[]`：flag ids（玩家已知信息）
- `exclusive_leads[]`：event/secret ids（只有该出身能接触的线索）
- `denied_actions[]`：动作 id（该出身禁用）
- `exclusive_to?`：出生地的地点 id

```yaml
id: miner
name: 矿工出身
description: 你在地下摸爬滚打多年
difficulty: easy
stats: { strength: 14, charisma: 8 }
skills: {}
items: [pickaxe, lantern]
starting_location: emberfall-tavern
starting_currency: 30
starting_relations:
  - { npc: elara, value: 40, type: 老主顾, description: 你常去她的酒馆 }
starting_knowledge: [mine-collapsed-3y-ago]
exclusive_leads: [mine-secret-hint]
denied_actions: []
```

---

## 12. npcs/ — NPC

一文件一 NPC。`{id, name, base_class, description, traits[], stats?, skills?, needs?, occupation, schedule?, home?, items[], relations[], memory?, secrets[], knowledge_flags[], llm}`

- `base_class`：自由文本（如 `humanoid`/`creature`，引擎不消费，仅为作者标签）
- `traits[]`：`{name, description, effects[]?}`（特性影响行为/数值）
- `relations[]`：`{target(npc id), value(-100..100), type(自由文本，如 青梅竹马/酒肉朋友), description?(自由文本，关系的静态描述)}`；关系矩阵由引擎双向构建，NPC↔NPC 与 →player 同模型。**语义标签不用枚举**——数值是引擎事实源，type/description 承载"同是朋友但质地不同"的细腻语义，运行时注入 LLM 上下文
- `memory`：`{initial[] {text, importance: major\|minor\|trivial, tags[]}, forget_policy{major_keep}}`；记忆强度按层级初始（major 1.0 / minor 0.6 / trivial 0.3），日界按 `tier_retention_days` 连续衰减，跌破阈值归档；被注入时强化
- `secrets[]`：`{id, content, reveal {logic(条件代数)}}`；未满足揭露条件前 LLM 不得剧透（taboo 默认项）
- `llm`：`{personality, speech_patterns[], knowledge_filter: true, dialogue_examples?(引用 narrative/examples)}`

```yaml
id: elara
name: 艾拉
base_class: humanoid
description: 酒馆老板娘，寡言但心细
traits:
  - { name: 谨慎, description: 不轻易信任陌生人, effects: [] }
stats: { hp: 80, charisma: 14 }
skills: { persuasion: 10 }
occupation: tavern_keeper
schedule: tavern_keeper
home: emberfall-tavern
items: []
relations:
  - { target: inspector, value: 30, type: 老相识, description: 常来查账 }
memory:
  initial:
    - { text: "三年前丈夫死于矿井事故", importance: major, tags: [family, mine] }
    - { text: "欠酒商 20 金币", importance: minor, tags: [debt] }
secrets:
  - id: mine-secret
    content: "矿井事故另有隐情，与镇长有关"
    reveal:
      logic: { all: [ { source: relationship, key: player, op: gte, value: 60 } ] }
knowledge_flags: [mine-secret-holder]
llm:
  personality: 说话轻声细语，回避谈论矿井
  speech_patterns: [用短句, 爱用"孩子"称呼年轻人]
  knowledge_filter: true
```

---

## 13. locations/ — 地点

一文件一地点。`{id, name, type, description, connections[], ambient_events?, npcs_present?, items?, danger_level, entry_condition?, exit_condition?}`

- `type`：自由文本（如 `indoor|outdoor|district|region`，引擎不消费，仅展示）
- `connections[]`：`{to(地点 id), distance, travel_time, condition?}`（构成地点图，移动动作依据）
- `ambient_events[]`：event ids（该地点的氛围事件）
- `npcs_present[]` / `items[]`：常驻 NPC / 物品
- `danger_level`：0-10
- `entry_condition` / `exit_condition`：条件代数

```yaml
id: emberfall-tavern
name: 灰烬酒馆
type: indoor
description: 镇中心的老酒馆，炉火常年不灭
connections:
  - { to: emberfall-square, distance: 1, travel_time: 5 }
  - { to: mine-entrance, distance: 3, travel_time: 30, condition: { all: [ { source: time, key: hour, op: gte, value: 6 } ] } }
ambient_events: [tavern-gossip]
npcs_present: [elara]
items: [ale]
danger_level: 1
```

---

## 14. items/ — 物品

一文件一物品。`{id, name, type, description, properties?, effects_on_use?, requirements?, rarity, value}`

- `type`：`consumable|equipment|quest|material|currency_item|misc`
- `properties`：`{slot?, stackable}`
- `effects_on_use[]`：效果代数
- `requirements`：条件代数
- `rarity`：自由文本（如 `common|uncommon|rare|epic|legendary`，引擎不消费，仅展示）
- `value`：货币数值

```yaml
id: healing-potion
name: 治疗药水
type: consumable
description: 恢复 20 点生命
properties: { stackable: true }
effects_on_use:
  - { kind: stat, direction: add, target: player, stat: hp, value: 20 }
requirements: {}
rarity: common
value: 10
```

---

## 15. factions/ — 势力

一文件一势力。`{id, name, description, goals[], members[], relations[], reputation?}`

- `goals[]`：势力目标（驱动势力行为）
- `members[]`：npc ids
- `relations[]`：`{target(faction id), value}`
- `reputation`：`{thresholds[] {value, label, effects[]}, decay}`（玩家对势力的声望）
- 声望阈值效果只在数值向上穿越 `value` 的当次 reputation effect 中立即触发；停留在阈值上方或向下变化不重复触发。

```yaml
id: miners-guild
name: 矿工工会
description: 矿脉枯竭后仍在守望的老工会
goals: [查明矿难真相, 为矿工争取抚恤]
members: [old-miner]
relations:
  - { target: town-hall, value: -30 }
reputation:
  thresholds:
    - { value: 50, label: 信任, effects: [ { kind: item, direction: add, target: player, item: guild-pass } ] }
  decay: 1
```

---

## 16. events/ — 事件池

一文件一事件。`{id, name, type, tags[], trigger, conditions?, effects?, narrative?, weight, cooldown, repeatable, exclusivity?, participants?, locations?}`

- `type`：自由文本（如 `crisis|opportunity|social|mystery|ambient|festival`，引擎不消费，仅分类标签）
- `tags[]`：novelty 模式标签（供 director 新鲜度调度）
- `trigger`：`time|condition|director`
- `conditions`：条件代数
- `effects`：效果代数
- `narrative`：引用 narrative/event_texts 模板（`{template: event_id}`）
- `weight`：导演选中相对概率
- `cooldown`：再次可选间隔（如 `3` = 3 个游戏日）
- `repeatable`：boolean
- `exclusivity`：`{group, mutually_exclusive[]}`
- `participants[]`：npc id 池；`locations[]`：地点 id

```yaml
id: mine-collapse
name: 矿井再次塌方
type: crisis
tags: [danger, mystery]
trigger: director
conditions:
  all:
    - { source: fact, key: mine-secret, op: not_has }
effects:
  - { kind: stat, direction: add, target: player, stat: hp, value: -10 }
  - { kind: flag, direction: set, target: player, flag: mine-collapse-witnessed }
narrative: { template: mine-collapse }
weight: 2
cooldown: 5
repeatable: false
exclusivity: { group: mine-crisis, mutually_exclusive: [mine-fire] }
participants: [old-miner]
locations: [mine-entrance]
```

---

## 17. tasks/ — 任务模板

一文件一任务（radiant quest 模板）。`{id, name, objective, giver, conditions?, rewards?, repeatable, cooldown?, time_limit?, narrative}`

- `objective` 按类型使用严格 target：gather=`{items[]}` 或 `{of_type}`；deliver=`{item,recipient}`；hunt=`{npc}`；escort=`{npc,destination?}` 或 `{any:true}`；investigate=`{marker:{source:flag|fact,key}}` 或 `{any:true}`；persuade=`{npc}`；travel=`{location}`。`quantity` 为正整数。
- `giver`：`{pool[](npc ids), condition?}`
- `rewards`：`effects[]`
- `narrative`：`{offer, complete, fail}`（文本模板）
- `time_limit.days` 的截止日包含在可完成窗口内；只在截止日之后失败。任务激活、完成与失败都写入同一 `WorldState.eventLog`，`any` 目标从激活日志之后的事件游标计数。

```yaml
id: gather-herbs
name: 采集药草
objective:
  type: gather
  target: { items: [herb] }
  quantity: 3
giver: { pool: [herbalist] }
conditions:
  all:
    - { source: location, key: current, op: eq, value: emberfall-forest }
rewards:
  - { kind: currency, direction: add, target: player, value: 15 }
repeatable: true
cooldown: 2
time_limit: { days: 3 }
narrative:
  offer: "药草店的老板递给你一张清单……"
  complete: "你带着药草回来，她点了点头。"
  fail: "时限到了，你没能凑齐药草。"
```

---

## 18. narrative/ — 叙事资产

剧本只提供素材与风格参数；提示词组装是引擎职责。

### 18.1 opening.yaml（必）

| 字段 | 类型 | 约束 |
|---|---|---|
| `scene` | string | 开场场景描写 |
| `first_lines[]` | string[] | 可选的开场台词 |
| `hooks[]` | object[] | `{text, condition?(条件代数)}` 按条件选开场钩子 |

### 18.2 style.yaml（必）

| 字段 | 类型 | 约束 |
|---|---|---|
| `voice` | string | 叙述声音（如 `第三人称有限`） |
| `tense` | string | 时态 |
| `perspective` | string | 视角 |
| `density` | string | 描写密度（`sparse\|normal\|dense`） |
| `sentence_style[]` | string[] | 句式风格 |
| `forbidden_words[]` | string[] | 禁用词 |

### 18.3 lore/（可选）

一文件一条目：`{id, keywords[], inject_when: always|on_keyword|on_location|on_npc, locations[]?, npcs[]?, content}`（Lorebook 按需注入）。

### 18.4 examples/（可选）

一文件一 NPC 或 generic：`{npc_id|"generic", exchanges[] {player, npc}}`（few-shot）。

### 18.5 event_texts/（可选）

一文件一事件：`{event_id, templates[] {tone, text, slot_vars[]}}`。

```yaml
# opening.yaml
scene: "你睁开眼，灰烬镇的清晨雾气未散……"
first_lines: ["酒馆老板娘艾拉正擦着杯子，抬头看你。"]
hooks:
  - text: "你是这里的熟客。"
    condition: { all: [ { source: flag, key: returned_visitor, op: has } ] }
```

---


## 19. theme.yaml — 主题（可选）

纯加法模块（缺省合法）：声明剧本默认主题与按区域的动态视觉切换。根文件 `theme.yaml` + 可选 `themes/*.yaml`（同一 schema，附加主题包）。**安全模型**：只允许白名单语义 Token（hex/enum/clamp/路径前缀），禁止任意 CSS、远程字体 URL 或 `<style>` 自由文本。

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `id` | string | ✅ | 主题 id（目录内唯一；根文件建议 `default`） |
| `name` | string | ✅ | 显示名 |
| `palette` | object | ✅ | 8 色：`background/surface/surface_alt/primary/accent/text/text_dim/border`，全部 `^#[0-9a-fA-F]{3,8}$` 严格校验 |
| `typography` | object | ✅ | 见下表 |
| `effects` | object | ✅ | 见下表 |
| `by_location` | object | ❌ | `{地点 id: 主题 id \| 内联覆盖}`；内联覆盖允许 palette 子集 + effects/typography 安全子集（不允许内联 faces 文件） |

`typography`：

| 字段 | 约束 |
|---|---|
| `font` | `serif\|sans\|mono`（系统回退角色） |
| `scale` | 0.85–1.3（总字号倍率 → `--cg-scale`） |
| `line_height` | 1.2–1.8 |
| `letter_spacing_em` | -0.04–0.12 |
| `faces` | 可选自定义字体：`{id, family, files: [{file, weight?, style?}]}`；`file` 必须 `assets/fonts/` 下 woff2/woff/ttf/otf（硬错误），存在性软警告 |
| `roles` | `{ui?, narrative?, mono?}` → face id 或 `serif\|sans\|mono`；face id 必须存在于 `faces`（硬错误） |

`family` 白名单：`^[A-Za-z0-9][A-Za-z0-9 _-]{0,62}$`（禁止引号/反斜杠等注入字符）。

`effects`：

| 字段 | 约束 |
|---|---|
| `bubble_radius` | 0–24（气泡圆角） |
| `chrome_radius` | 0–24（壳/按钮/模态圆角） |
| `glass` | 0–1（玻璃透明度） |
| `blur_px` | 0–24（玻璃模糊） |
| `shadow` | `none\|soft\|medium\|hard`（框架闭集映射，禁止原始 box-shadow） |
| `border_width_px` | 1–3（chrome 边框） |
| `density` | `compact\|cozy\|comfy`（间距倍率闭集） |
| `motion` | `minimal\|subtle\|standard\|playful` |
| `scene_tint` | hex（背景氛围） |
| `overlay_strength` | 0–0.8（模态遮罩浓度） |

```yaml
# theme.yaml
id: default
name: 灰烬镇·余烬
palette:
  background: "#1a1410"
  surface: "#241c15"
  surface_alt: "#2e2218"
  primary: "#c96f2f"
  accent: "#e8a04c"
  text: "#e8dcc8"
  text_dim: "#9a8a72"
  border: "#4a3a28"
typography:
  font: serif
  scale: 1.0
  line_height: 1.6
  letter_spacing_em: 0
  faces:
    - id: runes
      family: Rune Serif
      files:
        - { file: assets/fonts/rune.woff2, weight: 400, style: normal }
  roles:
    ui: runes
    narrative: runes
effects: { bubble_radius: 14, chrome_radius: 12, glass: 0.65, blur_px: 8, shadow: medium, border_width_px: 1, density: cozy, motion: subtle, scene_tint: "#1c0f06", overlay_strength: 0.45 }
by_location:
  mine-entrance: dark-mine     # 引用 themes/dark-mine.yaml
  forest-edge: deep-forest
```

校验：`by_location` 键必须存在于 `locations/`，值为主题 id 时该 id 必须存在于 `theme.yaml` + `themes/*.yaml` 合集（硬错误）；`faces[].file` 必须在剧本目录内且位于 `assets/fonts/`（硬错误），文件存在性为软警告；`roles` 引用必须能解析到已声明 face id（硬错误）。无主题剧本由框架内置 dark/light 主题兜底。

---

## 20. assets.yaml — 资产索引（可选）

纯加法模块（缺省合法）：**唯一资产真源**。静态文件引用 + 文生图/TTS 提示词占位，两类任一即可（prompt-only 合法，文件后补）。

| 键 | 实体池 | 条目 |
|---|---|---|
| `portraits` | npcs | `{file?, prompt?, alt?}` |
| `backgrounds` | locations | `{file?, prompt?}` |
| `icons` | items | `{file?, prompt?}` |
| `sprites` | npcs | `{file?, prompt?}` |
| `voices` | npcs | `{file?, prompt?, profile?}` |
| `ambient` | locations | `{file?, prompt?}` |
| `effects` | events | `{file?, prompt?}` |
| `ui` | 框架 chrome 槽 | `{file?, prompt?, alt?}`，键必须是固定枚举（见下） |

`ui` 固定槽位枚举（框架 chrome 图标，与实体 id 解耦）：
`inventory / character / relations / tasks / map / log / save / audio_on / audio_off / close / send / warning / hp / location / time`。未知槽位为硬错误；缺省时框架用内置 glyph 兜底。

规则：

- 实体键（portraits/backgrounds/icons/sprites/voices/ambient/effects）必须对应存在的 npc/location/item/event id——**硬错误**；`ui` 键必须属于上述固定枚举——**硬错误**。
- `file` 指向 `assets/` 目录内文件（布局约定上表）；文件存在性 = **软警告**（允许 prompt-only）。
- 文件类型白名单：svg/png/jpg/jpeg/webp/gif + mp3/wav/ogg + woff2/woff/ttf/otf（字体）。

```yaml
# assets.yaml
portraits:
  elara: { file: assets/portraits/elara.svg, alt: 艾拉 }
  mine-guardian: { prompt: "steampunk mine golem, glowing eyes" }
backgrounds:
  emberfall-tavern: { prompt: "steampunk tavern, warm firelight" }
icons:
  pickaxe: { file: assets/icons/pickaxe.svg }
voices:
  elara: { prompt: "calm, low voice", profile: 低哑平静 }
ambient:
  mine-entrance: { prompt: "distant mine rumbling" }
effects:
  mine-collapse: { prompt: "collapsing rock rumble" }
ui:
  inventory: { file: assets/icons/ui/inventory.svg }
  map: { prompt: "map icon" }
```

媒体决策归引擎：`MediaCue`（`npc_speech`/`location_enter`/`event`）由状态差确定性推导，LLM 不参与（"引擎管规则，LLM 管叙事"的延伸）。前端消费见 [presentation.md](presentation.md)。

---


## 附录 A. 内置动作库（26 个）

| id | 语义 | 默认 resolve | 默认 llm_freedom |
|---|---|---|---|
| `talk` | 交谈 | auto | narration |
| `ask` | 询问 | auto | narration |
| `move` | 移动 | auto | narration |
| `travel` | 旅行（跨地点图） | auto | narration |
| `investigate` | 调查 | skill_check (perception) | narration |
| `search` | 搜索 | skill_check (perception) | narration |
| `persuade` | 说服 | skill_check (persuasion) | narration |
| `intimidate` | 威胁 | opposed_check (charisma) | narration |
| `deceive` | 欺骗 | opposed_check (deception) | narration |
| `attack` | 攻击 | stat_check (strength) | process |
| `defend` | 防御 | stat_check (defense) | process |
| `flee` | 逃跑 | stat_check (agility) | process |
| `use_item` | 使用物品 | auto | narration |
| `give` | 给予 | auto | narration |
| `take` | 拿取 | auto | narration |
| `trade` | 交易 | auto | narration |
| `steal` | 偷窃 | opposed_check (stealth) | narration |
| `rest` | 休息 | auto | narration |
| `wait` | 等待 | auto | narration |
| `follow` | 跟随 | auto | narration |
| `sneak` | 潜行 | skill_check (stealth) | narration |
| `gather` | 采集 | skill_check (survival) | narration |
| `craft` | 制造 | skill_check (crafting) | narration |
| `repair` | 修理 | skill_check (crafting) | narration |
| `cast` | 施法 | stat_check (intellect) | process |
| `disguise` | 伪装 | skill_check (disguise) | narration |

剧本配置动作时，`resolve` 的 stat/skill 必须存在于 mechanics.yaml（引用边：actions→stats/skills/needs）。

---

## 附录 B. base_class 实体基类
INS.POST 887:
> `base_class` 为自由文本标签（引擎不消费，仅作者分类）；下表为剧本约定俗成取值，新值随时可用。

| base_class | 说明 | 默认核心属性 |
|---|---|---|
| `humanoid` | 人形生物（人类/精灵等） | hp, strength, agility, charisma, intellect, perception |
| `creature` | 非人形生物（野兽/怪物） | hp, strength, agility, aggression, instinct |

NPC 必须声明 `base_class`；`stats/skills/needs` 为**覆盖**（override）剧本默认值，未覆盖项取剧本默认。

---

## 附录 C. 条件代数 op 全集

条件代数递归定义：

```
logic := { all: [logic...] } | { any: [logic...] } | { not: logic } | leaf
leaf  := { source, key?, target?, op, value? }
```

`source` ∈ `stat|skill|need|flag|fact|relationship|reputation|time|location|inventory|currency`

`op` 全集（10 个）：

| op | 适用 source | 语义 |
|---|---|---|
| `gte` | 数值类 | 大于等于 |
| `lte` | 数值类 | 小于等于 |
| `gt` | 数值类 | 大于 |
| `lt` | 数值类 | 小于 |
| `eq` | 数值/枚举 | 等于 |
| `neq` | 数值/枚举 | 不等于 |
| `has` | flag/fact | 标志存在（true） |
| `not_has` | flag/fact | 标志不存在 |
| `in` | 集合 | value 是集合，key 在其中 |
| `not_in` | 集合 | value 是集合，key 不在其中 |

- `time` source：`key` ∈ `hour|day|month|weekday`，`value` 数值比较。
- `location` source：`key: current`，`value` 为地点 id（eq/neq）。
- `relationship` source：`key` 为 NPC id 或 `player`，`value` 数值。
- 禁止任何表达式字符串。

---

## 附录 D. 效果代数 kind 全集

效果统一结构：`{kind, direction: add|remove|set, target: player|npc id|faction id, ...专属字段}`。

| kind | 专属字段 | 语义 |
|---|---|---|
| `stat` | `stat, value` | 改属性 |
| `skill` | `skill, value` | 改技能 |
| `need` | `need, value` | 改需求 |
| `item` | `item, value(数量)` | 加/减物品 |
| `currency` | `value` | 加/减货币 |
| `relation` | `npc, value` | 改关系值 |
| `reputation` | `faction, value` | 改声望 |
| `flag` | `flag` | 设/清标志 |
| `teleport` | `location` | 传送 |
| `status` | `status` | 施加状态效果 |
| `memory` | `text, importance, tags?, replaces?` | 添加记忆（tags 用于相关性检索；replaces 取代旧记忆并归档） |
| `secret` | `secret` | 揭露秘密 |
| `event` | `event` | 触发事件 |
| `narrative` | `text` | 叙事提示 |

---

## 附录 E. 引用完整性矩阵

语义校验层逐边检查（每条边 ≥1 测试，`src/script/validate.ts` 为实现；本表与实现逐行对齐）：

| 源 | 引用目标 | 校验状态 |
|---|---|---|
| actions | stats, skills, needs, items（resolve/costs/conditions/effects） | ✅ 已实现 |
| plot | secrets, npcs, events, locations（related + trigger conditions） | ✅ 已实现 |
| events | locations, npcs, events（participants/exclusivity/narrative.template + conditions/effects 全 kind） | ✅ 已实现；矩阵中 events→tasks 无对应字段：events schema 无 tasks 引用字段，与 director→events 同理 |
| tasks | items, npcs, locations（objective/giver）+ rewards 全 kind | ✅ 已实现 |
| origins | npcs, locations, items, stats, skills, actions（starting_relations/starting_location/items/exclusive_leads/denied_actions/stats/skills） | ✅ 已实现 |
| origins | flags（starting_knowledge） | ⚠️ v1.1 不校验：flag 无声明池，见下方说明 |
| npcs | stats, skills, needs, schedule→time.yaml, home→locations, items, relations→npcs, secrets→plot（reveal.logic） | ✅ 已实现；矩阵中 npcs relations→factions 无对应字段：relation target 按模块契约仅为 npc id（人际关系），势力关系由 factions.relations 声明 |
| factions | npcs（members）, factions（relations）, items（reputation thresholds effects） | ✅ 已实现 |
| locations | connections→locations, npcs, items, events（ambient_events + entry/exit conditions） | ✅ 已实现 |
| items | stats, status_effects（effects_on_use + requirements） | ✅ 已实现 |
| narrative/event_texts | event ids | ✅ 已实现 |
| narrative/examples | npc ids | ✅ 已实现 |
| worldgen | 引用池（npc/faction/item/event ids） | ✅ 已实现 |
| director | events | ⚠️ v1.1 不校验：director.yaml 无 event 引用字段（tension 变量 source 已校验为 gauge） |
| run.yaml | locations, gauge（soft_failure）、origins（unlocks[].grant）、consequence.effects 全 kind（含 status） | ✅ 已实现 |
| theme | locations（by_location 键）、themes（by_location 主题 id 引用） | ✅ 已实现 |
| assets | npcs（portraits/sprites/voices）、locations（backgrounds/ambient）、items（icons）、events（effects）；`file` 路径必须在剧本目录内 | ✅ 已实现（文件存在性为软警告） |
| facts（条件代数 source: fact） | fact 键 | ⚠️ v1.1 不校验：fact 无声明池（引擎运行态事件日志持有），剧本内保持一致即可 |
---

## 附录 F. 版本与扩展性契约

- `schema_version` 严格相等匹配（1.1）；2.0 前只允许加法演进；破坏性变更升大版本。
- 所有 zod schema strict（未知字段报错）；每模块预留 `ext: {}` 扩展位（只允许版本化消费者解释）。Engine Extension v2 的声明集合必须与实际注册集合精确相等，未知或漏注册的扩展在校验与运行期都响亮失败。
- **ID 契约**：实体 id 全局唯一、小写连字符；发布后不得更改。
- **运行态隔离**：剧本文件禁止携带运行时状态（无时间戳、无进程内可变值）；所有可变状态属引擎 WorldState。
- 引擎仅加载与声明版本严格相等的剧本；作者小改字段须等引擎版本（加法演进通道缓解）。

---

## 附录 G. 完整示例剧本片段

（完整示例见 `scripts/emberfall/` 与 `scripts/starlight/`，两个题材各覆盖 18 模块。）

```yaml
# scripts/emberfall/script.yaml
id: emberfall
name: 灰烬镇
description: 蒸汽与魔法并存的边陲小镇
schema_version: "1.1"
language: zh
tone: [悬疑, 温情]
author: chatgame-team
```
