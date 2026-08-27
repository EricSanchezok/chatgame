# 引擎运行时参考

## 状态边界

`SimulationState` v11 是闭环仿真的持久状态：canonical world、全部 Agent 私有状态、准入提交与语义历史。Canonical world 持有世界时钟、Activity 与 WorldTimer；`WorldInstanceDocument` v15 在其外层保存 Participant、持久 Arrival、Participant intent、PolicyBinding、ActionWindow、调度配置和 WorldRun。

真人与自主主体使用同一个 `AgentState`。策略表必须精确覆盖全部 Agent：

```ts
type PolicyBinding =
  | { kind: "model"; agentId: AgentId; profiles: AgentModelProfiles; resumeFromRevision?: number }
  | { kind: "external"; agentId: AgentId; participantId: ParticipantId }
  | { kind: "idle"; agentId: AgentId; reason: "timeout" | "released" | "explicit" }
  | { kind: "replay"; agentId: AgentId; sourceExecutionId: string };
```

外部行动也是开放自然语言企图。它只能指定 raw text、goal、means 与已知目标；action ID、actor、base revision 和提交归属由引擎绑定。idle、超时和正在执行 Activity 的 Agent 不产生行动，也不调用模型伪造 noop。replay coordinator 从 `sourceExecutionId` 投影已记录行动，并通过同一请求槽位交给算法重新物化；缺少记录行动时步骤失败，不能调用模型补写。

## 世界推进

唯一入口接收当前 revision、触发类型、可选边界数和外部行动。`manual` 推进一个时间边界，`batch` 推进指定边界数，`realtime` 只按现实时间唤醒，`participant_action` 让一个根意图自动跨边界执行；调用方不能提交模拟秒数。

## 时间计划、活动与边界

每个新行动在裁决前获得一个 `TemporalPlan`，其形态为 fixed、rate、staged、conditional 或 ongoing。时间数值只来自玩家原文中可独立验证的明确数量、世界剧本的命名 Temporal Profile，或版本化 Rule Package 的确定性结果；`temporal-planner` 只能选择 Profile 并引用依据，不能填写任意 clock delta、`elapsedSeconds`、最终进度或完成效果。

引擎把 TemporalPlan 物化为 canonical Activity。Activity 保存来源行动、参与 Agent、状态、阶段、开始与更新时间、进度、下一个绝对检查点、完成时刻、可中断性和资源声明；默认前台容量由剧本声明为一，同一 Agent 的额外并发能力也只能由剧本资源容量授权。WorldTimer 保存未来到期时刻、唤醒对象、causes 与 assertions，不保存未经验证的未来 state delta。世界脚本可用 `world_timers` 物化初始绝对触发；到期且没有同一 Agent 的到期 Activity 时，内核注入确定性的 Timer trigger action，同刻交给 Truth，CanonicalCommitter 会重新构造并核对该 action。

每次提交选择所有 active Activity 检查点、Timer、Condition 到期和 `max_autonomous_span_seconds` 中最早的绝对时刻。同刻到期项联合裁决，提交只含一个由内核注入的正整数 `advance_time`。无关的更早边界可以更新可见进度，但不能把未到期 Activity 的绝对检查点改成“当前时间加间隔”。完成效果只能在完成或对应阶段边界产生；控制面暂停不形成零时间世界提交。

`eager-reference@1` 的阶段如下：

1. 只为当前决策点的 model/external Agent 收集新行动；active Activity 只在到期时提供已承诺的来源行动。
2. 为新行动调用 temporal planner，验证受信任时间依据，物化 Activity，并选择最早时间边界。外部普通行动覆盖一个可中断前台 Activity 时，旧 Activity 在同一语义提交中取消。
3. 每个到期或新行动独立调用 action grounding。输入只含 canonical 目录与该 actor 的私有视角；输出为 read/write/audience footprint；目录外引用和未知 audience 归一化为 global read/write 并计数。
4. footprint 的读写冲突、观察关系和 global fallback 构成无向冲突图；每个连通分量独立进入 Truth。
5. 每个分量按 `perception → reaction-routing → resolution → transition` 推进。perception 和 resolution 可分轮预承诺 d20 或剧本声明的离散随机；reaction 只有一轮 keep/replace。
6. 引擎 materialize transition 的运行时身份，并注入与 TemporalBoundary 相等的唯一 `advance_time`。进行中的 Activity 只能提交截至本边界已经真实发生的进度；实际 operation 超出声明 footprint，或两个分量的实际读写交叉时，全体行动以 global footprint 重新裁决。
7. Observation Renderer 根据 transition 后状态、事件和 grounding 授权视角生成固定槽位 observation；非行动 Agent 也能收到与自己相关的授权观察。多个冲突分量合并后，以完整合并候选重新生成权限投影。模型不输出 observation ID、observer ID、step 或 kind；批次不得超过 Observation Profile 输入预算。
8. 只有完成、失败、中断、Timer 或其他语义事件产生的新决策点允许 model Agent 执行 `BeliefPatch → CharacterPatch → nextAction`。他者行动 grounding 明确把 active Activity 参与者列为 audience 且确有授权 Observation 时，内核生成 `activity_interrupted` 决策点；普通无关观察只累积游标，不唤醒 AgentMind。AgentMind 一次消费 observation cursor 之后累积的授权观察；active Activity 不重复思考。external 与 idle Agent 只保留授权观察，新创建 Agent 在本步 bootstrap。
9. CanonicalCommitter 重新应用候选并验证全部不变量，构造包含 TemporalPlan、完整 temporal snapshot、Activity 转换、边界来源、到期集合与决策点的 `CommittedStep` 和下一状态。

算法不持有状态写入能力。`sourceStateHash`、候选、policy roster 与当前 source 不一致时提交失败。

