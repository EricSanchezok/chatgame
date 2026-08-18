# Agent Note: 文档体系与 Agent Notes 决策记录

Status: implemented

## Problem

随着设计决策增多，需要一套文档体系：未来每次决策、改动、优化都有记录、可追溯。参考了 deepseek-harness（`/Users/eric/projects/deepseek-harness`）的文档规范：分层文档 + Agent Notes 决策记录 + 门禁校验。本仓库按自身规模做适配。

## Decision

采用"分层文档 + 决策记录"结构：

- **AGENTS.md（根）**：常驻指令——仓库布局、命令、约定，每条一两行，链接各自的家。
- **docs/README.md**：文档地图——每类文档的归属表。
- **docs/architecture.md**：系统总览——各层如何组成。
- **docs/game-design/**：游戏设计参考——剧本格式、世界模型、机制规格（时间/背包/战斗/角色），一主题一页。
- **docs/postmortem/、docs/cookbook/**：事故复盘、操作指南，首次需要时创建。
- **.agents/notes/**：Agent Notes 决策记录，路径 `{lifecycle}/{class}/YYYY-MM-DD-topic.md`，格式见 [.agents/notes/README.md](../../README.md)。
- **docs/research/**：调研记录——外部证据（理论/方法论/相似产品）。调研不是决定：结论被采纳时写成决策（notes）或规格（game-design），并链接回研究记录。

规则：

- 每个非平凡改动必须新增/更新至少一条 Agent Note。
- 每个事实只有一个"家"：决策 → notes；规格 → docs；指令 → AGENTS.md；别处只放链接。
- 文档只写当前状态，不写变更历史；变更故事进 commit 与 note。
- 文档与决策记录用中文（用户母语，便于维护）；代码标识符与注释用英文。
- 交叉引用用相对 Markdown 链接。

初期不引入门禁脚本与中英对照镜像（按需再加）。

## Alternatives considered

**只有 docs/，不设决策记录**。放弃。文档承载"是什么"，承载不了"为什么、放弃了什么"；没有 notes，决策无法追溯，会被反复重提。

**标准 ADR 格式**。放弃。要点相近但更重，分类与游戏项目不贴合；Agent Notes 的轻量版（路径编码生命周期 + 分类）更易维护。

**文档全英文**。放弃。对 AI 友好但对用户维护成本高；中文为主，代码仍用英文标识符。

**一开始就上完整门禁（格式/link/字数校验脚本）**。暂缓。当前单人项目收益小于成本；结构先立，门禁按需补。

## Consequences

- 决策有"家"：proposed/implemented/rejected 生命周期让每个决定的状态一目了然。
- 写作成本：每次非平凡改动多一份 note 工作；换来的是可追溯的设计史。
- 结构为未来扩展留好位置（postmortem/cookbook），但避免了一堆空目录。
