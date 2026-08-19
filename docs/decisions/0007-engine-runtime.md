# 引擎运行时 v1——不可变快照 + 注入 RNG + PDVA 防作弊 + 双轨状态描述层

## Status
Accepted
Class: architecture

## Context and Problem Statement

剧本格式 v1.0（[ADR 0005](0005-script-format-v1.md)）定义了"世界是什么"，但缺少"世界如何运转"的运行时：时间推进、动作判定、承诺保持、事件调度、NPC 状态、LLM 叙事接缝。三路调研确认了运行时必须解决四个问题：状态真实（数值不进对话）、判定可靠（LLM 不可裁判）、防作弊（玩家文本不能是效果来源）、长期一致性（承诺由引擎保持）。

## Decision Drivers

- 状态真实：数值由引擎管理，绝不进对话文本。
- 判定可靠：规则裁决永不交给 LLM。
- 防作弊：玩家文本不能是效果来源。
- 确定性：同种子同结果，存档可复现。
- LLM 生态：用 Vercel AI SDK v7 + 薄适配层。

## Considered Options

- LangChain.js / 官方 SDK 直连 / 自研协议。
- LLM 判定成败（AI Dungeon 式）。
- 描述参与判定。
- LLM 直接提议状态 delta（PAYADOR 式）。
- 可变 WorldState + 就地修改。
- 剧本 schema 扩 passive 检定/区间映射表。
- 动态动作生成（STORY2GAME 式）。
- 内存存档。
- 不可变快照 + 注入 RNG + PDVA + 双轨描述层——即所选路线。

## Decision Outcome

引擎运行时 v1 = `src/engine/` 完整模块，消费 `src/script/` 契约层（只读，不扩 schema）：

- **状态模型**：不可变快照 + 纯函数更新 + append-only 事件日志；存档即快照。所有随机源（worldgen/导演/检定）走注入式种子 RNG（mulberry32），同种子同结果。
- **回合循环（PDVA）**：意图解析（LLM，兜底分级）→ 引擎合法性（RuleOK）→ 判定（stat/skill_check d20+DC / opposed 平手=主动方失败 / auto / narrative_only 最小化）→ 结果等级（fail/partial/success/crit，Blades 式，partial=0.5×/crit=2×）→ costs/effects/time → 承诺检查 → 导演选事件 → LLM 叙事（双通道）→ 一致性校验（schema/perm/taboo/秘密，重试≤2 后降级）→ 描述层惰性刷新。
- **双轨状态描述层**（descriptors.ts）：三层分离——计算层（数值，引擎，唯一事实源，参与判定）/ 分类层（确定性标签，value→stance/label 映射）/ 解释层（LLM 描述 ≤300 字，只解释不判定）。挂载关系/声望/需求；更新触发三级（事件/跨区间/定期兜底）；惰性生成 + 校验失败降级确定性模板；`setDescriptor` 用户可编辑。
- **防作弊（I1-I7 不变量）**：状态只有引擎能改；效果白名单 + 实体引用；记忆只由引擎写；规则裁决永不交给 LLM；骰子/数值/结算在引擎；叙事文本中的状态声称不生效（Narrative/Mechanics 双通道）；拒绝要叙事化。
- **LLM 桥**：`LLMProvider` 接口 + `MockProvider`（确定性，默认，无 key 全绿）+ `VercelProvider`（AI SDK v7 `generateObject`，env 配置端点，薄适配层隔离 API 演进）。意图/叙事/描述输出均定义 zod schema。
- **判定日志**：ResolutionLog 结构化记录（谁/什么检定/骰值/DC/等级/效果），可审计。
- **运行策略**：死亡三模式（soft_failure 威胁条传送 / world_continue 重建玩家 / hard_reset 重跑或保留世界）+ meta-progression（keep/reset/unlocks）。
- **存档**：文件 JSON 快照 `.chatgame/saves/<scriptId>/<runId>.json`，版本校验，往返深相等。
- **离线推进**：`advance(hours)` 确定性推进（时钟 + needs 衰减 + status tick，按 advance_scope）。
- **Demo CLI**：`npm run play`（加载 emberfall → 开局 → 固定回合含偷窃/战斗/超模请求 → 存档 → 读档验证）。

**复核修正（2026-08-18，审计后补充）**：opposed 平手语义修正为 diff===0 → fail（5e 语义），边界 diff>=5 crit / diff>=1 success / diff===0 fail / diff>=-3 partial；战斗接线（attack/defend 消费 mechanics/combat，HP 归零记 `defeated:<npc>` fact）；描述层校验兜底（descriptionPolarityOk 最小规则，失败降级模板）；LLM 桥双路验证（可注入 `languageModel`）；starlight 集成测试；条件代数 not_in 与跨季节断言补全；narrative_only 单测；package.json `engines.node >=22`。测试从 277 → 294。

### Consequences

- 引擎复杂度高：不可变更新 + 全量浅拷贝在超大规模世界下有性能代价（v1 规模可忽略，未来走结构化共享）。
- Mock 与真实 LLM 的叙事质量差距大：Mock 只为验证设计逻辑，真实叙事体验需配 key 验证（属可选 e2e）。
- 契约层缺口（passive 检定、剧本声明区间映射表、facts/flags 声明池）留待后续 Blueprint，引擎先用内置默认。
- 收益：PDVA 三关卡 + I1-I7 不变量全部引擎确定性执行；双轨状态（数值强度 + 标签质性 + LLM 描述）；固定种子可复现；109+ 测试全绿；后续 UI 可直接调用 Engine 门面。

## Pros and Cons of the Options

### LangChain.js / 官方 SDK 直连 / 自研协议
- 坏：依赖过重 / provider 锁定 / 用户明确要求用生态。选 Vercel AI SDK v7 + 薄适配层。

### LLM 判定成败
- 坏：NCP-Bench（20 轮后承诺存活率 42%）、RPGBench、CoC-Seduce、Flux 四重证据否定。判定永远引擎结算。

### 描述参与判定
- 坏：架构污染——判定只读数值（RimWorld thoughts 先例）。描述只解释。

### LLM 直接提议状态 delta
- 坏：v1 用更保守的"引擎按动作原语+参数结算"（单 LLM 调用最简最安全）。V2 加法演进。

### 可变 WorldState + 就地修改
- 坏：可测试性/存档/回滚困难。用不可变快照。

### 剧本 schema 扩 passive 检定/区间映射表
- 坏：属契约层改动；引擎 v1 用内置默认（opposed 平手语义、value→stance 映射），缺口记录为后续契约 Blueprint。

### 动态动作生成
- 坏：无成熟自动验证方案，等于向玩家开放规则编辑权。

### 内存存档
- 坏：用户选定文件 JSON 快照。

## Links
- [ADR 0005](0005-script-format-v1.md) — 剧本格式契约。
- [ADR 0006](0006-engine-mechanics-modules.md) — 基础机制模块。
- [ADR 0008](0008-engine-completeness.md) — 运行时完备化。
- [docs/game-design/engine-runtime.md](../game-design/engine-runtime.md) — 引擎运行时规格。
