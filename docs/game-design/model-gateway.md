# 模型目录与 Gateway

`config/models.yaml` 是生产运行时的模型配置入口。它只保存 provider 元数据与环境变量名，不保存密钥。运行时在首次初始化 WorldHost 时严格读取、校验和冻结目录；配置修改需要重启服务。

## 目录契约

```yaml
schema_version: 1
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
    model: deepseek-v4-pro
    description: 高强度世界真值裁决
    allowed_roles: [truth-engine]
    request_timeout_ms: 300000
    max_output_tokens: 32768
    inference:
      kind: deepseek-thinking
      effort: max
```

provider ID 与 profile ID 都使用小写 kebab-case。`api_key_env` 必须是大写环境变量名；每个已配置 provider 在服务初始化时都必须解析到非空密钥。profile 的 `model` 是传给供应商的不透明 ID；引擎不替换别名、不推导默认模型。`allowed_roles` 只允许 `truth-engine` 或 `agent-mind`，调用、世界加载和动态 Agent 创建都会校验角色；一次性 reaction 复用该 Agent 的 `agent-mind` Profile，但在审计中记录为独立的 `agent-reaction` 调用。

`inference` 是 provider 原生判别联合：

- `deepseek-thinking` 接受 `high|max`；`deepseek-non-thinking` 允许 nullable `temperature` 或 `top_p`，二者不能同时设置。
- `openai-reasoning` 配置 OpenAI 原生 `effort`、nullable summary 和 nullable text verbosity。
- `xai-reasoning` 配置 xAI 原生 `low|medium|high|xhigh` 与 nullable summary。

目录拒绝未知字段、空 provider/profile、无效引用、重复角色、非法并发/超时数值和 provider/inference 类型不匹配。可用 `CHATGAME_MODEL_CATALOG_PATH` 指向另一份完整目录；不支持按字段覆盖或热重载。

## 供应商调用

`StructuredModelProvider.generateStructured` 一次返回已验证值和 `ModelExecutionAudit`。请求显式携带 profile、workload/session lane、batch/run、角色、主体、prompt 版本、schema 名、system prompt、JSON 上下文、Zod schema 和可选 `AbortSignal`。

`ModelGateway` 只处理 Profile 解析、调度、重试、本地校验和审计；`ModelProviderAdapter` 隔离供应商客户端、API 形状与原生参数。新增供应商时增加目录判别分支、一个 Adapter 和对应契约测试，Gateway、Scheduler、Truth Engine 与 AgentMind 接口保持不变。

DeepSeek 调用 Chat Completions，启用稳定 `json_object` 模式，在用户 prompt 中附加 JSON Schema 与合法形状示例，并在本地解析 JSON 与执行 strict Zod。OpenAI 与 xAI 调用 Responses API，由 provider 原生 strict JSON Schema 限制输出，本地仍再执行同一 Zod schema。共享输出契约只使用 strict object、必填字段和显式 nullable；不从 Markdown、前后缀文字或截断响应中抢救结果。

任何 provider 失败都留在原 profile，不切换供应商或模型。网络错误、408、429 与 5xx 最多三次传输尝试，遵循 `Retry-After` 或使用最大十秒的指数抖动。400/401、严格输出失败与引擎语义验证不做传输重试。后两者可由 Truth/AgentMind 以结构化问题最多修复两次。

## 公平队列与原子批次

`FairModelScheduler` 是 WorldHost 进程内的唯一调度器。它将实际 HTTP 执行限制在 `global_concurrency` 与对应 provider `max_concurrency` 的交集内。每个 session/workload 是 FIFO lane，lane 之间公平轮转；Truth 不获得隐藏优先级。队列满或超过等待上限会返回 `ModelOverloadedError`。取消会移除尚未执行的任务，并将同一 `AbortSignal` 传递到在途 provider 请求。

每个世界步先完成 Truth 裁决，再并发请求全部存活 AgentMind。AgentMind 批次使用完整 settlement：所有结果成功后才统一应用 belief patch 和下一行动；任一请求最终失败都丢弃整批候选并保持世界 revision 不变。

## 审计

Model audit 持久化 catalog schema/hash、prompt 版本、profile/provider/实际模型、原生推理配置、结构化输出模式、传输/语义尝试、队列与执行耗时、token usage、finish reason、provider request ID 与规范请求/结构化响应 hash。它不保存 API key、原始 prompt、原始响应或思维链。

上下文的权威和认知投影由 [Truth Engine 运行时规格](engine-runtime.md#prompt-与上下文) 定义，世界对 Profile 的引用由 [世界剧本格式](script-format.md) 定义。
