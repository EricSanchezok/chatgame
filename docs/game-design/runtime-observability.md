# 运行时可观测性

本参考定义服务端运行时事件、持久化模型审计和诊断输出。可观测性只读取边界数据与计时，不参与世界裁决；`off`、`metrics` 与 `full` 对同一输入必须产生相同 truth、belief、公开事件和存档语义。

## 两条观测链路

成功提交的 bootstrap 与世界步骤把 `ModelExecutionAudit.invocations[]` 写入 `WorldSessionDocument` schema v9。运行 NDJSON 覆盖 HTTP、SSE、session、WorldRun、世界步骤、模型、校验与存档；失败、取消和回滚调用只进入运行日志，不进入已提交步骤审计。

公共游戏 API、SSE payload 与浏览器 DTO 不包含运行事件、模型审计、canonical binding 或内部错误。运行日志是有界本地诊断表面，不是游戏历史或公开事件流。

## 调试查询与实时订阅

本地受信任的世界演化调试器是运行日志的只读消费者，不是第三条观测链路。已提交图谱与状态差异来自 canonical history；失败、取消、回滚和进行中 attempt 来自同一 RuntimeEvent。`RuntimeObserver.subscribe` 在事件写入现有 sink 后通知进程内订阅者，监听器异常被隔离，不能改变 emit、WorldRun 或持久化结果。

Inspector v2 先按 `stepAttemptId` 聚合，再以 `step.committed`、`step.rolled_back`、`step.persistence_rolled_back` 或取消事件裁剪 attempt；存在 persistence rollback 时它优先于较早的候选 commit。终止之后复用同一 correlation 的 persistence 读取不进入该 attempt 的最新事件、数量、耗时或阶段。服务端从裁剪后的事件归纳终止时间、失败模型角色、输出拒绝、修复 invocation、参与/直接关联主体、拟议行动和起止 state hash；客户端不解析错误文本猜测这些字段。

窗口、step、attempt 和调试 SSE 只携带 RuntimeEvent 摘要：事件信封、错误、指标、`hasPayload` 与由 timestamp、sequence、事件名生成的稳定不透明 ID，不携带大型 payload。`GET /api/sessions/:id/inspector/runtime-events/:eventId` 在展开时从当前有界 trace 读取已经脱敏的完整事件；轮转或淘汰后的 ID 返回 404。摘要和详情共用同一事件 ID 算法，不建立 payload 缓存或第二份日志。

`RuntimeTraceIndex` 只索引符合日志命名规则的现存 NDJSON 段。每段记录 mtime、已读取 offset、尚未换行的尾部字节，以及完整行的文件偏移与 session 归属；payload 不常驻索引，查询时只按需读取匹配 session 的行。文件缩短时从头重建，轮转删除时同步移除该段索引，坏行只形成 trace 缺口并把可用性标为 degraded。查询合并持久事件、observer snapshot 与 10,000 条进程内 live buffer，并按 timestamp、sequence 排序去重。`off` 不读取 trace，`metrics` 不提供 payload，`full` 只返回 sink 已记录的 payload。

`/api/sessions/:id/inspector/events` 使用独立进程 epoch 和 RuntimeEvent sequence 作为 SSE ID，并以同一摘要 projector 删除 payload。合法同 epoch 游标只接收更大 sequence；epoch 变化、游标被 live buffer 淘汰或游标超前时先发 `resync`，客户端重新读取窗口。15 秒 heartbeat 携带最新已发送游标，不使游标倒退。连接、索引和序列化失败只使面板重连或显示记录不可用，不进入游戏事务。

WorldHost 对 committed 图谱窗口和 revision 前后快照使用 64 项有界 LRU。键包含 session ID、world content hash、当前 revision 与查询身份；revision 变化自然失效。缓存不包含 RuntimeEvent、trace 可用性或进行中 attempt，每次响应仍从当前日志派生这些字段；缓存不是持久状态。

## 事件信封

每条 `RuntimeEvent` 是一行完整 JSON，包含 `schemaVersion=1`、进程内递增 `sequence`、ISO `timestamp`、`level` 与 `event`。可选字段只有 correlation、`durationMs`、标量 attributes、数值 measurements、对象 counts、SHA-256 hashes、full payload 和白名单错误。

Correlation 按可用边界逐层增加：`requestId → sessionId → runId/runAttempt → stepAttemptId/revision/step → modelInvocationId/modelRole/modelSubject/modelInvocation/transportAttempt`。重试 run 使用新的 `runAttempt`；失败步骤的 `stepAttemptId` 保留，但 revision 不递增。

错误只序列化 `name`、`message`、`stack`、数字 `status` 和最多三层同结构 `cause`。SDK Error 的其他属性、请求头、认证头、API key、任意环境变量和 ZIP 二进制永不进入事件。

## 模式与 payload 所有权

`LIVINGWORLD_OBSERVABILITY=off|metrics|full` 控制运行日志，显式值始终优先。未显式配置时，`NODE_ENV=development` 默认 `full`，其他环境默认 `off`；因此 `npm run dev` 自动保留完整本地诊断链，而测试与生产不会隐式记录 payload。`metrics` 只记录 ID、大小、计数、耗时、状态、错误分类和 hash；`full` 在此基础上记录关键应用层 payload。启用的两种模式同时写 stdout 与文件。

Full payload 只在拥有边界出现：HTTP 记录经过递归凭证字段脱敏的游戏 JSON body；世界导入只记录文件名、字节数、hash 与 replace；步骤记录初始状态、联合行动、检定、离散随机承诺与 reaction、transition、玩家知识、Agent patches 和提交后状态；模型记录三类规范 Context、结构化输出，以及每个唯一 system/schema 契约一次。后续事件只引用 hash，不能重复附加同一大对象。日志不包含不可见思维链。

