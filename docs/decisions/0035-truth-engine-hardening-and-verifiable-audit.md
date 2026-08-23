# Truth Engine 硬化与可验证审计

## Status

Accepted
Class: architecture

## Context and Problem Statement

开放行动内核已经把玩家企图与状态写入分离，但仅依赖模型提示无法证明联合冲突公平、失败反馈不泄密、披露策略生效或运行审计足以复核预承诺检定。WorldRun 的公开记录与服务端记录也需要不同投影，才能同时保留诊断证据并避免把 canonical identity 暴露给玩家。

## Decision Drivers

- 同一组联合行动的语义不得受输入数组排列影响。
- 公开 observation、outcome、检定和失败事件不得包含 canonical identity、私密事实或其他 Agent 的信念。
- 每个已提交步骤必须保存完整检定请求、模型配置、尝试次数和内容 hash，但不保存思维链。
- 世界披露策略、行动替代依据和因果引用必须由硬内核验证，而不是只写进 prompt。
- 一个会话在启动和重试路径上都只能拥有一个活动 run。
- 首版 20–50 Agent 与所有指定自由行动场景必须由确定性测试和真实入口测试证明。
- 规则扩展必须通过受信任的服务端规则包注册表进入世界，世界 ZIP 不得携带可执行代码。

## Considered Options

- 保持提示词约束，把模型输出视为可信。
- 记录完整 prompt、响应和服务端错误供调试。
- 为每个题材继续向核心增加专用战斗与移动 handler。
- 结构化依据、公开信息守卫、服务端审计投影与规则包注册表——所选路线。

## Decision Outcome

联合行动在进入 Truth Engine 前按 actor 和 proposal identity 规范排序；事务仍把所有行动作为同一 revision 的整包处理。玩家失败替代方案携带玩家证据或本步 observation 依据，内核验证引用后才允许提交。

`CommittedStep` 保存完整 `D20CheckRequest` 与 `D20CheckResult`，并保存 Truth Engine 和各 AgentMind 的 `ModelExecutionAudit`。WorldSession 审计以 invocation 明细包含 catalog/prompt 版本与 hash、provider/model/profile、原生推理配置、角色、主体、Context 计量、transport、token、finish reason、provider request ID、语义结论及请求/响应 SHA-256，不持久化密钥、prompt、原始响应或思维链。显式 full 运行日志是独立、有界的本地诊断表面，由 [0043](0043-end-to-end-runtime-observability.md) 定义。

公开信息在提交前经过边界守卫，拒绝 canonical ID、未公开私密事实和其他 Agent 私密认知出现在玩家 observation/outcome 中。服务端失败详情只写入持久化内部记录；API 与 SSE 使用稳定的公开错误，不返回内部标识符。检定公开 ID 由宿主生成，不复用模型提供的内部 request ID。

持久化 run event 使用逐类型 strict schema，额外字段也会使存档拒绝加载，重签 checksum 不能把 canonical binding 混入 SSE。非预期 HTTP 500 只返回稳定公开消息；世界导入校验错误保留可操作细节但移除服务器暂存路径。

世界的检定披露配置是最大可见级别，Truth Engine 不能声明更公开的结果。规则包由服务端 `RulePackageRegistry` 注册，剧本只声明包 ID、版本和 JSON 配置；首版提供 `core-d20`，世界包不能加载代码。

WorldRun 保存对应 intent identity；启动和重试都验证会话没有其他活动 run，且重试只能继续同一 intent。POST run 只返回 run ID，GET run 返回 run 与公开会话状态的组合快照。

模型 provider、profile、原生推理、严格结构化输出与队列由 [0036](0036-multi-provider-model-gateway-and-fair-scheduler.md) 定义；审计不保存密钥或原始内容。

### Consequences

- LLM 仍负责开放语义，但输出必须携带可验证的认知依据和审计元数据。
- 信息守卫只能验证结构化引用和确定性秘密标记；更复杂的语义泄漏仍由发布门禁中的对抗场景补充。
- 规则包必须预先部署在服务端，世界作者不能通过 ZIP 执行代码。
- 更严格的校验会增加模型修复次数，但非法步骤保持原子回滚。

## Pros and Cons of the Options

### 只依赖提示词

- 好：实现简单，结构化输出最小。
- 坏：无法把公平、披露、认知依据和防泄漏作为可测试不变量。

### 保存完整模型内容

- 好：调试信息最丰富。
- 坏：会持久化玩家文本、世界秘密甚至模型私有推理，不符合最小披露原则。

### 增加题材专用 handler

- 好：单个玩法可以快速得到确定性实现。
- 坏：重新形成固定动作和机制白名单，破坏剧本驱动的通用内核。

### 结构化依据、审计投影与规则包注册表

- 好：开放语义与可验证提交并存，安全边界和重放证据可由测试证明。
- 坏：共享契约、存档和测试矩阵更严格，世界与模型输出需要提供更多结构。

## Links

- [0031](0031-epistemic-multi-agent-truth-engine.md) — 多 Agent 信念世界与联合裁决。
- [0032](0032-open-world-facts-and-d20-kernel.md) — 开放事实与通用数值内核。
- [0033](0033-persistent-streaming-world-runs.md) — WorldRun 与公开流式边界。
- [0034](0034-truth-engine-verification-matrix.md) — 验证矩阵。
- [0043](0043-end-to-end-runtime-observability.md) — 端到端运行事件与 invocation 审计。
- [引擎运行时规格](../game-design/engine-runtime.md) — 当前运行时契约。
