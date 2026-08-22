# 表现层规格（Presentation & UI v6）

> 本文是玩家宿主、主题、剧本 UI 扩展与可访问性边界的当前参考。导入协议见 [script-import.md](script-import.md)，剧本表现数据见 [script-format.md](script-format.md)，决策依据见 [0030](../decisions/0030-manus-style-game-workspace-and-ui-api-v6.md)。

## 所有权

浏览器只通过 `GamePort` 访问 Route Handlers；Engine、文件系统、存档和 LLM 保持在服务端。宿主持有路由、会话、网络、portal、Dialog、焦点、错误边界、实时播报、安全区和设置持久化；剧本持有世界内容、主题、静态素材与可选 UI bundle。剧本组件只能消费只读 view-model、宿主 capability 和 `--cg-*` 语义变量，不得创建第二套会话或读写宿主内部状态。

同一会话的 `turn`、`advance`、`save`、`load`、`descriptor` 与销毁共用一条服务端 mutation 队列；销毁等待已排队操作完成并拒绝新操作。每个 `turn` 从最后提交快照运行隔离的候选 Engine，autosave 与 meta 全部持久化成功后才原子发布候选 Engine、世界状态和表现快照；任一持久化失败使 Route Handler 返回错误，读取、转录、后续 preview 和下一回合继续使用前一完整提交，不得泄漏或重复结算失败回合。`turn` 与 `advance` 的响应都包含同一提交点的 `{ state, presentation }`，地点主题在队列操作内从该 state 解析；客户端以一个 reducer action 同时更新世界与表现，不接受 state-only 的 `advance` 响应。回合内部的异步中间态不可见；`previewAction` 作为只读操作也排在同一队列中，保证预检基于最新已提交状态。客户端 controller 在一个 generation 内只允许一个操作，取消或换代后的结果不得提交；`submitTurn(text, intentHint?)` 是唯一提交玩家行动的 capability。

`start` 与 `continue` 同时请求 `scriptDetail` 和 `createSession`，并等待两个结果都收敛，避免一个请求先失败后遗失另一个迟到成功的 session id。创建成功的 id 在 `enter` 通过 generation 校验并提交前属于临时资源；detail/create 任一失败、abort、换代或 store 提交失败都调用无旧 abort signal 的 `destroySession`。controller 记录已提交 id，旧 generation 的清理不得销毁新 generation 已提交的 session。DELETE 失败通过 `onSessionCleanupError` 独立报告，原始启动错误、当前 screen 与当前 session 保持不变。

## 玩家宿主

`HostAppShell` 是 `/`、`/scripts` 和 `/settings` 的应用宿主。桌面应用页侧栏默认展开为 272px，移动端由 Sheet 承载；玩家可手动展开或折叠。侧栏呈现当前剧本、游戏首页、最近存档入口、剧本库和设置。游戏会话使用独立的单轴工作区，不渲染 AppShell 侧栏。活跃会话期间当前剧本锁定，不提供跨剧本切换动作。

`/` 是启动器：最大约 96rem 的中央卡牌舞台把封面、标题、说明、剧本信息和玩家动作组成一张卡，不存在独立漂浮操作框或续玩条。卡内动作顺序是“开始新游戏 → 继续游戏 → 选择存档”；“继续游戏”仅在当前剧本存在存档时显示，并按 `updatedAt` 恢复该剧本最新的一份，不能跨剧本读取全局最后游玩指针。“开始新游戏”在舞台内横向推进“剧本介绍 → 选择出身 → 确认身份”，非活动步骤 inert；出身卡组使用 CSS scroll-snap，支持箭头、方向键和触摸滚动，邻卡保留约 24px 提示，锁定出身可见且标注“未解锁”。出身加载失败留在当前步骤并可重试；“选择存档”作为独立恢复任务使用 Dialog，且只列出当前剧本的全部存档。普通网页不显示虚假的退出动作；进入全屏后，暂停菜单监听 `fullscreenchange` 并显示“退出全屏”。

`/scripts` 是纵向档案式剧本库，列表展示名称、作者、规格版本、来源和当前状态。详情按“封面 → 标题与状态 Badge → 简介 → 元数据 → 管理说明 → 操作栏”排列；当前剧本不渲染禁用操作按钮，非当前剧本才在 footer 提供“设为当前剧本”。内置说明占独立信息行；导入剧本的切换与删除分组。内置剧本不可替换或删除；导入剧本只有在没有活跃会话时才能替换或删除，失败提示玩家结束相关会话后重新预检，删除保留存档。导入预检和确认遵循 [script-import.md](script-import.md)。