## 事件阶段

| 范围 | 事件族与阶段 |
|---|---|
| HTTP | `http.request.started/body/completed/failed` |
| SSE | `sse.connection.opened/closed/cancelled/failed`、`sse.event.sent` |
| Session 与 run | `session.bootstrap.*`、`run.queued/started/cancel_requested/finished/failed`、公开事件追加 |
| 世界步骤 | `step.started`、联合行动、Truth、`step.check_round.*`、`step.reaction_batch.*`、transition 校验/应用、玩家知识、AgentMind 批次、候选与历史校验、`step.committed/rolled_back` |
| 模型 | Context 构建/规范化/序列化、契约注册、invocation、queue、transport、retry wait、结构化解析、语义接受/拒绝 |
| 持久化 | 完整历史校验、document 序列化、临时文件写入、rename、读取、写入与失败；SQLite 读取完成事件标记 `cacheHit` |
| Sink | `observability.health` |

事件名是稳定的阶段标识；调用方依靠 correlation 串联，不依靠相邻行或时间戳猜测父子关系。

SQLite 可以缓存已经通过完整验证且 generation 与原始文档字节均未改变的会话，但缓存固定为最近使用的 8 项；创建、CAS 与读取都会更新次序，删除和关闭会释放对应项。批量列表先读取仍在缓存中的会话，再补齐未命中项，返回顺序仍按会话 ID，避免容量刚好少于会话数时每轮顺序扫描都把下一项逐出。命中和未命中都恰好产生一次 `persistence.read.completed`，只报告 `cacheHit` 等边界元数据，不把会话 payload 复制进事件。按 world/hash/seed 重建的可信世界契约同样使用 8 项 LRU，批量列表也先验证 resident；任何读取优化都不能成为随存档数量增长的第二份永久状态。

## Context 与模型调用计量

Gateway 先递归按键规范化 Context，再以两空格 JSON 序列化；`context.utf8Bytes` 是这份实际规范 JSON 的 UTF-8 字节数。`context.sections` 对每个顶层字段记录独立 JSON 字节与数组/对象 item count；counts 统计 history、event、agent、entity、fact、belief、evidence 与 observation。请求字节包含 system、schema、profile identity 和 Context；响应字节来自规范结构化值。

每个 `ModelInvocationAudit` 保存 invocation ID/序号、请求与响应 hash、请求/响应字节、Context 总量/顶层分区/对象计数、每个 transport attempt 的 queue/execution/retry delay/status/error 分类、token usage、finish reason、provider request ID、结果类型、`accepted|rejected` 语义结论和验证问题代码。调用次数、repair、transport retry、总 token 与总耗时由 `summarizeModelExecutionAudit` 从 `invocations[]` 派生，不在存档重复保存。

供应商返回后记录真实 input/output/reasoning/cache token。结构化或语义拒绝仍保留该 invocation 的可得 usage；没有供应商响应的终端 transport 失败只进入运行日志。

## 文件 sink、轮转与健康

日志目录由 `LIVINGWORLD_OBSERVABILITY_DIR` 指定，默认 `${LIVINGWORLD_DATA_ROOT:-.livingworld}/logs`。`LIVINGWORLD_OBSERVABILITY_SEGMENT_BYTES` 默认 64 MiB，`LIVINGWORLD_OBSERVABILITY_MAX_BYTES` 默认 1 GiB；启用模式下必须是正安全整数，且总量不小于 segment。

文件名为 `livingworld-<启动 UTC>-<PID>-<四位段号>.ndjson`。默认 observer 归进程所有并通过 `globalThis` 跨开发模块热重载复用，不能因 Route 模块重新求值重复打开空日志段或注册退出钩子。单个事件不跨文件；超过 segment 上限的事件独占一个段。轮转只删除符合该命名规则的最旧文件，保留目录内其他文件；最新超大段可以暂时使目录超过总量上限。

显式启用时，目录创建或首个文件打开失败使 WorldHost 初始化失败。运行中的日志文件 write/fsync/open 失败使 observer 进入 degraded，业务继续执行且后续事件继续写 stdout；世界存档自身的临时文件或 rename 失败仍按事务失败处理。轮转和关闭输出 `observability.health`，包含事件数、日志字节、序列化耗时、active segment 字节、degraded 与 sink error 数；同步 flush 保证进程正常退出与轮转边界落盘。

## 诊断命令

`npm run diagnose:runtime -- --agents 1,10,50 --steps 1,10,100` 通过生产 Gateway 与确定性 adapter 跑 Agent/step 矩阵，只替换远程 I/O 边界，不访问网络。Stdout 是 NDJSON，分别报告 bootstrap 与逐步骤的角色 Context/顶层分区增长、调用/repair/retry、阶段分位耗时、存档大小/写入时间、累计输入字节与日志自身开销，最后一行是 `diagnostic.summary`；stderr 是简表。CI 只执行 1 Agent × 1 step 的核心测试。

`npm run diagnose:live -- --steps 3` 显式使用模型目录和现有密钥，报告真实 token、cache、provider request ID、transport 与延迟。它是手动采样，不进入 CI；stdout 同样以 `diagnostic.summary` 收尾，stderr 只输出简表。

决策理由见 [0043](../decisions/0043-end-to-end-runtime-observability.md)、[0055](../decisions/0055-trusted-world-evolution-inspector.md) 与 [0057](../decisions/0057-failure-aware-world-inspector.md)。
