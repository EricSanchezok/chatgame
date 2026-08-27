# Eager Reference 执行算法

## Status
Accepted
Class: architecture

## Context and Problem Statement

`monolithic-current` 激活所有主体，却要求单次 transition 输出全部 outcome、世界修改和观察。Blackmarsh 的 48 个行动已经使输出槽位遗漏、修复上下文膨胀，并让私有认知 ID 混入 canonical 因果引用。该实现既不可靠，也不能作为后续稀疏算法的精确参考。

## Decision Drivers

- Eager reference 必须昂贵但可执行，不能把结构完整性交给大模型记忆。
- 所有存活自主 Agent 都要决策、获得观察并更新心智。
- 私有认知只进入所属 Agent 的行动处理上下文。
- 独立分量可以分别裁决；无法证明独立时必须保守合并。
- outcome、时间推进和运行时身份必须由引擎拥有。

## Considered Options

- 保留单一大 prompt 并增加 repair。
- 用规则或摘要近似场外行动。
- 按行动 grounding、冲突分量、分批观察和一次全局提交执行——所选路线。

## Decision Outcome

唯一内置算法为 `eager-reference@1`。它收集全部 model/external/idle/replay 行动，为每个行动预分配 outcome slot，以 actor 私有视角分别 grounding，并产出保守 read/write/audience footprint。目录外读写、未知 audience 和不一致的 global 声明由引擎归一化为 global read/write；模型篡改 action 或 actor 身份仍然拒绝。

footprint 相交的行动构成冲突分量。每个分量独立执行检定、随机承诺、resolution 与 transition；实际 operation 超出声明 footprint 或分量结果发生交叉时，全部行动以 global footprint 重新裁决。引擎补入唯一正数 `advance_time`，按预分配 slot 校验每个行动恰好一个 outcome。

观察由候选事实按观察者分批物化，批次受 Profile 输入字节预算限制。多个独立冲突分量合并后，Observation Renderer 使用完整合并候选为所有 Agent 重新生成一次权限受限的全局投影，保证跨分量公共后果不会因局部裁决而消失。typed catalog 将 canonical Fact、Entity、Action、Event 与私有 claim/evidence/goal 分开，因果 schema 不能引用私有目录。物化时只保留 typed current-event 引用和观察者局部实体图可容纳的 apparent claim；无法绑定的 canonical introduction 降为未绑定局部实体。outcome alternative 只保留行动主体确实持有的 evidence，失去全部依据的 alternative 被删除。所有归一化都写入 trace。观察批次语义 repair 耗尽时确定性二分；单槽仍耗尽时生成只陈述结果状态和认知不确定性的 typed observation，并计为 fallback。

所有自主 Agent 执行 AgentMind；external 与 idle Agent 不执行。单个 Agent 的语义 repair 耗尽时，引擎保留其现有私有状态、提交空 patch，并生成 typed idle next action；网络、取消、配置和 Ledger 失败仍终止整步。该 fallback 作为 `mindFallbacks` 显式记录，不伪造信念，也不回滚其他主体的合法更新。固定 CanonicalCommitter 最后进行全局验证并原子提交。

### Consequences

- 参考算法的模型工作随存活自主 Agent 和实际冲突增加，故意不优化激活成本。
- 每个模型响应的结构上界受分量或观察批次限制，不再随整个世界动作数一次增长。
- 局部独立性判断错误不能静默改变语义；其安全出口只能是扩大分量。
- 无效引用与个体 repair fallback 都是可计数的保守降级，实验必须同时报告，不能把它们当作无损成功。
- 稀疏、缓存、复用与近似算法可用同一 Candidate/Committer/Ledger 与本算法比较。

## Pros and Cons of the Options

### 单一大 prompt

- 好：调用次数少，沿用现有 Truth 流程。
- 坏：结构长度集中、repair 全局化，已经在真实世界中失败。

### 场外近似

- 好：成本低。
- 坏：不能作为 exact reference，会提前改变具名 Agent 语义。

### 分量化 eager reference

- 好：输出有界、错误局部、保留全量语义并提供可靠比较对象。
- 坏：模型调用多，保守 fallback 仍可能形成昂贵全局分量。

## Links

- [0059](0059-unified-execution-kernel-and-ledger.md) — 算法契约、提交器和 Ledger。
- [0060](0060-model-output-field-ownership.md) — 模型与引擎字段所有权。
- [0061](0061-unified-agent-and-external-policy.md) — 策略 roster。
- [事故复盘 0029](../postmortems/0029-blackmarsh-monolithic-transition-repair-exhaustion.md) — 真实失败样本。
