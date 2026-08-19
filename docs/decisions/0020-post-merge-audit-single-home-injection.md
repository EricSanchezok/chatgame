# 合并后审计——单一描述注入点、denied_action 回归与描述层 UI 消费补全

## Status
Accepted
Class: simplification

## Context and Problem Statement

六个并行 Blueprint 会话各自提交 PR 后合并进 main。合并后审计发现三处跨 PR 的集成缺陷：

1. **描述双注入**：[0014](0014-llm-context-management.md) 的 B 层状态快照通过 `sceneDescriptorLines` 注入关系/声望描述行，[0019](0019-semantic-enums-to-free-text.md) 又新增"关系与状态摘要"区块注入同一批描述——同一事实两个家，prompt 冗余膨胀。时间/位置同样双写：B 层快照有 `- 时间/地点` 行，`buildTurnPrompt` 又推 `## 当前时间/## 玩家位置`，`generateNarrative` 末尾还追加一行 `当前时间`。
2. **denied_action 行为回归**：PR #5 合并时 `narrativizeRejection` 的 `denied_action` 分支被并入 `unknown_action`（fall-through），出身禁用的动作被错误叙述为"这个世界没有这样的行动。"——玩家可见的语义回归，其审查修复 PR（#7）因分支未同步 main 而遗漏。
3. **描述层 UI 消费不完整**：0019 的 R5 要求关系/声望/需求面板展示描述；合并后需求行只有静态 description、声望区块缺失、编辑入口只存在于关系面板且为私有内联实现，无法复用。

## Decision Drivers

- 干净单一：每个事实只有一个家——描述注入的唯一入口是"关系与状态摘要"区块。
- 双轨不变量：descriptor 编辑只改 description、置 userEdited、永不触碰数值（routes 测试断言 value 不变）。
- UI 复用：关系/需求/声望三处编辑是同一语义操作，共享一个 `DescriptorEdit` 组件而非三份内联表单。
- 玩家可见文案必须世界一致（I7 叙事化拒绝）。
- 治理：审查修复 PR 必须与实现 PR 同源合并，分支游离导致回归。

## Considered Options

- **保留双注入**（让 B 层描述行与关系摘要并存）：信息冗余、prompt 膨胀、两个家都要维护——违反干净单一。落选。
- **让 B 层重新成为描述的唯一注入点、删除 0019 的关系摘要**：倒退回 0019 之前的断管状态，且 NPC↔NPC 关系网（0019 核心价值）无处可放。落选。
- **把 PR #11 的 needs 双轨行加回 B 层**：needs 行与关系/声望行同构，同样制造第二注入点；阈值 label 推导逻辑重复 `mechanics/needs.ts` 的 `thresholdFires` 极性。落选。
- **B 层纯结构化（时间/地点/在场 NPC/任务/flags）+ 关系与状态摘要为描述唯一家——所选路线**：每个事实一个家；`sceneDescriptorLines`/`MAX_SCENE_DESCRIPTORS`/`estimateChars`/`summaryOutputSchema` 死代码删除；`formatClock` 成为 B 层时间行的唯一生产点。

## Decision Outcome

**B 层退化为纯结构化事实**：`buildStateBlock(state, definition)` 只输出时间（`formatClock`）/地点/在场 NPC/进行中任务/关键 flags 与"数值为唯一事实源"指令；`sceneDescriptorLines`、`SceneDescriptorLine`、`MAX_SCENE_DESCRIPTORS` 及无引用导出（`estimateChars`、`summaryOutputSchema`）删除。`buildTurnPrompt` 删除重复的 `## 当前时间/## 玩家位置` 行；`generateNarrative` 删除末尾追加的 `当前时间` 行。NPC→player 关系行渲染为"与你"而非原始 id `player`。

**denied_action 文案恢复**：`narrativizeRejection` 恢复独立分支 `"你的出身让你做不出这种事。"`，`unknown_action` 保持 `"这个世界没有这样的行动。"`；新增端到端回归测试（apprentice 出身 cast 动作 → 断言出身文案、拒绝世界无此动作文案）。

**描述层 UI 消费补全**：CharacterPanel 需求行显示 `descriptor.label + value + DescriptorEdit`（path `player.needs.<name>`）；新增"声望"区块（catalog 透传 `factions` id/name，行显示 label + value + DescriptorEdit，path `player.reputation.<factionId>`，空列表安全 no-op）；`DescriptorEdit` 抽为共享组件，RelationsPanel 复用（消除私有内联表单）；catalog 同时透传 `skills` description（R5 属性/技能描述展示）。routes 测试补断言：needs 编辑 value 不变（双轨）+ reputation 空列表 no-op。

**裁决移植**：PR #11（B 审查修复）中 needs 双轨行与阈值 label 推导因与单一注入点裁决冲突**不移植**，其窗口有界测试移植（prompt 长度随 transcript 增长 <1.2x）；PR #12（0019 复核补交付）中 skills/factions 透传、status 描述单测（`refreshAllStale` 覆盖 statuses + `sourceEventIds`）、catalog 测试移植，需求/声望 UI 由共享组件实现替代其私有实现。

## Pros and Cons of the Options

- 所选路线：描述只有一个家、prompt 无冗余、死代码清零、UI 编辑三处一致；回归测试钉死 denied_action 文案。代价：B 层不再含场景相关的关系数值（该信息在关系摘要中以"关系值"呈现），破坏性删除导致 PR #11/#12 部分内容作废（以注释说明裁决依据）。
- 保留双注入：无裁决成本但 prompt 冗余与双家维护持续累积。落选。
- needs 双轨回填：制造第二注入点 + 极性逻辑重复。落选。

## Links

- [0014](0014-llm-context-management.md)（B 层描述注入的历史来源）
- [0019](0019-semantic-enums-to-free-text.md)（关系与状态摘要——描述唯一注入点）
- [0016](0016-dead-contract-wiring-and-ui-consumption.md)（descriptor 编辑 API 与双轨约束）
- [0007](0007-engine-runtime.md)（I7 叙事化拒绝）
