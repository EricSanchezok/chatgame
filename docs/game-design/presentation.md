# 本地沉浸会话壳

本文是浏览器表现层的参考。引擎运行、持久化与认知隔离见[系统架构](../architecture.md)，选择理由见[决策 0039](../decisions/0039-local-assistant-ui-immersive-session-shell.md)。

## 信息架构

| 路径 | 唯一职责 |
|---|---|
| `/` | 每次进入都显示主菜单；只继续本机明确记录且仍存在的当前存档 |
| `/play/:sessionId` | 显示一个精确 Session 的对话、运行状态与控制球 |
| `/saves` | 列出、进入、重命名和删除独立存档 |
| `/worlds` | 列出已安装世界、导入世界 ZIP 并创建新存档 |
| `/settings` | 调整本机文字比例、减少动效和控制球位置 |
| `/control` | 移动端完整游戏控制页 |

Session 是一段独立存档，包含世界状态、玩家认知、当前目标和全部 WorldRun 历史。多个 Session 可以来自同一世界剧本，但彼此没有共享时间线。浏览器以 `livingworld:current-session` 保存主菜单继续指针；该值只用于导航，不参与服务端状态、权限或排序。指向不存在 Session 的值立即清除，绝不回退选择列表第一项。

## 对话投影

游戏页以 `PublicSessionDetail` 为唯一 React 状态。一个持久 WorldRun 纯投影为一组相邻消息：玩家原始文本是一条 user message，公开事件集合是一条 assistant data message。运行中的 SSE 事件按 sequence 去重并合并到对应 run；消息列表每次从 runs 派生，不另存对话副本。

世界消息以玩家 observation 为主要叙事，补充 outcome、玩家可知替代方向和可见检定。`step.committed` 只更新步数、revision、世界时间与自动保存状态，不生成调试消息。queued/running 显示推演状态；failed 与 step_limit 在原消息中提供重试或继续；取消和其他终态保留为历史结果。

composer 接受 1–4000 字符任意自然语言行动。桌面 Enter 发送、Shift+Enter 换行；触摸主设备 Enter 换行并使用发送按钮。运行期间禁止再次发送并显示停止按钮；停止通过服务端取消资源在安全步骤边界完成。

## 控制与管理

桌面游戏页的 48px 控制球可拖动并按视口象限吸附四角，位置保存在 `livingworld:control-corner`。点击展开指向主菜单、存档、世界和设置的内向径向按钮；键盘可用 Enter/Space 开关、Escape 关闭、Alt+方向键移动。移动端点击直接进入 `/control`，该页复用同一动作清单。

运行中触发离开动作时先确认，再请求取消；拒绝确认则留在当前页面。所有 WorldRun 终态和每个成功步骤都由服务端自动持久化，界面没有手动保存按钮。

存档标题为 1–80 字符。活动 run 存在时删除不可用；其他删除必须经过明确确认。世界 ZIP 冲突不会自动覆盖，玩家必须选择“覆盖并导入”。新建存档后写入当前指针并进入精确 play URL。

## HTTP 资源

| 方法与路径 | 语义 |
|---|---|
| `GET /api/worlds` | 列出已安装 schema v4 世界 |
| `POST /api/worlds/import` | multipart 上传世界 ZIP；`replace=true` 显式替换 |
| `GET /api/sessions` | 返回按更新时间倒序的 `PublicSessionSummary[]` |
| `POST /api/sessions` | 以 `scriptId` 和可选非负 seed 创建 Session detail |
| `GET /api/sessions/:id` | 返回 `{ summary, state, runs }` |
| `PATCH /api/sessions/:id` | 修改标题并返回 detail |
| `DELETE /api/sessions/:id` | 删除无活动 run 的 Session，成功返回 204 |
| `POST /api/sessions/:id/runs` | 提交自然语言目标，返回 202 与精确 `{ runId }` |
| `GET /api/sessions/:id/runs/:runId` | 返回 `{ run, state }` 组合快照 |
| `POST /api/sessions/:id/runs/:runId` | 重试 failed/step_limit run |
| `DELETE /api/sessions/:id/runs/:runId` | 请求安全取消 |
| `GET /api/sessions/:id/runs/:runId/events` | 从 `Last-Event-ID` 或 `after` 游标重放并订阅 SSE |

公开 API 版本为 v2。Session 磁盘文档使用 schema v4；旧版本直接拒绝。列表摘要只包含存档与世界元数据、公开进度和可选活动 run，不携带玩家知识或 run 历史；单项 detail 才包含公开玩家状态和全部 run。

## 安全与可访问性

浏览器只使用 `src/shared/world-api.ts`。公开状态不包含 canonical truth、bindings、Agent belief、隐藏检定、内部模型错误或完整审计 delta。assistant-ui 只在本地渲染 External Store，不启用 Assistant Cloud、账号、附件、分支或外部线程存储。

当前部署信任边界是默认只监听 loopback 的本机操作者，Route Handler 没有用户认证与 owner 字段；它们不得原样暴露到不受信任网络。远程部署需要独立安全设计。

所有组件颜色只消费根主题声明的 `--cg-*` token。主要目标至少 44×44px，交互有可见键盘焦点，错误使用 alert，运行与保存状态有文本标签。布局覆盖窄屏、文字缩放、系统减少动效、应用内减少动效和 forced colors。
