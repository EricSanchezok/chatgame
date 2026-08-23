# 可恢复的玩家目标与同一 WorldRun

## Status
Accepted
Class: bug-fix

## Context and Problem Statement

Truth Engine 可以声明需要玩家决定，但单字段玩家 intent 无法同时保留原目标与最新补充；若 awaiting 状态只能结束流而没有输入资源，玩家只能创建新 run，原目标的身份、因果和重试边界随之丢失。

## Decision Drivers

- clarification 必须继续原目标，而不是冒充新目标。
- 一个未完成目标必须只有一个 run 所有者。
- 网络重试不得重复追加玩家输入或启动两次执行。
- 失败、步骤上限、等待玩家和取消必须有互不含糊的恢复语义。

## Considered Options

- 把补充文本作为新 run 和新 goal。
- 原地覆盖 intent 文本并创建新 run。
- 在同一 run 追加有身份的输入并保留稳定 goal——所选路线。

## Decision Outcome

`PlayerIntent` 保存稳定 `goal`、带 ID/类型/提交 step 的 `latestInput`、intent ID 与状态。首次输入创建 `kind=goal`；`POST /api/sessions/:id/runs/:runId/inputs` 只接受 awaiting_player run，追加 `kind=clarification`，恢复同一 intent 和 run。

每个输入 ID 在 run 内幂等：相同 ID 与相同规范文本返回现有快照，不启动第二次执行；相同 ID 与不同文本返回冲突。`player.input` 与 `run.execution_started` 是分离事件，后者明确引用本次执行使用的 input ID 和 initial/player_input/retry 原因。

queued、running、awaiting_player、failed 和 step_limit 都由同一个 active intent 拥有。存在 active intent 时拒绝新目标；failed/step_limit 通过 retry 继续，awaiting_player 通过输入继续，明确取消把 intent 和 run 一起终止。状态、run 终态和终态事件在同一 generation compare-and-swap 中提交。

### Consequences

- 玩家补充选择时，Truth Engine 同时获得原 goal 和最新 clarification。
- run 事件可以完整重放每次玩家输入与执行尝试。
- 客户端必须为 clarification 生成稳定幂等 ID，并在等待状态关闭 SSE 后以最后 sequence 恢复订阅。
- 旧单文本 intent 与旧事件格式直接拒绝。

## Pros and Cons of the Options

### 新 run、新 goal

- 好：复用创建 run 的入口。
- 坏：丢失原目标，无法判断新文本是目标还是回答。

### 覆盖 intent 文本

- 好：状态结构小。
- 坏：审计不能恢复最初意图，后续步骤会把回答误作最终目的。

### 同 run 输入日志

- 好：目标稳定、重试幂等、所有权唯一，流式历史可以回放。
- 坏：run 状态机和持久化校验需要理解多次输入与多次执行。

## Links

- [0033](0033-persistent-streaming-world-runs.md) — WorldRun 生命周期与 SSE。
- [0041](0041-local-sqlite-runtime.md) — generation CAS 持久化。
- [事故复盘 0011](../postmortems/0011-awaiting-player-lost-goal.md) — 促成此契约的失效机制。