`/settings` 保存版本化 `PlayerUiSettings v3`：声音总开关、主音量、环境音、语音、音效、进入游戏时全屏、主题模式、文字缩放、对比度、减少动效和按 `scriptId:runId` 隔离的追踪任务。页面收敛到约 68rem，分成“阅读、声音、显示与动效”，每行左侧是名称与说明，右侧是约 22rem 的统一控件区；窄屏改为上下排列。只有真正存在剧本专属偏好时才呈现剧本设置。普通保存状态只通过稳定 live region 播报，错误才显示可见提示。设置使用 `chatgame:settings:v3` 本地键；无效或其他版本数据回退默认值，不维护旧设置迁移路径。开始或续玩不得擅自覆盖玩家声音选择；任务追踪只影响 UI，不进入世界状态。

## 游戏壳与槽位

客户端安全契约的唯一入口是 `@chatgame/ui`，其 UI API 版本为 6。公开槽位只有 `launcher`、`game-shell`、`scene`、`panel:people`、`panel:inventory`、`panel:tasks`、`panel:map`、`panel:records`、`bubble:<id>`、`message-card:<id>` 与 `settings:<id>`；每个槽位在宿主都有真实消费点和完整 fallback。单例槽位不接受位置或排序参数，同一 bundle 重复注册同一槽位使整个 bundle 注册失败。v5 bundle 直接拒绝，不保留兼容层。

`game-shell` 接收宿主构造好的 `topbar`、`conversation`、`toolRail` 与 `overlays` regions。第三方剧本可以完整重排四个 region，但不能要求默认壳生成第二套 composer、工具栏、资料 portal 或暂停菜单。默认 `cg-game-workspace` 固定为视口高度，页面不滚动；`.cg-conversation-scroll` 是唯一纵向主滚动区，并禁止横向滚动。

顶部状态栏高度约 52px，只显示“地点 · 时间”和当前目标。目标入口打开任务 Dialog；小于 1024px 时资料入口收进顶部工具选择器。桌面左侧的 56px 悬浮工具栏不参与会话布局，依次提供人物、背包、任务、地图、档案和分隔后的游戏菜单；图标统一使用 Lucide、Tooltip 和完整可访问名称，目标至少 44×44px。资料由 Base UI 居中 Dialog 承载，普通资料最大约 720px，地图最大约 960px，移动端使用安全区内近全屏布局。人物合并玩家状态、声望、关系和已知 NPC；档案呈现世界事件与剧本记录，不复制聊天转录。游戏内没有 Sheet 或永久右轨。

会话与 composer 共享 `52rem / 832px` 中心轴。世界与 NPC 消息平铺；相邻且说话人相同的消息组成一个组，24px 头像、姓名和职业只在组首显示并保持可点击。世界正文使用 CommonMark/GFM 语义段落、列表、引用、代码和表格，模型输出的单个源换行按普通空白处理；玩家输入保留主动换行，消息按内容宽度右对齐且最大 34rem，只使用低对比填充。系统结果、判定和任务变化附着到对应世界回复。地点和事件媒体最大 40rem、16:9，并受视口高度限制；同一消息的第一张媒体是主卡，后续媒体以不超过约 28rem 的从属卡呈现。图片、标题、说明和事件状态属于同一紧凑媒体消息，点击图片打开居中 lightbox。只有用户原本位于底部时新消息自动滚到底，离开底部时出现“跳到最新消息”。

只有最新世界回复呈现最多三个纵向 `GameSuggestion`。建议是回答 footer，不渲染标题、方向图标或另一张卡片；点击建议把 label 写入 textarea、聚焦 composer，并调用 `previewAction(intentHint)`。预检显示耗时、资源、风险或不可执行原因。用户编辑文字时立刻清除 hint、旧预检与迟到 generation。composer 是会话轴底部唯一表面，空态约 60–64px；textarea 在换行或长文本时展开并自动增长到约 9rem 后内部滚动，不再嵌套第二层输入表面。Enter 发送、Shift+Enter 换行，IME composing 的 Enter 不提交；快捷键通过输入框隐藏说明提供，不常驻占据视觉层级。只有一个 44px 发送按钮，等待、预检失败和发送状态同时提供可见反馈与 live region。

活动滚动表面统一消费 `--cg-scroll-track`、`--cg-scroll-thumb` 与 `--cg-scroll-thumb-hover`。WebKit 使用 4px 透明槽和约 2px token 化 thumb；Firefox 使用隐藏静止态和 thin 活动态回退。滚动、hover 或 focus 时显示，停止约 500ms 后淡出；高对比模式保持可见。Carousel 仍隐藏系统横向滚动条，其可见导航由邻卡、箭头和选中状态承担。

