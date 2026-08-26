# Execution Ledger

Execution Ledger 是正常运行、失败诊断、Inspector、实验和重放的唯一执行证据。它与世界版本和 WorldSession 共用 `livingworld.sqlite`，不使用 NDJSON、日志轮转或独立实验数据库。

## 存储

`executions` 保存 execution kind、父 execution、session/run/step、算法 manifest、world/code/model/seed/runtime 配置、状态、semantic hash、state hash 和 commit revision。

`execution_events` 使用全局递增 sequence，保存 `traceId`、`spanId`、`parentSpanId`、links、阶段、correlation、耗时、标量属性、计数、测量、hash 与 artifact 引用。

`execution_artifacts` 以 canonical JSON 的 SHA-256 寻址，以 gzip BLOB 保存完整模型请求、响应、世界定义、候选结果、验证问题和错误。凭证字段在进入 Ledger 前由运行时脱敏。正式 writer 使用至多 64 个事件的有界缓冲和单事务批量写入；模型请求在 transport 前、响应在返回算法前、候选结果在提交内核消费前强制落盘，成功、回滚和 execution 结束前也必须清空缓冲。正式 writer 为 critical，写入失败会终止 execution；进程中断留下的 running execution 在下次数据库启动时标记为 failed。Ledger 自身的 artifact 原始/压缩字节与 SQLite 写入耗时直接附加到当前事件，不递归产生观测事件。

execution kind 只有 `interactive | diagnostic | benchmark | replay`。Benchmark 是父 execution 与 trial 子 execution，不拥有另一套事件或结果格式。

## 执行边界

`WorldExecutionAlgorithm` 只生成 `BootstrapCandidate` 或 `WorldStepCandidate`。`CanonicalCommitter` 独立验证候选并构造下一状态。`monolithic-current@1` 激活和更新全部存活 Agent，完整调用现有 Truth 与 AgentMind；它是可运行实现，不是稀疏算法或论文 baseline。

正式 WorldHost 为 bootstrap 和每个世界步骤建立 execution。成功时 WorldSession CAS 与 execution terminal record 在同一 SQLite 事务内完成；失败、取消、模型 repair 耗尽或关键记录写入失败均不推进 revision。session schema 为 v10；v9 不迁移。

原子事务在 terminal event 固定后生成 `{executionId, terminalEventSequence, traceHash}`。`traceHash` 覆盖事件身份、DAG、属性、计数、correlation、错误与 artifact 引用；运行时长和资源测量不进入该 hash，避免非确定性计时改变执行身份。bootstrap 保存 `bootstrapExecutionRef`，每个 `CommittedStep` 保存自己的 `executionRef`；`contentHash` 覆盖该引用，`semanticHash` 排除它，从而既能比较算法语义，也能验证执行证据链。

## 事件与指标

稳定阶段包括 activation、Truth 各阶段与 commitment round、reaction、transition/observation validation、每个 AgentMind、canonical validation、原子持久化、模型 invocation、transport retry 与 semantic repair。稳定的 trace/span/parent/link 表达执行 DAG；导出器从 span 推导总 work、最大深度与关键路径。主体、session、run、event 和 invocation ID 只用于 trace，不进入聚合指标维度。

`MetricDefinitionRegistry` 是指标名称、单位、聚合和允许维度的唯一登记处。指标从原始事件派生，不另存结果真相。当前覆盖：

- persistent、eligible、activated、skipped、reused、noop、updated Agent；
- actions、reactions、checks、random、outcomes、operations、events、observations、mind commits；
- dependency 节点、边、分量、最大分量和 fallback 预留槽；
- logical call、transport、repair、token、cache、请求/响应字节、queue/execution/retry work；
- CPU、RSS、heap、event-loop 与 SQLite 写入；
- rollback、废弃调用、semantic hash、state hash 和复现身份。

墙钟耗时用于描述运行条件。跨机器的主要算法工作量是调用、token、字节、模型 execution work、阶段 span 和语义产物基数。

## Inspector

Inspector 前端契约保持不变。服务端从 Ledger 按 session 查询事件，并按需解压 artifact；窗口与摘要不内联大型 payload。已提交图谱仍由 canonical history 重放派生，attempt、失败和模型详情由同一 Ledger 投影。

## 研究命令

```sh
npm run experiment:run -- --agents 1,10,50,1000 --steps 1 --database <sqlite>
npm run execution:replay -- <execution-id> --database <sqlite>
npm run execution:compare -- <left-id> <right-id> --database <sqlite>
npm run execution:export -- <execution-id> --database <sqlite> [--output <json>]
```

`experiment:run` 使用生产 Gateway 与确定性 transport boundary，不访问网络。每个矩阵 trial 记录完整模型输入输出和候选材料。`execution:replay` 以原 execution 为父 execution，逐次消费已记录模型输出，重新运行同一算法与固定 committer，不调用网络；命令同时验证 semantic hash 和 state hash。`execution:compare` 按 transition、observation 与 mind 分区报告差异。`execution:export` 输出 manifest、原始事件、artifact 索引、派生指标与 span/work 摘要。

随机实验以独立 world/seed 为重复单位；算法比较使用稳定随机键与配对运行，不能把同一世界中的 Agent 当成独立样本。

决策依据见 [0059](../decisions/0059-unified-execution-kernel-and-ledger.md)、[0055](../decisions/0055-trusted-world-evolution-inspector.md) 与 [0057](../decisions/0057-failure-aware-world-inspector.md)。
