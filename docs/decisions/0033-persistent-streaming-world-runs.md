# 持久化流式 WorldRun 与无内置剧本工作台

## Status
Accepted
Class: architecture

## Context and Problem Statement

一次开放目标可能触发数十个全体 Agent 世界步骤，现有同步 `/turn` 请求、单回合候选快照和动作预览无法表达长程运行、逐步骤持久化、进度观察与安全中断。两个内置剧本依赖旧动作和 UI 契约，保留它们会迫使新运行时维护兼容双轨。

## Decision Drivers

- 长程目标必须自动运行到完成、失败或玩家决策边界。
- 每个世界步骤必须原子提交，后续失败不能抹除已经发生的历史。
- 客户端必须持续收到玩家可知进度并能安全取消未提交的模型批次。
- 旧动作 API、旧剧本和旧存档不得形成兼容路径。
- 没有内置内容时应用仍需有明确、可访问的空态和导入入口。

## Considered Options

- 保持同步 turn 请求并延长超时。
- 客户端逐步骤重复调用。
- 整个长程目标结束后一次提交。
- 后台 WorldRun + SSE + 步骤级原子提交——所选路线。

## Decision Outcome

会话每次只运行一个 `WorldRun`。客户端通过 `POST /api/sessions/:id/runs` 提交原始玩家文本并只获得 run id；`GET /api/sessions/:id/runs/:runId/events` 使用 SSE 发送运行状态、公开检定、玩家 outcome、玩家观察和已提交步骤；run 资源 GET 返回 run 与公开会话状态的组合快照，DELETE 取消排队/在途模型请求并在最后已提交步骤边界终止。

每个步骤在 Truth transition、全部 Agent BeliefPatch、下一步行动、玩家知识、事件日志与 RNG 均验证成功后原子写入存档。模型或结构错误使当前步骤回滚并进入可重试失败状态。已提交步骤在后续失败、取消或进程恢复后保留。

持续玩家目标在内部步骤和玩家决定边界间持久化。需要玩家决定时 run 进入 `awaiting_player`；带幂等 ID 的 clarification 恢复同一 run 与 intent，稳定 goal 不被补充文本覆盖。运行在目标完成、失败、等待决定、取消或默认一百步骤安全上限时暂停或停止。客户端只接收玩家可知表面；完整联合行动和 delta 审计保留在服务端状态历史。

同步 turn、action preview、manual advance 与 descriptor mutation API 删除。两个内置剧本及其代码、资产、测试和演示命令删除；旧存档按新 schema 版本拒绝。启动器在零剧本状态显示明确空态并保留新格式导入入口。

世界 ZIP 导入只接受一个 schema v4 世界根目录，限制归档大小、条目数和展开体积，拒绝路径穿越、符号链接、额外文件、未知模型 Profile 与旧 `actions.yaml`。导入先在系统临时目录完整验证并规范化，再由 SQLite 事务写入不可变世界版本并切换当前指针；覆盖必须显式请求，暂存目录在所有结果下清理。

### Consequences

- UI 能展示真实世界进度并在步骤边界取消，不会让长行动表现为无响应请求。
- 服务端需要持久化 run 状态、事件序号、订阅者和取消信号。
- 每步写盘增加 I/O，但提供崩溃恢复与清晰的因果边界。
- 删除内置剧本后，首期仓库不提供可玩的展示世界；引擎行为由测试 fixture 证明。

## Pros and Cons of the Options

### 同步长请求

- 好：沿用现有客户端和 EngineHost。
- 坏：容易超时，无法观察进度，取消会留下不明确的提交边界。

### 客户端逐步骤调用

- 好：每个请求短且容易恢复。
- 坏：客户端成为世界推进编排者，长程目标无法由服务器自主执行。

### 整个目标一次提交

- 好：宏观目标具有单一事务。
- 坏：崩溃会丢失全部进度，长期已发生事件也可能被不合理回滚。

### 后台运行与步骤级提交

- 好：持久、可流式观察、可取消，并保持每个世界步骤原子。
- 坏：需要新的 run 生命周期、事件订阅和恢复测试。

## Links

- [0017](0017-session-persistence-refresh-recovery-meta.md) — 被步骤级 WorldRun 持久化取代的会话模型。
- [0030](0030-manus-style-game-workspace-and-ui-api-v6.md) — 被自由行动与流式运行 API 取代的游戏工作区契约。
- [0031](0031-epistemic-multi-agent-truth-engine.md) — WorldRun 执行的联合世界步骤。
- [0039](0039-resumable-player-intent.md) — awaiting_player 的同 run 恢复契约。
- [0040](0040-local-sqlite-runtime.md) — WorldRun 和 world catalog 的本地事务存储。
- [0025](0025-emberfall-industrial-folk-mystery.md) — 删除内容对应的灰烬镇决策。
- [0026](0026-starlight-shift-console.md) — 删除内容对应的星港决策。
