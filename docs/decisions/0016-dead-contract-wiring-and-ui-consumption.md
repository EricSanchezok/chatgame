# 死契约接线与 UI 消费点补全（cooldown / llm_freedom / safety / zip 加固）

## Status
Deprecated
Class: feature

## Context and Problem Statement

调研发现一批"定义了但零消费"的契约与能力：

- `action.cooldown`（动作冷却）：schema 有声明，引擎合法性检查不查——冷却形同虚设。
- `llm_freedom`（叙事自由度）：schema 有声明，叙事 prompt 不注入——LLM 不知道当前动作的叙事边界。
- `safety.yaml`（内容分级）：loader 加载进 definition，系统 prompt 与 launcher 均不消费——分级声明形同虚设。
- `TurnResult` 的 `worldEvents` / `taskCompletions` / `deathFired` / `fellBackToTalk`：引擎已产出，UI 不展示——玩家看不到世界反馈。
- 描述层（descriptor）：引擎 `setUserDescriptor` 已实现（双轨：只改 description 不碰 value），但 UI 无展示与编辑入口。
- `advance` 快进：路由已存在，前端无入口。
- zip 导入安全缺口：只限 zip 本体 20MB，未限解压总量（zip 炸弹可撑爆磁盘）。

用户决策：死契约接口不删除，接线为真功能。

## Decision Drivers

- 引擎管规则、LLM 管叙事：cooldown 是引擎判定，llm_freedom 是叙事指引（绝不授予 LLM 判定权，I4/I5 不变量）。
- 双轨状态：descriptor 编辑只改 description、置 userEdited、永不触碰数值。
- 前端零硬编码色值（`--cg-*`）。
- 干净单一：只消费现有 schema 声明，不新增并行配置。
- 安全：zip 解压总量必须有上限。

## Considered Options

- 删除死契约字段（llm_freedom/cooldown/safety）：用户决策"不删除，未来可能有用"，且接线成本低、可测。拒绝删除。
- safety 完整执行管道（生成后分类拦截）：文档自认 V2 工作；本次只做声明注入 + 展示，伪造执行违反"干净单一"。落选。
- llm_freedom 授予 LLM 判定权：违反 I4/I5（判定永远引擎侧）。接线为叙事指引，明确不越权。
- UI 大改（独立死亡界面/任务中心/动作快捷栏）：超出"最小消费闭环"；本次用聊天内系统条目 + 面板行内编辑。落选。
- cooldown 存 eventLog 推导：log 可裁剪不可靠；显式 `actionCooldowns` 字段最清晰。选择。
- zip 上限做成配置项：单机场景常量足够；`importScriptFromZip` options 已支持覆盖（供测试注入小上限）。选择。
- 把三个死契约接进现有单一消费路径（合法性检查 / 叙事 prompt / 系统 prompt）+ 最小 UI 闭环——所选路线。

## Decision Outcome

**cooldown 接线**（`src/engine/actions.ts` + `src/engine/types.ts`）：`checkActionLegality` 检查 `state.actionCooldowns[actionId]` 距今未满 `action.cooldown` 天时返回 reasonCode `on_cooldown`；`resolveAction` 成功结算后写入当前绝对天。`WorldState` 新增 `actionCooldowns: Record<string, number>`（actionId → 最后使用绝对天），`normalizeWorldState` 补空对象。`narrativizeRejection` 消费 `on_cooldown` 输出世界一致文案（I7 模式）。

**llm_freedom 注入**（`src/engine/narrative/prompt.ts` + `narrative.ts`）：新增 `buildActionFreedomBlock(actionId, def)`，按 narration/process/result 三态返回中文语义指引块，措辞固定"机制由引擎结算，你只负责叙事"；`buildTurnPrompt` 在"输出要求"前、`actionId` 存在时插入"当前动作"块；`generateNarrative` 传入 `resolution.actionId`。

**safety 轻量落地**（`src/engine/narrative/prompt.ts` + `src/app/api/scripts/[scriptId]/route.ts` + `launcher.tsx`）：`buildSystemPrompt` 末尾追加"内容边界（必须遵守）"块（age_rating、allowed 强度逐条、forbidden 列表，强度词直接引用剧本声明值，不新增枚举）；`GET /api/scripts/:id` 返回 `safety: { age_rating, content_classes }`；launcher 剧本卡片标题旁展示 age_rating 徽标。生成后内容拦截留 V2。

**UI 消费闭环**（`chat.tsx` / `panels.tsx` / `state.tsx` / `api.ts`，全部 `--cg-*` 变量）：

- `chat.tsx` 新增 `SystemFeedbackBlock`：每回合 world 条目后展示 worldEvents 列表、taskCompletions（✓/✗）、deathFired 提示条、fellBackToTalk 兜底小字。
- `panels.tsx`：关系面板行显示 `descriptor.label + description`，行内"编辑"→ textarea → 保存调 `POST /descriptor`（`api.setDescriptor`）；"快进"控件（+1h/+6h/+1d，两次点击确认，调 `api.advance`）。
- `state.tsx`：新增 `updateState` reducer action 与 `advance`/`updateDescriptor` 方法，更新后标记 dirty。

**zip 安全加固**（`src/server/script-import.ts`）：导出 `MAX_UNPACKED_BYTES = 100MB`，`extractZip` 解压循环在写出前累计 `Buffer.byteLength`，超限抛 `ScriptImportError` 并走现有失败清理路径；`importScriptFromZip` options 参数化 `maxUnpackedBytes`。

**保留不删**（用户决策）：`EngineHost.scriptSaves()`、`mediaProvider` getter 等无消费方法保留，补 JSDoc 标注"内部保留 API，供未来调用方使用"。

**存档**：`SAVE_SCHEMA_VERSION` 与并行决策 [0014](0014-llm-context-management.md)（contextSummary）、[0015](0015-memory-strength-retrieval-supersede.md)（MemoryEntry）共同达到 4，字段相加性，无迁移（敏捷约定）。

## Pros and Cons of the Options

- 所选路线：三个死契约成为真功能（冷却拒绝 + 文案世界一致；llm_freedom 进 prompt 不越权；safety 进系统 prompt 与 launcher）；UI 消费闭环补全；zip 炸弹防护落地。代价：存档 v4 旧档全拒（预期）；prompt 长度增加（safety 块 + 动作块，可控）。
- 删除死契约：违反用户决策，且失去未来能力。落选。
- safety 完整执行管道：V2 工作，伪造执行违反干净单一。落选。
- llm_freedom 判定权：违反 I4/I5 不变量。落选。

## Links

- [0014](0014-llm-context-management.md)（contextSummary 与三层注入）
- [0015](0015-memory-strength-retrieval-supersede.md)（记忆系统与存档 v4）
- [0007](0007-engine-runtime.md)（PDVA 防作弊管线 I1-I7）
