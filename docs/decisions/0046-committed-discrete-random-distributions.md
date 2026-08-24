# 剧本声明、预承诺并可重放的通用离散随机分布

## Status

Accepted
Class: architecture

## Context and Problem Statement

通用 d20 能表达依赖 DC、修正和成败的行动检定，却不能准确表达“若干个等概率槽位重复抽取后求和”“先判断是否触发，再按另一张表抽取”或带重复槽位权重的世界机制。把这些机制换算成期望值会消灭波动，把某次结果写进初始状态会把随机事实冻结成世界种子，让模型临时编写概率或自行选结果则无法证明概率、公平性和重放一致性。

引擎需要让任意题材声明有限离散概率，同时保持玩家与 Agent 动作开放、世界 ZIP 无执行代码、随机参数在结果产生前承诺、失败步骤不消耗已提交 RNG，以及会话恢复可验证实际使用的分布。

## Decision Drivers

- 概率、抽取次数、分支和聚合必须由剧本声明，不能为 D&D、某个参考世界或一种骰子表达式写死逻辑。
- 同一 outcome 槽位必须精确等概率；重复槽位是唯一权重表达，不能受浮点映射偏差或导入去重影响。
- Truth Engine 必须在看到结果前提交分布身份与因果，transition 修复不得改写已发生的抽取。
- RNG 历史必须从 seed 和请求逐字段重放，条件跳过也必须成为显式审计事实。
- 分布、快照、结果和实际 RNG word 必须有统一且可在导入、执行、历史恢复三处复用的资源上限。
- 会话恢复必须使用创建时固定的分布，不跟随同 ID 世界的后来替换。
- 运行态和会话契约直接断代，不保留迁移或兼容双轨。

## Considered Options

- 把期望值或一次抽样结果写入世界 Fact。
- 让 Truth 模型阅读自然语言概率并直接选择结果。
- 在核心加入通用骰子表达式解析器与分支脚本 DSL。
- 使用剧本声明的有限等概率槽位、有序条件 steps 与提交后抽取——所选路线。

## Decision Outcome

schema v6 `mechanics.yaml` 可声明 `random_distributions`。每个分布包含稳定 ID、说明和有序 steps；step 声明 1–100 次 `count`、2–100 个 `outcomes` 槽位、`first | sum | values` 聚合，以及可选的 `when: { step_id, equals }`。outcome 只能是非空字符串、安全整数、布尔值或 null。`first` 只允许一次抽取，`sum` 只接受安全整数，`values` 保留抽取序列；条件只能引用同一分布中更早且不是 values 聚合的 step。条件不满足时保存 skipped、空 draws 和 null aggregate，且不消耗 RNG。

每次抽取从 outcomes 的索引槽位中等概率选择。RNG state 以奇数 Weyl increment 遍历全部 `2^32` 个状态，再经过由 xor-right-shift 和奇数模乘组成的 32-bit 双射输出 word；全部 uint32 seed 各自保留唯一初态，seed 0 不映射到另一个 seed。随后用 rejection sampling 映射槽位，拒绝不能均匀分桶的尾部值，避免 `floor(float × n)` 的槽位偏差，也避免非双射 mixer 在完整 32-bit 结果域产生碰撞。每个被拒绝的 uint32 仍推进 RNG state 与 `SeededRngState.draws`，step `draws[]` 只保存接受后的 `{ outcomeIndex, value }`；历史从 `rngBefore` 复算被拒绝抽数，原始 word 不作为游戏结果暴露。相同 outcome 值可以重复占据多个槽位来表达整数权重；槽位顺序和重复次数都进入世界内容身份、严格导入结果与固定世界契约，不被去重、排序、折叠为概率摘要或替换成期望值。

底层 RNG 每次只产生一个 32-bit word，因此通用整数抽取只接受不超过 `2^32` 个结果的闭区间；更大 span 响亮拒绝，不用拼接后仍声称无偏的伪宽范围。外部 seed 契约同样严格限制为 uint32，不接受再静默折叠到相同初态的更大整数。离散分布自身仍以 2–100 个槽位为公开契约。

`truth-resolution` 以 `request_random` 预承诺请求 ID、分布 ID 和 causes。内核从固定 `WorldRuntimeContract.randomDistributions` 解析分布，并把完整 distribution snapshot 写入 `DiscreteRandomRequest` 后才抽取；模型不能随请求提交或修改 outcomes。d20 与离散随机共享最多四个承诺轮次，所有 d20 必须出现在本步骤首个离散随机承诺之前；随机承诺开始后不得重新请求 d20。内核在每轮真正提交后追加 `CommitmentRound`：check 轮保存 phase 与有序 request IDs，random 轮保存有序 request IDs；模型不能自行声明或改写轮界。

结果为逐 step 的 `skipped`、每次 `{ outcomeIndex, value }` draw 和 `aggregate`。每个已经承诺的随机请求都必须由最终 transition 的 mechanic invocation、operation、event 或 outcome 至少消费一次：消费者以该请求为 random cause，并用 `random_result` 断言精确匹配其中一个未跳过 step 的 aggregate。模型不能先抽取 A、查看结果后再抽取 B，却只让最终事务消费偏好的 B；未消费任何已承诺随机的候选直接拒绝。独立 causal verifier 同时读取随机请求与结果，检查随机是否必要以及效果是否匹配，但没有重新抽取或修改状态的权限。

