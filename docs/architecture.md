# 系统架构

Living World Engine 的运行时是“单一客观世界 + 多个有限认知主体 + 唯一联合裁判”。动作表达是开放的，状态提交是严格的。

## 模块边界

| 层 | 目录 | 唯一职责 |
|---|---|---|
| 世界契约 | `src/script/` | 严格读取 schema v6 YAML，规范化内容并构造带内容身份的 `WorldDefinition` 与 `SimulationState` v8 |
| 仿真内核 | `src/engine/` | AgentMind、角色演化、自身状态投影、分阶段 Truth Engine、因果断言、规则钩子、独立因果复核、有限反应、d20 与离散随机承诺、观察隔离及状态事务 |
| 模型网关 | `src/engine/model-*` | 模型目录、供应商适配、严格输出、公平队列与调用审计 |
| 运行观测 | `src/engine/observability.ts`、`src/server/runtime-observer.ts` | 关联 HTTP、SSE、WorldRun、步骤、模型与持久化事件，输出有界 NDJSON |
| 会话宿主 | `src/server/` | 世界仓库、WorldRun 生命周期、逐步原子持久化、恢复、导入 |
| HTTP 表面 | `src/app/api/` | 会话与 run 资源、SSE、世界列表、导入，以及独立只读 inspector 路由 |
| 浏览器 | `src/app/` | 以 assistant-ui 官方 Thread 基线纯投影公开 Session/WorldRun；默认隐藏的本地调试工作台独立消费 inspector 契约 |
| 公共契约 | `src/shared/world-api.ts` | 普通游戏浏览器安全 DTO；不含 canonical identity 或完整 truth |
| 调试契约 | `src/shared/world-inspector-api.ts` | 本地受信任的只读全真图谱、step/attempt 详情与实时事件 |

依赖方向固定为：浏览器 → Route Handler → WorldHost → SimulationEngine → AgentMind/TruthEngine。`src/engine/` 与世界 YAML 不进入浏览器 bundle。

## 三种现实

`CanonicalWorldState` 是唯一客观现实，包含实体、位置、事实、数值、时间、生命周期、客观事件与 RNG 状态。每个 `AgentState` 拥有独立的稀疏 `AgentBeliefState` 和分层 `AgentCharacterState`：前者用局部实体 ID 表达可与真相冲突的主观认知，后者保存人格、特质、价值、情绪、态度、目标和承诺。`PlayerKnowledgeState` 只保存玩家已知信息，不记录或推断真人心理。

`EpistemicBinding` 只在服务端把局部身份映射到 canonical entity。服务端以该映射派生去 canonical ID 的 `AgentSelfStateView`；AgentMind 能精确看到自身生命周期、时间、地点表象、数值与授权 Fact，却看不到底层 entity、placement、meter 或 rating identity。AgentMind prompt 与普通游戏 API 都移除 binding，所以玩家和模型不能靠 ID 绕过认知边界。唯一例外是 [0052](decisions/0052-trusted-world-evolution-inspector.md) 定义的本地受信任、只读 inspector 路由；其类型和消费点不得复用到公开会话或 AgentMind。

模型只生成开放语义 draft 和候选内 alias。action、check、random、mechanic、event、outcome、observation 与派生 evidence 等发生记录由引擎按 world hash、revision、阶段、所有者、轮次和稳定序号确定性分配 `rt:<kind>:<sha256>` 身份，再统一重写候选引用。语义 ID 仍由剧本或模型命名，但不能占用运行时命名空间、重绑 identity tuple 或在删除后复用；完整 pre-bootstrap truth/Agent/player base、bootstrap commit 与逐步 history ledger 共同重放并验证 ID、玩家输入、认知内容、下一行动和引用时间作用域。

## 一个世界步骤

1. 当前玩家目标和每个存活 Agent 已准备的自由行动绑定同一 `baseRevision`，按 actor/proposal identity 规范排序形成初始联合输入。
2. `truth-perception` 只决定并预承诺 perception checks；`truth-reaction-routing` 随后恰好调用一次，至多为有结构化感知依据的 Agent 打开一轮 keep/replace。
3. 最终行动集锁定后，`truth-resolution` 决定并预承诺 resolution checks 与剧本声明的离散随机请求；所有 d20 必须在首个离散随机承诺前完成，阶段只能前进，不能重新打开 perception 或 reaction。
4. `truth-transition` 基于最终行动集提出 outcome、规则调用、直接世界 delta、带影响级别的事件、逐观察者 observation 与玩家目标状态。每个 operation、规则调用、event 和 outcome 同时声明可解析原因与机器可求值的前置断言。
5. 受信任规则包校验规则调用并由代码派生 delta；事务层按顺序求值断言，校验引用、法则授权、守恒、范围、包含关系、观察覆盖和正数时间推进。`causal-verifier` 对有效候选做独立开放语义复核，只能接受或否决；否决只重试 transition，不重开早期阶段。
6. 每个 AgentMind 只看自己的 belief、character、self view、私有 stimulus 和 outcome observation，按 `BeliefPatch → CharacterPatch → nextAction` 更新；新创建 Agent 也在本步初始化。
7. 全部结果有效后，revision、step、RNG、truth、belief、character、玩家知识和审计历史一次提交。审计以 invocation 明细保存分阶段模型调用，并保存规则调用与结果、随机分布快照与逐次抽取、断言结果、因果复核和内容 hash；prompt、原始响应与思维链不进入存档。任一失败则整个步骤回滚。

