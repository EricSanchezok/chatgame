# Agent Note: 剧本格式 v1.0——声明式目录剧本 + zod 可执行契约

Status: implemented

## Problem

chatgame 需要一套"剧本 = 一个世界"的格式契约：换剧本即换游戏、每次开局体验不同、一个剧本可无限游玩，并落实"引擎管规则、LLM 管叙事"。之前只有两条第一性原理（[2026-08-18-game-first-principles.md](../game-design/2026-08-18-game-first-principles.md)），缺具体的剧本文件格式与校验机制；三份调研（[docs/research/](../../docs/research/README.md)）确认了格式必须解决"状态真实、承诺保持、无限游玩、换剧本通用"四个问题，且行业无人做全。

## Decision

剧本 = 一个强制目录，18 个模块，全部纯配置（YAML + 结构化条件/效果代数，无代码、无表达式字符串）：

- 10 个根模块：`script.yaml`（元信息/版本）、`world.yaml`（世界宪法：rules 引擎执行、taboos LLM 遵守、glossary）、`time.yaml`（时间/作息/推进）、`mechanics.yaml`（属性/技能/需求/战斗/背包/货币/成长）、`actions.yaml`（从内置 26 动作库选择配置）、`plot.yaml`（承诺骨架，无结局）、`director.yaml`（张力带事件选择）、`worldgen.yaml`（开局随机化分层）、`run.yaml`（死亡策略三种模式/meta-progression/记忆分层）、`safety.yaml`（内容边界声明）。
- 4 个实体目录：`origins/`（玩家出身）、`npcs/`（含关系网络/记忆/秘密/LLM 配置）、`locations/`（地点图）、`items/`、`factions/`、`events/`、`tasks/`（radiant 任务）。
- `narrative/`：opening/style/lore/examples/event_texts——剧本只提供素材与风格参数，提示词组装是引擎职责。

关键契约：

- **条件代数**：`{all|any|not}` 递归 + 叶子 `{source, key?, target?, op, value?}`；op 10 个（gte/lte/gt/lt/eq/neq/has/not_has/in/not_in）。**效果代数**：14 个 kind（stat/skill/need/item/currency/relation/reputation/flag/teleport/status/memory/secret/event/narrative），direction add/remove/set，target 明确。
- **纯配置**：机制算法在引擎，剧本只配置参数；新机制 = 引擎版本 + schema_version 提升。
- **版本契约**：`schema_version` 严格相等（1.0）；2.0 前只允许加法演进；ID 发布后不得更改（存档迁移前提）；运行态隔离（剧本无状态）。
- **校验三层**：YAML 安全解析（禁 alias、200KB 上限）→ zod strict 逐模块 → 语义校验（引用完整性矩阵全部边 + id 唯一性 + 命名规则 + 版本匹配），错误定位到文件+字段+行。
- **校验完备性**（审查补全）：引用矩阵全部边实现并逐边测试——actions 全 kind、plot related/trigger、events effects 全 kind（item/faction/npc/location/status/target）、tasks rewards 全 kind（npc/location/faction/status/event/secret/target）、origins（relations/items/exclusive_leads/denied_actions/stats/skills）、npcs（stats/skills/needs/schedule/home/items/relations/secrets）、factions（members/relations/reputation effects）、locations（connections/npcs/items/events/conditions）、items（effects/requirements）、worldgen 池、run（soft_failure location/gauge + unlocks[].grant→origins）、narrative 引用；破坏样本含非法 op 与类型错配；行号断言验证 lineForPath 端到端。规格附录 E 与实现逐行对齐，并显式注明 v1.0 不校验的边（director→events 无字段、origins→flags 与 facts 无声明池）。
- **校验补强 R10（2026-08-18）**：新增附录 C op×source 兼容矩阵统一语义遍历（数值类 source 仅 gte/lte/gt/lt/eq/neq，flag/fact 仅 has/not_has，location 允许 eq/neq/in/not_in；`in`/`not_in` 的 value 必须为数组、`eq`/`neq` 不可为数组），覆盖 actions/plot/opening hooks/events/tasks/npc secrets/locations connections 与 entry-exit/items 全部条件字段；补齐引用边（time festivals→events、schedules entries→locations、tasks conditions 与 giver.condition 全 kind、locations connections.condition、origins exclusive_to→locations、factions reputation.thresholds effects 全 kind）；secret id 跨 NPC 重复由隐式容错改为报错（引擎/plot 按 id 引用 secret，重复会使揭露归属歧义）。校验器保持纯函数、全部经 `add(file, line, path, message)` 通道报告。
- **交付物**：规格文档 `docs/game-design/script-format.md`（18 模块 + 附录 A-G）、`src/script/schemas/`（zod 全套）、`src/script/validate.ts` + `scripts/validate-script.ts`（CLI）、双 fixture `scripts/emberfall/` 与 `scripts/starlight/`、vitest 测试（每 schema 正反例 + 语义校验每边 + 破坏样本集）。

## Alternatives considered

- **剧本内嵌表达式/脚本（JS 片段/公式字符串）**：破坏纯配置、不可静态校验、引入执行安全边界。拒绝，用结构化条件/效果代数。
- **JSON 剧本**：无注释、手写不友好。拒绝，用 YAML（安全解析）。
- **自定义 DSL 文本格式（Ink/ChoiceScript 风格）**：需编译器，作者友好收益在无编辑器时无法兑现。拒绝，YAML + 严格校验即够。
- **剧情树/分支剧本**：违背无限游玩第一性原理。拒绝，用承诺骨架（必发生的事，无结局）。
- **剧本内嵌 LLM 提示词**：提示词组装是引擎叙事层职责。拒绝（narrative/ 只提供素材与风格参数）。
- **引擎内置固定属性集**：任意世界观无法表达。拒绝：剧本声明属性名，引擎提供统一数值语义。
- **分期/MVP 裁剪**：用户明确拒绝。18 模块与全部校验收口一次交付。
- **剧本级插件/钩子（TS 模块）**：与纯配置冲突、安全边界大。拒绝，记录为未来可选方向（不影响 v1.0）。

## Consequences

代价：
- 格式复杂：18 模块对简单剧本偏重——但"剧本 = 世界"的目标本身就要求完整维度；简单剧本可省略可选目录。
- 纯配置表达力有上限：复杂机制无法用现有原语表达时，须走"引擎版本 + schema_version 提升"路径（有意的演进纪律）。
- 版本严格匹配：作者小改字段也须等引擎版本（加法演进通道缓解）。

收益：
- 换剧本即换游戏：双 fixture（中式奇幻 / 科幻空间站）证明通用性。
- 状态真实、承诺保持：NCP-Bench 实证支撑的"引擎持承诺、LLM 只即兴"在格式层落地。
- 可测试、可追溯：zod 是机器契约、规格是人类契约、fixture 是活证据，三者一致；校验器定位到文件+字段+行。
- 后续引擎可直接依据规格与 schema 开工，无需再作格式设计决策。
