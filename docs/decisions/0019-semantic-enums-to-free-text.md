# 数值系统描述化——语义枚举 → 自由文本 + description 全链路

## Status
Accepted
Class: architecture

## Context and Problem Statement

用户第一性原理："数值代表具体的值，description 就是一段自然语言，绝不枚举（枚举总有上限而且不能有复杂关系）"。但旧架构把语义标签做成了硬编码枚举（relation type/stance、status kind、event type、item rarity、location type、base_class、origin difficulty、commitment type、safety 内容类），作者想表达"偷偷暗恋"只能硬凑 `friendly`，且 10 处剧本条目被枚举卡住（怨愤→wary、宗亲→acquaintance 等降级表达）。

调研（4 份 subagent 报告）同时确认描述管道断裂：

- **上游**：作者已用 `note` 表达细微差别（86% 关系条目写 note），但 `worldgen` 只复制 value/stance/type，**note 运行时丢失**。
- **中游**：descriptor 生成器上下文太薄（缺作者 note/type/剧本 description）；status 实例 descriptor 是死代码；`sourceEventIds` 恒空。
- **下游**：**描述从不注入 LLM 上下文**（prompt 无关系/声望/需求描述）；NPC↔NPC 描述生成后零消费（白耗 LLM 调用）；UI 唯一展示 descriptor 在一处；stats/skills/items 的剧本 description 被 catalog 丢弃。

即"上游写了、中游丢、下游不看"——枚举有上限 + 管道断裂双重问题。

## Decision Drivers

- 用户锁定：LLM 消费描述、引擎仍判定；语义枚举描述化、指令枚举保留。
- 数值唯一事实源：描述不参与判定、LLM 物理上只能写描述字段（I6 双通道、防作弊管线不变）。
- 干净单一：不做双轨（语义表达只有 description 一个家；枚举删除不留兼容路径）。
- 判定确定性：指令枚举（condition source/op、effect kind 等）保持枚举——未知值静默 false 是最大风险。

## Considered Options

- 条件判定也 LLM 化（用户否决）：判定概率化，推翻防作弊管线（I5）、"数值唯一事实源"。落选。
- 全部枚举自由化（用户否决）：连 condition/effect/task 指令也放开 → 未知 source/op 静默返回 false，动作合法性/事件触发/承诺/任务完成全部静默失效。落选。
- 只放宽枚举、不修管道：作者能写但运行时仍丢、LLM 仍看不到，等于没做。落选。
- 只注入描述、不动枚举：作者仍被枚举卡住。落选。
- 给语义枚举加 description 双轨：违反"干净单一"，且用户明确"绝不枚举"。落选。
- 删除 valueToStance/relationLabel 派生表：失去描述生成失败/未生成时的确定性 UI 兜底，且极性校验依赖 label 子串表；保留为内部兜底层（不暴露给作者）不构成双轨。落选。
- 物品实例级动态描述/全状态描述化（flags/tasks/tension）：超出"数值系统"范围，列为 V2。落选。
- 语义枚举 → 自由文本 + 描述位补全 + LLM 消费——所选路线。

## Decision Outcome

三层落点：

1. **契约层**（剧本 schema v1.1）：语义标签枚举 → `z.string().min(1)`（relation type、status kind、event type、item rarity、location type、base_class、origin difficulty、commitment type、safety content_class/intensity）；relation 加 `description?` 位（替代原 `note` 位，note 语义并入 description）；status_effects 加 `description?`；`script.schema_version` 1.0 → 1.1。判定硬依赖的指令枚举全集保留：condition source/op、effect kind、task objective type、MediaCue、动作 id 白名单、memory importance、event trigger、resolve type、worldgen target、meta_progression.keep、taboo severity、lore inject_when、progression source、advance_scope、`"threat_gauge"`。

2. **引擎层**（运行时 + 描述管道）：`RelationState` 补 `description?`（作者静态描述，worldgen/definition 构建关系时保留）；`llmDescriptorGenerator` 上下文增强（注入作者 description/type/剧本 description/近期事件）；`refreshAllStale` 扩展到 status 实例（statuses 路径）并用最近 10 条 eventLog 填充 `sourceEventIds`（entities.test.ts 断言非空）；`upsertRelation` 值变化只更新 value + `valueToStance` 派生 stance（label 兜底），**不再覆盖作者/LLM 管理的 type**；`applyStatus` 对已有实例标 stale；catalog 透传 stats/skills/items/statusEffects 的 description 与 factions id/name（engine-host.test.ts 断言 skills.description 与 factions 透传）。

3. **消费层**（LLM + UI）：`buildTurnPrompt` 注入"关系与状态摘要"区块——玩家↔在场 NPC 关系（type + description + value）、玩家声望/需求/状态描述、NPC 视角关系网（随在场 NPC 注入，消灭白生成）；UI 面板展示 description：CharacterPanel 展示属性/技能/需求/状态描述（catalog 透传 skills/stats/statusEffects description），RelationsPanel 展示关系描述 + 编辑入口（`updateDescriptor` → `setDescriptor` API → 既有 descriptor route）与**声望区块**（catalog factions id/name + reputation descriptor.description，缺省回退 label/value），InventoryPanel 物品卡展示 item description。

版本契约：`SAVE_SCHEMA_VERSION` 3 → 4、`script.schema_version` 1.0 → 1.1（敏捷约定：旧档/旧剧本直接拒绝，不写迁移）。

边界：物品/属性/技能只消费静态 description（作者写、UI 显示、可注入 LLM），不加实例级动态描述；flags/tasks/commitments 描述位属非数值系统，列为 V2。

## Pros and Cons of the Options

- 所选路线：作者可用自然语言表达"同是朋友但质地不同"；描述全链路接通（上游保留、中游增强、下游注入+展示）；NPC↔NPC 描述获得消费；判定确定性不破。代价：破坏性版本变更（存档 v4、剧本 schema 1.1，旧档/旧剧本拒绝）；描述注入放量 token 成本上升（用户明确接受）；语义标签自由化后失去 schema 层拼写校验（标签不参与判定，风险可控）；`note` 位并入 `description`（两示例剧本已迁移）。
- 条件判定 LLM 化：推翻防作弊管线。落选。
- 全部枚举自由化：静默失效风险。落选。
- 双轨并存：违反干净单一。落选。

## Links

- [0014](0014-llm-context-management.md)（contextSummary 与三层注入——描述锚定数值注入的事实源指令）
- [0015](0015-memory-strength-retrieval-supersede.md)（记忆打分检索）
- [0016](0016-dead-contract-wiring-and-ui-consumption.md)（descriptor 编辑 API 与 UI 消费）
- [0018](0018-immersive-frontend-script-code-v2.md)（槽位 UI 结构——描述展示挂入新结构）
- [0004](0004-game-first-principles.md)（数值+description 第一性原理）
