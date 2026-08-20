# 引擎运行时规格（Engine Runtime）

> 本文档是 chatgame 引擎运行时 v1 的规格——"世界如何运转"的运行时实现契约。决策依据见 [决策记录 0007](../decisions/0007-engine-runtime.md)；剧本格式契约见 [script-format.md](script-format.md)。

## 架构分层

```
剧本（Script，静态）      → src/script/：schema + 校验（只读契约层）
引擎核心（Engine Core）   → src/engine/：世界状态、回合循环、机制、存档、表现层
LLM 桥（LLM Bridge）     → src/engine/narrative/：provider + prompt + 意图解析 + 一致性校验
服务托管（EngineHost）   → src/server/：会话注册表、剧本库扫描、zip 导入、资产服务
界面（UI）               → src/app/：Route Handlers + 沉浸聊天式前端（规格见 presentation.md）
```

## 模块地图

```
src/engine/
├── index.ts          Engine 门面：create/playerTurn/advance/save/load/setDescriptor
├── types.ts          运行时类型：WorldState/PlayerState/NpcState/GameClock/TurnResult/Descriptor
├── rng.ts            可种子 RNG（mulberry32）
├── loader.ts         loadScript：validateScriptDir + schemas → WorldDefinition
├── definition.ts     确定性标签：value → stance/label 映射
├── time.ts           GameClock：小时/日/月/年/季节/节日/作息
├── condition.ts      条件代数求值器（10 op × 11 source，flag/fact 统一标记空间）
├── effect.ts         效果代数执行器（14 kind + ResultGrade 系数）
├── rules.ts          ★RuleOK 关卡：world.yaml rules 确定性执行
├── actions.ts        ★判定管道：合法性 → costs/handler 计划 → resolve → 结果等级 → effects/execute
├── builtins.ts       内置动作注册表（attack/defend/move/travel/use_item/give/take/steal/trade）
├── worldstep.ts      ★统一世界步进（回合与离线推进共用同一管道）
├── events.ts         事件执行（playEvent/checkScheduledEvents/ambient，唯一播放入口）
├── tasks.ts          任务系统（自动激活/进度/完成/时限失败）
├── memory.ts         记忆分层（major/minor/trivial）+ 连续强度衰减 + 相关性检索 + 访问强化 + supersede（确定性 id）
├── descriptors.ts    ★★双轨状态描述层（数值+标签+LLM 描述，生成器注入）
├── worldgen.ts       开局随机化（固定种子确定性，含 secret_holder 映射）
├── director.ts       事件选择（张力带加权 + novelty + difficulty_ramp）
├── presentation.ts   ★表现层：resolveTheme（default+by_location）/ buildAssetManifest / deriveMediaCues（引擎确定性推导，LLM 不参与）/ appendTranscript
├── save.ts           JSON 存档 + 版本门（v5，含 threshold 游标、transcript、runtimeState 与描述位，无迁移）
├── media/            MediaProvider 接口 + off/mock 实现（env：CHATGAME_MEDIA_PROVIDER；真实生成 V2）
└── narrative/
    ├── provider.ts   LLMProvider 接口 + factory（env 配置）
    ├── mock.ts       MockProvider（确定性，默认）
    ├── vercel.ts     VercelProvider（AI SDK v7 适配层）
    ├── prompt.ts     PromptBuilder（宪法/style/lore/记忆/知识过滤/taboos + 关系与状态摘要）
    ├── intent.ts     ★意图解析（兜底分级：直映射/澄清/降级 talk/拒绝）
    ├── narrative.ts  ★双通道输出 {narrative, mechanics_tags}（白名单 10 种）
    └── consistency.ts★PDVA 校验 + 一致性重试
```

## Engine Extension v2

剧本在 `script.yaml.engine_extension` 静态声明 effects、conditions、action handlers、rule mechanisms 与 lifecycle，加载时必须与 `engine/index.ts` 的实际注册集合精确相等；重复、未知或漏注册均响亮失败。动作 handler 返回纯 `ActionHandlerPlan`，规划阶段只计算拒绝、动态成本与耗时，`execute` 只在真实结算中对 post-effect state 调用一次。规划输入是与权威 `WorldState`、`WorldDefinition` 和参数隔离的深度只读快照，写入 Map 或嵌套值会响亮失败。`onSessionStart` 只运行于 fresh session，加载 v5 存档不重放；其余生命周期按注册顺序运行且摘要进入事件日志。

