# Execution Ledger

Execution Ledger 是正常演化、失败诊断、Inspector、实验和重放的唯一执行证据。它与世界版本和 World Instance 共用 `livingworld.sqlite`，不使用 NDJSON、日志轮转或独立实验数据库。

## 存储

`executions` 保存 execution kind、父 execution、instance/run/step、算法 manifest、world/code/model/seed/runtime 配置、状态、semantic hash、state hash 和 commit revision。

`execution_events` 使用全局递增 sequence，保存 `traceId`、`spanId`、`parentSpanId`、links、阶段、correlation、耗时、标量属性、计数、测量、hash 与 artifact 引用。

`execution_artifacts` 以 canonical JSON 的 SHA-256 寻址，以 gzip BLOB 保存完整模型请求、响应、世界定义、候选结果、验证问题和错误。凭证在进入 Ledger 前脱敏。模型请求在 transport 前、响应在返回算法前、候选在提交内核消费前必须落盘；关键写入失败会终止 execution，revision 不前进。

writer 使用有界缓冲和 SQLite 批量事务。Ledger 自身的 artifact 字节、压缩字节与写入耗时直接附加到当前事件，不通过事件系统递归观测自身。进程中断遗留的 running execution 在数据库再次打开时标记为 failed。

execution kind 只有 `interactive | diagnostic | benchmark | replay`。Benchmark 是父 execution 与 trial 子 execution，不拥有另一套事件或结果格式。

## 执行边界

`WorldExecutionAlgorithm` 只生成 `BootstrapCandidate` 或 `WorldStepCandidate`。`CanonicalCommitter` 独立验证候选并构造下一状态。唯一内置算法 `eager-reference@1` 全量激活自主 Agent，按行动 grounding、冲突分量、分批 Observation 和 AgentMind 执行，最后只进行一次全局原子提交。

WorldHost 为 bootstrap、每个 WorldRun 时间边界和 Arrival 建立 execution。成功世界推进时，World Instance CAS、WorldRun revision 列表与 execution terminal record 在同一 SQLite 事务内完成；失败、取消、暂停、repair 耗尽、迟到结果或关键记录失败均不推进 revision。World Instance document schema 为 v15，旧实例不迁移。

原子事务在 terminal event 固定后生成 `{executionId, terminalEventSequence, traceHash}`。`traceHash` 覆盖事件身份、DAG、属性、计数、correlation、错误与 artifact 引用；运行时长和资源测量不进入该 hash。bootstrap 保存 `bootstrapExecutionRef`，每个 `CommittedStep` 保存自己的 `executionRef`；`contentHash` 覆盖引用，`semanticHash` 排除引用，从而分别验证证据链和算法语义。

## 事件与指标

稳定阶段包括策略激活、行动收集、grounding、依赖图、Truth 分量、commitment round、reaction、Observation batch、每个 AgentMind、canonical validation、原子持久化、模型 invocation、transport retry 与 semantic repair。稳定的 trace/span/parent/link 表达执行 DAG；导出器从 span 推导总 work、最大深度与关键路径。

`MetricDefinitionRegistry` 是名称、单位、聚合和允许维度的唯一登记处。Agent、Participant、Instance、Advance、Event、Component 和 invocation ID 只存在于 trace，不进入聚合指标维度。指标只从 Ledger 原始事件派生，不另存实验结果真相。

当前指标覆盖 Agent 数量与策略来源、ActionWindow 等待、TemporalPlan/Activity/边界与决策资格、语义产物基数、依赖图与冲突分量、模型调用/repair/token/cache/字节/work、阶段 DAG、CPU/RSS/heap/event-loop/SQLite、rollback 与废弃工作，以及算法/代码/世界/seed/model/runtime 的复现身份。

墙钟耗时用于描述运行条件。跨机器的主要算法工作量是调用、token、字节、模型 execution work、阶段 span 和语义产物基数。

## Inspector

Inspector 服务端按 World Instance 查询 Ledger，并按需解压 artifact；窗口和摘要不内联大型 payload。已提交图谱从 canonical history 重放派生，attempt、失败、模型调用与原始材料来自同一 Ledger。每个 step detail 公开受信任的 TemporalPlan、Activity/Timer snapshot、边界来源、动态 Δt、同刻到期集合、Activity 转换与决策点；未提交 attempt 明确保持 canonical clock 和 Activity progress 不变。

Inspector 是本地受信任调试表面。公开产品 DTO 和 Participant 视角不读取 Inspector 投影，也不能获得 canonical binding 或其他主体私有认知。

## 研究命令

```sh
npm run experiment:run -- --agents 1,10,50,1000 --steps 1 --database <sqlite>
npm run execution:replay -- <execution-id> --database <sqlite>
npm run execution:compare -- <left-id> <right-id> --database <sqlite>
npm run execution:export -- <execution-id> --database <sqlite> [--output <json>]
```

`experiment:run` 使用生产 Gateway 与确定性 transport boundary，不访问网络。每个 trial 记录完整模型输入输出和候选材料。`execution:replay` 逐次消费已记录模型输出并重新运行相同算法与 committer，不访问网络，同时验证 semantic hash 与 state hash。`execution:compare` 按 transition、observation 和 mind 分区报告差异。`execution:export` 输出 manifest、事件、artifact 索引、派生指标与 span/work 摘要。

随机实验以独立 world/seed 为重复单位；算法比较使用稳定随机键与配对运行，不能把同一世界中的多个 Agent 当成独立样本。

决策依据见 [0059](../decisions/0059-unified-execution-kernel-and-ledger.md)、[0063](../decisions/0063-eager-reference-execution.md) 与 [0064](../decisions/0064-conversation-core-and-agent-perspective-observer.md)。
