# 文档体系与 Agent Notes 决策记录

## Status
Superseded by [0013](0013-adopt-repo-seed-governance-layer.md)
Class: process

## Context and Problem Statement

随着设计决策增多，需要一套文档体系：未来每次决策、改动、优化都有记录、可追溯。参考了 deepseek-harness 的文档规范：分层文档 + Agent Notes 决策记录 + 门禁校验。本仓库按自身规模做适配。

## Decision Drivers

- 决策可追溯：每个决定都有"家"，不会被反复重提。
- 分层文档：指令/规格/决策/调研各归其位。
- 中文优先：文档与决策记录用中文（用户母语，便于维护）。
- 结构先行：初期不引入门禁脚本与中英对照镜像（按需再加）。

## Considered Options

- 只有 docs/，不设决策记录。
- 标准 ADR 格式。
- 文档全英文。
- 一开始就上完整门禁（格式/link/字数校验脚本）。
- 分层文档 + Agent Notes 决策记录——即所选路线（后被 [ADR 0013](0013-adopt-repo-seed-governance-layer.md) 取代）。

## Decision Outcome

采用"分层文档 + 决策记录"结构：

- **AGENTS.md（根）**：常驻指令——仓库布局、命令、约定，每条一两行，链接各自的家。
- **docs/README.md**：文档地图——每类文档的归属表。
- **docs/architecture.md**：系统总览——各层如何组成。
- **docs/game-design/**：游戏设计参考——剧本格式、世界模型、机制规格，一主题一页。
- **docs/postmortem/、docs/cookbook/**：事故复盘、操作指南，首次需要时创建。
- **.agents/notes/**：Agent Notes 决策记录，路径 `{lifecycle}/{class}/YYYY-MM-DD-topic.md`。
- **docs/research/**：调研记录——外部证据。调研不是决定：结论被采纳时写成决策或规格，并链接回研究记录。

规则：每个非平凡改动必须新增/更新至少一条决策记录；每个事实只有一个"家"（决策/规格/指令各归其位）；文档只写当前状态，不写变更历史；文档与决策记录用中文，代码标识符与注释用英文；交叉引用用相对 Markdown 链接。

本决策所建立的 Agent Notes 体系已整体迁移为 `docs/decisions/` 的 MADR 决策日志（见 [ADR 0013](0013-adopt-repo-seed-governance-layer.md)）；本记录保留历史事实。

### Consequences

- 决策有"家"：proposed/implemented/rejected 生命周期让每个决定的状态一目了然。
- 写作成本：每次非平凡改动多一份记录工作；换来的是可追溯的设计史。
- 结构为未来扩展留好位置（postmortem/cookbook），但避免了一堆空目录。
- 后续被统一 MADR 决策日志取代：生命周期目录与分类由文件编号 + `Class:` 扩展行承载。

## Pros and Cons of the Options

### 只有 docs/，不设决策记录
- 坏：文档承载"是什么"，承载不了"为什么、放弃了什么"；没有决策记录，决策无法追溯，会被反复重提。

### 标准 ADR 格式
- 坏：要点相近但更重，分类与游戏项目不贴合；Agent Notes 的轻量版更易维护。（后续统一采用 MADR 时，这一顾虑由 `Class:` 扩展与门禁解决。）

### 文档全英文
- 坏：对 AI 友好但对用户维护成本高；中文为主，代码仍用英文标识符。

### 一开始就上完整门禁
- 坏：当前单人项目收益小于成本；结构先立，门禁按需补。（后续由 [ADR 0013](0013-adopt-repo-seed-governance-layer.md) 引入确定性门禁。）

## Links
- [ADR 0013](0013-adopt-repo-seed-governance-layer.md) — 取代本记录所建立的决策记录体系。
- [docs/README.md](../README.md) — 文档地图。
