# 模型目录与 Gateway

`config/models.yaml` 是生产运行时的模型配置入口。它只保存 provider 元数据与环境变量名，不保存密钥。运行时在首次初始化 WorldHost 时严格读取、校验和冻结目录，并只为当前存在凭据的 provider 构造 Adapter；目录或凭据修改需要重启服务。

## 目录契约

```yaml
schema_version: 2
scheduler:
  global_concurrency: 16
  max_queued_requests: 1024
  queue_timeout_ms: 300000
providers:
  deepseek:
    kind: deepseek
    base_url: https://api.deepseek.com
    api_key_env: DEEPSEEK_API_KEY
    max_concurrency: 16
profiles:
  truth-deepseek:
    provider_id: deepseek
    model: deepseek-v4-flash
    description: 高吞吐世界真值裁决
    allowed_roles: [truth-perception, truth-reaction-routing, truth-resolution, truth-transition, causal-verifier]
    request_timeout_ms: 300000
    max_output_tokens: 32768
    inference:
      kind: deepseek-non-thinking
      temperature: null
      top_p: null
```

provider ID 与 profile ID 都使用小写 kebab-case。`api_key_env` 必须是大写环境变量名；目录中的 provider 是可选能力注册项，未被当前世界引用时允许没有密钥。创建或加载会话会在任何模型调用前预检五个 Truth Profile 与全部现有 Agent Profile；缺少实际引用 provider 的密钥会显式失败。动态 Agent 只会看到当前凭据可用的 Profile，其提交前仍再次预检；每次模型调用也保留最终防线。profile 的 `model` 是传给供应商的不透明 ID；引擎不替换别名、不推导默认模型。`allowed_roles` 只允许 `truth-perception`、`truth-reaction-routing`、`truth-resolution`、`truth-transition`、`causal-verifier`、`agent-bootstrap`、`agent-mind` 与 `agent-reaction`。世界、初始 Agent、动态 Agent 和每次调用都按精确角色校验，不复用或映射另一角色；多个角色仍可显式引用同一 Profile。

`inference` 是 provider 原生判别联合：

- `deepseek-thinking` 接受 `high|max`；`deepseek-non-thinking` 允许 nullable `temperature` 或 `top_p`，二者不能同时设置。
- `openai-reasoning` 配置 OpenAI 原生 `effort`、nullable summary 和 nullable text verbosity。
- `xai-reasoning` 配置 xAI 原生 `low|medium|high|xhigh` 与 nullable summary。

目录拒绝未知字段、空 provider/profile、无效引用、重复角色、非法并发/超时数值和 provider/inference 类型不匹配。可用 `LIVINGWORLD_MODEL_CATALOG_PATH` 指向另一份完整目录；不支持按字段覆盖或热重载。

## 供应商调用

`StructuredModelProvider.generateStructured` 一次返回已验证值和 `ModelExecutionAudit`。请求显式携带 profile、workload/session lane、batch/run、角色、主体、prompt 版本、schema 名、system prompt、JSON 上下文、Zod schema 和可选 `AbortSignal`。

`ModelGateway` 处理 Profile 解析、可用性预检、调度、重试、本地校验和审计；`ModelProviderAdapter` 隔离供应商客户端、API 形状与原生参数。新增供应商时增加目录判别分支、一个 Adapter 和对应契约测试，Gateway、Scheduler、Truth Engine 与 AgentMind 接口保持不变。

DeepSeek 调用 Chat Completions，启用稳定 `json_object` 模式，在用户 prompt 中附加 JSON Schema 与最小 schema-valid 形状示例：可选数组示例为空，只有 `minItems` 才生成必要元素，避免示例凭空诱导 belief/character/world operation。响应在本地解析 JSON 并执行 strict Zod。OpenAI 与 xAI 调用 Responses API，由 provider 原生 strict JSON Schema 限制输出，本地仍再执行同一 Zod schema。共享输出契约只使用 strict object、必填字段和显式 nullable；不从 Markdown、前后缀文字或截断响应中抢救结果。

任何 provider 失败都留在原 profile，不切换供应商或模型。网络错误、408、429 与 5xx 最多三次传输尝试，遵循 `Retry-After` 或使用最大十秒的指数抖动。400/401、严格输出失败与引擎语义验证不做传输重试。后两者可由 Truth/AgentMind 以结构化问题最多修复两次。

## 公平队列与原子批次

`FairModelScheduler` 是 WorldHost 进程内的唯一调度器。它将实际 HTTP 执行限制在 `global_concurrency` 与对应 provider `max_concurrency` 的交集内。每个 session/workload 是 FIFO lane，lane 之间公平轮转；Truth 不获得隐藏优先级。队列满或超过等待上限会返回 `ModelOverloadedError`。取消会移除尚未执行的任务，并将同一 `AbortSignal` 传递到在途 provider 请求。

每个世界步依序完成 perception、reaction routing、resolution、transition 与 causal verifier，再并发请求全部存活 AgentMind。早期阶段一旦完成不会因后续修复而重开；因果复核否决只重试 transition。AgentMind 批次使用完整 settlement：所有结果成功后才统一应用 belief patch 和下一行动；任一请求最终失败都丢弃整批候选并保持世界 revision 不变。

## 审计

Execution Ledger 为每次调用持久化 catalog/schema/prompt hash、profile/provider/实际模型、原生推理配置、结构化输出模式、完整规范请求与结构化响应、Context 字节/分区、transport attempts、token usage、finish reason、provider request ID 与语义结论；汇总只从这些原始事件派生。API key 和隐藏思维链不进入 Ledger，WorldSession 不保存模型审计副本。完整字段见 [Execution Ledger](runtime-observability.md)。

上下文的权威和认知投影由 [Truth Engine 运行时规格](engine-runtime.md#prompt-与上下文) 定义，世界对 Profile 的引用由 [世界剧本格式](script-format.md) 定义。
