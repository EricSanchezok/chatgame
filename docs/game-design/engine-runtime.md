# 引擎运行时规格（Engine Runtime）

> 本文档是 chatgame 引擎运行时 v1 的规格——"世界如何运转"的运行时实现契约。决策依据见 [.agents/notes/implemented/architecture/2026-08-18-engine-runtime.md](../../.agents/notes/implemented/architecture/2026-08-18-engine-runtime.md)；剧本格式契约见 [script-format.md](script-format.md)。

## 架构分层

```
剧本（Script，静态）      → src/script/：schema + 校验（只读契约层）
引擎核心（Engine Core）   → src/engine/：世界状态、回合循环、机制、存档
LLM 桥（LLM Bridge）     → src/engine/narrative/：provider + prompt + 意图解析 + 一致性校验
界面（UI）               → 后续 Blueprint（消费 Engine 门面）
```

核心原则：

- **引擎管规则，LLM 管叙事**——状态（时间/背包/血量/记忆/关系）是引擎管理的真实数据，LLM 只产生意图建议与叙事文本。
- **不可变快照**——所有状态更新是纯函数 `(state, action) => newState` + append-only 事件日志；存档即快照。
- **确定性**——所有随机源（worldgen/导演/检定）走注入式种子 RNG；同种子同结果。
- **防作弊（PDVA）**——SchemaOK ∧ PermOK ∧ RuleOK 三关卡全确定性程序化；玩家文本永远不是效果来源。

## 模块地图

```
src/engine/
├── index.ts          Engine 门面：create/playerTurn/advance/save/load/setDescriptor
├── types.ts          运行时类型：WorldState/PlayerState/NpcState/GameClock/TurnResult/Descriptor
├── rng.ts            可种子 RNG（mulberry32）
├── loader.ts         loadScript：validateScriptDir + schemas → WorldDefinition
├── definition.ts     确定性标签：value → stance/label 映射
├── time.ts           GameClock：小时/日/月/年/季节/节日/作息
├── condition.ts      条件代数求值器（10 op × 11 source）
├── effect.ts         效果代数执行器（14 kind + ResultGrade 系数）
├── rules.ts          ★RuleOK 关卡：world.yaml rules 确定性执行
├── actions.ts        ★判定管道：合法性 → resolve → 结果等级 → costs/effects/time
├── mechanics/        inventory/needs/status/combat/progression
├── relations.ts      关系矩阵（NPC↔NPC + →player，非对称）
├── memory.ts         记忆分层（major/minor/trivial）+ 归档
├── descriptors.ts    ★★双轨状态描述层（数值+标签+LLM 描述）
├── worldgen.ts       开局随机化（固定种子确定性）
├── director.ts       事件选择（张力带加权 + novelty）
├── plot.ts           承诺系统（触发/期限/on_miss/秘密守卫）
├── run.ts            死亡策略（soft_failure/world_continue/hard_reset）+ meta
├── save.ts           JSON 存档 + 版本校验
└── narrative/
    ├── provider.ts   LLMProvider 接口 + factory（env 配置）
    ├── mock.ts       MockProvider（确定性，默认）
    ├── vercel.ts     VercelProvider（AI SDK v7 适配层）
    ├── prompt.ts     PromptBuilder（宪法/style/lore/记忆/知识过滤/taboos）
    ├── intent.ts     ★意图解析（兜底分级：直映射/澄清/降级 talk/拒绝）
    ├── narrative.ts  ★双通道输出 {narrative, mechanics_tags}
    └── consistency.ts★PDVA 校验 + 一致性重试
```

## 回合循环（playerTurn）

```
玩家自由文本
  → 1. 意图解析：LLM 映射 {action_id, target}（兜底分级；超模先拒绝）
  → 2. 引擎合法性：动作/条件/世界规则（RuleOK）→ 叙事化拒绝（I7）
  → 3. 判定：stat/skill_check（d20+bonus vs DC）/ opposed（平手=主动方失败）/
       auto / narrative_only（最小化）
  → 4. 结果等级：fail/partial/success/crit（partial=0.5×, crit=2×）
  → 5. costs（currency/items/time）→ effects（×grade）→ 时间推进 → ResolutionLog
  → 6. 承诺检查（触发/期限 on_miss）→ 导演选事件（张力带加权）
  → 7. 死亡策略检查（soft_failure 威胁条等）
  → 8. LLM 叙事（双通道）→ 一致性校验（schema/perm/taboo/秘密）→ 重试≤2 → 降级
  → 9. 校验通过的 mechanics_tags → applyEffects
  → 10. 描述层惰性刷新（stale → 重生成）
  → TurnResult{narrative, resolution, logEntries, descriptorUpdates, ...}
```

