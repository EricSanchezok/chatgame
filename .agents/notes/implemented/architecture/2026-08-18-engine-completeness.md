# Agent Note: 引擎运行时完备化——v1 未接线系统一次交付

Status: implemented

## Problem

引擎运行时 v1 规格（[engine-runtime.md](../../../docs/game-design/engine-runtime.md)）定义了大量"已定义契约 / 已实现原语但未接入运行时循环"的系统：事件执行链整体缺失（`activeEventIds` 死队列 5 个写入方零消费方、eventTexts 加载即弃）；需求阈值/记忆归档/成长 progression 唯一调用方是测试；needs 衰减与 status tick 只在 `advance()` 不进 `playerTurn`；张力变量永不同步 threat_gauge、`difficulty_ramp` 无消费者；NPC 作息 `scheduleAt`/`todayFestival` 零调用；战斗/移动按动作 id 硬编码、时间成本可为零；`deadline.condition` 被忽略；任务系统契约层完整但运行时为零。另有两处内容缺陷：emberfall 主线事件写 flag 而承诺读 fact（永不触发）、`coal-essence`/`eva-suit` 是孤立物品。

## Decision

单一变更集交付，主线是**统一世界步进函数 `stepWorld`**——回合循环与离线推进共用同一条确定性管道，其余子系统全部挂接到这条管道或回合循环的明确挂点：

- **worldstep.ts**（新增）：逐小时循环（时钟→需求连续衰减→NPC 作息移动）+ 日边界批处理（状态效果 tick 每日一次、需求阈值持续触发、声望衰减+阈值上升沿触发、记忆归档按 `tier_retention_days`、节日事件、time/condition 事件、ambient 事件 30%（`AMBIENT_EVENT_CHANCE`）、承诺检查、任务检查、张力同步 threat_gauge → tension 变量）。`advance_scope` 五项门控离线推进；`world_advances: false` 世界冻结。所有随机走注入式 `state.rng`。
- **回合循环改造**：时间推进移出 `resolveAction`——`effectiveTimeCost = max(costs.time ?? 1, 1)` 由 `playerTurn` 在效果后调 `stepWorld` 推进；导演选中事件立即 `playEvent`；任务检查（激活/进度/完成）在回合内执行；`TurnResult` 新增 `worldEvents` / `taskCompletions`。
- **events.ts**（新增）：`playEvent` 是唯一事件执行入口——effects（event 类效果递归，深度上限 5 防循环）→ `playedEventIds` / `eventLastPlayedDay` 记录 → 事件文本（event_texts 模板，无则确定性占位句）→ `applyProgression(source: "event")`。**删除 `activeEventIds` 与 `DirectorState.seenEventIds`**（played 追踪为单一真源）。冷却 = `event.cooldown ?? director.novelty.cooldown_default`；`currentTensionBand` 用第一个张力变量驱动带区间；`difficulty_ramp` 生效（封顶 5）。
- **tasks.ts**（新增）：承诺式自动激活（giver 同场 + 条件满足 + 可重复/冷却）；objective 状态驱动进度（gather/deliver/escort/hunt/investigate/persuade/travel）；完成 → 奖励 effects + `applyProgression(source: "task")`；`time_limit.days` 到期失败；同一纯函数挂回合循环与日边界，幂等。不引入"接受任务"动作（26 内置动作无 accept，扩意图 schema 属契约变更）。
- **builtins.ts**（新增）：数据驱动注册表实现九种机械动作。attack 命中按 strength×grade 结算伤害、HP≤0 记 `defeated:<npc>` fact；defend 成功威胁 -5；**move 必须直接相连、travel 走 BFS 多跳可达**，均校验 exit/entry/连接条件，拒绝带机器 reasonCode（叙事化）；use_item 校验 requirements、consumable 消耗；give/take/steal/trade 走容量与货币检查（NPC 初始货币 0，卖自然拒绝）。`actions.ts` 硬编码块删除；`rules.ts` 动作集合改为从 schema 单一真源派生；`checkActionLegality` 增加 `origin.denied_actions` 拒绝。
- **worldgen.ts**：NPC 库存/初始记忆（确定性 id `mem-<day>-<idx>`）/trait effects 落地；npc_placement/item_placement 走种子 RNG；`secretHolders` 运行时映射（definition 不可变）；weighted 分布；`exclusive_leads` → 玩家 flags；`faction_stance` 文档化 no-op；`starting_event` 由 `Engine.create` 开局播放并并入 `openingNarrative()`。
- **语义层**：`condition.ts` 新增 `hasMarker` 统一标记空间（player.flags ∪ world.flags ∪ facts），flag/fact 两 source 均走它——修复 emberfall 主线"flag 写入 / fact 读取"不一致，无需改剧本；`deadline.condition` 求值（条件为真且未触发视为期限到达）；承诺触发时 `related.secrets` 逐条揭露；意图兜底返回候选列表（0→fallback_talk / 1→direct / ≥2→clarify）；mechanics_tags 白名单收窄为 10 种（移除 memory/secret/event/narrative）；soft taboo → `ConsistencyResult.warnings` 仅警告不拒绝；`style.voice` 入 system prompt；lorebook 按 on_keyword/on_location/on_npc 注入；few-shot 按 NPC `dialogue_examples` 匹配。
- **run.ts**：`world_continue` 继承 `lore-` 前缀 facts；origin 由种子 RNG 从全部 origins 随机选取；Engine 门面新增 `unlockedOrigins()` / `metaSnapshot()`。
- **存档**：`SAVE_SCHEMA_VERSION = 2`，旧版本直接拒绝（**敏捷开发，不做迁移**）；`normalizeWorldState` 补齐派生字段（`locationInventories` 从 `locations[].items`、`secretHolders` 从 NPC secrets、played 追踪默认值）。
- **描述层**：`llmDescriptorGenerator` 注入 `refreshAllStale`（走 provider `generateObject` + `descriptorOutputSchema`）；极性校验（`descriptionPolarityOk`）不过或生成失败 → 确定性模板降级，不阻塞回合。
- **契约层**：校验器补强附录 C op×source 矩阵、引用边（festivals→events、schedules→locations、tasks/locations 条件、exclusive_to→locations、faction rep 阈值全 kind、secret id 全局唯一）、`in`/`not_in` 数组值。
- **demo 内容**：`mine-entrance` 加 `items: [coal-essence]`、starlight `cargo-bay` 加 `eva-suit`；play 脚本"去酒馆"改映射 `travel`；old-wei secret 的 `inventory + has` 修为 `gte value: 1`（数值源语义）。
- **AGENTS.md**：新增「敏捷开发，不做向后兼容」与「干净单一」两条约定；`.chatgame/saves/` 旧档删除。

