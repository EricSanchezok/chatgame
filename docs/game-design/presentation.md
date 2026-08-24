# 沉浸会话壳与流式 API

## 浏览器安全边界

浏览器只使用 `src/shared/world-api.ts`。会话列表是含标题、世界摘要、更新时间、步数和 queued/running run 的 `PublicSessionSummary`；详情拆成 `{ summary, state, runs }`。公开状态包含 world ID、world hash、manifest version、revision、step、elapsedSeconds、玩家知识和当前目标；不包含 canonical truth、bindings、Agent belief、隐藏检定或完整审计 delta。

## HTTP 资源

| 方法与路径 | 语义 |
|---|---|
| `GET /api/worlds` | 列出已安装 schema v5 世界 |
| `POST /api/worlds/import` | multipart 上传一个世界 ZIP；`replace=true` 显式替换 |
| `GET /api/sessions` | 按更新时间列出持久 Session 摘要 |
| `POST /api/sessions` | 以 `worldId` 和可选 uint32 seed 创建 Session，返回详情 |
| `GET /api/sessions/:id` | 读取精确寻址的 Session 详情 |
| `PATCH /api/sessions/:id` | 在无 queued/running run 时以 `{ title }` 重命名存档 |
| `DELETE /api/sessions/:id` | 在无 queued/running run 时删除该存档 |
| `POST /api/sessions/:id/runs` | 提交 1–4000 字符任意自然语言目标，返回 202 与精确形状 `{ runId }` |
| `GET /api/sessions/:id/runs/:runId` | 返回 `{ run, state }` 公开组合快照 |
| `POST /api/sessions/:id/runs/:runId` | 重试 failed/step_limit run，返回 `{ run, state }` |
| `POST /api/sessions/:id/runs/:runId/inputs` | 以幂等 `{ id, text }` 向 awaiting_player run 追加 clarification 并恢复同一 run |
| `DELETE /api/sessions/:id/runs/:runId` | 取消排队/在途模型批次并回到最后已提交步骤，返回 `{ run, state }` |
| `GET /api/sessions/:id/runs/:runId/events` | 从 `Last-Event-ID` 或 `after` 游标重放并订阅 SSE |

## SSE 事件

事件有单调 `sequence`、`type`、时间与 payload。`player.input` 记录 goal/clarification；`run.execution_started` 记录 initial/player_input/retry 执行边界；其余类型包括 `check.resolved`、`player.outcome`、`player.observation`、`step.committed` 以及各停止状态。公开检定使用宿主生成的不透明 ID；公共 outcome 只包含 status 与从本步玩家 outcome Observation 按提交顺序汇总的 summary，不包含内部替代方向。流在发送当前停止事件后关闭；断线客户端携带最后 sequence 重连即可补齐，不需要重新运行世界步骤。

## 运行状态

run 状态为 queued、running、awaiting_player、completed、goal_failed、step_limit、cancelled 或 failed。queued、running、awaiting_player、step_limit 和 failed 都可以拥有 active intent；一个 active intent 必须精确属于一个 run，新目标在该 run 完成或明确放弃前拒绝。failed 的公开错误为稳定、可重试消息，内部异常只保存在服务端记录；failed/step_limit 通过重试继续，awaiting_player 通过新输入继续，三者都保留原 goal。

## 浏览器路由与消息投影

`/` 是主菜单，只继续浏览器明确记录且仍存在的 Session；`/worlds` 安装世界并创建新存档，`/saves` 重命名、精确进入或确认删除存档，`/settings` 保存本机阅读偏好，`/play/:sessionId` 是精确寻址的游戏页，窄屏控制球进入 `/control`。开发与生产启动默认只监听 loopback；浏览器指针是导航偏好，不是状态权威或认证。

游戏页使用 `@assistant-ui/react` External Store。消息不是另一份存储：每个 WorldRun 按 `player.input` 边界投影玩家/世界消息段，clarification 继续同一 run；世界 data part 只展示公开 observation、observation 派生的 outcome、检定与终态。SSE 增量合并后再从 `PublicSessionDetail` 重建；刷新、重连和存档恢复不会产生第二条消息路径。运行中可安全中断，awaiting_player 可补充信息，failed/step_limit 可重试。

所有组件颜色通过根主题的 `--cg-*` token；主要控件至少 44px，有可见键盘焦点。错误使用 alert，加载状态使用 live region，并支持 320px、减少动效、forced colors 与浏览器字体缩放。