`ScriptUiContext.configureGame(presentation)` 每个 bundle 最多调用一次。`GamePresentation.objective(model)` 与 `suggestions(model)` 是同步纯函数，分别返回 `GameObjective` 和 `GameSuggestion[]`；缺失或执行失败时宿主从权威 task 和 action catalog 生成 fallback。`GamePanelId` 只有 `people`、`inventory`、`tasks`、`map` 与 `records`。灰烬镇和星港通过 provider 定义动态目标与建议行动，并只为地图、证据、交班、工装等专属资料注册 panel。

`@chatgame/ui` 公开宿主与剧本共用的受控表现原语：`Button`、`Badge`、`Frame`、`FramePanel`、`Input`、`InputGroup`、`Select`、`Switch`、`Slider`、`Checkbox`、`SettingRow` 和 `Textarea`。`Select` 接收受控 value、options 与 `onValueChange`；`Switch`、`Checkbox` 和单值 `Slider` 只暴露受控状态；`SettingRow` 统一名称、说明、控件关联及响应式布局。variant、尺寸和状态使用封闭枚举；宿主与内置剧本不得使用原生 select、checkbox 或 range，也不得重新实现基础按钮、输入框、composer、Dialog 或游戏壳。剧本 `styles.ts` 只描述该世界独有的图示、资料结构与排版语法。

`LauncherSlotProps.newGame` 是完整 launcher 覆盖的受控新游戏模型，包含 `step`、加载状态、带可用性的出身、当前选择、玩家名字、错误以及选择、前进、返回、重试能力。`LauncherSlotProps.resume` 是当前剧本的受控续玩模型，包含按更新时间选出的最新存档、忙碌状态与恢复 capability；宿主不再保存或公开跨剧本的全局 last-run 指针。第三方 launcher 可以形成不同构图，但不得建立另一套新游戏或续玩状态，也不得直接调用宿主内部接口。

`BubbleSlotProps` 的 `speaker` 只包含公开 NPC id、姓名、简介、职业和关系显示，`isFirstAppearance` 支持首次相遇标记；`PanelSlotProps` 的 `trackedTaskId` 与 `trackTask` 只读写本地追踪偏好。`SettingsSlotProps` 提供当前设置与受控更新。剧本不得从秘密、holder 或任意运行态拼出额外公开档案，不得直接 fetch 会话 API、控制全局 portal 或持有可变 registry。

## UI bundle 构建与激活

剧本 `ui/index.ts` 或 `ui/index.tsx` 默认导出注册函数并从 `@chatgame/ui` 导入类型与 API。构建只允许剧本目录内的相对依赖、React 运行时和 `@chatgame/ui`；任何逃出剧本目录的路径或其他 bare import 都失败。`@chatgame/ui` 不打入剧本 bundle，而是外部化到宿主持有的 `/api/runtime/ui.mjs`，确保宿主和所有剧本共享同一份 ReUI/Base UI 实现。依赖图内容和 UI API 版本共同生成 hash，bundle URL 带版本参数，响应提供对应 ETag 和 immutable 缓存。

registry 是由 `useSyncExternalStore` 订阅的不可变快照，快照同时包含 scriptId、generation、依赖 hash、slots、`gamePresentation` 和可恢复错误。加载先写临时 registry，只有完整注册成功且 generation 仍为最新时才提交。重复 slot、重复 `configureGame` 或非法 provider 使本次注册失败。同一剧本替换失败保留上一完整快照；跨剧本加载失败提交目标剧本的空 slots 和空 provider，并使用宿主 fallback，绝不把旧剧本组件传入新剧本 props。错误边界只隔离当前槽位渲染，提供宿主 fallback 和可恢复错误状态。

`ScriptPresentation.defaultThemeId` 是服务端权威字段，不从主题数组顺序或运行态重新推断。激活时 scriptId、default/current theme 与 UI registry 属于同一 generation；旧请求晚到不得覆盖新激活。

## 主题、素材与声音

`theme.yaml` 和 `themes/*.yaml` 解析为白名单 `ThemeView`。主题只能写入 `--cg-*` 语义变量，包括背景、表面、前景、主操作及其前景、焦点、边界、成功、警告、危险、选中、字体、密度、半径和动效。剧本与宿主组件都不得硬编码颜色或注入任意 CSS；字体文件只来自剧本的 `assets/fonts/`。

`assets.yaml` 是运行时素材索引，`backgrounds` 以地点 id 索引，`illustrations` 以事件 id 索引，`portraits` 与 `icons` 分别服务 NPC 与物品。`MediaCue` 由引擎根据状态差确定性产生 `npc_speech`、`location_enter`、`event` 与 `item_reveal`，LLM 和客户端不决定媒体。未提供图片、音频或剧本槽位时，宿主使用文字、结构和静态 fallback，游戏仍可完成。导入素材的来源与远程热链门禁见 [script-import.md](script-import.md)。

