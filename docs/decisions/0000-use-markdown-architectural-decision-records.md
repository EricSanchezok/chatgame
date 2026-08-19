# 使用 Markdown 架构决策记录（MADR）

## Status
Accepted
Class: process

## Context and Problem Statement

仓库的决策——某个设计或流程规则为什么存在、赢过了谁、放弃了什么——如果只存在于 commit message 或对话里，就会丢失。没有决策日志，同一个决策会被反复重提，后来的维护者无法分辨当前结构是有意设计还是偶然产物。

## Decision Drivers

- 所有决策（架构与流程）需要一个统一、业界标准的"家"。
- 工具兼容：记录应能被现有 ADR 工具解析。
- 机器可校验：结构可被门禁检查，漂移能被捕获。

## Considered Options

- MADR（Markdown Any Decision Records），存放于 `docs/decisions/`。
- Nygard 原始 ADR 格式。
- 自造 notes 格式 + 自定义生命周期词汇。
- 完全没有决策日志。

## Decision Outcome

采用 **MADR** 作为格式，扁平存放于 `docs/decisions/NNNN-title.md`，并带一个文档化的 `Class:` 扩展行（architecture/process/testing/feature/bug-fix/simplification）。状态值为 MADR 原生集合：Proposed、Accepted、Rejected、Deprecated、Superseded by NNNN。生命周期与链接纪律——superseded 记录绝不改写成相反决定，由新记录 supersede 它——遵循 MADR 约定。`scripts/verify-decisions.mjs` 强制命名、编号、章节、状态、Class 与 supersede 链接。

### Consequences

- 好：所有决策一个家；现有 MADR 工具可直接解析这些文件；漂移被机械捕获。
- 好：`Class:` 扩展对不认识它的工具透明，兼容性保留。
- 代价：相比自由格式笔记，每条决策有少量格式开销；门禁让格式成本变得很低。

## Pros and Cons of the Options

### MADR
- 好：标准、有文档、工具友好。
- 好：`## Status` 在顶部，生命周期一目了然。
- 中性：要求若干固定章节；门禁保证它们不缺席。

### Nygard 格式
- 好：原始格式，广为人知。
- 坏：章节约定更松散，难以统一校验。

### 自造 notes 格式
- 好：词汇完全定制。
- 坏：无生态兼容；重复发明了行业已标准化的轮子。

### 无决策日志
- 坏：决策只活在记忆与提交历史里；被重提是必然。

## Links
- [ADR 0001](0001-repo-seed-is-a-skill-not-a-template.md) — 本仓库为何以 skill 形式存在。
- [ADR 0002](0002-self-governing-repository-design.md) — 本日志所保护的五层治理设计。
