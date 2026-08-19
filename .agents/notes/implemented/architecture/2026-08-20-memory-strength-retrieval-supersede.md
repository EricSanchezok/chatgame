# Agent Note: NPC/玩家记忆系统升级——相关性检索 + 连续遗忘 + 失效语义

Status: implemented

## Problem

原记忆系统（脚本写入 + `tier_retention_days` 硬天数二值归档 + `summarizeForInjection` 取最新 8 条注入）只实现了业界共识的一个子集：

- **检索**：纯 recency，无相关性维度——一个 trivial 但高度相关的记忆（"欠了玩家一个人情"）在相关时刻永远不会被注入。调研证据：纯 recency 保留率仅 0.368（2606.12945）。
- **遗忘**：`archived` 布尔 + 硬天数到点一刀切，无连续强度、无访问强化、无逐条类型化（MemoryBank Ebbinghaus 曲线、AI Dungeon LRU 反淘汰均证明"复习"是遗忘的必要成分）。
- **更新**：append-only 无失效语义——"欠 20 金币"在"已还清"之后仍永远污染检索（MemStrata：事实被取代后向量检索 AUROC 0.59 ≈ 随机；失效而非删除是唯一可靠解法）。
- **玩家记忆是死写**：`PlayerState.memories` 可写但零读取方。
- **memory id 碰撞缺陷**：`mem-${eventLog.length + 1}` 在同一批 effects / 嵌套事件内必然碰撞。
- **死配置**：`context_compaction`（schema 必填零消费）、`forget_policy.trivial_after_days`（零读取）、`meta_progression.reset.memories`（零消费）、`addMemory`/`memoriesByTag` 死导出。

调研依据：`docs/research/2026-08-19-npc-memory.md`（学术 15 篇 + 业界收敛点，双线调研）。

## Decision

在既有记忆系统上做确定性升级（不引入 LLM 写入、向量库或新存储）：

- **MemoryEntry 形状**：新增 `strength`（0–1 连续强度）、`lastAccessedDay`、`lastDecayDay`（多天跳跃按日幂等衰减）、`supersededBy?`（失效审计）。`archived` 保留为最终二值结果。
- **连续遗忘**：`applyMemoryDecay` 按 tier 初始强度（major 1.0 / minor 0.6 / trivial 0.3）与 `tier_retention_days` 标定日衰减因子，强度跌破阈值（0.05）归档；major+majorKeep 与 retention 0 = 永久；日界由 `applyGlobalMemoryDecay` 对所有角色执行（原"恒执行、不受 advance_scope 控制"语义不变）。
- **访问强化**：`recordMemoryAccess` 对本次实际注入的 ids 提升 strength（+0.15，封顶 1.0）并记录 `lastAccessedDay`；只在叙事正常生成路径强化，fallback 不强化（保守、确定性）。
- **相关性检索**：`selectMemories` 打分 `strength + 0.5 × min(相关命中, 3)`；相关信号 = tag 命中对话 NPC / 当前地点 / 玩家输入子串；平局按 createdAtDay 降序、再按 id 字典序（稳定确定性）。注入改为打分 top-8。
- **玩家记忆接入注入**：`buildTurnPrompt` 新增"## 玩家的记忆"区块（与 NPC 记忆同一套打分/强化）；`memorySelections` 为 prompt 与强化共享同一选择函数，保证同 state 同输入 → 同注入集合 → 同强化结果。
- **supersede 语义**：memory effect 增加可选 `tags[]` 与 `replaces: <id>`；`replaces` 把目标 actor 中匹配的活跃条目归档并写 `supersededBy`，目标不存在则仅追加（容错、确定性）。
- **id 修复**：`${target}-mem-${day}-${actor.memories.length}`——actor 列表长度批内单调、target 前缀隔离 actor、worldgen 初始前缀 `mem-${npcId}-${idx}` 不冲突；删除对 eventLog.length 的依赖。
- **存档 v4**：`SAVE_SCHEMA_VERSION` 3→4，旧档直接拒绝（敏捷约定，无迁移）。
- **死配置清除**：删除 `context_compaction`（run.ts schema + 两剧本 run.yaml）、`forget_policy.trivial_after_days`（npc schema）、`meta_progression.reset.memories`（schema + 两剧本 run.yaml）、`addMemory`/`memoriesByTag` 死导出。`activeMemories` 保留（`selectMemories` 内部使用）。

## Alternatives considered

- **LLM 自动写记忆/提取事实**（Mem0/Zep/LangMem）：违反 I3 不变式；TRUSTMEM 证据表明 LLM 管理记忆产生污染/遗漏/捏造。落选。
- **向量库/embedding 检索**：破坏确定性 + 引入运行时依赖；MemStrata 证明纯向量在事实演化时不可靠。留 V2 可选增强。落选。
- **落地 `context_compaction` 摘要层**：transcript 已保留对话历史，摘要收益不确定且引入 LLM 依赖；作为死配置删除，摘要留 V2（届时必须是剧本显式效果）。落选。
- **记忆分 kind 硬编码**（事件/关系/事实/人格）：关系类事实已有 relations 系统（单一事实源），硬编码 kind 制造并行所有权；以 tags 表达主题。落选。
- **逐条类型化衰减**（Scrub Jay）：需要每条记忆声明腐坏系数，契约面大增；本次用 tier 级曲线，逐条化留 V2。落选。
- **纯 ADD-only 不自动遗忘**（Mem0）：游戏需要遗忘作为叙事特性。落选。
- **删除玩家记忆**：用户选择接入注入（激活死写能力）。落选。

## Consequences

- **买到**：注入由"最新 8 条"变为"强度 × 相关性打分 top-8"，旧但重要的记忆在相关时刻会被召回；遗忘从二值到点变为连续曲线 + 复述强化（MemoryBank S+1 的确定性版本）；`replaces` 让剧本作者能表达"事实变了"；玩家记忆进入 LLM 上下文；id 碰撞缺陷修复；死配置清零。
- **付出**：MemoryEntry 形状变更 → 存档 v4，旧档全拒（符合敏捷约定）；`context_compaction` 占位删除意味着 V2 摘要层需重新引入（届时必须是剧本显式效果）；评分公式为引擎常量（不进 schema），剧本作者只能通过 importance/tags 间接控制。
- **验证**：30 测试文件 463 测试全绿；lint / build / 两剧本 validate / play 冒烟通过；`rg` 死配置清零（src/scripts/docs 无残留）。
- **边界**：注入长度 NPC + 玩家各 8 条不变；衰减归档 ±1 日边界模糊（作者语义"保留 N 天"）；`lastDecayDay` 保证多天跳跃（`advance` 一次跨多日）只按实际天数衰减一次。
