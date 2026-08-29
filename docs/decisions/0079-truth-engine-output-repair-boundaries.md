# Truth Engine 输出修复边界

## Status
Accepted
Class: architecture

## Context and Problem Statement

Truth Engine 的模型输出同时承担语义提案、mechanic 输入、冲突范围和 observer 渲染。未知或 private 引用曾被归一化为 global dependency，批量结构错误会重复生成已经合法的 slot，过时 mechanic 字段只能在可信规则执行时暴露，observer 的隐私错误会拖累同批次主体。该行为扩大了错误影响面，也让性能、语义和失败原因无法分别测量。

## Decision Drivers

- 保留开放世界的自然语言自由度、完整上下文和可信规则执行。
- 让结构、引用、mechanic、privacy、causal 和 transport 错误拥有独立责任边界。
- 并发执行独立工作项，保持 canonical 提交原子性和 replay determinism。
- 让真实全局语义继续获得全局联合裁决，不以性能为由强制拆分。

## Considered Options

- 继续把未知引用和 repair exhaustion 统一升级成 global fallback。
- 用上下文裁剪、摘要或 singleton fallback 降低每次模型负担。
- 采用完整上下文、运行时契约 preflight、目标级 semantic repair、observer 独立槽位和保守组件边界。

## Decision Outcome

采用第三种方案。`globalFallback` 只有 canonical global reference 通过校验时成立；未知、模糊、private 或不一致引用产生局部 repair issue。Action Compilation 保留已验证 slot，并在原始结构化输出能定位时只重试失败 slot。RulePackageRegistry 暴露不含配置和可执行代码的输入 JSON contracts，TruthEngine 在可信规则执行前按 invocation preflight，旧字段只修复该 invocation。

Resolution plan verifier 以 finding 的最小 plan target 生成 replacement 并重新验证，尚未接受的 plan 不提交随机承诺。Causal verifier 只在 finding 仅影响 observation 且目标存在时重渲染目标 observer；不能证明局部安全的 finding 仍由当前组件或整步原子失败承担。Observation Renderer 为每个 observer 并发提交完整授权上下文，独立记录 audit 和 repair，失败后只生成 typed uncertainty observation。

所有 semantic repair 都保留完整上下文，不 truncate、slice、summary、top-K 或隐式字段删除；超出 `max_input_bytes` 直接抛出 `ContextLimitExceeded`。transport failure 与 structured-output rejection 分别写入 telemetry，repair orchestration 不决定组件或整步 disposition，由拥有候选的 canonical caller 决定。

## Pros and Cons of the Options

### Global fallback for every unknown reference

- 好：调用路径简单，短期内可能减少分量数量。
- 坏：把模型质量错误误判成世界语义，造成全局串行和无关 action 重算；无法保持局部失败隔离。

### Context reduction or singleton fallback

- 好：单次请求较小，部分 provider 成本较低。
- 坏：丢失语义证据、降低自由度和正确性，并隐藏真正的 context-limit 根因。

### Contract-aware local repair with conservative components

- 好：完整语义可见，修复责任可定位，独立工作项并发，真实 global 仍安全；错误与性能指标可分别观察。
- 坏：普通场景调用次数增加，真实 global 或无法证明独立的 component 仍承受联合裁决长尾。

## Links

- [0010 Truth Engine 输出质量与局部 Repair 分层](../specs/0010-truth-engine-output-repair.md)
- [0063 Eager-reference 执行算法](0063-eager-reference-execution.md)
- [0060 Model-output 字段所有权](0060-model-output-field-ownership.md)
- [0059 统一执行内核与 Ledger](0059-unified-execution-kernel-and-ledger.md)
