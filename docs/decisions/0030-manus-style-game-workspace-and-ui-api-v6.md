# Manus 风格游戏会话工作区与 UI API v6

## Status
Superseded by [0033](0033-persistent-streaming-world-runs.md)
Class: architecture

## Context and Problem Statement

应用页面需要稳定导航，游戏会话需要沉浸、连续且单轴的阅读体验。把两类任务放进同一个展开式 AppShell 会让游戏侧栏、顶部读数、资料面板和剧本自定义 chrome 与对话争夺层级；允许剧本分别覆盖 HUD、工具栏、composer 和暂停菜单又会形成多套交互实现。巨幅媒体、右侧 Sheet、横向行动胶囊和常驻资源矩阵进一步破坏正文与输入框的共同轴线。

## Decision Drivers

- 游戏会话必须以一条稳定阅读轴和一个主滚动容器组织消息、媒体、建议行动与输入。
- 资料入口必须可识别、可访问，并且不能占用正文布局轨道。
- 宿主必须唯一持有 composer、资料入口、Dialog、暂停与保存退出行为。
- 剧本仍需定义动态目标、建议行动和世界专属资料，但不能复制宿主交互壳。
- 桌面、移动端、超宽屏、200% 文字、高对比和减少动效必须共享同一信息层级。
- 快速迭代期直接拒绝旧 UI API，不维护兼容路径或双轨组件。

## Considered Options

- 保留 AppShell 游戏侧栏并继续压缩 HUD、媒体和 composer。
- 采用永久右侧资料面板，把对话和资料组成双栏工作区。
- 采用 Manus 风格单轴会话工作区，以悬浮工具栏和居中 Dialog 承载资料，并将剧本动态表现收敛为纯函数 provider。

## Decision Outcome

`HostAppShell` 只服务启动器、剧本库和设置。默认游戏壳使用 `cg-game-workspace`：52px 顶部状态栏只显示“地点 · 时间”和当前目标；页面本身不滚动，`.cg-conversation-scroll` 是唯一纵向滚动容器。桌面左侧是脱离正文布局的 56px 悬浮工具栏，固定提供人物、背包、任务、地图、档案和分隔后的游戏菜单；每个入口使用 Lucide 图标、Tooltip、完整可访问名称和至少 44px 目标。小于 1024px 时工具栏隐藏，顶部按钮打开五项资料选择器。

人物、背包、任务、地图和档案都由 Base UI 居中 Dialog 承载；普通资料最大约 720px，地图最大约 960px，移动端进入安全区内近全屏布局。人物合并玩家状态、声望、关系和已知 NPC；档案只呈现世界事件与剧本记录，不复制聊天转录。NPC 身份行直接打开人物资料并定位对应角色。游戏内没有 Sheet 或永久右栏；Escape 关闭顶层 Dialog 并恢复触发点，没有覆盖层时才打开游戏菜单。

会话与 composer 共享 52rem 中心轴。世界与 NPC 消息平铺；连续且说话人相同的消息组成一个视觉组，只在组首显示 24px 头像、姓名和职业身份行。世界正文按 CommonMark/GFM 的段落、列表、引用、代码和表格语义渲染，源文本中的单个换行不制造硬折行；玩家输入保留其主动换行，消息按内容内在宽度右对齐，最大 34rem，使用低对比填充。系统结果、判定与任务变化附着在对应世界回复内。地点和事件图片最大 40rem、16:9，并受视口高度约束；同一回复有多张媒体时只有第一张占据主宽度，后续媒体降级为较小的从属卡。标题与说明属于同一紧凑 caption，点击图片打开居中 lightbox。

只有最新世界回复展示最多三个纵向建议行动。建议属于回答 footer，不使用标题、方向图标或独立卡片背景；点击后把文字写入 textarea、聚焦输入框并调用权威 `previewAction`。预检在 composer 内显示耗时、成本、风险或不可执行原因。输入文本发生任何编辑时，建议 hint、旧预检和竞态中的迟到结果立即失效。composer 是会话轴底部唯一的粘性圆角表面，空态约 60–64px；textarea 在换行或长文本时自动增长到 9rem 后内部滚动，不再嵌套第二层 InputGroup，也不常驻显示快捷键提示。Enter 发送、Shift+Enter 换行，并忽略中文 IME composing 的 Enter；快捷键通过输入框的隐藏说明暴露给辅助技术。界面只有一个 44px 发送按钮；离开底部时显示“跳到最新消息”。

活动滚动表面使用共享 `useScrollActivity` 行为。WebKit 槽宽 4px、token 化 thumb 约 2px，Firefox 静止时隐藏并以 thin 活动态作为回退；滚动、hover 或 focus 时显示，停止约 500ms 后淡出。高对比模式保持滚动条可见。游戏会话强制 `overflow-x: hidden`，不得产生横向滚动条。

UI API 直接升级为 v6。公开槽位是 `launcher`、`game-shell`、`scene`、`panel:people`、`panel:inventory`、`panel:tasks`、`panel:map`、`panel:records`、`bubble:<id>`、`message-card:<id>` 和 `settings:<id>`；v5 bundle 直接拒绝。`game-shell` 只接收宿主构造的 `topbar`、`conversation`、`toolRail` 和 `overlays` regions，完整覆盖可以重排这些区域，但不能要求默认壳生成第二套 composer 或 toolbar。

`ScriptUiContext.configureGame(presentation)` 每个 bundle 最多调用一次。`GamePresentation` 用同步纯函数 `objective(model)` 和 `suggestions(model)` 返回 `GameObjective` 与最多三个 `GameSuggestion`；执行失败或未配置时使用宿主任务与动作 fallback。五类资料统一由 `GamePanelId` 表达。灰烬镇和星港只注册专属资料 panel，并通过 `configureGame` 提供动态目标与建议；剧本不注册 HUD、目标追踪器、工具栏、composer 或暂停菜单。

公共 runtime 保留受控 `Button`、`Badge`、`Frame`、`FramePanel`、`Input`、`InputGroup`、`Select`、`Switch`、`Slider`、`Checkbox`、`SettingRow` 与 `Textarea`。无消费者的 `ActionChoice`、`Metric` 和旧 slot props 不属于 v6 表面。

## Pros and Cons of the Options

### 保留游戏 AppShell

- 好：应用页和游戏页共享一套外壳，迁移量较小。
- 坏：导航、资料与资源读数持续占据会话构图，侧栏折叠仍留下第二条视觉轴。

### 永久双栏工作区

- 好：资料可以一直可见，适合高密度管理工具。
- 坏：游戏资料不是每回合都需要，右栏压缩正文并在窄屏重新变成另一套抽屉语义。

### 单轴会话与居中资料层

- 好：阅读、媒体、建议和输入共享稳定轴线；资料按需出现；宿主交互实现唯一；剧本扩展边界更小。
- 坏：资料无法与聊天永久并排比较，第三方完整 `game-shell` 需要接受宿主提供的四个 regions。

## Links

- [0029](0029-reui-app-shell-and-ui-api-v5.md) — 被本记录取代的 AppShell 游戏布局与 UI API v5。
- [0024](0024-frontend-workbench-and-ci.md) — 前端工作台、视觉矩阵和真实入口验证。
- [表现层规格](../game-design/presentation.md) — 当前游戏工作区、UI API 和无障碍契约。
- [会话层级复盘](../postmortems/0008-conversation-hierarchy-regressed-again.md) — 几何与快照门禁允许错误层级通过的原因和护栏。
- [0034](0034-truth-engine-verification-matrix.md) — 当前前端与真实入口验证策略。