## 双轨状态（descriptors.ts）

三层分离（30 年行业范式，调研验证）：

- **计算层**：数值（引擎增减，唯一事实源，参与判定）
- **分类层**：确定性标签（value → stance/label，规则生成）
- **解释层**：LLM 描述（≤300 字，只解释/展示，**永不参与判定**）

挂载位置：玩家/NPC 的关系、声望、需求。更新触发三级：事件（里程碑）/ 跨区间（阈值）/ 定期兜底；惰性生成 + 校验失败降级确定性模板；`setDescriptor` 用户可编辑（编辑不影响数值）。

一致性防线：数值唯一事实源（LLM 物理上只能写描述字段）、生成输入锚定、校验兜底、描述不参与判定（架构分离）。

## 判定设计

| resolve 类型 | 机制 | 说明 |
|---|---|---|
| stat_check | d20 + 属性 vs DC | 5e 模型 |
| skill_check | d20 + 技能 vs DC | 5e 模型 |
| opposed_check | 双方 d20+修正，平手=主动方失败 | 5e 语义 |
| auto | 无风险不掷骰 | 5e/Blades 共识 |
| narrative_only | 无引擎结算 | 最小化：仅无状态后果的社交行为 |

结果等级（Blades 式）：`fail / partial / success / crit`——partial=效果×0.5 附代价，crit=效果×2；等级由骰值余量映射。判定日志结构化记录（谁/什么检定/骰值/DC/等级/效果），可审计。每动作必须消耗时间（costs.time），防自由文本无限刷。

## 防作弊管线（I1-I7 不变量）

- I1 状态只有引擎能改；I2 效果必须来自白名单原语+实体引用（凭空造物→SchemaOK 失败）；I3 记忆只由引擎写；I4 规则裁决永不交给 LLM；I5 骰子/数值/结算在引擎；I6 叙事文本中的状态声称不生效（双通道）；I7 拒绝要叙事化。
- 意图解析兜底：高置信直映射 / 中置信候选确认 / 低置信降级 talk / 超模拒绝。
- 超模处理矩阵：偷远处物品→前置条件不满足→叙事化拒绝；瞬移/开挂→无对应原语→拒绝+世界内合理化；凭空造物→SchemaOK 失败→拒绝。

## LLM 桥

- `LLMProvider` 接口：`generateObject<T>({system, prompt, schema})` / `generateText`。
- `MockProvider`：确定性（默认，无 key 全绿）；`VercelProvider`：AI SDK v7 `generateObject`（env：`CHATGAME_LLM_PROVIDER`/`BASE_URL`/`API_KEY`/`MODEL`）。
- 意图解析、叙事双通道输出、描述生成均定义 zod schema，LLM 输出必须过 schema 才进入引擎。

## 存档

- 路径 `.chatgame/saves/<scriptId>/<runId>.json`；格式 `{saveSchemaVersion, scriptId, createdAt, updatedAt, worldState}`。
- load 校验 schema_version/script_id；未知版本拒绝（迁移工具后续 Blueprint）。
- 往返测试：save → load → 状态深度相等。

## 运行策略

- `soft_failure`：威胁条 ≥ 阈值 → 传送副作用地点 + effects + 重置威胁条（Fallen London 式）。
- `world_continue`：继承 state_kept（flags/lore/relations），重建玩家。
- `hard_reset`：reroll_worldgen（重跑世界）或 keep_world（保留世界重置玩家）。
- meta-progression：keep（flags/lore/relations_overview）/ reset（stats/inventory/location/memories/currency）/ unlocks（flag → grant origins）。

## 命令

```sh
npm run play                                        # demo CLI（默认 Mock）
CHATGAME_LLM_PROVIDER=vercel npm run play           # 真实 LLM（需配置 env）
npm test                                            # 全部测试
```

## 边界（v1 不实现）

- UI 层、safety 内容过滤执行管道、多玩家/网络、真实 LLM 的完整验证（CI 不依赖 key）、记忆的 LLM 摘要压缩、剧本 schema 改动（passive 检定变体、剧本声明区间映射表——后续契约 Blueprint）、LLM 效果提议 delta 与动态动作生成（V2 加法演进）。
