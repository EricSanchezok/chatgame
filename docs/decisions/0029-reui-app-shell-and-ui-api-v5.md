# ReUI AppShell 与 UI API v5

## Status
Accepted
Class: architecture

## Context and Problem Statement

启动器、剧本库、设置和游戏分别维护页面壳、按钮、弹层与布局，内置剧本又复制 composer、工具栏和基础表面。默认游戏虽以会话为中心，但顶部、正文、媒体、右侧任务栏和 composer 使用多套宽度与滚动轴；超宽屏出现漂浮和断裂，窄屏则压缩操作区。UI API v4 还把公共契约实现打入每个剧本 bundle，宿主手写 Dialog 的焦点、inert 与抽屉逻辑，形成重复基础设施。

## Decision Drivers

- 启动器、游玩、剧本库和设置必须共享唯一 AppShell 与导航语义。
- 对话正文、媒体、事件状态和 composer 必须围绕同一中心轴，并只有一个主滚动区。
- 宿主与剧本必须消费同一份可访问公共原语，不得在 bundle 中复制组件实现。
- 游戏入口、剧本状态和设置控件必须具有单一任务轴，不能依靠漂浮操作框、禁用按钮或浏览器原生表单样式表达结构。
- 内置剧本保留世界专属读数与视觉语言，但不得重复按钮、composer、Dialog、Sheet 或页面网格。
- 快速迭代期直接拒绝旧 UI API，不保留兼容层或双轨实现。
- 主题仍是所有界面颜色的唯一来源，中文字体栈和剧本字体优先。

## Considered Options

- 继续修补现有多页面壳和右侧永久工具轨。
- 购买并复制 ReUI Pro App Shell 17 block。
- 使用免费 ReUI primitives 与 shadcn Base UI + Nova，自行实现 App Shell 17 的信息架构并升级 UI API。

## Decision Outcome

宿主采用唯一 `HostAppShell`。桌面默认侧栏宽 272px，游戏默认折叠为 72px 图标栏，移动端由 Base UI Sheet 承载；侧栏统一呈现当前剧本、游戏首页、最近存档入口、剧本库、设置和游戏资料。第三方 `launcher` 与 `game-shell` 完整覆盖能力保留；默认宿主与内置剧本统一继承 AppShell。

启动器使用一个最大约 96rem 的中央卡牌舞台，封面、剧本说明和“开始新游戏、继续游戏、选择存档”属于同一张卡，不存在页面级漂浮续玩条。“继续游戏”只恢复当前卡片剧本按更新时间计算的最新存档，不读取跨剧本的全局最后游玩指针；没有存档时不显示该动作。新游戏不打开 Dialog，而在舞台内按“剧本介绍 → 选择出身 → 确认身份”横向切换；非活动步骤 inert。出身使用 CSS scroll-snap 卡组，支持箭头、键盘和触摸滚动，锁定身份保持可见但不可进入，加载失败在原步骤内重试。选择存档仍使用独立 Dialog，并且只列出当前剧本的存档。

游戏默认壳取消永久右轨。顶部 60–64px 只显示剧本上下文、位置、时间、目标与少量权威读数；背包、任务、地图、关系和日志从侧栏入口打开 Sheet，暂停使用居中 Dialog。主区只有转录滚动：正文最大约 720px，玩家消息最大约 560px，地点、事件和关键图片最大约 960px，全部共享中心轴。图片、标题、说明和状态属于同一个媒体消息单元；composer 与媒体最大宽度一致，顺序固定为建议行动、单行权威预检和带唯一发送按钮的 InputGroup。

默认壳通过显式 CSS Grid 固定侧栏、顶部状态、转录和 composer 的几何关系。转录使用 `scrollbar-gutter: stable both-edges` 保持其中心轴与 composer 一致；启动器、侧栏、转录、行动预检、输入框、Sheet、Dialog、剧本库和设置的滚动表面统一消费 `--cg-scroll-*` token，并同时提供标准滚动条与 WebKit 滚动条样式。移动端侧栏进入 Sheet，主页面保持单一纵向滚动区，所有可见操作目标至少 44px。

基础实现采用免费 ReUI Frame 和 shadcn `Base UI + Nova`。shadcn 语义 token 全部映射到 `--cg-*`，不安装仅覆盖拉丁文的默认字体。宿主使用 Lucide 作为唯一 fallback 图标集，剧本素材仍可按 slot 覆盖。Base UI 持有 Dialog、Sheet、焦点陷阱、背景隔离、Escape 与焦点恢复，宿主仅保留业务 wrapper。交互按压使用 `scale(.96)`，高频颜色反馈不超过 150ms；减少动效时取消位移和缩放。

设置页使用“阅读、声音、显示与动效”的系统设置列表，每行只有说明和固定宽度控件区；剧本库把当前状态放入标题 Badge，把内置管理说明和操作栏分成独立区域。普通自动保存状态只通过稳定 live region 播报，只有错误显示可见提示。页面、Dialog 与 Select 弹层统一使用 10px token 化滚动槽。

UI API 直接升级为 v5，保留 v4 的全部 SlotId，并公开 `Button`、`Badge`、`Frame`、`FramePanel`、`Input`、`InputGroup`、`Select`、`Switch`、`Slider`、`Checkbox`、`SettingRow`、`Textarea`、`ActionChoice` 与 `Metric`。`LauncherSlotProps` 提供受控的新游戏步骤与当前剧本续玩模型；续玩模型只暴露当前剧本的最新存档、忙碌状态和恢复 capability。`@chatgame/ui` 在剧本构建中外部化为宿主 `/api/runtime/ui.mjs`，与 React runtime 一样由宿主单例提供；脚本只能导入 React、`@chatgame/ui` 和自身目录内相对依赖。v4 bundle 直接拒绝。灰烬镇与星港只保留专属读数、行动生成、证据、地图和世界视觉语法；星港不再重复提供全局声音与动效设置。

## Pros and Cons of the Options

### 修补旧界面

- 好：改动较少。
- 坏：多套壳、错位轴线、重复组件和自维护无障碍逻辑仍然存在。

### 复制 ReUI Pro block

- 好：可以直接获得完整成品结构。
- 坏：依赖未持有的授权和不可审计的外部源码，不符合免费实现边界。

### 免费原语重建

- 好：信息架构统一、组件实现单一、剧本边界清晰，并能按本项目的会话与主题模型精确裁剪。
- 坏：需要一次性迁移宿主、内置剧本、测试与文档，且视觉基线必须整体更新。

## Links

- [0027](0027-session-first-ui-api-v4.md) — 被本记录取代的 UI API v4。
- [0028](0028-conversation-first-game-layout.md) — 被本记录取代的默认布局。
- [0024](0024-frontend-workbench-and-ci.md) — 前端测试工作台与 CI。
- [0017](0017-session-persistence-refresh-recovery-meta.md) — 本记录收紧了其中跨剧本“继续上次游戏”的入口语义，存档持久化与 meta 契约保持不变。
- [表现层规格](../game-design/presentation.md) — 当前 AppShell、UI API 和验证契约。
- [布局回归测试](../../e2e/flows/layout.spec.ts) — 桌面与移动端的中心轴、单一主滚动区、触控尺寸和溢出断言。
