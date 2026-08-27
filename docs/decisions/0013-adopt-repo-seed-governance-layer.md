# 采用 repo-seed 自治理层

## Status
Superseded by [0066](0066-upgrade-progressive-repo-seed-governance.md)
Class: process

## Context and Problem Statement

仓库已有自主建立的治理体系（分层文档 + `.agents/notes/` Agent Notes 决策记录，见 [ADR 0009](0009-documentation-and-agent-notes.md)），但没有确定性门禁、pre-commit hook、许可证、贡献指南与内嵌评审 skill：决策记录格式无机器校验、文档链接会腐烂、占用文件可被悄悄手改、升级通道缺失。repo-seed skill（v0.2.0）提供完整的五层自治理骨架 + 所有权清单升级通道，与本仓库"干净单一""每个事实只有一个家""敏捷开发"的既有约定同构。

## Decision Drivers

- 决策记录必须有机器门禁：格式、编号、链接、占位符、manifest 全部可验证。
- 保持可升级：重跑 repo-seed 是唯一升级通道，用户改过的文件默认保留。
- 不引入第二套决策体系：`docs/decisions/`（MADR）成为唯一决策日志，`.agents/notes/` 整体迁移后删除。
- 技术栈无关、零新依赖：门禁脚本零依赖，只需 node ≥ 22。
- 文档与决策记录保持中文（仓库既有约定）。

## Considered Options

- 保留 `.agents/notes/` 并自定义门禁适配（不引入 docs/decisions/）。
- 跳过决策层（只 seed 其余治理）。
- 原样覆盖现有 AGENTS.md/docs（模板英文直出）。
- 并行保留 `.agents/notes/` 与 `docs/decisions/`。
- 把 `.agents/notes/` 原样复制到 `docs/decisions/` 不改格式。
- 完整采用 repo-seed 治理层 + 一次性迁移既有决策体系——即所选路线。

## Decision Outcome

按 repo-seed 五步流程（Analyze → Interview → Scaffold → Instantiate → Record & verify）落地：

- **决策体系迁移**：`.agents/notes/` 的 9 条 implemented 记录迁移为 `docs/decisions/` 的 MADR 记录 0004–0012（含 seed 自带 0000–0003，中文实例化）；本次变更记录为 0013；0009 标记 `Superseded by 0013`。迁移后删除 `.agents/notes/` 目录并更新全仓引用。
- **确定性门禁**：`scripts/` 下 4 个 verifier（verify-decisions / verify-doc-links / verify-placeholders / verify-manifest）+ install-hooks.mjs；pre-commit hook 运行 4 门禁 + `git diff --cached --check`。门禁覆盖：MADR 格式与编号、文档相对链接与锚点、填充 token 占位符、manifest 哈希。
- **自治理基础设施**：`.repo-seed/manifest.json`（sha256 所有权清单）+ `.repo-seed/update-strategy.md`；`.agents/skills/repo-review`（按本项目规则实例化的语义评审 skill，user-owned，永不从模板刷新）与 `.agents/skills/repo-decisions`（决策记录流程 skill）。
- **文档标准与指南**：`docs/AGENTS.md`（文档标准）、`docs/development.md`、`docs/testing.md`、`docs/postmortems/README.md`、`CONTRIBUTING.md`、`docs/architecture.md`（真实模块图）。
- **元文件**：`LICENSE`（MIT）、`.editorconfig`、`.gitattributes`、`.github/`（PR + issue 模板）；根 `AGENTS.md` 重组为 seed 骨架（保留既有 9 条约定与 nextjs-agent-rules 块，新增 gates 命令与治理循环）。

### Consequences

- 决策记录、文档链接、占位符、manifest 全部有机器门禁，commit 时由 pre-commit hook 强制。
- 治理层可升级：重跑 repo-seed 刷新未触碰的 seeded 文件；文档型文件已实例化为中文，重跑时被识别为 user-modified 而保留。
- 单一决策体系：`docs/decisions/` 是唯一决策日志；`repo-review` skill 让评审聚焦本项目真实红线与失效模式。
- 写作成本：每次非平凡改动需按 MADR 写决策记录（与既有 Agent Notes 规则等价）。
- 业务代码零改动：门禁与迁移只触碰治理层文件与文档链接。

## Pros and Cons of the Options

### 保留 .agents/notes/ 并自定义门禁适配
- 坏：偏离 seed 标准，需维护自定义适配层，重跑 seed 无法升级，违背"干净单一"。

### 跳过决策层
- 坏：丢失 repo-seed 核心价值（决策可追溯 + 门禁强制），治理循环无法闭环。

### 原样覆盖现有 AGENTS.md/docs（模板英文直出）
- 坏：违反"文档与决策记录用中文"约定，丢失 9 条既有硬规则与真实模块信息；seed 明确要求实例化。

### 并行保留两套体系
- 坏：双轨决策体系，违反"每个事实只有一个家"与"干净单一"，门禁无法覆盖旧记录。

### 原样复制 notes 到 decisions 不改格式
- 坏：verify-decisions 门禁（文件名、章节、状态值）必然失败，门禁形同虚设。

### 完整采用 + 一次性迁移
- 好：门禁可验证、升级通道存在、单一体系、业务零改动；迁移成本一次付清。

## Links
- [ADR 0000](0000-use-markdown-architectural-decision-records.md) — MADR 决策日志标准。
- [ADR 0002](0002-self-governing-repository-design.md) — 五层治理设计。
- [ADR 0009](0009-documentation-and-agent-notes.md) — 被本决策取代的旧决策记录体系。
- [.repo-seed/update-strategy.md](../../.repo-seed/update-strategy.md) — 所有权与更新语义。
