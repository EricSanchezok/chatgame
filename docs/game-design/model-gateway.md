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
    allowed_roles: [truth-perception, truth-reaction-routing, truth-resolution, truth-transition, temporal-planner, action-grounding, observation-renderer, causal-verifier, arrival-generator]
    request_timeout_ms: 300000
    max_output_tokens: 32768
    max_input_bytes: 524288
    inference:
      kind: deepseek-non-thinking
      temperature: null
      top_p: null
```

provider ID 与 profile ID 都使用小写 kebab-case。`api_key_env` 必须是大写环境变量名；目录中的 provider 是可选能力注册项，未被当前世界引用时允许没有密钥。创建或加载 World Instance 会在模型调用前预检世界与全部 Agent Profile；缺少实际引用 provider 的密钥会显式失败。profile 的 `model` 是传给供应商的不透明 ID；引擎不替换别名、不推导默认模型。`allowed_roles` 覆盖 Truth、temporal planner、action grounding、Observation renderer、causal verifier、Arrival Generator 和 AgentMind 系列角色；每个调用按精确角色校验。`max_input_bytes` 是序列化 context 的硬上限，也是 Observation 分批的输入预算。

`inference` 是 provider 原生判别联合：

- `deepseek-thinking` 接受 `high|max`；`deepseek-non-thinking` 允许 nullable `temperature` 或 `top_p`，二者不能同时设置。
- `openai-reasoning` 配置 OpenAI 原生 `effort`、nullable summary 和 nullable text verbosity。
- `xai-reasoning` 配置 xAI 原生 `low|medium|high|xhigh` 与 nullable summary。

目录拒绝未知字段、空 provider/profile、无效引用、重复角色、非法并发/超时数值和 provider/inference 类型不匹配。可用 `LIVINGWORLD_MODEL_CATALOG_PATH` 指向另一份完整目录；不支持按字段覆盖或热重载。

## 供应商调用

`StructuredModelProvider.generateStructured` 一次返回已验证值和 `ModelExecutionAudit`。请求显式携带 profile、workload/instance lane、batch/advance、角色、主体、prompt 版本、schema 名、system prompt、JSON 上下文、Zod schema 和可选 `AbortSignal`。

`ModelGateway` 处理 Profile 解析、可用性预检、调度、重试、本地校验和审计；`ModelProviderAdapter` 隔离供应商客户端、API 形状与原生参数。新增供应商时增加目录判别分支、一个 Adapter 和对应契约测试，Gateway、Scheduler、Truth Engine 与 AgentMind 接口保持不变。

DeepSeek 调用 Chat Completions，启用稳定 `json_object` 模式，在用户 prompt 中附加 JSON Schema 与最小 schema-valid 形状示例：可选数组示例为空，只有 `minItems` 才生成必要元素，避免示例凭空诱导 belief/character/world operation。响应在本地解析 JSON 并执行 strict Zod。OpenAI 与 xAI 调用 Responses API，由 provider 原生 strict JSON Schema 限制输出，本地仍再执行同一 Zod schema。共享输出契约只使用 strict object、必填字段和显式 nullable；不从 Markdown、前后缀文字或截断响应中抢救结果。

任何 provider 失败都留在原 profile，不切换供应商或模型。网络错误、408、429 与 5xx 最多三次传输尝试，遵循 `Retry-After` 或使用最大十秒的指数抖动。400/401、严格输出失败与引擎语义验证不做传输重试。后两者可由 Truth/AgentMind 以结构化问题最多修复两次。

## 公平队列与原子批次

`FairModelScheduler` 是 WorldHost 进程内的唯一模型调度器。它将实际 HTTP 执行限制在 `global_concurrency` 与对应 provider `max_concurrency` 的交集内。每个 instance/workload 是 FIFO lane，lane 之间公平轮转；Truth 不获得隐藏优先级。队列满或超过等待上限会返回 `ModelOverloadedError`。取消会移除尚未执行的任务，并将同一 `AbortSignal` 传递到在途 provider 请求。

Eager reference 先为新行动调用 temporal planner，再对到期行动执行 grounding，按冲突分量运行 Truth，并按输入字节预算分批生成 Observation；无法证明局部独立时扩大为全局分量。只有新决策点上的 model Agent 并发调用 AgentMind，并一次消费 observation cursor 之后的完整 settlement。语义 repair 耗尽的单个 eligible Agent 产生可计数的空 patch 与 idle action；网络、配置、取消、Ledger 或其他终端失败会丢弃整份候选并保持 revision 不变。

## 审计

Execution Ledger 为每次调用持久化 catalog/schema/prompt hash、profile/provider/实际模型、原生推理配置、结构化输出模式、完整规范请求与结构化响应、Context 字节/分区、transport attempts、token usage、finish reason、provider request ID 与语义结论；汇总只从这些原始事件派生。同一语义 invocation 的 transport retry 复用身份，semantic repair 和由上层 repair 触发的重新渲染使用新的 invocation 身份。API key 和隐藏思维链不进入 Ledger，World Instance 不保存模型审计副本。完整字段见 [Execution Ledger](runtime-observability.md)。

上下文的权威和认知投影由 [Truth Engine 运行时规格](engine-runtime.md#observation-与认知隔离) 定义，世界对 Profile 的引用由 [世界剧本格式](script-format.md) 定义。
