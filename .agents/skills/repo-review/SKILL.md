---
name: repo-review
description: Use when reviewing a pull request or a change in this repository — orients the reviewer to this repository's standards (AGENTS.md conventions, decision log, gates) and the review-specific checks that code alone cannot show
---

# Reviewing a change in this repository

Read the diff, the owning docs, the decision log, and enough surrounding code to understand the design before judging it. **Blocking requirements** are hard: a violation blocks the change. **Manual checks** rank remaining risk by this project's real failure modes — apply the ones the change touches, not every one, to every change.

## Sources of truth

- [AGENTS.md](../../../AGENTS.md): standing repository rules.
- [docs/AGENTS.md](../../../docs/AGENTS.md): documentation placement and prose discipline.
- [docs/decisions/](../../../docs/decisions/README.md): design rationale. Disagreement with a decision record is a design discussion, not an automatic veto.
- [docs/testing.md](../../../docs/testing.md): required test tiers.
- [docs/architecture.md](../../../docs/architecture.md): the module map and seams.

## Blocking requirements

### Universal (applies to any repository)

1. **New prose receives semantic review.** Critically review every added or changed Markdown passage, JSDoc, comment, prompt, description, diagnostic, and visible string. Verify required coverage, accuracy, placement, and editorial quality against the owning code or behavior; automated checks do not establish those properties.
2. **Docs match the code.** Config, defaults, errors, wire fields, events, and public behavior update the owning docs and JSDoc in the same diff.
3. **Decisions are recorded.** A non-trivial change adds or updates a decision record in `docs/decisions/` (see the `repo-decisions` skill). Flag a missing record.
4. **Tests exist for the behavior.** A behavior change carries a test in the same change; a fix without a regression test is a rumor.

### Project-specific (instantiated at seed time from this project's own rules)

1. **剧本驱动**：世界观/人物/机制由剧本定义，框架保持通用。禁止为单个游戏写死逻辑而绕过剧本（AGENTS.md 硬规则）。
2. **引擎管规则，LLM 管叙事**：状态（时间/背包/血量/记忆）是引擎管理的真实数据，绝不放进对话文本；`MediaCue` 由引擎从状态差确定性推导，LLM 不参与媒体决策。
3. **引擎只在服务端运行**：fs/YAML/API key 决定引擎不能进浏览器；客户端只通过 `src/app/api/**/route.ts` 访问；任何"引擎搬客户端"方案阻塞。
4. **干净单一**：逻辑只有一个实现；旧路径被替代即删除，不留双轨（例如 `actions.ts` 硬编码块被 `builtins.ts` 注册表替代后即删除）。
5. **决策记录**：非平凡改动必须附 `docs/decisions/` 决策记录（同一改动内完成）；缺记录阻塞。

## Manual checks

### Project-specific (instantiated at seed time from this project's stack and known failure modes)

1. **状态双轨一致性**：数值（引擎，唯一事实源）与 LLM 描述（≤300 字，只解释）物理分离；描述不参与判定；生成失败或极性校验不过时降级确定性模板，不阻塞回合。
2. **服务端边界**：新 API 走 `src/app/api/**/route.ts` 薄层 → EngineHost 调用；引擎/fs/YAML/API key 不进入客户端代码。
3. **前端颜色纪律**：UI 只消费 `--cg-*` CSS 变量（主题由 `src/app/lib/theme.ts` 应用）；禁止硬编码色值。
4. **存档 schema 变更**：敏捷开发不做向后兼容——旧存档直接拒绝（`SAVE_SCHEMA_VERSION` 提升），不写迁移与兼容层；旧测试数据删除。
5. **剧本契约同步**：`src/script/schemas/`（zod 机器契约）与 `docs/game-design/script-format.md` 规格在同一改动内同步；新模块/字段走加法演进（schema_version 2.0 前只允许加法）。

### Universal fallbacks (apply where the project has no specific rule)

- **Intent and interface contracts:** trace both sides of every changed interface. Confirm the implementation matches the change and any decision record, including errors, cancellation, ownership, and disposal.
- **Lifecycle and concurrency:** for async setup, callbacks, processes, or teardown, check races before publication, cancellation during awaits, independent error reporting, and complete cleanup.
- **Scope and necessity:** map each abstraction, option, defensive copy, and compatibility path to its current contract and consumer. Challenge unrelated features and speculative generality.
- **Bounds cover the final operation:** probe tiny and exact limits, oversized chunks, and multibyte text for byte limits.
- **Real entry path:** tests exercise the shipped binary, module, or process where relevant; a hand-wired harness does not catch a broken entry point.
