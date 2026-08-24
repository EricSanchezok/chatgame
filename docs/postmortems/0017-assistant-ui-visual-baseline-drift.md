# assistant-ui 会话视觉基线漂移

## Executive summary

游戏页声称采用 assistant-ui，但合并实现只接入了 headless primitives，删除官方依赖的 Tailwind/PostCSS 样式栈，并用自制 header、账本消息和 sticky 输入框替代官方 `Thread`。玩家发送第一条消息后，输入框从空态位置跳到消息下方；超宽屏留下巨大空白，控制球不能自由拖动，移动端还离开对话跳往独立页面。功能测试使用一套过度简化的 assistant-ui mock，只验证文本、按钮和 API 状态；E2E 同样没有比较 composer 几何、真实拖动、主题或视觉快照，因此“逻辑能走通”掩盖了整个会话表面的退化。持久教训是：采用 UI 上游必须固定源码拓扑和视觉基线，真实浏览器测试必须验证几何与交互，而不是只验证内容存在。

## Summary

[0044](../decisions/0044-local-assistant-ui-immersive-session-shell.md) 正确保留了 `WorldRun → External Store` 的单一数据路径，但实现把“使用 assistant-ui”缩减成安装 `@assistant-ui/react` 和调用部分 primitives。官方 registry 的 44rem 会话轴、居中 welcome、消息组、`ViewportFooter`、圆角 composer 与底部滚动结构没有进入代码；Tailwind 和 PostCSS 反而被删除。页面继续显示 session header 和运行计数，将世界回复做成带分隔线的 ledger，并用普通容器的 sticky 区域承载输入框。

控制球沿用四角枚举，只能在预设位置间切换。桌面展开项和状态缺少稳定的视口避让，移动端点击直接进入 `/control`，破坏“对话是唯一主舞台”的产品决策。页面在暗色主题中使用独立复古字体与固定视觉语言，其余管理路由又是另一套产品。

## Timeline

1. [0044](../decisions/0044-local-assistant-ui-immersive-session-shell.md) 选择 assistant-ui External Store 与 data part 薄适配，但只约束状态权威和能力边界，没有固定官方 `Thread` 源码。
2. 实现接入 headless primitives，却删除 Tailwind/PostCSS 和 registry 基础组件，布局继续建立在旧会话工作台 CSS 上。
3. 组件测试为 assistant-ui 写了本地 mock；mock 自己实现 `Empty`、`Messages` 和 composer，既没有 `ViewportFooter`，也没有浏览器滚动与布局行为。
4. E2E 验证世界导入、消息出现、失败放弃和移动端 `/control` 跳转；它把错误的信息架构当作预期，并未记录 composer 坐标、控制球中途拖动或任何视觉快照。
5. 真实用户在 5120px 页面上看到首条消息后输入框上跳、会话轴松散、控制球不可拖动且样式粗糙，确认问题不是单个 CSS bug，而是上游基线整体丢失。
6. 会话表面按当前 registry 重建，旧 header、ledger、四角位置、ControlScreen、`/control` 和对应测试一次删除。

## Root cause

决策把 assistant-ui 当作运行时适配库，却没有把官方 `Thread` 当作需要版本化的产品上游。没有 commit、registry 哈希、允许差异列表或源码拓扑门禁后，“使用 primitives”在评审中被等同于“采用 assistant-ui”，而样式工具链被误认为可删除的脚手架。布局代码和 API/SSE 状态机又集中在同一个大组件中，使重建视觉表面看起来会触碰运行语义，团队更倾向继续局部打补丁。

测试的替身比生产环境简单得多。组件 mock 只回答“当前有哪些消息、按钮能否点击”，无法表达 flex 剩余空间、sticky footer、滚动锚点、Pointer Events、焦点约束或安全区。E2E 的断言也全部是 URL 和文本存在性，没有几何容差、宽屏结构、视觉快照和 axe 状态矩阵。于是每一张安全网都验证了实现自述，而没有验证用户看到和操作的真实界面。

## Guardrails

- [决策 0051](../decisions/0051-assistant-ui-upstream-session-surface.md) 固定 `@assistant-ui/react` 版本、上游 commit、registry SHA-256、官方核心拓扑和允许的本地差异。
- `GameSession`、WorldRun 公开表现和 `GameThread` 分离；会话视图不再持有 API、SSE 或重连状态机的实现。
- 源码契约测试要求 `Root → Viewport → Messages → ViewportFooter`，并拒绝已弃用的 `ThreadPrimitive.Empty`。
- Playwright 在首条与后续消息后记录 composer 底部坐标，误差超过 2px 即失败；同时覆盖 2560/5120 宽度的 44rem 居中轴、Shift+Enter 与真实生产入口。
- 控制球测试覆盖归一化位置、最近边缘、composer 排除区、键盘移动、径向方位、中途跟随指针、松手吸边、刷新恢复和移动 Sheet 不离开会话页。
- light/dark 在 1440×900 与 390×844 建立视觉快照；空态、完成、失败、径向菜单、移动 Sheet、forced-colors 和 reduced-motion 进入 axe/浏览器回归。
- 旧 `/control`、四角键、旧 header、ledger 与自制 sticky composer 被删除，不保留兼容路径或隐藏回退。
