# 剧本格式 v1.0——声明式目录剧本 + zod 可执行契约

## Status
Accepted
Class: feature

## Context and Problem Statement

chatgame 需要一套"剧本 = 一个世界"的格式契约：换剧本即换游戏、每次开局体验不同、一个剧本可无限游玩，并落实"引擎管规则、LLM 管叙事"。此前只有两条第一性原理（[ADR 0004](0004-game-first-principles.md)），缺具体的剧本文件格式与校验机制；三份调研确认了格式必须解决"状态真实、承诺保持、无限游玩、换剧本通用"四个问题，且行业无人做全。

## Decision Drivers

- 纯配置、无代码：机制算法在引擎，剧本只配置参数。
- 可静态校验：错误定位到文件+字段+行。
- 版本契约：schema 演进有纪律，存档可迁移。
- 通用性：任意世界观可表达。

## Considered Options

- 剧本内嵌表达式/脚本（JS 片段/公式字符串）。
- JSON 剧本。
- 自定义 DSL 文本格式（Ink/ChoiceScript 风格）。
- 剧情树/分支剧本。
- 剧本内嵌 LLM 提示词。
- 引擎内置固定属性集。
- 分期/MVP 裁剪。
- 剧本级插件/钩子（TS 模块）。
- 声明式目录剧本 + zod 可执行契约——即所选路线。

## Decision Outcome

剧本 = 一个强制目录，18 个模块，全部纯配置（YAML + 结构化条件/效果代数，无代码、无表达式字符串）：

- 10 个根模块：`script.yaml`（元信息/版本）、`world.yaml`（世界宪法：rules 引擎执行、taboos LLM 遵守、glossary）、`time.yaml`（时间/作息/推进）、`mechanics.yaml`（属性/技能/需求/战斗/背包/货币/成长）、`actions.yaml`（从内置 26 动作库选择配置）、`plot.yaml`（承诺骨架，无结局）、`director.yaml`（张力带事件选择）、`worldgen.yaml`（开局随机化分层）、`run.yaml`（死亡策略三种模式/meta-progression/记忆分层）、`safety.yaml`（内容边界声明）。
- 4 个实体目录：`origins/`（玩家出身）、`npcs/`（含关系网络/记忆/秘密/LLM 配置）、`locations/`（地点图）、`items/`、`factions/`、`events/`、`tasks/`（radiant 任务）。
- `narrative/`：opening/style/lore/examples/event_texts——剧本只提供素材与风格参数，提示词组装是引擎职责。

关键契约：

- **条件代数**：`{all|any|not}` 递归 + 叶子 `{source, key?, target?, op, value?}`；op 10 个（gte/lte/gt/lt/eq/neq/has/not_has/in/not_in）。**效果代数**：14 个 kind（stat/skill/need/item/currency/relation/reputation/flag/teleport/status/memory/secret/event/narrative），direction add/remove/set，target 明确。
- **纯配置**：机制算法在引擎，剧本只配置参数；新机制 = 引擎版本 + schema_version 提升。
- **版本契约**：`schema_version` 严格相等（1.0）；2.0 前只允许加法演进；ID 发布后不得更改（存档迁移前提）；运行态隔离（剧本无状态）。
- **校验三层**：YAML 安全解析（禁 alias、200KB 上限）→ zod strict 逐模块 → 语义校验（引用完整性矩阵全部边 + id 唯一性 + 命名规则 + 版本匹配），错误定位到文件+字段+行。
- **校验完备性**（审查补全）：引用矩阵全部边实现并逐边测试——actions 全 kind、plot related/trigger、events effects 全 kind、tasks rewards 全 kind、origins/npcs/factions/locations/items/worldgen 池/run 的引用边全部覆盖。
- **校验补强 R10（2026-08-18）**：新增附录 C op×source 兼容矩阵统一语义遍历（数值类 source 仅 gte/lte/gt/lt/eq/neq，flag/fact 仅 has/not_has，location 允许 eq/neq/in/not_in；`in`/`not_in` 的 value 必须为数组、`eq`/`neq` 不可为数组），覆盖全部条件字段；补齐引用边（time festivals→events、schedules entries→locations、tasks conditions 与 giver.condition 全 kind、locations connections.condition、origins exclusive_to→locations、factions reputation.thresholds effects 全 kind）；secret id 跨文件全局唯一。
- **交付物**：规格文档 `docs/game-design/script-format.md`（18 模块 + 附录 A-G）、`src/script/schemas/`（zod 全套）、`src/script/validate.ts` + `scripts/validate-script.ts`（CLI）、双 fixture `scripts/emberfall/` 与 `scripts/starlight/`、vitest 测试（每 schema 正反例 + 语义校验每边 + 破坏样本集）。

### Consequences

- 格式复杂：18 模块对简单剧本偏重——但"剧本 = 世界"的目标本身就要求完整维度；简单剧本可省略可选目录。
- 纯配置表达力有上限：复杂机制无法用现有原语表达时，须走"引擎版本 + schema_version 提升"路径。
- 版本严格匹配：作者小改字段也须等引擎版本（加法演进通道缓解）。
- 收益：换剧本即换游戏（双 fixture 证明通用性）；状态真实、承诺保持；zod 是机器契约、规格是人类契约、fixture 是活证据；校验器定位到文件+字段+行；后续引擎可直接依据规格与 schema 开工。

## Pros and Cons of the Options

### 剧本内嵌表达式/脚本
- 坏：破坏纯配置、不可静态校验、引入执行安全边界。改用结构化条件/效果代数。

### JSON 剧本
- 坏：无注释、手写不友好。改用 YAML（安全解析）。

### 自定义 DSL 文本格式
- 坏：需编译器，作者友好收益在无编辑器时无法兑现。YAML + 严格校验即够。

### 剧情树/分支剧本
- 坏：违背无限游玩第一性原理。改用承诺骨架（必发生的事，无结局）。

### 剧本内嵌 LLM 提示词
- 坏：提示词组装是引擎叙事层职责。narrative/ 只提供素材与风格参数。

### 引擎内置固定属性集
- 坏：任意世界观无法表达。剧本声明属性名，引擎提供统一数值语义。

### 分期/MVP 裁剪
- 坏：用户明确拒绝。18 模块与全部校验收口一次交付。

### 剧本级插件/钩子（TS 模块）
- 坏：与纯配置冲突、安全边界大。记录为未来可选方向（不影响 v1.0）。

## Links
- [ADR 0004](0004-game-first-principles.md) — 第一性原理。
- [docs/game-design/script-format.md](../game-design/script-format.md) — 剧本格式规格。
- [docs/research/README.md](../research/README.md) — 相关调研记录。