`CommittedStep` 保存 commitment rounds、random requests、distribution snapshots、results 与 RNG 前后态。轮次账本必须以原顺序恰好覆盖每个请求一次，最多四轮，random 单轮最多十六个请求；同轮请求不能引用同轮兄弟结果，perception check 只能引用 reaction 前 initial actions，resolution check 与 random 只能引用 final actions，进入 random 后不能再出现 check。Truth transition、独立 causal verifier 与后续 semantic history 都读取同一轮界，能区分同轮预先并列抽取和看过前轮结果后的追加抽取。完整状态校验从 `rngBefore` 先重放 d20，再按顺序重放离散随机，并逐字段核对结果和 `rngAfter`；`WorldSessionDocument` 还核对每个 snapshot 与会话固定世界契约中同 ID 分布的内容身份。任一 schema、因果、transition、AgentMind 或提交失败都回滚整个步骤，未提交候选不推进持久 RNG。

历史不能信任已保存的轮界或 `causalAssertionResults.passed/observed`。恢复先验证轮次账本的数量、阶段、顺序、精确覆盖和逐轮可见原因，拒绝五轮链、同轮依赖、跨步骤 check/random 依赖、random 后的 d20 以及 reaction 前后行动混用。首次提交前固定由 definition initial state 派生的 replay base，内容为完整 canonical truth、player entity ID 与初始 Agent ID → entity ID 映射；其 canonical hash 写入固定世界运行时契约。状态和会话恢复从该 base 按 operation 顺序重建 canonical truth 与动态 Agent 身份，再用重放的 d20/离散随机结果重新执行同一个 `evaluateProposalCausality`；因此未消费的已承诺随机在运行时和恢复时都会被拒绝。恢复逐字段比较 target、assertion、passed 与 observed，并核对最终 canonical truth 和 actor identity。单独改 outcome 断言、保存的观察值、passed 和 step content hash，或追加一个可重放但未消费的随机承诺，仍不能把非法历史伪装为成功。

所有预算用同一个 canonical 稳定序列化 helper 计算实际 UTF-8 字节，不使用字符数或近似 token 数。单 outcome 上限 256 B，单分布 32 KiB 且至多 1,024 次声明抽取；单个世界至多 256 个分布，完整 catalog 至多 512 KiB，防止每次 Truth 与因果复核上下文被合法世界包放大到归档总上限。每个离散随机承诺轮至多 16 个请求，每个 committed step 至多 32 个随机请求、2,048 次声明抽取和 4,096 个实际消费的 uint32 word，分布快照合计至多 256 KiB、结果合计至多 512 KiB。边界值接受，增加一个分布、随机请求、抽取、word 或一个 UTF-8 字节即拒绝；loader、Truth resolution、历史校验和 session restore 复用同一组常量与 helper。

`SimulationState` 使用 schema v8，`WorldSessionDocument` 使用 schema v9；世界剧本使用 schema v6。旧状态和旧会话直接拒绝，项目不提供迁移读取、默认补丁或兼容路径。

### Consequences

- 世界作者可以准确表达多次求和、带权结果和条件分支，不需要把具体骰制、生态表或参考世界规则加入核心。
- outcome 数组以重复槽位表达权重，规模受 100 槽上限约束；超大权重比需要约分或拆成有序 steps。
- 完整分布快照和逐次 draw 增加历史体积，换来概率参数、条件跳过与 RNG 连续性的可审计证据。
- 固定资源预算限制了单步可表达的批量随机规模，超大模拟必须拆成多个原子世界步骤。
- d20 与离散随机采用固定非交错顺序，牺牲任意混排以获得单一且易验证的历史重放语义。
- 轮次账本增加少量历史体积，换来对四轮上限、同轮不可见性和结果后追加请求的可验证证据。

## Pros and Cons of the Options

### 固定期望值或一次结果

- 好：无需扩展引擎协议，状态最小。
- 坏：期望值没有随机波动；冻结结果不能代表持续世界机制，也无法在真实发生时才消耗 RNG。

### 由 Truth 模型直接选择

- 好：作者只写自然语言，能表达任意表面概率。
- 坏：模型既定义概率又看到并选择结果，槽位公平、参数预承诺、失败回滚和确定性重放都不可证明。

### 骰子表达式与分支脚本 DSL

- 好：短表达式对熟悉桌游语法的作者紧凑，理论上可以表达复杂程序。
- 坏：需要解析器、执行器、资源限制与更大的安全表面，容易把 D&D 术语或一套并行脚本语言固化进通用核心。

### 有限离散槽位与有序条件 steps

- 好：数据结构严格、题材无关、可预承诺、可审计且能组合常见多骰与条件分支；ZIP 仍不携带代码。
- 坏：比自然语言冗长，不能直接表达连续分布、任意精度权重或循环程序。

## Links

- [0004](0004-game-first-principles.md) — 剧本驱动与通用引擎第一性原理。
- [0032](0032-open-world-facts-and-d20-kernel.md) — d20、数值原语与随机承诺基础。
- [0039](0039-pinned-world-runtime-contract.md) — 内容身份与固定世界运行时契约。
- [0042](0042-causal-assurance-and-staged-model-profiles.md) — 分阶段 Truth、因果断言和独立复核。
- [0045](0045-versioned-reference-world-projects.md) — 首个使用通用离散分布的参考世界。
- [引擎运行时规格](../game-design/engine-runtime.md#离散随机协议) — 请求、断言、RNG 与历史重放契约。
- [世界剧本格式](../game-design/script-format.md#mechanicsyaml) — random distributions 的严格 YAML 格式。
- [世界导入](../game-design/script-import.md) — 分布在严格导入和规范世界契约中的保存方式。
