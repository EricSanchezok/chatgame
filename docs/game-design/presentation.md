# World Instance API 与会话体验

## 投影边界

公共产品契约为 `src/shared/world-api.ts`（API v7）。Participant DTO 只包含本人控制角色的 Arrival、行动、Observation 与授权私有状态；对话由这些持久事实投影，不保存独立聊天记录。

Observer 契约为 `src/shared/world-observer-api.ts`。它每次只返回所选 Agent 的行动、Observation、character 与 belief，并移除 canonical binding；切换 Agent 不形成跨主体认知聚合。

本地受信任 Inspector 使用 `src/shared/world-inspector-api.ts`。它可以读取 canonical truth、隐藏检定、全部认知和 Execution Ledger，因此默认不可见，数据不能进入 Participant 或 Observer 投影。

当前 Principal Resolver 从 `x-lwe-principal` 读取稳定身份，本地默认值为 `local`。产品入口限制一个 active Participant；World Instance、PolicyBinding 和 ActionWindow 以复数 Participant 建模。

## HTTP 资源

| 方法与路径 | 语义 |
|---|---|
| `GET /api/worlds` | 列出已安装的 schema v10 世界 |
| `POST /api/worlds/import` | 导入或显式替换世界 ZIP |
| `DELETE /api/worlds/:id` | 在没有关联实例时卸载世界 |
| `GET /api/worlds/:id/start-options` | 读取 Origin 与 Observer 准入选项 |
| `GET /api/worlds/:id/assets/:hash` | 读取已验证的不可变静态图片 |
| `GET /api/instances` | 列出 World Instance |
| `POST /api/instances` | 以 Origin 或 Observer 原子创建实例 |
| `GET/PATCH/DELETE /api/instances/:id` | 读取、重命名或删除实例 |
| `POST /api/instances/:id/advance` | Observer 单步或批量推进 |
| `PUT /api/instances/:id/realtime` | Observer 启停严格串行实时调度 |
| `GET /api/instances/:id/observer` | 按 AgentId 读取单主体 Observer 投影 |
| `GET/PUT /api/instances/:id/control` | 读取可接管 Agent 或原子转移控制权 |
| `POST /api/instances/:id/participants/:participantId/actions` | 幂等提交自然语言行动并自动推进一次 |
| `GET /api/instances/:id/events` | 订阅只含重新读取提示的实例更新 SSE |
| `GET /api/instances/:id/inspector/**` | 读取本地受信任 Inspector 投影与 Ledger 证据 |

所有改变世界或控制状态的请求使用 revision CAS。行动以 `submissionId` 幂等；重复请求返回已投影结果，不重复推进。失败步骤保留安全失败消息、关闭 ActionWindow 且不推进 revision；内部错误只存在于 Ledger 和 Inspector。

## 创建与控制

世界详情页的“开始新游戏”在当前 URL 打开两阶段准入对话框。第一阶段是可横向切换的身份牌组，全部 Origin 与 Observer 作为同级卡片；Origin 有图片资产时显示图片，缺失时由宿主显示默认身份卡面。选定 Origin 后，第二阶段才收集名字、外观和动机。取消不创建实例；确认后执行 bootstrap、Origin admission、Arrival 与实例持久化，再进入 `/play/:instanceId`。Arrival 失败使用 Origin 回退旁白。

Observer 创建不生成 Participant。Observer 可以推进无人世界、选择任一 Agent 的视角，并接管任意存活且未被 external 策略占用的 Agent。接管持久化新的视角 Arrival；退出或切换角色在一个 CAS 中把原角色恢复为 model 策略。

缺失 `participation.yaml` 的世界没有 Origin，但仍支持 Observer 与接管已有 Agent。

## Participant 会话

Participant 页面使用 44rem 单轴 assistant-ui 消息流。第一条 World 消息是持久 Arrival；玩家行动为右侧自适应气泡，World Observation 为无气泡正文。Arrival 的三条建议只填入 composer。

composer 只负责发送、失败重试和可选的高级 detach，不提供单步、批量或实时按钮。发送行动时，服务端自动创建 `participant_action` advance 和当前 revision 的 ActionWindow；收集完整后只执行一次统一推进入口。

对话 projection 依次关联 Participant intent、advance 和 committed Observation。刷新、重复提交和服务重启不会新增消息或重复行动。

## Observer 会话

Observer 使用同一消息布局的只读形式。每条记录由所选 Agent 在某个 revision 的行动与收到的 Observation 构成；footer 提供 Agent 切换、单步、十步、实时、角色信息和接管。

Observer 不能提交角色行动。接管成功后页面切换为 Participant 会话，并以新的持久 Arrival 开始当前控制阶段。

## 控制球与 Inspector

可拖动控制球提供主菜单、存档、设置和角色工具；移动端使用 Sheet。设置中的“高级角色控制”开启 Participant detach 与直接切换；“显示世界调试器”开启 Inspector 工具，并提示其包含剧透、隐藏检定和全部认知。

工具使用注册槽位扩展；没有数据的工具不显示。弹层关闭后焦点返回触发控件，控制球位置在浏览器偏好中恢复。

## 界面约束

界面只使用内置组件、Lucide 图标和 `--cg-*` token；世界包不能注入 UI。体验支持键盘、可见焦点、触控目标、320 px、200% 缩放、RTL、reduced motion、forced colors 和无图片回退。长 ID、错误与 JSON 必须在自身容器内换行或滚动，不能扩大侧栏或对话框。

设计依据见 [0061](../decisions/0061-unified-agent-and-external-policy.md)、[0063](../decisions/0063-eager-reference-execution.md)与 [0064](../decisions/0064-conversation-core-and-agent-perspective-observer.md)。