## 回合循环（playerTurn）

```
玩家自由文本
  → 1. 意图解析：LLM 映射 {action_id, target}（兜底分级；超模先拒绝）
  → 2. 引擎合法性：动作/条件/世界规则（RuleOK）→ 叙事化拒绝（I7）
  → 3. 声明 costs → handler 纯计划（动态成本/耗时）→ 引擎统一支付动态 costs
  → 4. 判定：stat/skill_check（d20+bonus vs DC）/ opposed（平手=主动方失败）/
       auto / narrative_only（跳过剧本 effects，内置语义照常）
       → 结果等级：fail/partial/success/crit（partial=0.5×, crit=2×）
  → 5. effects（×grade）→ plan.execute 一次 → ResolutionLog
  → 6. stepWorld（统一世界推进：时钟/需求/状态/作息/事件/承诺/张力/任务）
  → 7. 导演选事件（张力带加权 + 冷却）→ 立即 playEvent → 任务检查（激活/进度/完成）
  → 8. 死亡策略检查（soft_failure 威胁条 ≥ 阈值 / world_continue·hard_reset 玩家 hp 归零）
  → 9. LLM 叙事（双通道）→ 一致性校验（schema/perm/taboo/秘密）→ 重试≤2 → 降级
  → 10. 校验通过的 mechanics_tags → applyEffects → 描述层惰性刷新（LLM 生成器）
  → 11. 转录追加（player 输入 + world 叙事；拒绝/澄清/死亡也写入）+ mediaCues 推导
  → TurnResult{narrative, resolution, logEntries, descriptorUpdates, worldEvents, taskCompletions, mediaCues, deathFired, ...}

动作预检与执行复用同一合法性、handler 规划与可支付性检查。`ActionPreview` 合并声明成本与动态 currency/items/resources，并使用计划耗时；执行在骰点和 effects 前由引擎统一校验、扣除动态成本一次，handler 不自行扣除。预检不执行 effects 或 `execute`。`effectiveTimeCost = max(plan.timeCost ?? costs.time ?? 1, 1)`，由 `playerTurn` 在效果后调用 `stepWorld` 推进（时间推进不在 resolveAction 内）。

## 世界推进（worldstep.ts）

`stepWorld(state, definition, hours, { scope })` 是唯一世界推进管道，回合循环与离线 `advance()` 共用：

- **逐小时**：时钟推进 → 需求连续衰减 → NPC 作息移动（`scheduleAt` 重算位置）。
- **日边界**（时钟跨天时执行一次）：状态效果 tick（duration=天数）→ 需求阈值（持久化边沿触发，停留区间不重复）→ 声望衰减 + 阈值（仅向上穿越时立即触发）→ 记忆衰减 + 归档（`tier_retention_days`，NPC `forget_policy` 覆盖）→ 节日事件 → time/condition 事件 → ambient 事件（30% 概率，`AMBIENT_EVENT_CHANCE`）→ 承诺检查 → 任务检查（时限失败 + 自动激活）→ 张力同步（tension 变量 ← threat_gauge）。
- `advance_scope` 五项（schedules/needs/events/factions/time_events）门控离线推进；`world_advances: false` 时世界冻结。
- 所有随机（ambient/导演/任务/世界生成）走注入式 `state.rng`，同种子同结果。
- fresh session 保留 `worldgen` 选出的 starting event，并在开场 transcript 前通过 `playEvent` 播放一次；事件事实、正文和 `{kind:"event"}` MediaCue 使用同一 event id。load 从已持久化 transcript/事件状态恢复，不重放开场事件。

## 事件与任务

- **事件**（`events.ts`）：`playEvent` 是唯一事件执行入口——应用 effects（event 类效果递归，深度上限 5 防循环）→ 记录 `playedEventIds` / `eventLastPlayedDay` → 事件文本（event_texts 模板，无则确定性占位句）→ `applyProgression(source: "event")`。五类触发：director（导演选中即播）/ time（时钟匹配）/ condition（条件满足）/ festival（节日当天）/ ambient（所在地点池 30%）。不可重复事件只播一次；可重复事件按 `event.cooldown ?? director.novelty.cooldown_default` 冷却。
- **任务**（`tasks.ts`）：承诺式自动激活（giver 同场 + 条件满足 + 可重复/冷却）；objective 是严格联合类型，investigate 明确读取 flag/fact marker 或从激活游标之后计数 `any` 调查。激活/完成/失败都写入 `WorldState.eventLog`；完成 → 奖励 effects + `applyProgression(source: "task")`；`time_limit.days` 的精确截止日仍可完成，次日起失败；同一纯函数 `checkTasks` 挂回合循环与日边界，幂等。
- **张力**：导演以第一个张力变量驱动带区间选择；`difficulty_ramp` 生效（`multiplier = band.weight × min(1 + ramp × day, 5)`）。

## 内置动作（builtins.ts）

九种机械动作由数据驱动注册表实现（`BUILTIN_HANDLERS`），`resolveAction` 在剧本 effects 后调用：

- **attack**：命中（partial/success/crit）按玩家 strength × grade 对目标 `applyDamage`，HP ≤ 0 记 `defeated:<npc>` fact。
- **defend**：success/crit → 威胁 -5。
- **move**：目标必须与当前地点直接相连，并在平行边中选择耗时最短的可行边；**travel**：在可行简单路径中选总 `travel_time` 最短者。每段在真实出发时钟校验实际遍历边的 `exit_condition` 与连接 `condition`，推进该段分钟后以抵达时钟校验 `entry_condition`；拒绝带机器 reasonCode（叙事化）。
- **use_item**：校验 `item.requirements` → `effects_on_use` → consumable 消耗 1 件。
- **give / take**：玩家 ↔ NPC / 地点库存转移（容量检查）。
- **steal**：success/crit 转移 1 件，partial 威胁 +5，fail 威胁 +10；空库存拒绝。
- **trade**：buy/sell 走 `item.value` 货币交换（NPC 初始货币 0，卖自然拒绝并叙事化）。

状态重施加统一走 `mechanics/status.ts#addStatus`：总是刷新 `remainingTicks`，仅 stackable 状态增加层数。成长只应用到触发行为对应的实体和 target。

