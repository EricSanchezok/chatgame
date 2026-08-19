# 001-deno_action-regression

## Executive summary

PR #5（死契约接线 C）合并进 main 时，`narrativizeRejection` 的 `denied_action` 分支被并入 `unknown_action`（fall-through），出身禁用的动作从此被叙述为"这个世界没有这样的行动。"——玩家可见的语义回归。该回归在随后的审查修复 PR #7 中已修复，但 PR #7 因分支未重新同步 main 而未被合并，修复从未落地。根因是审查修复 PR 与实现 PR 不同源合并的流程缺口：修复分支游离，无门禁能断言"审查修复必须与实现同源合并"。护栏：denied_action 端到端回归测试（apprentice 出身 cast 动作断言出身专属文案）。

## Summary

六条 Blueprint 线并行执行，每条线实现后发 PR 到 main，审查修复以 follow-up PR 交付。PR #5 合并时一个 switch 分支 fall-through 造成玩家可见文案回归；审查方发现并在 PR #7 修复，但 PR #7 基于旧 main、未重新同步就滞留 open，协调方（本会话）在终审时才察觉，手动把修复移植进 main 并补回归测试。

## Timeline

1. PR #5 实现：`narrativizeRejection` 加 `on_cooldown` 分支时，`denied_action` 与 `unknown_action` 被合并为一个 case，共享"这个世界没有这样的行动。"文案。
2. PR #5 独立审查：发现该回归，并发现 scriptSaves() 404 gate 被删、需求/声望描述层消费缺失，共 3 项阻塞。
3. PR #7 创建：在 C 线分支上修复 3 项阻塞（denied_action 恢复独立文案、404 gate 恢复、需求/声望 UI 补全），PR body 详述。
4. PR #5 先合入 main；随后 PR #6/#8/#9 依次合入，main 快速前移。
5. PR #7 停留 open，其分支只 merge 过旧 main（PR #6 之前），未跟随 main 前移；后续 PR #8 的前端重构覆盖了它改动的 panels.tsx 区域，PR #9 改变了 catalog/描述语义。
6. 协调方终审发现 PR #7 未合并，逐项核对：404 gate 已由 main 自带（PR #6 合入时保留）；denied_action 文案与描述层 UI 两处修复确实缺失，手动移植 + 补回归测试。

## Root cause

**直接原因**：switch 分支 fall-through——新增 `on_cooldown` case 时把相邻的 `denied_action` 并进了 `unknown_action`，改动时没有意识到两者是玩家可见的不同语义。

**逃逸原因**：三层安全网全部失效——
- 实现阶段：无测试断言 narrativizeRejection 的 denied_action 文案（只有 rejectReason 层面的 gameplay 测试）。
- 审查阶段：审查发现了问题，但修复以 follow-up PR 交付而非 blocking 修改；follow-up PR 无任何机制保证在实现 PR 之后合入。
- 协调阶段：协调方按 PR 创建顺序合并，PR #7 创建晚于 #5 但无人跟踪"审查修复必须同源合并"这一不变量，直到终审才察觉。

**系统性缺口**：审查修复 PR 与实现 PR 不同源合并是流程漏洞——修复分支基于旧 main，合并时天然落后；门禁（测试/lint/决策记录）都不覆盖"玩家可见文案与世界一致性"（I7 叙事化拒绝的语义正确性）。

## Guardrails

- 回归测试：`engine.test.ts` 新增 denied_action 端到端用例——apprentice 出身 + cast 动作 → 断言 `"你的出身让你做不出这种事。"` 且不含 `"这个世界没有这样的行动。"`。
- 终审清单：多 PR 合并场景下，每个 open 的审查修复 PR 必须在终审时逐项核对 main 现状（哪项已落地、哪项被后续 PR 覆盖、哪项需要手动移植）。
- 决策记录 [0020](../decisions/0020-post-merge-audit-single-home-injection.md) 记录裁决：denied_action 与 unknown_action 文案分离是永久契约，任何合并两者的改动都是回归。