## 模型调用链

`config/models.yaml` 显式声明 provider、profile、原生推理配置与并发限制。世界分别选择 perception、reaction routing、resolution、transition 与 causal verifier Profile；每个 Agent 分别选择 bootstrap、mind 与 reaction Profile。每个调用点都按精确角色校验；Gateway 只要求实际引用 Profile 对应的 provider 凭据，缺失时在调用前失败。`ModelGateway` 按 provider 调用 DeepSeek Chat Completions 或 OpenAI/xAI Responses API，返回 strict schema 结果与审计。所有 HTTP 请求经过进程级公平队列，不存在默认模型、供应商 fallback 或生产 mock。完整契约见 [模型目录与 Gateway](game-design/model-gateway.md)。

服务端统一 observer 以 correlation 串联 HTTP、SSE、WorldRun、世界步骤、模型 transport 与 SQLite 持久化；失败和回滚进入运行日志但不进入已提交历史。事件、payload 边界和有界文件 sink 见 [运行时可观测性](game-design/runtime-observability.md)。

世界演化调试器把 canonical history 通过事务校验共用的 replay 投影为 committed 图谱和 revision 前后快照，把同一有界 RuntimeEvent 通过增量 NDJSON 索引与独立 SSE 投影为 attempt 分支。WorldHost 的 64 项 LRU 只缓存以 session、world hash 和 revision 寻址的可重建派生值；trace 与 live attempt 每次重新合并。浏览器用 React Flow 呈现语义节点，Web Worker 内的 ELK 只计算坐标，不运行引擎或应用状态 delta。完整表面见 [表现层参考](game-design/presentation.md)。

## 规则扩展

世界通过 `rule_packages` 引用服务端受信任注册表中的规则包 ID、精确版本和严格配置。ZIP 不能携带可执行规则代码；未知包、规则、版本不符或多余配置在加载/调用时拒绝。同一 `WorldRepository` 持有导入、加载和运行共用的 Registry；resolver 只接收隔离快照，其返回值重新通过严格 operation schema。规则包公开可调用规则的 ID、说明和严格输入 schema，代码统一添加 `mechanic` provenance 并可拒绝模型直接绕过。核心预装 `core-d20@1.1.0` 与 `apply-meter-impact`；它不定义动作白名单，只把检定驱动的 Meter 变化变成可复核的确定性机制。

## 长程 WorldRun

`WorldHost` 把一次玩家目标作为后台 `WorldRun` 执行。`PlayerIntent.goal` 在整段 run 中保持不变，最新的 goal/clarification 作为独立输入记录；需要玩家决定时 run 进入 `awaiting_player`，后续输入恢复同一个 intent 与 run。每个已完成步骤与对应 run 边界在同一次 compare-and-swap 中写入 SQLite，并通过 SSE 发布公开检定、玩家观察和提交进度。queued/running 表示模型仍在执行；awaiting_player/completed/goal_failed/step_limit/cancelled/failed 都是必须有同名末事件的流边界；其中 awaiting_player/step_limit/failed 仍拥有可恢复或可放弃的 active intent。

浏览器不另存聊天消息；`PublicSessionDetail.runs` 按持久 `player.input` 边界投影成 assistant-ui 玩家/世界消息段和仅含公开叙事的复制文本。游戏页固定使用官方 `Root → Viewport → 44rem message group → ViewportFooter` 单轴结构，不显示 sidebar 或 session header。新目标、clarification、重试、取消和放弃都回写 WorldRun 资源；所有成功或响应不确定的操作、跨标签页恢复和重新获得焦点都通过同一服务端对齐路径重建界面并只观察当前 executing run。

取消会终止排队或在途模型请求，持久化取消请求，并在候选步骤提交前重新读取 generation；并发取消使候选失效，因此只保留最后一个完整步骤。进程重启时，无取消请求的 queued/running run 变成可重试 failed；已写入取消请求的 run 则原子恢复为 cancelled 并取消 intent。失败是否可重试由类型化内部错误映射到持久 `run.failed.retriable`，永久失败只能放弃。一个会话同时只允许一个拥有 active intent 的 run。

