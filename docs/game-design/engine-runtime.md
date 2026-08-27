# 引擎运行时参考

## 状态边界

`SimulationState` v9 是闭环仿真的持久状态：canonical world、全部 Agent 私有状态、准入提交与语义历史。`WorldInstanceDocument` v12 在其外层保存 Participant、PolicyBinding、ActionWindow、调度配置和 advance 状态。

真人与自主主体使用同一个 `AgentState`。策略表必须精确覆盖全部 Agent：

```ts
type PolicyBinding =
  | { kind: "model"; agentId: AgentId; profiles: AgentModelProfiles; resumeFromRevision?: number }
  | { kind: "external"; agentId: AgentId; participantId: ParticipantId }
  | { kind: "idle"; agentId: AgentId; reason: "timeout" | "released" | "explicit" }
  | { kind: "replay"; agentId: AgentId; sourceExecutionId: string };
```

外部行动也是开放自然语言企图。它只能指定 raw text、goal、means 与已知目标；action ID、actor、base revision 和提交归属由引擎绑定。idle 与超时由引擎构造 typed noop，不调用模型伪造。replay coordinator 从 `sourceExecutionId` 投影已记录行动，并通过同一请求槽位交给算法重新物化；缺少记录行动时步骤失败，不能调用模型补写。

## 世界推进

唯一入口接收当前 revision、触发类型、模拟秒数和外部行动。`manual`、`batch`、`realtime` 与 `participant_action` 都调用同一个步骤实现。

`eager-reference@1` 的阶段如下：

1. 收集全部 model、external 与 idle 策略行动。
2. 每个行动独立调用 action grounding。输入只含 canonical 目录与该 actor 的私有视角；输出为 read/write/audience footprint；目录外引用和未知 audience 归一化为 global read/write 并计数。
3. footprint 的读写冲突、观察关系和 global fallback 构成无向冲突图；每个连通分量独立进入 Truth。
4. 每个分量按 `perception → reaction-routing → resolution → transition` 推进。perception 和 resolution 可分轮预承诺 d20 或剧本声明的离散随机；reaction 只有一轮 keep/replace。
5. 引擎 materialize transition 的运行时身份，并注入唯一 `advance_time`。实际 operation 超出声明 footprint，或两个分量的实际读写交叉时，全体行动以 global footprint 重新裁决。
6. Observation Renderer 根据 transition 后状态、事件和每个 observer 的授权视角生成一人一槽的 observation。多个冲突分量合并后，以完整合并候选为所有 Agent 重新生成全局权限投影，不能让跨分量公共后果消失。模型不输出 observation ID、observer ID、step 或 kind；批次不得超过 Observation Profile 的输入字节预算。物化只保留 typed current-event 引用和合法的 observer-local claim；outcome alternative 只保留行动主体已有的 evidence。所有丢弃或解绑都进入 trace。repair 耗尽的多槽批次确定性二分，单槽最终使用只陈述结果状态与认知不确定性的 typed observation，并显式计数。
7. model Agent 接收自己的 observation 并执行 `BeliefPatch → CharacterPatch → nextAction`。语义 repair 耗尽时提交空 patch 与 typed idle next action，并增加 `mindFallbacks`；transport、配置、取消和 Ledger 失败不降级。external 和 idle Agent 只更新 observation bindings；新创建 Agent 在本步 bootstrap。
8. CanonicalCommitter 重新应用候选并验证全部不变量，构造 `CommittedStep` 和下一状态。

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

batch 在没有 external Agent 时连续调用步骤；遇到行动窗口即返回。realtime 严格串行，并在步骤终止后安排下一 tick。scheduler generation 使暂停、重新启用和重启前的 timer 失效；重启不补算离线时间。

## Participant 准入

Participant 以 principal 身份控制一个 external Agent。认领已有 Agent 只在 revision 边界完成；当时的 prepared action 作为历史承诺保留并记录 `suppressedActionId`，external 策略绝不收集或执行它。真人获得该 Agent 的角色视角和历史观察，但不会获得 bindings、其他 Agent 认知或 canonical truth。

Origin 准入确定性创建 Entity、Agent、placement、资源和自由动机 goal，并形成独立 admission revision。显示名称、外观和动机不能改变剧本的数值、出生点或资源。Arrival Generator 在准入提交后运行，只读该角色视角并返回标题、第一人称场景和三条建议；失败使用剧本回退文本，不能回滚准入。

释放时选择 model 或 idle。model 策略先以该角色控制期间收到的 observations 恢复 AgentMind，再参与下一联合行动。释放后的 Agent 可再次认领。

## 提交与重放

提交内核校验：状态 schema、revision、行动与 outcome 一一覆盖、唯一时间推进、随机顺序、causal refs、断言、世界引用、守恒、范围、placement、observation 权限、mind commit 覆盖、RNG 连续性、semantic hash 与历史 replay。

成功步骤的实例 CAS 与 execution terminal record 在一个 SQLite 事务中完成。失败只更新 advance 与 execution 诊断，不改变 canonical revision。canonical history replay 不调用模型；recorded execution replay 从 Execution Ledger 消费原始结构化响应并再次运行同一算法与提交内核。

相关边界见[系统架构](../architecture.md)、[剧本格式](script-format.md)、[Execution Ledger](runtime-observability.md)和[表现层](presentation.md)。
