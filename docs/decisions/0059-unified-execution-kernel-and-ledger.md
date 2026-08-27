# 统一执行内核与 Execution Ledger

## Status

Accepted
Class: architecture

## Context and Problem Statement

世界步骤原先由 `SimulationEngine` 直接装配 TruthEngine 与 AgentMind，并把模型审计写入 canonical history；失败证据另存为可轮转 NDJSON。正常运行、Inspector 和规模诊断因此依赖不同的数据寿命与查询路径，也没有稳定的算法替换边界。

## Decision Drivers

- 算法只能提出候选结果，不能直接写 canonical state。
- 世界提交必须继续验证引用、守恒、因果、观察权限、认知隔离和完整状态，并保持原子性。
- 正常运行、失败诊断、实验、比较与重放必须共享同一执行身份、事件协议和持久证据。
- 模型请求必须在发送前持久化，响应必须在算法消费前持久化；关键记录失败必须阻止提交。
- 聚合指标不能以 Agent、session、run、event 或 invocation ID 为维度。
- 首个算法提供结构可靠的全量 eager reference，不冒充稀疏算法。

## Considered Options

- 保留固定执行链，只增加更多日志字段。
- 保留 canonical model audit 与 NDJSON，并另建实验数据库。
- 引入外部 OpenTelemetry Collector 与 MLflow 作为运行前置依赖。
- 采用可替换算法、固定提交内核与 SQLite Execution Ledger——所选路线。

## Decision Outcome

`WorldExecutionAlgorithm` 是唯一候选生成契约，入口为 `bootstrap` 与 `step`。`AlgorithmManifest` 固定算法、版本、配置、组件和规范化 hash；算法注册通过 registry 完成。`CanonicalCommitter` 独立重放候选操作、Observation 和 mind commit，验证成功后才构造下一状态。唯一内置算法 `eager-reference@1` 激活全部 model Agent，逐行动 grounding，按冲突分量执行分阶段 Truth，向全部主体物化 Observation，并更新全部 model Agent 的私有状态。

`LocalDatabase` 同时实现唯一 `ExecutionLedger`。`executions` 保存执行身份、复现配置、状态与语义结果；`execution_events` 保存全局 sequence、trace/span/link、阶段、计数、测量和 artifact 引用；`execution_artifacts` 保存以内容 hash 寻址的 gzip canonical JSON。正式 writer 固定为 full 且 critical，使用至多 64 个事件的有界缓冲和单事务批量写入。模型请求在 transport 前、模型响应在算法消费前、候选结果在提交内核消费前强制落盘；成功、回滚和 execution 结束前也必须清空缓冲。写入异常会传播到当前执行，进程中断后遗留的 running execution 在下次取得数据库租约时标记为 failed。

World Instance 不保存模型审计副本。`CommittedStep.semanticHash` 只覆盖 transition、observation 与 mind 的语义产物；成功原子提交再附加 `{executionId, terminalEventSequence, traceHash}`，`contentHash` 覆盖语义与该引用。模型请求、响应、配置、调用身份和失败材料只以 execution ID 在 Ledger 中寻址。Inspector 从候选 artifact 投影模型详情，不产生第二个事实源。

interactive、diagnostic、benchmark 和 replay 使用同一 Ledger。`experiment:run` 创建 benchmark 父 execution 与 trial 子 execution。`execution:replay` 逐次消费已存模型输出，重新运行同一算法与固定 committer，不访问网络；`execution:compare` 按 transition、observation 和 mind 分区比较；`execution:export` 导出 manifest、原始事件、artifact 索引、派生指标和 span/work。Inspector 服务端从 Ledger 查询，前端契约不新增实验界面。

`WorldInstanceDocument` schema 为 v12。旧实例文档不迁移；旧数据目录保持原样，运行新版本时使用新的 data root。NDJSON sink、轮转索引和 `off|metrics|full` 产品配置被删除。

### Consequences

- 算法替换不需要修改 WorldHost、提交规则或持久化表。
- 全量 prompt、response 和候选结果会增加本地 SQLite 体积；这是可重放证据的明确成本。
- 当前算法的模型工作仍随 Agent 总数增长；Ledger 会如实记录全部 activated 与 updated Agent。
- 墙钟耗时保留为运行条件；调用、token、字节、work/span 与产物基数是跨机器比较的主要工作量指标。

## Pros and Cons of the Options

### 固定执行链加字段

- 好：改动小。
- 坏：算法无法独立替换，提交权限与候选生成继续耦合。

### 三套持久证据

- 好：可以分别优化游戏存档、日志和实验格式。
- 坏：同一调用存在不同事实来源，失败与淘汰会使实验和 Inspector 无法复核。

### 外部观测与实验服务

- 好：直接获得成熟 UI 和聚合能力。
- 坏：本地引擎启动依赖外部服务，原子 session/execution 提交与完整离线重放仍需自建协议。

### 固定提交内核与统一 Ledger

- 好：候选生成、合法提交和执行证据边界清晰；正常运行与研究命令共享材料。
- 坏：SQLite 写放大和 schema 复杂度增加，正式执行不能关闭完整记录。

## Links

- [0031](0031-epistemic-multi-agent-truth-engine.md) — 认知隔离与唯一 truth。
- [0041](0041-local-sqlite-runtime.md) — 本地 SQLite 运行时。
- [0043](0043-end-to-end-runtime-observability.md) 与 [0050](0050-development-default-full-observability.md) — 被本决策取代的双链与可选日志设计。
- [0055](0055-trusted-world-evolution-inspector.md) — Inspector 只读边界。
- [0060](0060-model-output-field-ownership.md) — 模型 draft 与运行时字段所有权。
- [运行时可观测性](../game-design/runtime-observability.md) — 当前 Execution Ledger 规格。