动作合法性：`checkActionLegality` 增加 `origin.denied_actions` 拒绝（reasonCode `denied_action`）；动作 id 集合以 `src/script/schemas/actions.ts` 为单一真源。

## 双轨状态（descriptors.ts）

三层分离（30 年行业范式，调研验证）：

- **计算层**：数值（引擎增减，唯一事实源，参与判定）
- **分类层**：确定性标签（value → stance/label，规则生成）
- **解释层**：LLM 描述（≤300 字，只解释/展示，**永不参与判定**）

挂载位置：玩家/NPC 的关系、声望、需求、状态效果实例（statuses）。更新触发三级：事件（里程碑）/ 跨区间（阈值）/ 定期兜底；惰性生成 + 校验失败降级确定性模板；`setDescriptor` 用户可编辑（编辑不影响数值）。刷新路径：`refreshAllStale` 注入 LLM 生成器（`llmDescriptorGenerator`，走 provider `generateObject` + `descriptorOutputSchema`），生成器输入含作者静态描述（relation type/description、status effect description）与近期事件（`sourceEventIds`），生成失败或极性校验（`descriptionPolarityOk`）不过 → 确定性模板降级，不阻塞回合。

语义标签不枚举：关系 type、status kind、event type、item rarity、location type、base_class、origin difficulty、commitment type、safety 内容类等**引擎零分支读取**的标签全部为自由文本（剧本契约 v1.1，作者用自然语言表达"同是朋友但质地不同"）；引擎分支读取的指令枚举（condition source/op、effect kind、task objective type、MediaCue、动作 id、memory importance、event trigger、resolve type、worldgen target、meta_progression.keep、taboo severity、lore inject_when、progression source、advance_scope、`"threat_gauge"`）保持枚举。数值仍是唯一事实源；作者 description 与 LLM 生成描述注入叙事上下文（prompt.ts 关系与状态摘要，含 NPC 视角关系网）供 LLM 理解，**永不参与判定**。

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
- mechanics_tags 白名单收窄为 10 种（stat/skill/need/item/currency/relation/reputation/flag/teleport/status）；soft taboo 命中 → 仅警告不拒绝；`denied_actions` 在合法性关卡拒绝。
- flag/fact 统一标记空间：`hasMarker` 检查 player.flags ∪ world.flags ∪ facts（修复"flag 写入 / fact 读取"不一致，emberfall 主线由此打通）。
- 秘密知识边界只读运行态 `secretHolders`；prompt 为真实 holder 注入秘密 id 与完整正文，一致性过滤用同一 holder 判断，定义文件中的原始 owner 不参与运行态裁决。

