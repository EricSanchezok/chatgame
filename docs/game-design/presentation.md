# World Instance API 与参与体验

## 安全边界

普通产品界面只使用 `src/shared/world-api.ts`。公开 DTO 包含 World Instance 摘要、公共事件、Participant 摘要、公开 Origin/角色预览以及当前 Principal 所控制角色的授权视角；不包含 canonical truth、canonical binding、其他 Agent belief、隐藏检定或完整模型审计。

本地受信任 Inspector 使用独立的 `src/shared/world-inspector-api.ts` 和 Inspector 路由。Inspector 数据不能回流到公开事件、角色视角或行动上下文。

当前 Principal Resolver 从 `x-lwe-principal` 读取稳定身份，本地默认值为 `local`。产品入口限制一个 active Participant；持久状态、ActionWindow 和服务端投影以复数 Participant 建模。

## HTTP 资源

| 方法与路径 | 语义 |
|---|---|
| `GET /api/worlds` | 列出已安装的 schema v8 世界及 headless/open 参与能力 |
| `POST /api/worlds/import` | 导入或显式替换世界 ZIP |
| `DELETE /api/worlds/:id` | 在没有关联实例时卸载世界 |
| `GET /api/worlds/:id/assets/:hash` | 以不可变 content hash 读取已验证静态图片 |
| `GET /api/instances` | 按更新时间列出 World Instance |
| `POST /api/instances` | 以 `worldId`、可选标题和可选 uint32 seed 创建实例 |
| `GET /api/instances/:id` | 读取 Principal 权限下的公开实例详情 |
| `PATCH /api/instances/:id` | 重命名实例 |
| `DELETE /api/instances/:id` | 删除实例 |
| `POST /api/instances/:id/advance` | 按 expected revision 执行单步、批量或 realtime 触发 |
| `PUT /api/instances/:id/realtime` | 启动或暂停严格串行实时调度 |
| `POST /api/instances/:id/participants` | 从 Origin 创建角色或认领已有 Agent |
| `POST /api/instances/:id/participants/:participantId/actions` | 幂等提交当前 ActionWindow 的外部行动 |
| `POST /api/instances/:id/participants/:participantId/release` | 将角色交还 model 策略或置为 idle |
| `GET /api/instances/:id/inspector` | 分页读取 committed 图谱、Agent 与 execution attempt |
| `GET /api/instances/:id/inspector/steps/:revision` | 读取一个 revision 的提交证据 |
| `GET /api/instances/:id/inspector/attempts/:executionId` | 读取成功、失败或回滚 execution 的事件 |
| `GET /api/instances/:id/inspector/runtime-events/:eventId` | 读取一条 Ledger RuntimeEvent 的完整 payload |
| `GET /api/instances/:id/inspector/events` | 订阅本地调试 SSE；断线不重新执行世界 |

所有改变世界或参与状态的请求使用 revision CAS。模型、持久化、验证或调度失败不得推进 revision；失败 execution 仍保存在 Execution Ledger。外部行动以 `submissionId` 幂等，同一 revision 的冲突提交返回冲突而不是覆盖。

## 世界推进

单步只调用一次统一推进入口。批量推进重复该入口，遇到外部 ActionWindow 就停在可恢复边界。实时调度在上一步结束后才安排下一次触发；重启只从当前时间恢复，不补算离线 backlog。

零 active Participant 时，所有 model/idle/replay 策略直接产生行动并推进。有 external 策略时，引擎为当前 revision 打开唯一 ActionWindow；收齐所有必需 Agent 的提交后推进，deadline 到期则为缺失者生成 typed noop。

## 浏览器流程

`/worlds/:worldId` 创建或打开 World Instance；`/play/:instanceId` 是唯一世界体验页。页面由公共世界舞台、演化控制和 Participant 侧栏组成，不维护独立于服务端状态的会话事实。

旁观者可以查看公共事件，并执行单步、十步、实时或暂停。没有 `participation.yaml` 的世界只显示旁观能力。公共事件只包含所有主体均获授权的事件，不暴露某个 Agent 的私有 Observation。

“进入世界”展示可认领 Agent 和 Origin。认领前只展示公开名称、描述和位置；成功后才返回该角色的 character、belief 和 Observation。Origin 允许填写显示名称、外观描述和一个自由动机；出生点、资源、角色基础和 Agent ID 由剧本与内核确定。

准入成功后，Arrival Generator 只读取新角色获授权的视角，输出标题、第一人称场景和三条可编辑建议。建议只填充行动输入，不自动提交；生成失败显示 Origin 的回退文本，已经成功的角色准入不会回滚。

真人控制时，Agent 保留位置、历史和私有认知，但不运行 AgentMind。释放时可以交给 AgentMind 继续生活或保持 idle；托管先消化控制期间遗漏的本角色 Observation，再恢复 model 策略。释放后的角色可以再次认领。

## 界面约束

界面只使用内置组件、Lucide 图标和 `--cg-*` 颜色 token，世界包不能注入 UI。所有流程支持键盘、可见焦点、触控目标、320 px 宽度、200% 缩放、RTL、减少动态效果和无图片回退。

长 execution ID、错误、canonical/runtime ID 和 JSON 必须在自身容器内换行或滚动，不能扩大 Participant 侧栏或 Inspector 对话框。模态框关闭后焦点返回触发控件；Arrival 建议和世界控制必须公开可理解的可访问名称。

设计依据见 [0061](../decisions/0061-unified-agent-and-external-policy.md)、[0062](../decisions/0062-world-instance-participation-and-action-window.md) 与 [0063](../decisions/0063-eager-reference-execution.md)。
