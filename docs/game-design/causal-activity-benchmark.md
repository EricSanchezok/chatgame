# 因果 Activity Benchmark 参考

该 benchmark 评估 Living World Engine 自己拥有的时间、因果、并发和恢复语义。外部 Agent benchmark 只补充底层模型能力，不能替代本引擎的系统评估。

## 报告契约

报告固定分成语义、模型成本、计算性能和玩家等待四栏，不合成单一分数。

| 栏目 | 指标 |
|---|---|
| 语义 | 场景通过率、affected-Activity recall、错误激活率、因果顺序违规、replay hash 一致性 |
| 模型成本 | 调用数、输入/输出 token、估算费用、repair 次数 |
| 计算性能 | p50/p95 执行时间、峰值 heap、artifact 字节、footprint 查询数、最大冲突分量 |
| 玩家等待 | 单独记录 reaction window 等待时间，不计入算法执行耗时 |

CI 硬门槛为语义场景通过率 100%、affected recall 100%、错误激活和因果顺序违规为零、replay hash 完全一致、无关 occupied Agent 的 AgentMind 调用为零。墙钟性能在非固定硬件上只记录基线，不设易抖动的硬阈值。

## 场景矩阵

确定性 footprint benchmark 覆盖 Agent 数量 `1 / 10 / 50 / 1000`、冲突密度 `zero / sparse / dense / global_fallback` 和 Activity 类型 `short / long / staged / conditional / ongoing`。每个查询同时使用倒排索引与穷举 oracle；二者集合必须完全一致。

引擎语义测试覆盖以下边界：独立睡眠与两秒行动、可感知 onset reaction、1 秒与 5 秒 replacement、不可感知的事后决策、不可中断 Activity、continuation assertion 被写入破坏、同时到期、Timer/Condition context、外部反应超时、重启、artifact 损坏、陈旧提交和 recorded replay。

运行完整矩阵：

```sh
npm run benchmark:causal
```

缩小 Agent 数量用于本地迭代：

```sh
npm run benchmark:causal -- --agents 1,10,50
```

`scripts/causal-activity-benchmark.ts` 输出 schema v1 JSON。通用执行成本实验继续使用 `npm run experiment:run` 和同一 Execution Ledger；二者不维护第二套运行语义。
