# WorldRun 失败分类、取消恢复与流边界

## Status

Accepted
Class: architecture

## Context and Problem Statement

WorldRun 曾把所有 failed 都标为可重试，同时用同一组“active statuses”表达执行是否仍在进行、是否仍拥有玩家目标和 SSE 是否应关闭。快速失败的 run 在客户端取得终态快照后仍会打开 EventSource；服务端在终态尾游标返回 200 空流，浏览器把正常 EOF 当作断线并持续重连。取消请求已写盘但取消终态未写盘时，恢复路径又会产生校验禁止的 `failed + cancelRequested` 文档。

## Decision Drivers

- run 状态必须分别表达模型执行、玩家目标所有权与事件流生命周期。
- 重试按钮只能承诺存在合理恢复可能的失败；永久错误必须允许玩家放弃目标。
- 取消、崩溃恢复和步骤提交必须以最后完整 revision 为原子边界。
- SSE 重连只补齐持久事件，终态不得制造新连接或重新运行步骤。
- 客户端旧连接、旧请求和重复操作不得覆盖更新的 run。

## Considered Options

- 保留所有 failed 可重试，只修正错误文案。
- 让 200 空 SSE 依赖浏览器自行停止重连。
- 在客户端为每次 EOF 增加固定延迟后重新连接。
- 建立共享状态谓词、类型化失败分类、取消恢复事务与明确的 204 终态协议——所选路线。

## Decision Outcome

运行状态分为三组：`queued | running` 是 execution-active；`awaiting_player | completed | goal_failed | step_limit | cancelled | failed` 是 stream boundary；`queued | running | awaiting_player | step_limit | failed` 拥有 active intent。只有 execution-active run 可以保持 SSE 打开；每个 stream boundary 必须以匹配的 `run.<status>` 事件结束。

`run.failed.payload.retriable` 是布尔值，也是 retry 授权的持久事实。临时网络、408/429/5xx、队列过载、模型语义修复耗尽、明确的临时存储故障、CAS 冲突与普通进程中断可重试；配置错误、永久 4xx、状态或事务不变量、文档校验、宿主 fencing 与未知错误不可重试。错误 cause 与 AggregateError 递归分类，除 Abort 始终按取消处理外，任一永久原因优先。若失败终态首次落盘失败，宿主保留原分类和内部错误，直到恢复事务把它持久化；不能把已知永久错误降级成普通可重试进程中断。内部诊断保留在服务端，公共消息只说明状态与恢复动作。

若恢复 queued/running 且 `cancelRequested` 为真，宿主从最后完整快照取消 player intent，并在同一 CAS 写入 `cancelled`、清除标记与追加 `run.cancelled`；Abort 已被分类为取消但 cancelled 首次落盘失败时，也必须保留该待恢复分类，不能在下一次读取时降级成普通进程中断。无取消请求的普通进程中断写入可重试 failed。awaiting_player、failed 与 step_limit 都能通过现有 DELETE run 资源明确放弃，保留已提交步骤并释放 active intent；只有可重试 failed 和 step_limit 接受 retry。旧终态 intent 释放后，同一有历史会话可以在 history 尾部建立由新 run 输入账本绑定的新 goal。

每个 committed step 的公开 `check.resolved → player.outcome → player.observation → step.committed` 必须由 canonical history 唯一投影并完整、同序落盘，不能独立伪造、遗漏或重复。每次 `step.committed` 还必须把所属 run 的 `intentId` 与截至该步已经公开的输入前缀逐项绑定到同 revision 的 canonical `playerIntent`；当前 intent 之外的历史 run 也不能改写目标或已提交 clarification。SSE 游标必须是非负安全整数；非法值返回 400，超过当前尾部返回 409。stream boundary 且游标已经位于尾部时返回 204，落后时返回 200 并只重放到遇到的首个边界；execution-active 在尾部继续等待。

浏览器只为 execution-active 快照建立 EventSource，并以连接 epoch、source identity、独立请求序号与组件生命周期隔离旧回调；连接决策使用 freshness 合并后的有效快照，不能让旧 detail 关闭较新 run。启动、继续、重试、取消、放弃以及响应可能已提交但客户端未收到的请求，都进入同一个“重新读取服务端并对齐当前执行 run”的路径；页面重新获得焦点时也执行相同对齐。若 start 响应在返回 `runId` 前丢失，以客户端 attempt、提交前 run 集合与规范化 goal 匹配新 run；网络错误、408、429、5xx 等不能证明未提交的响应都使用该路径，只有明确永久 400、401、403、404、422 直接失败。首次空读取不足以证明服务端未提交，只有跨确认窗口的连续权威 absence 才释放互斥并报告原错误。操作错误按客户端 operation 身份归属；对于同一次取消或放弃，只要 SSE 或权威 detail 已确认终态，错误无论早到还是晚到都不能覆盖终态，旧终态也不能清除后来独立操作的错误。clarification 在确认落盘前复用同一个输入 ID。

持久校验只能接受或拒绝值，不能以 trim 等转换改写已经用于 canonical history 投影和内容 hash 的公开叙事。SQLite 对已完整验证会话使用固定 8 项 LRU，并让缓存命中与未命中都发出一次不含 payload 的读取完成事件；批量列表必须避免容量边界的顺序逐出抖动。可信 world/hash/seed 契约缓存也必须有界；优化不得改变持久语义、使常态读取从可观测链路消失或随存档数永久增长。

会话文档升级到 schema v9，公共 API 升级到 v4。旧会话直接拒绝，不做迁移。

### Consequences

- 永久失败不再诱导玩家重复执行同一个必败步骤，但可以明确放弃并开始新目标。
- 终态 204 为原生 EventSource 提供停止重连的协议级信号，客户端仍会在收到边界事件后主动关闭。
- 状态集合与失败分类成为服务端、Route Handler 和 UI 共用的单一实现。
- 更严格的 run 末事件校验会拒绝缺少边界审计的损坏文档。

## Pros and Cons of the Options

### 所有失败都可重试

- 好：接口和 UI 最简单。
- 坏：配置或不变量错误会确定性复现，并让 active intent 永久阻止新目标。

### 依赖 200 空流自动结束

- 好：服务端无需特殊响应。
- 坏：EventSource 把 EOF 视为可重连错误，制造假断线和请求风暴。

### 客户端固定延迟重连

- 好：可降低请求频率。
- 坏：没有解决终态与执行态混淆，旧回调仍可能覆盖新状态。

### 明确状态谓词、失败分类与 204 边界

- 好：持久状态、HTTP 与 UI 共享同一生命周期语义，恢复动作与实际故障匹配。
- 坏：需要更新公开事件契约、客户端连接管理和存档版本。

## Links

- [0033](0033-persistent-streaming-world-runs.md) — WorldRun、SSE 与原子步骤基础。
- [0040](0040-resumable-player-intent.md) — active intent 与 clarification。
- [0041](0041-local-sqlite-runtime.md) — SQLite CAS 与崩溃恢复。
- [0044](0044-local-assistant-ui-immersive-session-shell.md) — 浏览器消息投影与本地会话壳。
- [0048](0048-engine-owned-runtime-identities.md) — 引擎运行时身份与版本断代。
- [事故复盘 0016](../postmortems/0016-runtime-identity-collision-and-reconnect-loop.md) — 用户可见故障和逃逸护栏。