## LLM 桥

- `LLMProvider` 接口：`generateObject<T>({system, prompt, schema})` / `generateText`。
- `MockProvider`：确定性（默认，无 key 全绿）；`VercelProvider`：AI SDK v7 `generateObject`（env：`CHATGAME_LLM_PROVIDER`/`BASE_URL`/`API_KEY`/`MODEL`）。
- 意图解析、叙事双通道输出、描述生成均定义 zod schema，LLM 输出必须过 schema 才进入引擎。

## 存档

- 路径 `.chatgame/saves/<scriptId>/<runId>.json`；格式 `{saveSchemaVersion, scriptId, createdAt, updatedAt, worldState}`。
- 当前 schema 版本 = 5（WorldState 包含持久化 `activeNeedThresholds`、MemoryEntry 连续强度字段、contextSummary、actionCooldowns、runtimeState、关系/状态描述位与 transcript）；save/load 共用完整严格的 `SaveFile`/`WorldState` schema。缺 clock/player/npcs 等必需字段、嵌套字段类型错误、伪造版本号的残缺 v5 和旧版本都直接拒绝（敏捷开发，不做迁移）。
- `normalizeWorldState` 在 fresh create 后建立派生字段，并在通过完整 schema 的 load 后规范可选 `contextSummary`；它不充当残缺存档的迁移通道。
- 往返测试：save → load → 状态深度相等（含 threshold 游标、转录、contextSummary、actionCooldowns、runtimeState 与描述位），且 load 不重复执行 session-start lifecycle。

## 运行策略

- `soft_failure`：威胁条 ≥ 阈值 → 传送副作用地点 + effects + 重置威胁条（Fallen London 式）。
- `world_continue`：**玩家 hp 归零**才触发；`state_kept` 含 "lore" 时继承 `facts` 中 `lore-` 前缀项；重建玩家 origin 由种子 RNG 从全部 origins 随机选取。
- `hard_reset`：**玩家 hp 归零**才触发；reroll_worldgen（重跑世界，转录保留）或 keep_world（保留世界重置玩家）。
- 三种模式都有显式触发门（软失败看威胁条，另两种看 hp）——健康回合永不触发重置。
- meta-progression：keep（flags/lore/relations_overview）/ reset（stats/inventory/location/currency）/ unlocks（flag → grant origins）；Engine 门面暴露 `unlockedOrigins()` / `metaSnapshot()`。
- `faction_stance` 为文档化 no-op（faction 间关系 v1 无运行时消费者）。

## 命令

```sh
npm run dev                                        # 开发服务器（启动器 + 游戏 UI）
npm run play                                       # demo CLI（默认 Mock）
CHATGAME_LLM_PROVIDER=vercel npm run play          # 真实 LLM（需配置 env）
npm test                                           # 全部测试
npm run lint                                       # ESLint
npm run build                                      # 生产构建
```

## 边界（v1 不实现）

- safety 内容过滤执行管道、多玩家/网络、真实 LLM 的完整验证（CI 不依赖 key）、记忆的 LLM 摘要压缩、真实文生图/TTS（MediaProvider 仅 off/mock，真实 provider V2）、回合流式输出、在线剧本市场/远程下载、用户认证与数据库持久化（会话在内存、存档在文件）、剧本 schema 改动（passive 检定变体、剧本声明区间映射表——后续契约 Blueprint）、LLM 效果提议 delta 与动态动作生成（V2 加法演进）。
