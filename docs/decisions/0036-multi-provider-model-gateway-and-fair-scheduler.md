# 多供应商模型目录、严格结构化输出与公平调度

## Status

Accepted
Class: architecture

## Context and Problem Statement

Truth Engine 与每个 AgentMind 需要独立选择 DeepSeek、OpenAI、xAI 或后续供应商的具体模型和原生推理配置。单一 OpenAI-compatible 环境变量、默认模型和静默 fallback 无法表达供应商差异，也会在模型停用或结构化输出失败时改变世界裁决者而不留下可验证证据。多 Agent 步骤的瞬时请求数还可超过供应商配额，需要全进程与供应商双层限流、会话公平性与整批原子性。

## Decision Drivers

- 每个 Agent 和 Truth Engine 都能显式选择模型，且不从角色或其他 Profile 推导默认值。
- 思考强度、JSON 协议和 API 形状保持供应商原生语义。
- 任何配置、密钥、结构化输出或供应商失败都显式失败，不切换模型或结构化结果。
- 高并发请求使用有界、可取消、按会话公平的队列，且 AgentMind 批次只能整体提交。
- 模型调用可审计；WorldSession 不持久化密钥、原始 prompt、原始响应或思维链，显式 full 本地运行日志由 [0043](0043-end-to-end-runtime-observability.md) 约束。

## Considered Options

- 继续使用一个 OpenAI-compatible provider 和环境变量 fallback。
- 对所有供应商暴露统一的 `reasoningEffort` 与任意 provider options。
- 不设队列，由 `Promise.all` 直接发出全部 HTTP 请求。
- 使用 Redis/BullMQ 分布式队列。
- `ModelCatalog → ModelGateway → FairModelScheduler → Provider Adapter` 单一链路——所选路线。

## Decision Outcome

`config/models.yaml` 是服务端模型目录。目录以 strict schema 声明 scheduler、provider 和 profile；profile 包含不透明模型 ID、用途、允许角色、超时、输出上限和供应商原生推理判别联合。目录在服务初始化时读取、校验、冻结并计算 hash；所有已配置 provider 的环境密钥必须存在。目录 schema v2 使用五个 Truth 角色与三个 Agent 角色；世界 schema v5 和 Agent 分别为每个调用点声明 Profile，加载、导入、会话恢复、动态 Agent 创建与调用都校验 Profile 存在性及精确角色兼容性。调用点拆分见 [0042](0042-causal-assurance-and-staged-model-profiles.md)。

`ModelGateway` 是唯一生产模型入口。DeepSeek V4 使用 Chat Completions、`json_object`、原生 `thinking/reasoning_effort` 与本地 strict Zod；OpenAI 和 xAI 使用 Responses API 与 strict JSON Schema，各自传入原生推理参数。公共 LLM schema 只使用三家稳定支持的严格对象子集，nullable 字段必须显式输出 `null`。网关不抢救 Markdown 或自然语言中的 JSON，也不执行模型别名、降级或供应商切换。

`FairModelScheduler` 在单服务进程内同时执行全局和 provider 并发上限。每个会话是一个 FIFO lane，lane 之间轮转；默认全局在途上限 16、最大排队 1024、等待上限五分钟。队列满或超时返回可重试过载错误；`AbortSignal` 移除排队任务并中止在途请求。网络、408、429 和 5xx 最多三次传输尝试，遵循 `Retry-After` 并使用指数抖动；400/401、schema 和业务错误不做传输重试。Truth/AgentMind 的语义修复独立计数，修复时传入结构化问题。所有 AgentMind 请求完整 settlement 后才统一应用，任一失败会回滚整个世界步。

Prompt Builder 使用版本化 system prompt 与规范 JSON envelope。Truth Engine 获得世界、会话/run 身份、完整 canonical truth、完整语义历史、规则裁决语义、玩家与 Agent 认知、联合行动、检定和允许的 Agent Profile。AgentMind 只获得自身人格、目标、belief、去 canonical 的局部绑定、主观历史、自身行动/可感知结果和 observation。玩家文本与行动始终标记为不可信企图数据。

`ModelExecutionAudit.invocations[]` 保存 catalog 版本/hash、prompt 版本、profile/provider/实际模型、原生推理配置、严格输出模式，以及每次调用的 Context 计量、transport、token、finish reason、provider request ID、语义结论与规范请求/响应 hash；汇总不重复持久化。测试 provider 仅位于 `src/engine/testing/`；生产 E2E 通过本地 HTTP 服务走真实 Gateway 与 DeepSeek adapter。

### Consequences

- 部署者需要管理一份显式模型目录，并为其中所有 provider 提供密钥；配置改动需重启。
- 严格输出和角色校验会将供应商差异暴露为明确失败，不会以静默降级继续世界。
- 单进程公平队列符合当前 WorldHost 部署模型；多副本部署需以保留同一 Scheduler 接口的分布式实现取代它。

## Pros and Cons of the Options

### 单 OpenAI-compatible provider 与 fallback

- 好：配置少，接入旧端点快。
- 坏：丢失原生推理和严格输出语义，停用模型与 fallback 会静默改变裁判。

### 统一推理参数与任意 options 透传

- 好：表面 API 简短，新字段无需修改 schema。
- 坏：同名强度在不同供应商上不等价，无约束 options 无法在启动时校验。

### 直接并发全部请求

- 好：实现最少。
- 坏：高 Agent 数会引发限流，大会话可能饿死其他会话，取消和过载语义不明确。

### 立即使用分布式队列

- 好：可跨进程共享并发配额。
- 坏：当前宿主为单进程，引入外部持久化基础设施不会提高当前事务语义。

### 严格多供应商 Gateway 与公平调度

- 好：供应商差异显式、模型选择可审计、高并发可控，世界步继续保持原子性。
- 坏：配置和 Adapter 契约更严格，供应商 API 升级需要显式更新对应判别联合与测试。

## Links

- [0031](0031-epistemic-multi-agent-truth-engine.md) — 多 Agent 认知隔离与联合裁决。
- [0034](0034-truth-engine-verification-matrix.md) — 真实入口与确定性验证矩阵。
- [0035](0035-truth-engine-hardening-and-verifiable-audit.md) — 模型审计与公开信息边界。
- [0042](0042-causal-assurance-and-staged-model-profiles.md) — 分阶段精确角色与可配置 Profile。
- [0043](0043-end-to-end-runtime-observability.md) — 运行事件、日志模式与 invocation 审计。
- [模型目录与 Gateway 规格](../game-design/model-gateway.md) — 当前配置与运行契约。
- [DeepSeek 模型](https://api-docs.deepseek.com/quick_start/pricing/) 与 [JSON Output](https://api-docs.deepseek.com/guides/json_mode/)。
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) 与 [Reasoning](https://developers.openai.com/api/docs/guides/reasoning)。
- [xAI Structured Outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs) 与 [Reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning)。