## Truth 与随机承诺

perception 只能请求 perception checks 或结束；reaction routing 只能选择有结构化感知依据的 Agent；resolution 只能请求 resolution checks、离散随机或结束；transition 只提出语义效果。阶段单向前进，离散随机开始后不能再请求 d20。

d20 请求先固定 actor、target、rating、modifier sources、DC、stakes、visibility 与 causes，再由内核抽取。离散随机只能引用 `WorldRuntimeContract` 内的分布定义；请求固定后由 seeded RNG 执行。所有随机结果必须被最终机制、operation、event 或 outcome 消费。

每个 operation、机制调用、event 与 outcome 都包含 causal refs 和至少一个机器可求值 assertion。代码先验证引用、断言、守恒和规则包；`causal-verifier` 再检查开放语义是否相关、效果是否匹配以及事件影响级别是否夸大。

## Observation 与认知隔离

Observation 使用观察者局部实体 ID。新对象必须在同一 packet 的 introductions 中建立局部实体；服务端私有 `canonicalEntityId` 只用于 binding，普通 API 和 AgentMind 都看不到该映射。apparent claim 只能引用该观察者已有或本包新引入的局部实体。

Observation Renderer 是受信任的模型角色，可以依据候选世界变化决定可见表象，但输出必须通过固定槽位、事件引用、局部身份、权限和完整覆盖校验。Truth transition 不生成 observation，因此全局裁决不会同时承担全体自然语言观察输出。

AgentMind 只收到自己的 character、belief、去 canonical identity 的 self view、自己的行动结果状态和自己的 observations。CharacterPatch 只能使用本步 eligible observation 作为证据；没有合格来源时必须为空。

## ActionWindow

同一 revision 最多一个 ActionWindow：

```ts
interface ActionWindow {
  id: string;
  generation: number;
  baseRevision: number;
  requiredAgentIds: AgentId[];
  submissions: Record<AgentId, ExternalActionInput>;
  deadlineAt: string | null;
  status: "open" | "resolving" | "committed" | "cancelled";
}
```

required Agent 的提交以 `submissionId` 幂等。相同 ID 与相同文本重试返回既有状态；同一 Agent 的不同提交冲突。收齐后立即执行，deadline 到期时缺失槽位转为 timeout idle。claim、release、提交、超时和取消都受 instance generation、window generation 与 base revision 约束。

ActionWindow 只包含此刻处于决策点的 external Agent。active Activity 的玩家不在每个检查点重新输入；完成、失败、中断或真正需要选择时才重新打开窗口。batch 在遇到 external 决策点时停止，realtime 严格串行且只安排现实唤醒；scheduler generation 使暂停、重新启用和重启前的 timer 失效，重启不补算离线时间。

## WorldRun 与暂停恢复

一个 Participant intent 对应一个持久 WorldRun，能够连续提交多个 TemporalBoundary。状态为 `queued | running | pausing | paused | awaiting-decision | completed | failed | budget-paused`；记录 generation、根行动、Activity、execution、已提交 revisions、停止原因和当前 lease。

每个自动 lease 默认最多 100 次提交或 15 分钟真实执行时间，任一预算耗尽只进入 `budget-paused`。暂停会中止尚未提交的模型尝试并提高 generation；迟到结果在 Ledger 标为 cancelled，不能越过 generation/revision CAS。恢复创建新 lease。进程启动时把遗留 queued/running/pausing run 转为 `paused: process-recovered`，保留 canonical Activity 与进度，且不自动发起模型调用。

## Participant 准入与控制转移

Participant 以 principal 身份控制一个 external Agent。普通新游戏只能通过 Origin 创建新 Agent；Observer 可以在 revision 边界接管任意存活且未被 external 策略控制的 Agent。当时的 prepared action 作为历史承诺保留并记录 `suppressedActionId`，external 策略绝不收集或执行它。真人获得该 Agent 的角色视角和历史观察，但不会获得 bindings、其他 Agent 认知或 canonical truth。

Origin 准入确定性创建 Entity、Agent、placement、资源和自由动机 goal，并形成独立 admission revision。显示名称、外观和动机不能改变剧本的数值、出生点或资源。Arrival Generator 在准入提交后运行，只读该角色视角并返回标题、第一人称场景和三条建议；失败使用剧本回退文本，不能回滚准入。

控制转移以一个 revision CAS 同时释放当前角色并选择 Observer 或另一 Agent。释放角色恢复 model 策略，并以 `resumeFromRevision` 标记需要消化的控制期 observations；被接管角色生成新的持久 Arrival。Participant 的自然语言提交由服务端持久化为根 intent，并创建或继续 `participant_action` WorldRun。一个 intent 可以投影多条 committed Observation；暂停后玩家可恢复同一 Activity，也可提交普通“停止/改变活动”行动进入下一次语义裁决。

## 提交与重放

提交内核校验：状态 schema、revision、TemporalBoundary、TemporalPlan 权威来源、Activity/Timer snapshot、行动与 outcome 一一覆盖、唯一时间推进、随机顺序、causal refs、断言、世界引用、守恒、范围、placement、observation 权限、决策资格、mind commit 覆盖、RNG 连续性、semantic hash 与历史 replay。

成功步骤的实例 CAS、WorldRun 更新与 execution terminal record 在一个 SQLite 事务中完成。失败、暂停、超时和迟到结果只更新运行或 execution 诊断，不改变 canonical revision。canonical history replay 从每个 CommittedStep 恢复完整 temporal snapshot 且不调用模型；recorded execution replay 从 Execution Ledger 消费原始结构化响应并再次运行同一算法与提交内核。

相关边界见[系统架构](../architecture.md)、[剧本格式](script-format.md)、[Execution Ledger](runtime-observability.md)和[表现层](presentation.md)。
