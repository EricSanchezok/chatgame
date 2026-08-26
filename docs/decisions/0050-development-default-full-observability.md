# 本地开发默认完整运行时日志

## Status

Superseded by [0059](0059-unified-execution-kernel-and-ledger.md)
Class: process

## Context and Problem Statement

WorldRun 的失败与回滚不进入已提交步骤审计，只由运行日志保存。若本地开发沿用关闭日志的缺省值，真实模型结构化输出修复耗尽后只能看到最终校验摘要，无法复核每次 invocation 的 Context、模型输出、token、供应商请求身份与阶段耗时；开发者必须在问题发生前预见它并手动开启日志。

## Decision Drivers

- 本地真实模型失败第一次发生时就必须留下可关联的完整证据，不能依赖事后复现。
- 测试与生产不能因缺少显式配置而隐式记录玩家输入、世界秘密或大体积 payload。
- 显式配置必须始终覆盖缺省值，便于临时降级到 `metrics` 或关闭日志。
- 既有脱敏、有界轮转、degraded sink 与事务隔离契约必须保持不变。

## Considered Options

- 所有环境继续默认 `off`。
- 所有环境默认 `full`。
- 本地开发默认 `metrics`，其他环境默认 `off`。
- 本地开发默认 `full`，其他环境默认 `off`，显式配置优先——所选路线。

## Decision Outcome

`readRuntimeObservabilityConfig` 在 `LIVINGWORLD_OBSERVABILITY` 未设置且 `NODE_ENV=development` 时选择 `full`，在其他环境选择 `off`；显式的 `off|metrics|full` 始终优先。因此标准 `npm run dev` 自动同时写 stdout 与有界 NDJSON 文件，测试、构建和生产启动不会隐式生成完整 payload 日志。默认 observer 由进程级 `globalThis` 槽持有，Next 开发模块重新求值时复用同一 sink 和退出钩子。

事件协议、correlation、持久化 invocation audit、payload 所有权、凭证脱敏、文件轮转和 sink 降级继续遵守[运行时可观测性规格](../game-design/runtime-observability.md)。本地 full 日志属于敏感诊断数据，不是游戏历史；默认保留上限仍由文件 sink 契约约束。

### Consequences

- 首次出现的本地失败、取消和回滚可以直接按 run/step/model correlation 复盘。
- 本地开发会承担完整 payload 的序列化、终端输出与磁盘 I/O，复杂世界的日志可能较大。
- 开发者可以显式设置 `metrics` 获得性能基线，或设置 `off` 进行无日志对照。
- 生产部署若需要运行日志必须显式选择模式，并承担相应的敏感数据治理责任。

## Pros and Cons of the Options

### 所有环境默认关闭

- 好：没有隐式日志 I/O 或敏感 payload。
- 坏：不可提交的真实失败没有事后证据，最需要日志时往往尚未开启。

### 所有环境默认完整日志

- 好：任何环境都拥有最完整的诊断证据。
- 坏：测试与生产会在部署者未授权时记录大体积敏感内容，违背最小化原则。

### 本地开发默认 metrics

- 好：保留调用身份、耗时、token 与 hash，成本低于 full。
- 坏：仍看不到导致 schema 或语义拒绝的 Context 和结构化输出，不能独立复盘模型服从问题。

### 本地开发默认 full，其他环境默认 off

- 好：把完整证据放在最需要且数据仍留在本机的环境，同时保持测试与生产保守缺省。
- 坏：本地终端更嘈杂，复杂世界会增加序列化和磁盘开销，日志目录必须按敏感数据对待。

## Links

- [0043](0043-end-to-end-runtime-observability.md) — 事件协议、双模式 NDJSON 与 invocation audit 的原决策。
- [0049](0049-world-run-failure-and-stream-boundaries.md) — 失败、取消、回滚与重试边界。
- [运行时可观测性规格](../game-design/runtime-observability.md) — 当前模式缺省、payload、轮转与诊断契约。
- [开发指南](../development.md) — 本地启动与显式覆盖方式。
