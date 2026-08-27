# Inspector 把最后一个启动事件误报为失败原因

## Executive summary

一次真实推演在模型传输之后失败，但 Inspector 只显示 `model.transport.started`。Execution Ledger 记录了阶段事件和 execution 终态，却没有把终止异常作为同一条 durable terminal event 保存；Inspector 因而只能把最后一条普通事件当作摘要。并发批次抛出的 `AggregateError` 还会把成员异常压成一条外层消息。修复后，失败或取消 execution 的终态、完整错误树和 execution 更新在同一 SQLite 事务中提交，Inspector 只从这份持久证据生成失败原因。

## Summary

模型请求已经开始且后续步骤没有形成 Revision 时，Inspector 的尝试摘要读取 execution events 的最后一项。此前 `finishExecution` 把错误写入 execution artifact 和状态列，但不追加 `execution.failed` 事件，因此最后一项可能只是 `model.transport.started`。这条事件描述发生到了哪里，不是失败原因，却被 UI 当作失败原因展示。

## Timeline

1. Blackmarsh 推演启动多个模型调用并写入阶段事件。
2. 一个并发模型批次失败，步骤在 Canonical Commit 前回滚。
3. Ledger 将 execution 标记为 failed，但事件序列没有对应的 terminal error event。
4. Inspector 取事件序列末项，向用户显示 `model.transport.started`。
5. `finishExecution` 改为在同一事务内追加 terminal event、保存错误 artifact 并更新 execution；错误序列化同时保留有界的 `AggregateError.errors`。

## Root cause

Execution Ledger 对“execution 已终止”和“为什么终止”采用了两种不同的持久表达：状态在 `executions`，错误在 artifact，事件流没有终止原因。Inspector 的投影却以事件流为阶段事实源，在缺少 terminal event 时只能退化到最后一个非终止事件。测试只断言失败 execution 不提交 Revision，没有断言最后一条事件包含可读根因，也没有覆盖并发模型调用产生的 `AggregateError`。

## Guardrails

- [`local-database.ts`](../../src/server/local-database.ts)在一个 SQLite 事务中持久化 `execution.failed` 或 `execution.cancelled`、错误 artifact 和 execution 终态，事务提交后才向订阅者发布事件。
- [`observability.ts`](../../src/engine/observability.ts)保留有界的嵌套 cause 与 `AggregateError` 成员，避免并发失败只剩外层摘要。
- [`world-inspector.ts`](../../src/server/world-inspector.ts)从 terminal error tree 生成诊断文本，不再把最后一个阶段启动事件解释为失败原因。
- [`execution-ledger.test.ts`](../../src/server/__tests__/execution-ledger.test.ts)断言普通失败与进程恢复都以 durable terminal event 收尾；[`observability.test.ts`](../../src/engine/__tests__/observability.test.ts)覆盖聚合错误成员。
