# 引擎 mechanics 模块（背包/需求/状态/战斗/成长）

## Status
Superseded by [0032](0032-open-world-facts-and-d20-kernel.md)
Class: architecture

## Context and Problem Statement

引擎运行时需要剧本驱动的基础机制模块（inventory/needs/status/combat/progression），全部为不可变快照 + 纯函数更新。两个无先例的语义点需要定夺：需求阈值的触发记录方式（brief 明令不改 types.ts）与需求阈值的极性方向（fatigue 这类"越高越糟"的需求）。

## Decision Drivers

- 不改 types.ts：阈值触发不得引入 WorldState 新字段。
- 语义由 definition 数据驱动，引擎代码不感知语义方向。
- 阈值/状态/成长语义可被任意剧本复用。

## Considered Options

- 阈值一次性触发 + WorldState 记录 fired。
- 用 decay_per_day 符号表达极性（负=上升）。
- duration 表示"包含本 tick 的剩余次数"（先递减后应用）。
- progression 按 source 前缀决定 stat/skill 归属。
- RimWorld 式持续效果 + 初始值远端比较——即所选路线。

## Decision Outcome

- 5 个模块落于 `src/engine/mechanics/`：inventory.ts、needs.ts、status.ts、combat.ts、progression.ts，配套单测在 `__tests__/`（共 28 例）。
- 阈值触发采用 **RimWorld 式持续效果**：不记录"已触发"，value 越过 level 期间每次调用 applyNeedThresholds 都应用一次 effects。重复触发的节奏由效果自身的 status duration/stackable 控制，因此无需在 WorldState 加 fired 记录，types.ts 不动。
- 阈值极性：阈值位于需求初始值的"远端"——`initial >= level` 的需求（如 hunger，初始 80）在 `value <= level` 时触发；`initial < level` 的需求（如 fatigue，初始 20）在 `value >= level` 时触发。引擎代码不感知语义方向，只比较初始值与 level。
- status tick 语义：每 tick **先应用效果、再递减 remainingTicks**；duration=N 表示效果恰好应用 N 次，减到 0 移除实例。stackable 状态重新添加时 stacks+1 且计时器重置。
- progression 的 target 查找：stats 优先、skills 次之（同名如 perception 时 stats 胜出）。clamp 用 entry.cap，无 cap 时用 stat/skill 定义的 max，下限取定义 min。
- 背包容量按所有堆叠的数量总和计算，与 item.properties.stackable 无关；超出返回 `{ ok: false, reason }` 不抛错。
- applyDamage 保留 damageType 参数（签名按 brief），基础结算不使用（当前无伤害类型修正因子）。
- tickStatuses 的 day 从 `absoluteDay(definition, state.clock)` 派生，不要求调用方传 day。

### Consequences

- types.ts 零改动，阈值/状态/成长语义全部由 definition 数据驱动，可被任意剧本复用。
- 28 个单测覆盖堆叠、容量拒绝、衰减比例、阈值极性、状态过期、伤害 clamp、威胁条封顶等边界。
- 持续效果语义要求剧本作者把"只发生一次"的阈值后果写进 status duration 或 effect 本身（如 set 类效果天然幂等）。
- damageType 目前是占位参数，未来实现伤害类型系统时需要在此扩展。
- 未定：fatigue 类需求的 decay_per_day 在 emberfall 中为正值（15），按 `value - decay` 计算 fatigue 数值反而下降、远离阈值 80——该 fixture 的疲劳增长未在引擎侧建模，若后续剧本需要"疲劳累积"需另议（可能给 needDef 加方向字段）。

## Pros and Cons of the Options

### 阈值一次性触发 + WorldState 记录 fired
- 坏：要求改 types.ts（brief 禁改）或在 effects 里塞 flag（污染剧本作者的 flag 空间、flag 属于叙事层）。

### decay_per_day 符号表达极性
- 坏：`value - decay` 对疲劳会变成"越衰减越疲劳"反而方向相反，且文档未定义符号语义。

### duration 先递减后应用
- 坏：status 刚加上当 tick 不生效，直觉上更弱；先应用后递减让 `duration: 2` 的 tipsy 恰好生效 2 tick。

### progression 按 source 前缀决定归属
- 坏：emberfall 的 task→crafting（skill）、event→perception（stats/skills 同名）都靠前缀无法唯一判定；stats 优先规则简单且确定。

## Links
- [ADR 0007](0007-engine-runtime.md) — 引擎运行时 v1。
- [docs/game-design/engine-runtime.md](../game-design/engine-runtime.md) — 引擎运行时规格。
