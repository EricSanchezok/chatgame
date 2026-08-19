# LLM 上下文管理——对话历史注入与滚动摘要

## Status
Accepted
Class: feature

## Context and Problem Statement

叙事 prompt 从不注入 transcript 对话历史：`buildTurnPrompt` 注入时间/位置/NPC 人格/记忆/lorebook/对话示例与玩家输入，但完全不注入此前回合的对话，多轮对话中 LLM 无法引用早前回合的事实（NCP-Bench 数据显示 20 回合存活率仅 42%、事实冲突 40–68%）。同时仓库存在两个死资产：`run.yaml` 已声明的 `context_compaction { policy: summarize_archive, retention_tiers }` 配置（schema 必填、引擎零消费）与 `LLMProvider.generateText` 接口（零调用者）。

## Decision Drivers

- 长程一致性必须由引擎保证，不能依赖 LLM 自身的上下文窗口。
- 不引入新枚举；注入的是数值 + 确定性标签 + 自然语言描述（"数值+description 双轨、绝不枚举"决策）。
- 消费既有死配置而非新增配置入口（用户决策：接线不删除）。
- 零新依赖：不引入 embedding、tokenizer。
- 失败必须降级，绝不阻塞回合。

## Considered Options

- 纯窗口（只注入最近 N 轮 transcript）：零额外 LLM 调用，但长程失忆依旧，且死配置继续死。
- 纯摘要（不保留 verbatim）：摘要漂移/污染风险高，近期回合保真度差。
- 引入 embedding/向量检索（Memory Bank 式）：新增依赖与检索管线，v2 再做。
- LLM 自由写记忆库（MemGPT 式）：既有调研证明 LLM 直接写记忆会污染/捏造；记忆保持引擎写。
- 每次全量重写摘要：token 浪费、漂移更大。
- 精确 token 计数：引入 tokenizer 依赖。
- 三层混合注入（近期 verbatim + 滚动摘要 + 结构化状态）——所选路线。

## Decision Outcome

`buildTurnPrompt` 扩展为五层注入（A→E）：A system 块（世界观/规则/禁忌/常驻 lore，原有）；B 结构化状态快照（时间/地点/在场 NPC/进行中任务/关键 flags/场景相关的关系-声望-需求数值+标签+LLM 描述，附"数值为唯一事实源、描述仅为解释"指令，场景过滤）；C 滚动摘要（`contextSummary.text`，增量续写非重写）；D 最近 6 回合 transcript verbatim（`run.ext.llm_context.window_turns` 可覆写）；E 玩家当前输入（最后，recency bias）。

新增 `src/engine/context.ts` 承载上下文逻辑：常量 `CONTEXT_WINDOW_TURNS=6` / `SUMMARY_EVERY_TURNS=8` / `SUMMARY_TRIGGER_RATIO=0.65` / `CONTEXT_TOKEN_BUDGET=24000` / `SUMMARY_MAX_CHARS=6000` / `MAX_SCENE_DESCRIPTORS=3`（均可经 `run.ext.llm_context` 覆写）；`shouldSummarize` 双条件触发（距上次摘要 ≥8 回合，或字符估算超预算×比例）；`summarizeContext` 为 `LLMProvider.generateText` 的首个消费点，模板强制保留玩家目标/任务进度/剧情承诺/未解决线索/关系与声望变化/canonical facts、丢弃氛围描写，输出裁剪到上限，任何失败返回 `null`（降级为纯窗口）。

`WorldState` 新增 `contextSummary?: ContextSummary`（`{ text, lastSummaryTurn, sourceTurnRange }`），随存档持久化；`SAVE_SCHEMA_VERSION` 3→4，旧档拒绝（敏捷约定）。摘要触发在 `playerTurn` 回合结算（transcript append 后）；意图解析 prompt 保持轻量、不注入历史。

记忆分工：短期=transcript verbatim 窗口；中期=rolling summary（引擎持有、可存档）；长期=engine memory（引擎写）；事实=引擎数值状态。摘要/描述是 LLM 产物但由引擎持有与校验，不构成事实源。

## Pros and Cons of the Options

- 三层混合注入：长程一致性与近期保真度兼得，死配置/死接口被消费；代价是每 8 回合多一次摘要 LLM 调用与 prompt 长度增加（由预算常量约束），可接受。
- 纯窗口：零成本但长程失忆依旧（NCP-Bench 证据），且死配置继续死——落选。
- 纯摘要：漂移风险高、近期保真度差——落选。
- embedding/向量检索：复杂度高、破坏零依赖目标——v2 再做。
- LLM 写记忆：违反"记忆引擎写"不变式——落选。

## Links

- [0007](0007-engine-runtime.md)（不可变快照与双轨描述层）
- `docs/research/` 相关调研（LLM 上下文管理最佳实践）