`AudioController` 分离 master、ambient、voice 与 effects gain；设置变化实时应用。声音默认关闭，只有玩家明确开启后播放；进入游戏不改变此选择。全屏失败静默降级为窗口模式，不阻塞游玩。

## 可访问性、响应式与动效

应用导航 Sheet 与全部 Dialog 由 Base UI 持有 `aria-modal`、标题/说明关联、背景隔离、焦点陷阱、Esc 关闭和焦点恢复；宿主只保留业务 wrapper。游戏资料只使用 Dialog。状态通过 `aria-live` 和可见文字反馈，等待、成功、警告与错误不只靠颜色或 opacity。主要目标至少 44×44px，布局在 390px 宽、短横屏、安全区和 200% 文字下保留同一任务顺序。宿主 fallback 图标统一使用 Lucide。

宿主动效只表达操作因果：启动器步骤使用横向位移，按钮和建议行动使用快速颜色与轻微位移反馈，世界等待标记使用低调脉冲。系统或玩家选择减少动效时把滚动行为改为即时并把动画与过渡压缩到近零时长；按压、等待文案和结果反馈仍保留。

## HTTP 表面

| 路由 | 方法 | 语义 |
|---|---|---|
| `/api/scripts` | GET | 已安装剧本摘要、规格版本、来源、默认主题和静态封面 |
| `/api/scripts/:scriptId` | GET / DELETE | 剧本详情；只删除无活跃会话的导入剧本 |
| `/api/scripts/import/preview` | POST | 暂存并静态预检 zip |
| `/api/scripts/import/preview/:token/cover` | GET | TTL 内通过 opaque token 读取白名单暂存封面 |
| `/api/scripts/import/commit` | POST | 以一次性 token 和显式 `replace` 确认安装 |
| `/api/scripts/:scriptId/assets/*` | GET | 读取白名单剧本素材 |
| `/api/scripts/:scriptId/entity-assets/:kind/:entityId` | GET | 读取或生成实体素材 |
| `/api/scripts/:scriptId/ui-bundle` | GET | 读取版本化 UI bundle |
| `/api/runtime/react.mjs`、`jsx-runtime.mjs`、`ui.mjs` | GET | bundle 与宿主共享的 React 与 UI 运行时 |
| `/api/sessions` | GET / POST | 会话列表与创建/续档 |
| `/api/sessions/:id/state`、`presentation` | GET | 当前世界与表现快照 |
| `/api/sessions/:id/action-preview` | POST | 无状态行动成本预览 |
| `/api/sessions/:id/turn` | POST | `{text, intentHint?}` 玩家回合；返回原子世界/表现快照 |
| `/api/sessions/:id/advance` | POST | 排队推进时间；返回原子世界/表现快照 |
| `/api/sessions/:id/save`、`load`、`descriptor` | POST | 其他排队的会话 mutation |
| `/api/sessions/:id/saves` | GET | 存档摘要 |
| `/api/sessions/:id` | DELETE | 排队销毁会话 |

## 验证矩阵

自动化至少覆盖 UI runtime exports、受控 Select/Switch/Slider/Checkbox、UI API v6 注册、重复 `configureGame`、v5 拒绝、provider 失败 fallback、跨剧本隔离、A-B generation、五种资料映射、三步 launcher、当前剧本最新存档续玩、锁定出身、加载失败重试、主题 token 映射、NPC 公开资料、四类媒体提示、Markdown 段落与 GFM 表格、依赖图 hash/边界 import/ETag、建议行动预检竞态、IME 与 typed submit、controller 与 EngineHost 并发、AppShell/Sidebar/Dialog focus、全屏实时状态、设置持久化、两阶段导入和内置源码保护。真实入口分别验证两个剧本的地点卡、NPC 人物资料、建议行动写入与聚焦、编辑后预检失效、自由输入、五个资料 Dialog、游戏菜单、保存退出与继续。游戏结构先断言没有 AppShell、Sheet 或横向溢出，只有一个主滚动区，会话与 composer 同轴，短玩家消息按内容收缩且保持右对齐，连续说话人只显示一个组首身份，composer 没有嵌套表面，主媒体不超过 640px且从属媒体更小，活动滚动条按时淡出；启动器、剧本库和设置覆盖 390×844、768×1024、1440×900、2560×1440、5120×2880，启动器和游戏额外覆盖 844×390、200% 文字、键盘导航、高对比与减少动效。结构和语义断言通过后才更新视觉基线。

```sh
npm run typecheck
npm run lint
npm test -- --project unit
npm run build
npm run script:validate -- scripts/emberfall
npm run script:validate -- scripts/starlight
```