## 世界身份与本地持久化

世界内容先规范化再计算 `sha256`；哈希覆盖 manifest、法则、机制、玩家和按实体 ID 排序的实体内容，不依赖 ZIP 条目顺序或实体文件名。会话同时保存 `worldId`、`worldHash` 和完整 `WorldRuntimeContract`；每次读取先用原始 seed 加载保留的 content-addressed 世界版本，再逐字段验证内嵌契约，既不跟随当前版本指针，也不信任会话自身声明的同 hash 内容。初始 Fact 的 provenance 使用 `{ kind: "world_seed", id: worldHash }`，世界 Law 只有在确实提供运行时因果时才能作为来源。

所有世界版本、当前版本指针、会话、run 与事件存放在 `LIVINGWORLD_DATA_ROOT/livingworld.sqlite`。`WorldSessionDocument` schema v9 保存固定世界契约、1–80 字符存档标题、状态与 run；列表只返回公开摘要，读取与创建返回 `{ summary, state, runs }`。重命名与删除同样经过 generation fencing，queued/running 时均拒绝，避免元数据写入使在途步骤失效。SQLite 使用 WAL、FULL synchronous、外键、严格表、写事务和 generation compare-and-swap；世界导入的验证在事务外完成，版本与当前指针在一个事务内切换。进程租约拒绝同一数据库被第二个宿主实例同时驱动；这是纯本地单实例契约，不提供多主或分布式协调。

## 硬不变量

- 玩家文本和 Agent action 都是企图，不是状态命令。
- 每个步骤恰好包含一次正数时间推进。
- 每个联合行动恰好有一个 outcome。
- 所有 delta、规则调用、事件与 outcome 都有可解析 causal provenance 和至少一个可求值断言；引用 check 时必须断言同一 check 的结果，引用离散随机请求时必须断言其中一个未跳过步骤的实际聚合值。
- Quantity 转移守恒；生产/消耗必须引用该 Quantity 明确列入相应授权列表的世界法则。
- 初始 Fact 只能引用本会话 `worldHash` 对应的 `world_seed`；运行时 Fact 来源必须解析到已提交因果。
- Meter/Rating 必须在剧本定义范围内；threshold 只触发一次。
- 检定修正来源以 `(kind, id)` 标识；同名 Rating 与数值 Fact 是两个不同来源，值与总和都由内核核验。
- placement 不得形成循环；Agent 必须绑定活动实体。
- 每个 Agent 恰好有一个局部 self binding；自身状态投影不得泄漏 canonical identity 或其他实体状态。
- 每步最多一轮玩家刺激 reaction；每个 actor 最终恰好一个行动，resolution 开始后不得反应。
- Truth 各阶段、独立因果复核、Observation、BeliefPatch、CharacterPatch、reaction 与下一行动全部通过各自 Profile、schema 与语义校验。
- 普通游戏客户端永远不接收 canonical bindings、其他 Agent 信念、内部模型 ID、内部错误或隐藏检定；只有 [0052](decisions/0052-trusted-world-evolution-inspector.md) 的本地受信任 inspector 路由可以只读返回这些调试数据。

## 扩展到超大世界

当前状态模型没有地图格数量或动作种类上限；地点只是实体，移动只是带因果的 placement 变化。真正的大世界瓶颈是内容量、上下文选择、Agent 数量、存储和模型成本，而不是动作表达。首版故意让全部 Agent 每步行动以验证语义；未来可以加入区域分片、分层时间和 Agent 调度，但它们必须保留同 revision 联合语义和唯一 truth 提交点。

架构理由见 [0031](decisions/0031-epistemic-multi-agent-truth-engine.md)、[0032](decisions/0032-open-world-facts-and-d20-kernel.md)、[0033](decisions/0033-persistent-streaming-world-runs.md)、[0037](decisions/0037-agent-evolution-self-awareness-and-reaction-window.md)、[0039](decisions/0039-pinned-world-runtime-contract.md)、[0040](decisions/0040-resumable-player-intent.md)、[0041](decisions/0041-local-sqlite-runtime.md)、[0042](decisions/0042-causal-assurance-and-staged-model-profiles.md)、[0043](decisions/0043-end-to-end-runtime-observability.md)、[0046](decisions/0046-committed-discrete-random-distributions.md)、[0047](decisions/0047-on-demand-model-provider-credentials.md)、[0048](decisions/0048-engine-owned-runtime-identities.md)、[0049](decisions/0049-world-run-failure-and-stream-boundaries.md)、[0051](decisions/0051-assistant-ui-upstream-session-surface.md) 与 [0052](decisions/0052-trusted-world-evolution-inspector.md)。