## Alternatives considered

- **事件"选中即播" vs 保留队列 + 独立叙事阶段**：选即播 + 叙事注入。保留队列需要新的叙事状态机，且 `activeEventIds` 已是死数据——删除比维护更干净。
- **任务"接受"动作/意图扩展**：扩意图 schema 属契约变更且引入 LLM 语义。选承诺式自动激活（与承诺系统同构，零新契约）。
- **需求阈值边缘触发（需跨步状态）vs 每日持续触发**：选每日持续——无需新增 fired 状态、与 `decay_per_day` 粒度一致。
- **状态效果每小时 tick vs 每日 tick**：选每日——与现有 `duration` 单位一致、修复 `advance(24)` 只 tick 一次的单位混乱。
- **flag/fact 严格分离（新增 fact effect kind）**：选标记空间统一——附录 E 自述二者无声明池，引擎运行态持有，统一单一事实源，避免契约变更与内容返工。
- **secret_holder 迁移不可变 definition**：选运行时 `secretHolders` 映射——保持 definition 不可变，存档可序列化。
- **faction 运行时状态以支持 faction_stance jitter**：无消费者即无状态——文档化 no-op，避免屎山。
- **meta.reset 单独实现**：与 keep 语义互补冗余，重建即重置——文档化，不写重复代码。
- **存档 v1 静默兼容 / 写迁移**：用户明确要求零向后兼容——v2 严格拒绝旧版本 + normalize，无迁移层。

## Consequences

代价：
- demo 节奏变化（需求衰减/状态 tick 进入回合；move 从任意瞬移变直接连接——剧本作者需按连接图配置 travel）。
- NPC 初始货币 0 → trade 卖自然拒绝（叙事化）；steal 空库存拒绝。
- 真实 LLM 下每个 stale 描述一次 generateObject 调用（失败降级模板，不阻塞回合）。
- stepWorld 逐小时循环耗时随小时数线性增长（advance 单次建议 ≤ 1000h，v1 规模无压力）。

收益：
- 唯一世界推进管道：回合与离线共用 `stepWorld`，无双轨逻辑。
- 事件/任务/内置动作/成长/记忆/张力/描述层全部接线，无死队列、无未消费字段。
- 确定性：所有新增随机走注入式 RNG，同种子同结果（测试断言深相等）。
- 引擎测试全绿（engine 225 用例），四份新测试文件覆盖 worldstep/events/tasks/builtins。
