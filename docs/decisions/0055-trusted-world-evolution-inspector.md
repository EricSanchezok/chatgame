# 本地受信任的世界演化调试器

## Status

Accepted
Class: feature

## Context and Problem Statement

Living World Engine 的已提交历史、每个 Agent 的独立认知和运行时事件已经能够解释世界为何到达当前状态，但公开会话只投影玩家可知信息。开发者需要在同一界面关联 step、行动、检定、随机承诺、状态操作、Observation、AgentMind 更新、失败尝试和模型调用证据。直接扩充玩家 API 会破坏 [0031](0031-epistemic-multi-agent-truth-engine.md) 的认知隔离；只展示公开摘要又不足以定位联合裁决和个体演化问题。

## Decision Drivers

- 调试者必须从整个世界提交主干自由切换到任一玩家或 Agent 的个体演化。
- 已提交状态只能由 canonical history 的同一重放语义派生，不能建立第二套 delta 应用器或持久事实源。
- 失败、取消和回滚必须读取 [0059](0059-unified-execution-kernel-and-ledger.md) 的 Execution Ledger，不建立调试器专用事实源。
- 玩家 Session API、WorldRun SSE、assistant-ui 消息和 AgentMind 上下文仍必须保持认知隔离。
- 调试器只读；查看失败不能阻塞、回滚或改变世界运行。
- 大图需要可缩放、可搜索、可线性替代，并在布局计算期间保持浏览器主线程可交互。

## Considered Options

- 不提供产品内调试器，只使用 SQLite Ledger 和命令行。
- 只用玩家公开 API 生成脱敏的演化摘要。
- 把完整真相与审计加入现有 Session API 和 WorldRun SSE。
- 建立独立、只读、本地受信任的 inspector 类型、路由和工作台——所选路线。

## Decision Outcome

新增 `src/shared/world-inspector-api.ts` 独立契约与 `/api/sessions/:id/inspector/**` 只读路由。设置中的“显示世界调试器”默认关闭，只控制控制球入口与剧透体验，不是权限边界；本地部署中的 inspector 路由始终可用。该表面是认知隔离的唯一客户端例外：公开 `world-api.ts`、WorldRun SSE、assistant-ui 消息和 AgentMind 输入仍不能收到 canonical binding、其他主体认知、隐藏检定或调试审计。

已提交图谱和任意 revision 前后状态通过事务校验器共用的 `replayCommittedHistory` 生成。每一步先注册全部可引用节点再连接因果边，窗口只返回两个端点都存在的边，分页不能产生悬空引用。WorldHost 使用以 session、world hash、当前 revision 和查询窗口为身份的 64 项有界 LRU 缓存 committed 图谱与 step 快照；缓存只保存可重建派生值，不进入 SQLite。RuntimeEvent 是 SQLite Execution Ledger 的查询投影，Inspector 按 session 与全局 sequence 读取同一事件表。独立 SSE 使用进程 epoch 与全局 sequence；旧 epoch、过期或超前游标收到 resync。

控制球工具区打开接近全屏的 Radix `WorkspaceDialog`。工作台提供 React Flow 因果图、Git 风格时间线、Agent 透镜、搜索、隔离、追随最新、minimap 与按需详情。图谱首帧使用确定性拓扑排布，随后由 Web Worker 内的 ELK Layered 精排；worker 失败时保留首帧排布。布局完成状态绑定当前可见节点与边的拓扑签名，切换 Agent 聚焦后不得复用旧图的完成状态；minimap 在当前拓扑的精排坐标可用后挂载。详情先把世界提交归纳为结果链，把 Agent 提交归纳为行动、观察、认知变化与尚未执行的后续计划；非空技术阶段按需展开，完整对象只进入原始记录。移动端默认时间线，详情在同一全屏工作台下方展开。所有交互只查询数据，不提供回滚、重跑、分叉或状态写入。

### Consequences

- 本地调试者可以查看会剧透的客观真相、身份 binding、所有 Agent 认知和已记录的 full payload；共享或远程部署必须在宿主层另加认证，设置开关本身不提供安全性。
- [0059](0059-unified-execution-kernel-and-ledger.md) 之后正式运行始终保留完整 Ledger；Inspector 可查看已记录的模型上下文与结构化输出，但不展示或推断隐藏思维链。
- 图谱、详情和实时流故障不会进入 WorldRun 事务，也不会新增持久 trace。
- React Flow 与 ELK 成为调试工作台依赖；视觉快照、键盘/移动端流程和无障碍扫描覆盖该表面。

## Pros and Cons of the Options

### 只使用存档、日志和命令行

- 好：没有新的浏览器表面或依赖。
- 坏：无法把跨 Agent 因果、提交主干和失败分支放在同一空间中观察，定位成本随 step 和 Agent 数增长。

### 只展示公开摘要

- 好：完全复用玩家安全边界，几乎没有剧透风险。
- 坏：看不到 canonical delta、隐藏检定、belief/character patch 和模型审计，不能承担关键调试窗口的职责。

### 扩充现有玩家 API

- 好：路由和客户端数据流最少。
- 坏：调试能力会永久污染玩家契约，任一普通 UI 消费者都可能意外泄漏完整世界状态。

### 独立受信任 inspector

- 好：完整调试能力拥有清晰命名空间、只读边界与独立流，同时保持玩家和 Agent 认知隔离。
- 坏：本地设置不是授权机制，宿主若开放到不受信任网络必须额外保护这些路由；前端需要维护专业的大图交互。

## Links

- [0031](0031-epistemic-multi-agent-truth-engine.md) — 保持不变的玩家与 Agent 认知隔离。
- [0035](0035-truth-engine-hardening-and-verifiable-audit.md) — committed step 的严格审计内容。
- [0049](0049-world-run-failure-and-stream-boundaries.md) — 失败、取消与回滚边界。
- [0059](0059-unified-execution-kernel-and-ledger.md) — RuntimeEvent、artifact 与 execution 的唯一持久来源。
- [0051](0051-assistant-ui-upstream-session-surface.md) — 控制球与沉浸会话表面。
- [表现层参考](../game-design/presentation.md) — 工作台交互、路由和响应式规格。
- [运行时可观测性](../game-design/runtime-observability.md) — trace 查询、索引和降级契约。
