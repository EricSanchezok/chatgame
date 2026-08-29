# 会话时间线轨道与状态化 Composer

## Status
Accepted
Class: feature

## Context and Problem Statement

世界会话同时包含可提交行动、长程 WorldRun、暂停/恢复、反应窗口和 Observer 只读观察。输入区如果在所有状态都保持可见，会让不可提交的页面看起来像仍然可以操作；消息较长时，用户也缺少定位历史世界边界的轻量导航。

## Decision Drivers

- 不可提交时必须从交互表面移除输入，而不是只禁用发送按钮。
- Participant、Observer、暂停和反应窗口必须共享同一消息轴。
- 桌面需要历史定位能力，但不能引入永久资料侧栏或第二条滚动轴。
- 轨道只能消费现有公共投影，不得暴露 canonical truth 或其他主体认知。
- 移动端 320px 宽度、键盘、reduced motion、forced colors 和 RTL 需要保持可用。

## Considered Options

- 始终显示禁用的 composer，并把运行状态放在输入框内部。
- 增加永久右侧资料栏，同时放置进度和世界状态。
- 采用状态化 composer，并在桌面使用独立的消息时间线轨道——所选路线。

## Decision Outcome

Participant composer 只在当前 Participant 可以提交自然语言行动时挂载。`queued`、`running`、`pausing` 和提交请求处理中使用紧凑运行状态条；`paused`、`budget-paused`、`preparation-invalidated`、`awaiting-decision` 与未提交的 reaction window 保持输入可用。Observer 永远不挂载 composer。

桌面游戏页使用固定的消息时间线轨道。轨道按当前权限投影的世界回复生成刻度，当前刻度显示轻量预览卡；点击刻度只滚动现有会话 viewport，不产生世界状态变化。轨道不替代原生滚动条，也不显示 canonical identity、隐藏检定或其他 Agent 的私有信息。移动端隐藏轨道并保留会话内的滚动到最新控制。

游戏外壳保持无侧栏的沉浸式单轴布局。世界名称、当前位置、世界时间和 step 作为轻量上下文悬浮在画布边缘；存档、设置、视角、控制转移和 Inspector 继续由控制球提供。

## Pros and Cons of the Options

### 始终显示禁用 composer

- 好：底部高度稳定，用户始终能看到输入入口。
- 坏：不可提交时产生错误 affordance，并占据长文本阅读空间。

### 永久右侧资料栏

- 好：状态信息可持续可见。
- 坏：压缩消息轴，形成第二条布局和滚动语义，移动端还需要另一套抽屉行为。

### 状态化 composer 与消息时间线轨道

- 好：交互状态与视觉 affordance 一致，历史定位不破坏单轴会话，轨道只使用已有投影。
- 坏：composer 挂载/卸载会改变底部高度，轨道需要维护 viewport 观察和窄屏降级。

## Links

- [0064](0064-conversation-core-and-agent-perspective-observer.md) — Participant 与 Observer 的统一会话投影。
- [0070](0070-event-boundary-temporal-runtime.md) — WorldRun、暂停和反应窗口的时间边界。
- [表现层规格](../game-design/presentation.md) — 当前游戏会话与权限边界。
