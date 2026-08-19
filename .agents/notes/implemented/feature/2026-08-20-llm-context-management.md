# Agent Note: LLM 上下文管理——对话历史注入与滚动摘要

Status: implemented

## Problem

叙事 prompt 从不注入 transcript 对话历史，长对话中 LLM 无法引用早前回合的事实（"LLM 失忆"）；同时 `run.yaml` 已声明的 `context_compaction` 配置与 `LLMProvider.generateText` 接口零消费，成为死配置/死接口。

## Decision

在 `buildTurnPrompt` 内扩展为五层注入（A/B/C/D/E）：

- A：system 块（世界观/规则/禁忌/常驻 lore，`buildSystemPrompt` 原有）；
- B：system 块——结构化状态快照（时间/地点/在场 NPC/进行中任务/关键 flags/场景相关的关系-声望-需求数值+确定性标签+LLM 描述），附"数值为唯一事实源、描述仅为解释"系统指令；描述锚定数值并列注入（`Elara | 关系 20/100 | 友善 | <description>`），只注入当前场景相关对象（在场 NPC ≤3 条）；
- C：system 块——滚动摘要（`contextSummary.text`，增量续写非重写）；
- D：chat 块——最近 6 回合 transcript verbatim（`run.ext.llm_context.window_turns` 可覆写）；
- E：user 块——玩家当前输入（最后，recency bias）。

新增 `src/engine/context.ts` 承载全部上下文逻辑：

- 常量：`CONTEXT_WINDOW_TURNS=6`、`SUMMARY_EVERY_TURNS=8`、`SUMMARY_TRIGGER_RATIO=0.65`、`CONTEXT_TOKEN_BUDGET=24000`、`SUMMARY_MAX_CHARS=6000`、`MAX_SCENE_DESCRIPTORS=3`，均可经 `run.ext.llm_context` 覆写（默认锁死）。
- `shouldSummarize`：双条件——距上次摘要 ≥8 个玩家回合，或 transcript+summary 字符估算超过预算×比例（字符估算代替 tokenizer，无新依赖）。
- `summarizeContext`：`LLMProvider.generateText` 的**首个消费点**；prompt 含旧摘要 + 本轮新增回合范围 + 强制模板（保留：玩家当前目标/任务进度/剧情承诺/未解决线索/关系与声望变化/canonical facts；丢弃：氛围描写/重复陈述/寒暄）；输出裁剪到 `SUMMARY_MAX_CHARS`；任何失败返回 `null`。
- 摘要触发在 `playerTurn` 回合结算（transcript append 之后）执行，摘要写入 `WorldState.contextSummary`（`{ text, lastSummaryTurn, sourceTurnRange }`），随存档持久化。

存档 schema version 3 → 4（`SAVE_SCHEMA_VERSION=4`）；`normalizeWorldState` 为缺失的 `contextSummary` 补空对象（`[1,0]` 哨兵表示"无摘要"）。旧存档拒绝（敏捷约定，无迁移）。

记忆分工不变：短期=transcript verbatim 窗口；中期=rolling summary（引擎持有、可存档）；长期=engine memory（引擎写）；事实=引擎数值状态。摘要/描述是 LLM 产物但由引擎持有与校验，不构成事实源。

## Alternatives considered

- **纯窗口（只注入最近 N 轮）**：零额外 LLM 调用，但长程失忆依旧，且 `context_compaction`/`generateText` 继续是死配置/死接口。拒绝。
- **纯摘要（不保留 verbatim）**：摘要漂移/污染风险高，近期回合保真度差。拒绝。
- **引入 embedding/向量检索（Memory Bank 式）**：新增 embedding 依赖 + 检索管线，复杂度高，v2 再做。拒绝。
- **LLM 自由写记忆库（MemGPT 式）**：既有调研证明 LLM 直接写记忆会污染/捏造；记忆保持引擎写。拒绝。
- **每次全量重写摘要**：token 浪费、漂移更大；采用增量续写（running summary，LangMem 模式）。
- **摘要状态放 transcript 条目**：污染聊天渲染；独立 `contextSummary` 字段（存档持久化、UI 不可见）。选择。
- **精确 token 计数**：引入 tokenizer 依赖；用保守字符估算（1 汉字 ≈ 1-3 token 余量）即可。选择。

## Consequences

- 买到的：多轮对话中 LLM 能引用早前回合事实；长会话 token 输入不随 transcript 线性膨胀（窗口 + 摘要双保险）；`context_compaction` 被消费（`retention_tiers` 进入摘要模板）；`generateText` 有调用者；摘要状态随存档 round-trip。
- 付出的：每个摘要触发点多一次 LLM 调用（每 8 回合 1 次，可接受）；存档 schema 升到 v4，旧存档被拒；prompt 长度增加（状态块 + 窗口 + 摘要），由预算常量约束。
- 降级路径：摘要失败 → 跳过只注入窗口，回合不阻塞；descriptor 失败 → 既有确定性模板兜底（未改动）。
- 并行约定：蓝图 A 不动 schema、C 不动 schema；本蓝图只加 `WorldState.contextSummary` 可选字段并 bump version 常量，合入无冲突。
