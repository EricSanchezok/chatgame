# 端到端运行时可观测性与 invocation 审计

## Status

Superseded by [0059](0059-unified-execution-kernel-and-ledger.md)
Class: architecture

## Context and Problem Statement

模型 Context、历史、Agent 数与存档会随世界运行增长，但只看成功存档中的聚合模型计数无法定位增长来自哪个 Context 分区、哪次 transport、哪段事务或哪次失败回滚。优化 Context 之前需要一条能贯通 HTTP、SSE、WorldRun、世界步骤、模型、校验和持久化的诊断证据链，同时保持游戏公共协议和事务语义不变。

## Decision Drivers

- 成功提交需要可复核的细粒度模型调用事实，失败与回滚也必须留下关联证据。
- 性能测量不能默认承担完整 payload 的 I/O 成本，流程复盘又需要显式可选的本地完整内容。
- Context 字节、分区、对象计数、真实 token、queue、transport、retry 与语义 repair 必须区分。
- 日志必须有界、可降级、不会因运行期 sink 故障回滚世界事务，也不能误删目录内其他文件。
- API key、认证材料、环境变量、ZIP 二进制和不可见思维链不能进入任何观测表面。
- 当前单进程 WorldHost 不需要分布式 collector 或额外日志依赖。

## Considered Options

- 直接优化 Context，不先建立基线。
- 只扩展 WorldSession 聚合审计。
- 把完整 prompt 与响应持久化进 WorldSession。
- 立即接入 OpenTelemetry 与外部 collector。
- 可注入统一事件协议、metrics/full NDJSON 与持久化 invocation audit——所选路线。

## Decision Outcome

服务端使用可注入 `RuntimeObserver` 发出 schema v1 事件。事件以 correlation ID 串联 request、session、run attempt、step attempt、model invocation 与 transport attempt；no-op、recording 和 stdout+file NDJSON 实现共享同一协议。默认关闭，`metrics` 保存大小、计数、耗时、状态与 hash，`full` 只在拥有边界增加关键应用 payload。

运行日志覆盖成功、失败、取消和回滚。Full 日志是显式启用、有界轮转的本地诊断表面；WorldSession 审计不保存 raw/full payload。错误使用白名单投影，认证材料、任意环境变量、ZIP 内容和思维链不记录。

`ModelExecutionAudit` 以 `invocations[]` 作为单一事实源，每个 invocation 保存请求/响应 hash 与字节、规范 Context 及顶层分区、对象计数、transport attempts、真实 usage、供应商结果与语义结论。汇总由 helper 派生。成功 bootstrap 和步骤持久化这些 invocation；失败步骤只保留运行日志。世界剧本使用 schema v6，`SimulationState` 使用 schema v8，`WorldSessionDocument` 使用 schema v9；旧运行态与会话直接拒绝且没有迁移路径。

启用日志同时写 stdout 与按启动时间/PID 命名的 NDJSON 段。单事件不拆分，超大事件独占段；目录按总字节删除最旧的 `livingworld` 日志段，不处理其他文件。初始化 sink 失败阻止启动；运行期文件 sink 失败进入 degraded 并继续 stdout，轮转与关闭输出健康统计。

确定性诊断命令复用真实 Simulation、Context builder 与持久化校验，只替换远程模型边界；真实模型采样显式运行且不进入 CI。两者 stdout 都是 NDJSON 并以 `diagnostic.summary` 结束。

### Consequences

- 可以先用证据定位 Context、模型、校验或存档瓶颈，再单独决策截断、摘要、检索或预算策略。
- Metrics 模式适合作为性能基线；full 模式的额外序列化和 I/O 属于诊断成本，不用于基线比较。
- 带完整 invocation ledger 的存档比聚合审计更大，但不重复保存汇总或原始内容。
- 本地 full 日志可能包含玩家输入和世界秘密，部署者必须把日志目录视为敏感数据并依赖有界轮转管理保留期。
- 未来 collector 可以替换 sink，业务埋点和 correlation 契约保持不变。

## Pros and Cons of the Options

### 直接优化 Context

- 好：能立即减少某个已知调用的输入。
- 坏：没有增长曲线和阶段证据，容易优化错瓶颈，也无法验证语义与性能影响。

### 只扩展 WorldSession 聚合审计

- 好：实现面较小，成功历史可长期查询。
- 坏：看不到失败、回滚、HTTP/SSE、transport retry 与存档阶段，聚合字段还会与调用明细漂移。

### 持久化完整 prompt 与响应

- 好：单一存档可直接复盘模型内容。
- 坏：把玩家输入与世界秘密永久绑定到游戏历史，存档无界增长且扩大公开投影误泄漏风险。

### OpenTelemetry 与外部 collector

- 好：拥有成熟的 span、exporter 与集中查询生态。
- 坏：当前单进程产品需要新增依赖和部署面，且仍要先定义游戏专用 payload、审计与脱敏契约。

### 统一事件、双模式 NDJSON 与 invocation audit

- 好：成功与失败拥有同一关联证据，性能基线和流程复盘分离，sink 可替换且不改变游戏语义。
- 坏：需要跨服务端链路埋点、运行态/会话 schema 破坏性升级和严格的本地日志保护策略。

## Links

- [0038](0038-project-rename-to-living-world-engine.md) — 环境变量、数据目录与文件名前缀。
- [0033](0033-persistent-streaming-world-runs.md) — WorldRun、持久化与 SSE 边界。
- [0035](0035-truth-engine-hardening-and-verifiable-audit.md) — 已提交步骤审计与公开信息边界。
- [0036](0036-multi-provider-model-gateway-and-fair-scheduler.md) — 模型 Gateway、调度和供应商语义。
- [0042](0042-causal-assurance-and-staged-model-profiles.md) — 分阶段 Truth 调用点与运行态 schema 基线。
- [0050](0050-development-default-full-observability.md) — 本地开发默认启用完整运行日志。
- [运行时可观测性规格](../game-design/runtime-observability.md) — 当前事件、模式、轮转、审计与诊断契约。
