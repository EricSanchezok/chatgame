# 记忆系统升级——相关性检索、连续遗忘与失效语义

## Status
Accepted
Class: feature

## Context and Problem Statement

原记忆系统（脚本写入 + `tier_retention_days` 硬天数二值归档 + `summarizeForInjection` 取最新 8 条注入）只实现了业界共识的一个子集，且存在多处缺陷：

- **检索**：纯 recency，无相关性维度——一个 trivial 但高度相关的记忆（"欠了玩家一个人情"）在相关时刻永远不会被注入（纯 recency 保留率仅 0.368）。
- **遗忘**：`archived` 布尔 + 硬天数到点一刀切，无连续强度、无访问强化（MemoryBank Ebbinghaus 曲线、AI Dungeon LRU 反淘汰均证明"复习"是遗忘的必要成分）。
- **更新**：append-only 无失效语义——"欠 20 金币"在"已还清"之后仍永久污染检索（MemStrata：事实被取代后检索接近随机，失效而非删除是可靠解法）。
- **玩家记忆是死写**：`PlayerState.memories` 可写但零读取方。
- **memory id 碰撞缺陷**：`mem-${eventLog.length + 1}` 在同一批 effects / 嵌套事件内必然碰撞。
- **死配置**：`forget_policy.trivial_after_days`（零读取）、`meta_progression.reset.memories`（零消费）、`addMemory`/`memoriesByTag` 死导出。

调研依据：`docs/research/2026-08-19-npc-memory.md`（学术 15 篇 + 业界收敛点）。

## Decision Drivers

- 保持引擎管状态不变式（I3）：记忆只能由引擎效果写入，LLM/玩家文本永不写记忆。
- 确定性：无 `Math.random`/时间戳做 id；同 seed 同输入同输出。
- 零新依赖：不引入 embedding/向量库。
- 干净单一：旧路径被替代即删除，不留双轨。

## Considered Options

- LLM 自动写记忆/提取事实（Mem0/Zep/LangMem）：违反 I3 不变式；TRUSTMEM 证据表明 LLM 管理记忆产生污染/遗漏/捏造。落选。
- 向量库/embedding 检索：破坏确定性 + 引入运行时依赖；MemStrata 证明纯向量在事实演化时不可靠。留 V2 可选增强。落选。
- 记忆分 kind 硬编码（事件/关系/事实/人格）：关系类事实已有 relations 系统（单一事实源），硬编码 kind 制造并行所有权；以 tags 表达主题。落选。
- 逐条类型化衰减（Scrub Jay）：需要每条记忆声明腐坏系数，契约面大增；本次用 tier 级曲线，逐条化留 V2。落选。
- 纯 ADD-only 不自动遗忘（Mem0）：游戏需要遗忘作为叙事特性。落选。
- 删除玩家记忆：用户选择接入注入（激活死写能力）。落选。
- 在既有记忆系统上做确定性升级（连续强度 + 相关性检索 + 失效三件套）——所选路线。

## Decision Outcome

**数据模型**（`src/engine/types.ts`）：`MemoryEntry` 新增 `strength`（0–1 连续强度）、`lastAccessedDay`（最近被注入的绝对天，从未注入为 null）、`lastDecayDay`（多天跳跃按日幂等衰减的锚点）、`supersededBy?`（失效审计）。`archived` 保留为最终二值结果（强度跌破阈值）。

**`src/engine/memory.ts` 重写**：

- 初始强度按 importance 分层：major 1.0 / minor 0.6 / trivial 0.3（引擎常量，不进剧本 schema）。
- `applyMemoryDecay`：日衰减因子 `(FORGET_THRESHOLD / initial) ** (1 / retentionDays)`，`FORGET_THRESHOLD = 0.05`——强度恰在第 N 天达到阈值，归档发生在之后第一次日边界（±1 天模糊，作者语义"保留 N 天"等价）；`major + majorKeep` 与 `retentionDays === 0` 永久；`lastDecayDay` 保证离线 advance 跨多日只按实际天数衰减一次。
- `recordMemoryAccess`：对本次实际注入的 ids 提升 strength（+0.15，封顶 1.0）并记录 `lastAccessedDay`；未知 id 静默忽略（幂等）。只在叙事正常生成路径强化，fallback 不强化（避免"没看到也变强"）。
- `selectMemories`：打分 `strength + 0.5 × min(相关命中, 3)`；相关信号 = tag 命中对话 NPC / 当前地点 / 玩家输入子串；平局按 createdAtDay 降序、再按 id 字典序（稳定确定性）。注入改为打分 top-K（K=8）。
- 删除 `addMemory` / `memoriesByTag` / `summarizeForInjection` 旧实现。

**effect 扩展**（`src/engine/effect.ts` + `src/script/schemas/common.ts`）：memory effect 新增可选 `tags[]` 与 `replaces: <id>`；`replaces` 把目标 actor 中匹配的活跃条目归档并写 `supersededBy`，目标不存在则仅追加（容错、确定性）；id 修复为 `${target}-mem-${day}-${actor.memories.length}`（actor 列表长度批内单调、target 前缀隔离 actor、worldgen 前缀 `mem-${npcId}-${idx}` 不冲突）。

**注入改造**（`src/engine/narrative/prompt.ts` + `narrative.ts` + `index.ts`）：NPC 记忆改打分注入；新增"## 玩家的记忆"区块（K=8，玩家记忆从死写变为进 LLM 上下文）；`memorySelections` 为 prompt 与强化共享同一选择函数，保证同 state 同输入 → 同注入集合 → 同强化结果。

**日边界**（`src/engine/worldstep.ts`）：`applyGlobalForgetting` → `applyGlobalMemoryDecay`（"恒执行、不受 advance_scope 控制"语义不变）。

**存档**：`SAVE_SCHEMA_VERSION` 3→4，旧档直接拒绝（敏捷约定，无迁移）。

**死配置清理**：删除 `forget_policy.trivial_after_days`（npc schema）、`meta_progression.reset.memories`（schema + 两剧本 run.yaml）、`addMemory`/`memoriesByTag` 死导出。`activeMemories` 保留（`selectMemories` 内部使用）。`context_compaction` 由并行决策 [0014](0014-llm-context-management.md) 消费，本记录不删除它（合并时保留）。

## Pros and Cons of the Options

- 所选路线：注入由"最新 8 条"变为"强度 × 相关性打分 top-8"，旧但重要的记忆在相关时刻被召回；遗忘从二值到点变为连续曲线 + 复述强化；`replaces` 让剧本作者能表达"事实变了"；玩家记忆进入 LLM 上下文；id 碰撞缺陷修复；死配置清零。代价：MemoryEntry 形状变更 → 存档 v4 旧档全拒（符合敏捷约定）；评分公式为引擎常量，剧本作者只能通过 importance/tags 间接控制（契约最小化的刻意选择）。
- LLM 写记忆：违反 I3、污染风险高——落选。
- 向量检索：破坏确定性 + 新依赖——留 V2。

## Links

- [0014](0014-llm-context-management.md)（LLM 上下文管理：`context_compaction` 消费与三层注入）
- `docs/research/2026-08-19-npc-memory.md`
- [0007](0007-engine-runtime.md)（I3 不变式与双轨状态）
