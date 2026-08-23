# 检定 modifier source 命名空间冲突

## Executive summary

d20 修正来源只保存裸 ID，而 Rating 与 Fact 是两个独立状态表；同一 ID 同时存在时，校验无法证明模型引用哪一个，也可能把合法的两个来源误判为重复。根因是 DTO 抹掉了来源类型，后续代码只能按查找顺序猜测命名空间。护栏是 `{kind,id,amount}` 判别联合、按 `(kind,id)` 去重、按 kind 精确查值，以及同名 Rating 与数值 Fact 同时参与一次检定的回归测试。

## Summary

开放事实内核允许世界作者自由命名 Fact 和 Rating，它们没有全局共享 ID 空间。旧 modifier source 契约却只传 ID 与数值；Truth Engine 校验和历史审计无法区分 `ratings[id]` 与 `facts[id]`，因此契约在合法世界状态下存在歧义。

## Timeline

1. 通用 d20 协议允许 Rating 和数值 Fact 提供修正。
2. modifier source DTO 只记录 `{id, amount}`，隐含假设两个表不会同名。
3. 世界 schema 没有也不应强制跨类型全局唯一，因此该假设没有可执行约束。
4. 审计构造同名 Rating/Fact 后证明裸 ID 无法表达两个合法来源。
5. 来源升级为判别联合，模型 schema、实时校验和历史校验统一采用类型化身份。

## Root cause

数据模型在状态层保留了命名空间，在跨模型和审计 DTO 层却把它压平。测试分别覆盖 Rating 修正和非法 Fact 修正，没有把两种来源放在同一个 ID 冲突夹具中，所以查找顺序带来的歧义没有出现。

## Guardrails

- [决策 0032](../decisions/0032-open-world-facts-and-d20-kernel.md) 明确 modifier source 以 kind 与 ID 共同标识。
- [`llm-schemas.ts`](../../src/engine/llm-schemas.ts) 只接受 `rating`/`fact` 判别联合。
- [`truth-engine.ts`](../../src/engine/truth-engine.ts) 按 kind 读取精确状态表，并核对 amount 与 modifier 总和。
- [`multi-agent-simulation.test.ts`](../../src/engine/__tests__/multi-agent-simulation.test.ts) 让同 ID Rating 与 Fact 同时合法贡献一次检定。
