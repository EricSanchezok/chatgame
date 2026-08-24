# 以 assistant-ui 上游为会话表面基线

## Status

Superseded by [0052](0052-persistent-game-context-and-world-library.md)
Class: architecture

## Context and Problem Statement

[0044](0044-local-assistant-ui-immersive-session-shell.md) 决定用 assistant-ui 原语承载 WorldRun 会话，但没有把官方 `Thread` 的源码拓扑、样式栈和几何行为写成不可漂移契约。实现随后只保留 headless primitives，移除 Tailwind/PostCSS，并用普通容器、可见 session header、账本式世界消息和自制 sticky composer 重建页面。结果在名称上使用 assistant-ui，实际空态、消息轴、输入框锚点、滚动和控件比例都偏离上游；控制球同时退化为固定角落菜单，移动端还离开对话跳转独立控制页。

会话表面需要一个可核验的上游基线，同时必须继续服从游戏的状态权威、公开知识和本地部署边界。视觉复刻不能引入 Assistant Cloud、第二份线程持久化、客户端模型或引擎逻辑。

## Decision Drivers

- 首屏、消息流、composer 和滚动行为必须与当前 assistant-ui 官方 `Thread` 保持同一结构和比例，不能只复用原语名称。
- `PublicSessionDetail.runs → External Store` 必须继续是浏览器唯一消息路径。
- 空态 composer 居中，有消息后固定于底部；失败、等待和消息数量不能改变其底部锚点。
- 游戏页不显示 sidebar、header 或工作台 chrome，管理能力由不遮挡会话的控制球承载。
- 桌面控制球需要自由拖动、左右吸边和键盘等价操作；移动端需要在当前页面内打开可访问 Sheet。
- 全部路由需要共享 system/light/dark 主题与同一套语义 token，组件不能直接声明颜色。
- 上游升级、结构漂移和几何退化必须由自动化门禁直接失败。

## Considered Options

- 继续修补现有账本式会话和四角控制菜单。
- 只使用 assistant-ui headless primitives，自行维护所有布局和样式。
- 直接嵌入 assistant-ui 完整示例，包括线程栏、附件、模型选择和云端能力。
- 固定官方 `Thread` 源码基线，只保留游戏有真实语义支撑的差异——所选路线。

## Decision Outcome

`@assistant-ui/react` 固定为 `0.15.16`。会话表面以 2026-08-24 获取的官方 `https://r.assistant-ui.com/thread.json` 为基线；当时 assistant-ui 仓库 HEAD 为 `231d14896f3a2b2bb65d7844e65eca17f9151399`，registry 内容 SHA-256 为 `929f6b7f205ff3a2bfc5fc4ff8c7a4dee73628fa284b4c992ba85205f7462f72`。升级依赖或重新同步 registry 时必须更新这里的提交、内容哈希和回归快照，不能无记录漂移。

允许的本地差异只有：删除 sidebar 与可见 header；使用中文游戏文案；用 WorldRun data part 渲染公开叙事、检定和运行边界；没有真实后端能力的建议、附件、语音、编辑、分支、重新生成和模型选择不渲染。官方核心拓扑保持为 `ThreadPrimitive.Root → flex Viewport → 44rem message group → ThreadPrimitive.ViewportFooter`。空会话只在会话轴中间显示“你想做什么？”和 composer；出现第一条消息后 footer 使用 `mt-auto + sticky bottom-0`，并为安全区、composer 高度和自动滚动保留空间。玩家消息是右侧自适应低对比气泡，世界消息是无气泡正文；复制操作使用由同一 WorldRun 派生的公开纯文本 part，不暴露对象或内部状态。

`GameSession` 只负责 API、SSE、重连、并发操作和 External Store；WorldRun 公开表现与 `Thread` 视图独立。运行中只出现真实可执行的停止操作；请求已提交但尚未确认 run 时保持发送锁并显示确认状态，不伪造可取消能力。网络与连接异常进入会话轴 live region，不恢复可见 session header。

