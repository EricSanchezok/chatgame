# 工作台与流式 API

## 浏览器安全边界

浏览器只使用 `src/shared/world-api.ts`。公开会话包含 world ID、revision、step、elapsedSeconds、玩家知识和当前目标；不包含 canonical truth、bindings、Agent belief、隐藏检定或完整审计 delta。

## HTTP 资源

| 方法与路径 | 语义 |
|---|---|
| `GET /api/worlds` | 列出已安装 schema v2 世界 |
| `POST /api/worlds/import` | multipart 上传一个世界 ZIP；`replace=true` 显式替换 |
| `GET /api/sessions` | 列出持久会话公开快照 |
| `POST /api/sessions` | 以 `scriptId` 和可选非负 seed 创建会话 |
| `GET /api/sessions/:id` | 读取公开会话快照 |
| `POST /api/sessions/:id/runs` | 提交 1–4000 字符任意自然语言目标，返回 202 与 run |
| `GET /api/sessions/:id/runs/:runId` | 读取 run 快照 |
| `POST /api/sessions/:id/runs/:runId` | 重试 failed/step_limit run |
| `DELETE /api/sessions/:id/runs/:runId` | 请求在安全步骤边界取消 |
| `GET /api/sessions/:id/runs/:runId/events` | 从 `Last-Event-ID` 或 `after` 游标重放并订阅 SSE |

## SSE 事件

事件有单调 `sequence`、`type`、时间与 payload。类型包括 `run.started`、`check.resolved`、`player.observation`、`step.committed` 以及各终止状态。终止后流在发送最后事件后关闭；断线客户端携带最后 sequence 重连即可补齐，不需要重新运行世界步骤。

## 运行状态

run 状态为 queued、running、awaiting_player、completed、goal_failed、step_limit、cancelled 或 failed。只有 queued/running 属于活动状态；一个会话同时至多一个活动 run。failed 带可重试错误，step_limit 保留 active intent 供继续。

## 工作台

零世界时显示“暂无可玩世界”和 ZIP 导入控件。安装世界后可以创建会话。会话页显示 revision、step 与世界时间；时间线逐条展示公开检定、玩家观察和提交边界；textarea 是唯一行动入口，不展示或暗示固定动作集合。运行中可请求安全中断，失败和步骤上限可继续。

所有颜色通过 `--cg-*` token；主要控件至少 44px，有可见键盘焦点。错误使用 alert，运行进度使用 live region，并支持减少动效与 forced colors。
