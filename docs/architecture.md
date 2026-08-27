# 系统架构

Living World Engine 维护一个 canonical world 和多个具有私有认知的 Agent。真人、模型、脚本与回放只是 Agent 策略的不同来源；Participant 属于产品接入层，不属于另一类仿真主体。

## 模块边界

| 层 | 目录 | 职责 |
|---|---|---|
| 世界契约 | `src/script/` | 读取 schema v8 世界包，校验资源并构造 `WorldDefinition` 与 `SimulationState` v9 |
| 执行算法 | `src/engine/eager-reference.ts` | 全量策略激活、逐行动 grounding、冲突分量裁决、观察分批与 AgentMind 更新 |
| 固定内核 | `src/engine/canonical-committer.ts` | 验证候选、认知隔离、因果、守恒、完整覆盖与原子状态构造 |
| 模型网关 | `src/engine/model-*` | Profile、供应商适配、严格结构化输出、公平调度与调用审计 |
| 实例宿主 | `src/server/world-host.ts` | `WorldInstanceDocument` v12、Participant、ActionWindow、调度与 generation fencing |
| 执行证据 | `src/server/execution-ledger.ts` | execution、事件、artifact、实验、重放与 Inspector 的唯一持久事实源 |
| HTTP 与浏览器 | `src/app/` | API v6、世界库、无人演化控制、Participant 准入、角色视角和只读 Inspector |
| 公共契约 | `src/shared/` | 浏览器安全 DTO 与本地受信任 Inspector DTO |

依赖方向为：浏览器 → Route Handler → WorldHost → SimulationEngine → WorldExecutionAlgorithm → CanonicalCommitter。算法只能返回候选，不能持有 canonical state 的写能力。引擎与世界 YAML 只在服务端加载。

## 状态与策略

`SimulationState` 包含唯一 `CanonicalWorldState`、`agents`、准入提交与语义历史。每个 `AgentState` 绑定一个活动 Entity，并拥有独立的 `AgentBeliefState`、`AgentCharacterState`、epistemic bindings 与下一行动。完整闭环状态是世界状态与全部 Agent 私有控制状态的组合。

`PolicyBinding` 为每个 Agent 选择 `model | external | idle | replay`。外部控制不会创建 PlayerState；Agent 的位置、身份、历史与私有观察保持不变。外部控制期间不调用 AgentMind，也不推断真人信念、情绪或下一行动。释放后可转为 idle，或由 AgentMind 先消化控制期间该角色收到的观察再恢复 model 策略。

模型只生成语义 draft。Agent、Entity、Fact、Meter、Rating 和主体私有认知记录使用世界语义 ID；action、check、random、mechanic、event、outcome、observation 与 apparent claim 的运行时身份由引擎确定性分配。revision、step、phase、生命周期、provenance、Profile 与时间戳由引擎 materialize。

## `eager-reference@1`

参考算法以全量工作提供可比较的精确语义基线：

1. 所有 model Agent 使用已准备行动；external Agent 使用 ActionWindow 提交；idle 或超时 Agent 使用引擎生成的 typed noop。
2. 每个行动独立 grounding，私有认知只进入该行动的上下文。grounding 输出保守 read/write/audience footprint；不确定依赖进入 global fallback。
3. footprint 构成冲突图。连通分量分别执行 perception、reaction routing、resolution、随机承诺和 transition；实际读写越界或分量交叉依赖触发全局重新裁决。
4. Truth transition 只输出 outcome、机制、operation、event 与 decision request。正数 `advance_time` 由引擎统一注入。
5. Observation Renderer 按固定观察槽位生成表象；槽位数、observer、step、kind 与持久身份由引擎确定。多个分量合并后，完整候选再向所有 Agent 生成一次权限受限的全局投影；batch 按 Observation Profile 的输入字节预算切分。
6. 所有 model Agent 并发执行 AgentMind；external 与 idle Agent 只接收自己的 Observation。
7. CanonicalCommitter 做一次全局验证并构造下一状态。实例 CAS 与 execution terminal record 在同一 SQLite 事务内提交。

任一模型、校验、取消或持久化失败都不会推进 revision。失败 execution 与已取得的请求、响应和验证材料仍写入 Execution Ledger。

## World Instance 与 Participant

`WorldInstanceDocument` 保存 canonical state、复数 participants、每个 Agent 的 policy binding、一个 ActionWindow、运行参数、scheduler 状态、advance 记录与 execution 引用。产品入口限制一个 active Participant；内部状态与窗口收集支持多个 Participant。

实例在零 Participant 时可单步、批量或实时演化。存在 external Agent 时，推进在当前 revision 打开唯一 ActionWindow，收齐全部 required Agent 的幂等提交后执行；deadline 到期的缺失槽位成为 typed timeout noop。窗口 ID、generation、base revision 与实例 generation 共同阻止重复提交和陈旧写入。

Scheduler 保证同一实例严格串行。realtime 的下一触发点只在前一步结束后计算；暂停或重新启用会增加 generation，使陈旧 timer 失效。进程恢复从当前时间安排下一步，不补算离线 backlog。batch 遇到外部行动窗口时停在可恢复边界。

可选 `participation.yaml` 声明可认领 Agent、Origin 与静态图片。Origin 定义固定出身、出生点、资源、关系钩子、风险、托管 Profile 与回退入场文本；真人只填写显示名称、外观和自由动机。准入在 revision 边界形成独立 canonical admission commit。Arrival Generator 只读该 Agent 获授权的私有视角，只返回入场叙事与三条可编辑建议，不产生 world operation。

## 世界身份与持久化

世界内容规范化后计算 SHA-256，覆盖 manifest、法则、机制、实体、参与配置与静态资源身份。实例固定保存 `WorldRuntimeContract` 与 world content hash；读取时从 content-addressed 版本重建并核对契约。

世界版本、实例和 Execution Ledger 位于 `LIVINGWORLD_DATA_ROOT/livingworld.sqlite`。SQLite 使用 WAL、`synchronous=FULL`、strict tables、进程租约、写事务与 generation compare-and-swap。旧 schema 不迁移；运行不同契约时使用新的 data root。

## 硬不变量

- 行动文本是企图，不是状态 delta。
- 每个 Agent 在策略表中恰好出现一次，每个最终联合行动恰好有一个 outcome。
- 每个步骤恰好有一次由引擎注入的正数时间推进。
- 每个存活 Agent 恰好收到一条 outcome observation；私有文本使用观察者局部 ID。
- Quantity 守恒，生产与消耗必须有世界法则授权；Meter 与 Rating 保持在剧本范围内。
- placement 无循环；Agent 绑定活动 Entity，并拥有唯一 self binding。
- operation、机制、event 与 outcome 的原因和断言必须可解析并在写入前成立。
- external Agent 不执行 AgentMind；model Agent 和本步创建的 Agent 恰好提交一次 mind commit。
- 普通 API 不返回 canonical truth、bindings、其他 Agent 认知、模型配置或内部错误材料。

世界包、运行时、表现层与 Ledger 的细节分别见[剧本格式](game-design/script-format.md)、[引擎运行时](game-design/engine-runtime.md)、[表现层](game-design/presentation.md)和[执行证据](game-design/runtime-observability.md)。架构选择见 [0061](decisions/0061-unified-agent-and-external-policy.md)、[0062](decisions/0062-world-instance-participation-and-action-window.md)与 [0063](decisions/0063-eager-reference-execution.md)。