全产品以 `next-themes` 作为主题偏好的唯一来源，支持 `system | light | dark`，默认 `system`。根布局用 `.dark` 切换 assistant-ui 明暗 OKLCH 语义色，并映射为唯一 `--cg-*` token；Tailwind 颜色也只能消费这些 token。键盘焦点统一使用明暗主题分别验证的蓝色 `--cg-ring`，普通组件只在 `:focus-visible` 绘制指示，composer 保持静态边框并用同一 token 的柔和外层光晕表示输入焦点，forced-colors 使用系统 `Highlight`。正文统一使用 Inter、IBM Plex Mono 与中文系统字体回退。设置页只写 next-themes 偏好；原文字缩放和减少动效偏好继续独立存在。

桌面控制球为 56px 圆形表盘，接收世界名、存档名、step、elapsedSeconds 和 `running | confirming | saved` 公开状态。Pointer Events 拖动只通过 `requestAnimationFrame + translate3d` 更新，松手吸附最近左右边缘并持久化 `{ edge, y }` 到 `livingworld:control-position:v2`；`y` 为归一化坐标，视口变化后重新限制在安全区与 composer 排除区。旧四角键直接废弃。桌面点击向页面内侧径向展开四个真实导航动作和状态卡，方位随边缘及垂直空间翻转；状态卡位置由当前方位的完整按钮包络计算，并在按钮实体边缘外保留 32px 间距。移动端点击在当前 `/play/:sessionId` 内打开有焦点约束的底部 Sheet，独立 `/control` 路由删除。键盘支持 Enter/Space、Escape、Alt+方向键和 Alt+Home，关闭后焦点返回球体。

### Consequences

- 会话视觉和滚动行为拥有可比对的上游源，不再靠团队记忆解释“像 assistant-ui”。
- WorldRun、Session、SSE 与引擎契约没有变化；前端仍是持久状态的薄投影。
- Tailwind 4、PostCSS、tw-animate-css、next-themes 和本地 Tooltip/Sheet 基础层成为必要前端依赖。
- 官方 registry 升级不再是无成本版本号变化；必须重新核对允许差异、结构测试、几何断言、无障碍和视觉快照。
- 删除独立控制页和旧位置格式会丢弃旧浏览器位置偏好，符合快速迭代期不维护兼容层的约定。

## Pros and Cons of the Options

### 继续修补账本式会话

- 好：改动局部，不恢复样式工具链。
- 坏：错误的页面拓扑仍是事实来源，composer、滚动和消息比例会继续各自演化。

### 只复用 headless primitives

- 好：依赖和样式约束较少，可以完全自定义。
- 坏：这正是本次漂移的机制；原语不自动带来官方 Thread 的布局、视觉和行为质量。

### 嵌入完整官方示例

- 好：最接近上游完整功能集。
- 坏：sidebar、附件、模型、分支和云线程没有游戏语义，会制造伪功能或第二份状态权威。

### 固定 Thread 基线并限制差异

- 好：复用成熟会话结构，同时保留游戏状态权威和极简信息架构。
- 坏：本地 WorldRun renderer、控制球和主题映射仍需维护，且上游同步需要明确审计。

## Links

- [0044](0044-local-assistant-ui-immersive-session-shell.md) — 被本记录取代的 assistant-ui 薄适配与四角控制方案。
- [0033](0033-persistent-streaming-world-runs.md) — 保持不变的 WorldRun、SSE 与原子持久化。
- [0040](0040-resumable-player-intent.md) — clarification 与同一目标恢复语义。
- [0049](0049-world-run-failure-and-stream-boundaries.md) — 失败、重试、放弃和流边界。
- [表现层参考](../game-design/presentation.md) — 当前会话布局、主题、控制球和消息投影规格。
- [事故复盘 0017](../postmortems/0017-assistant-ui-visual-baseline-drift.md) — 旧实现为何逃过评审和测试。
- [事故复盘 0018](../postmortems/0018-focus-ring-and-orb-card-collision.md) — 焦点边框和状态卡碰撞为何逃过首轮重建验证。
