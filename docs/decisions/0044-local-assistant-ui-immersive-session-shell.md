# 本地 assistant-ui 沉浸会话壳与存档资源

## Status

Accepted
Class: architecture

## Context and Problem Statement

单页工作台把世界安装、会话选择、运行状态和逐事件调试信息堆在同一界面，并默认读取会话列表第一项。它既不能表达多个独立存档，也让玩家面对引擎术语而不是世界叙事。应用按本机部署或桌面发行运行，没有云端多租户、远程账号和跨用户资源共享边界；引入账号认证会增加不存在的身份模型，却不能代替存档资源本身的明确寻址。

## Decision Drivers

- 每个 Session 必须是一段可命名、可选择、可删除的独立存档，不能由数组顺序隐式决定当前存档。
- 玩家主流程必须是标准对话体验，WorldRun 与服务端 Session 仍是唯一状态权威。
- 前端组件库不能引入云端存储、外部认证、第二套线程持久化或模型调用路径。
- 主菜单、世界安装、存档管理和设置需要稳定独立路由，并在刷新后保持可直接寻址。
- 运行中导航、取消、失败重试、步骤上限继续、自动保存和 SSE 重连必须保留真实服务端语义。
- 旧工作台、旧样式、旧测试和旧 Session 文档不得形成兼容双轨。

## Considered Options

- 继续迭代自研单页工作台。
- 整体嵌入带后端、账号和云线程的完整开源聊天产品。
- 使用 assistant-ui 原语渲染由 WorldRun 投影的单线程对话，并由独立本地路由管理存档与世界——所选路线。
- 为本地 API 增加账号认证与会话所有权字段。

## Decision Outcome

应用入口固定为主菜单，游戏使用 `/play/:sessionId` 精确寻址；`/saves`、`/worlds`、`/settings` 与移动端 `/control` 分别承载存档、世界、偏好和控制导航。主菜单只继续 `localStorage` 明确记录且仍存在的 Session，不回退到列表第一项。桌面游戏页提供可拖动并吸附四角的控制球，点击展开共享动作清单；移动端点击进入完整控制页。运行中离开先请求玩家确认并通过现有取消资源在安全步骤边界停止。

对话层使用 MIT 许可的 `@assistant-ui/react` 原语和 `useExternalStoreRuntime`。每个持久 `WorldRun` 按其 `player.input` 边界纯投影为玩家/世界消息段；clarification 仍属于同一个 run，不创建第二份线程状态。世界消息使用 data part 展示公开 observation、由玩家 outcome Observation 派生的 outcome、可见检定与运行终态；内部 ActionOutcome alternatives 不进入公共事件。前端不启用 Assistant Cloud、线程列表、附件、分支、编辑、重新生成或第二套消息存储。新目标、补充信息、取消和重试仍只调用 [0033](0033-persistent-streaming-world-runs.md) 与 [0040](0040-resumable-player-intent.md) 定义的 WorldRun API，SSE 事件合并回唯一 `PublicSessionDetail`，消息数组始终由其派生。

Session 持久化文档使用 schema v9，在 [0039](0039-pinned-world-runtime-contract.md) 的固定世界契约上增加 1–80 字符标题；旧文档直接拒绝。公开 API 版本为 v4：列表返回含世界摘要、更新时间、步数和活动 run 的 `PublicSessionSummary`，单项读取与创建返回 `{ summary, state, runs }`，failed 事件携带真实 `retriable`，SSE 对边界尾游标返回 204。PATCH 通过 generation CAS 修改标题，DELETE 按目标 generation 永久删除；queued/running 时两者都拒绝，避免元数据写入使在途步骤失效。浏览器当前 Session 指针只是本机导航偏好，不是状态所有权或访问控制。

运行边界是单机进程与本机文件系统，开发和生产启动命令默认只监听 loopback。应用不建立用户、登录、cookie 会话或 Session owner；所有能访问本地监听端口的调用者都被视为同一设备操作者。若部署形态出现非 loopback 暴露、共享主机或远程访问，必须新增安全决策并同时定义身份、授权、CSRF、监听地址和数据隔离，不能把本决策外推为公共网络安全模型。

表现层采用宿主根部声明的 `--cg-*` token、叙事/界面/等宽三类字体、44px 最小目标、可见焦点、forced-colors 与减少动效。旧工作台组件、Tailwind/PostCSS 接线、旧选择首项逻辑和对应测试全部删除，不保留别名或隐藏回退。会话与世界继续由 [0041](0041-local-sqlite-runtime.md) 的单一 SQLite 数据库持久化；界面不恢复文件存储旁路。

### Consequences

- 多个 Session 成为玩家可理解的多个存档，刷新与链接不会因列表顺序进入错误世界。
- assistant-ui 提供成熟的 composer、消息和滚动原语，但应用只承担一层薄适配，升级时需验证 External Store 与 data part 契约。
- 没有认证让单机安装保持简单，也明确禁止把当前 Route Handler 原样暴露到不受信任网络。
- Session v9 断代会拒绝旧本地存档，符合快速迭代期不维护迁移层的约定。
- 独立路由增加页面表面，但共享管理壳、控制动作清单、浏览器偏好模块与单一 API 客户端避免复制导航和状态逻辑。

## Pros and Cons of the Options

### 继续迭代单页工作台

- 好：依赖最少，改动范围小。
- 坏：会话选择、世界安装和调试时间线继续挤压叙事主舞台，聊天基础交互需要重复维护。

### 嵌入完整聊天产品

- 好：开箱提供账号、线程、模型适配、附件和管理界面。
- 坏：它的线程与模型后端会和 Session/WorldRun 争夺权威，并带入本地游戏不需要的部署与认证系统。

### assistant-ui 薄适配与独立本地路由

- 好：复用可访问的聊天原语，同时保留引擎、持久化、SSE 和导航的单一实现。
- 坏：需要维护 WorldRun 到消息 data part 的明确投影，并跟踪组件库的 API 变化。

### 本地账号认证

- 好：若服务被远程共享，可以表达调用者身份和资源所有权。
- 坏：当前没有多用户或远程信任边界，账号、cookie、密码恢复和授权策略只会制造虚假安全感与冗余状态。

## Links

- [0004](0004-game-first-principles.md) — 游戏第一与框架通用性的根原则。
- [0033](0033-persistent-streaming-world-runs.md) — 保留的 WorldRun、SSE、原子持久化与取消边界。
- [0034](0034-truth-engine-verification-matrix.md) — 真实生产入口与无障碍验证矩阵。
- [0039](0039-pinned-world-runtime-contract.md) — 会话固定世界运行时契约。
- [0040](0040-resumable-player-intent.md) — clarification 恢复同一目标与 WorldRun。
- [0041](0041-local-sqlite-runtime.md) — Session 的唯一 SQLite 持久化与 CAS 边界。
- [0043](0043-end-to-end-runtime-observability.md) — HTTP、运行与持久化操作的关联观测。
- [0049](0049-world-run-failure-and-stream-boundaries.md) — 终态 204、连接 epoch、失败重试与放弃语义。
- [表现层参考](../game-design/presentation.md) — 当前浏览器路由、会话投影与交互契约。
- [系统架构](../architecture.md) — 模块边界和部署信任边界。
