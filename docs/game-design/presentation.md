# 表现层规格（Presentation & UI v5）

> 本文是玩家宿主、主题、剧本 UI 扩展与可访问性边界的当前参考。导入协议见 [script-import.md](script-import.md)，剧本表现数据见 [script-format.md](script-format.md)，决策依据见 [0029](../decisions/0029-reui-app-shell-and-ui-api-v5.md)。

## 所有权

浏览器只通过 `GamePort` 访问 Route Handlers；Engine、文件系统、存档和 LLM 保持在服务端。宿主持有路由、会话、网络、portal、Dialog、焦点、错误边界、实时播报、安全区和设置持久化；剧本持有世界内容、主题、静态素材与可选 UI bundle。剧本组件只能消费只读 view-model、宿主 capability 和 `--cg-*` 语义变量，不得创建第二套会话或读写宿主内部状态。

同一会话的 `turn`、`advance`、`save`、`load`、`descriptor` 与销毁共用一条服务端 mutation 队列；销毁等待已排队操作完成并拒绝新操作。每个 `turn` 从最后提交快照运行隔离的候选 Engine，autosave 与 meta 全部持久化成功后才原子发布候选 Engine、世界状态和表现快照；任一持久化失败使 Route Handler 返回错误，读取、转录、后续 preview 和下一回合继续使用前一完整提交，不得泄漏或重复结算失败回合。`turn` 与 `advance` 的响应都包含同一提交点的 `{ state, presentation }`，地点主题在队列操作内从该 state 解析；客户端以一个 reducer action 同时更新世界与表现，不接受 state-only 的 `advance` 响应。回合内部的异步中间态不可见；`previewAction` 作为只读操作也排在同一队列中，保证预检基于最新已提交状态。客户端 controller 在一个 generation 内只允许一个操作，取消或换代后的结果不得提交；`submitTurn(text, intentHint?)` 是唯一提交玩家行动的 capability。

`start` 与 `continue` 同时请求 `scriptDetail` 和 `createSession`，并等待两个结果都收敛，避免一个请求先失败后遗失另一个迟到成功的 session id。创建成功的 id 在 `enter` 通过 generation 校验并提交前属于临时资源；detail/create 任一失败、abort、换代或 store 提交失败都调用无旧 abort signal 的 `destroySession`。controller 记录已提交 id，旧 generation 的清理不得销毁新 generation 已提交的 session。DELETE 失败通过 `onSessionCleanupError` 独立报告，原始启动错误、当前 screen 与当前 session 保持不变。

## 玩家宿主

`HostAppShell` 是 `/`、`/scripts`、`/settings` 和默认游戏壳的唯一宿主结构。桌面应用页侧栏默认展开为 272px，游戏默认折叠为 72px 图标栏，移动端由 Sheet 承载；玩家可手动展开或折叠。侧栏呈现当前剧本、游戏首页、最近存档入口、剧本库、设置和会话资料。活跃会话期间当前剧本锁定，不提供跨剧本切换动作。

`/` 是启动器：最大约 96rem 的中央卡牌舞台把封面、标题、说明、剧本信息和玩家动作组成一张卡，不存在独立漂浮操作框或续玩条。卡内动作顺序是“开始新游戏 → 继续游戏 → 选择存档”；“继续游戏”仅在当前剧本存在存档时显示，并按 `updatedAt` 恢复该剧本最新的一份，不能跨剧本读取全局最后游玩指针。“开始新游戏”在舞台内横向推进“剧本介绍 → 选择出身 → 确认身份”，非活动步骤 inert；出身卡组使用 CSS scroll-snap，支持箭头、方向键和触摸滚动，邻卡保留约 24px 提示，锁定出身可见且标注“未解锁”。出身加载失败留在当前步骤并可重试；“选择存档”作为独立恢复任务使用 Dialog，且只列出当前剧本的全部存档。普通网页不显示虚假的退出动作；进入全屏后，暂停菜单监听 `fullscreenchange` 并显示“退出全屏”。

`/scripts` 是纵向档案式剧本库，列表展示名称、作者、规格版本、来源和当前状态。详情按“封面 → 标题与状态 Badge → 简介 → 元数据 → 管理说明 → 操作栏”排列；当前剧本不渲染禁用操作按钮，非当前剧本才在 footer 提供“设为当前剧本”。内置说明占独立信息行；导入剧本的切换与删除分组。内置剧本不可替换或删除；导入剧本只有在没有活跃会话时才能替换或删除，失败提示玩家结束相关会话后重新预检，删除保留存档。导入预检和确认遵循 [script-import.md](script-import.md)。

`/settings` 保存版本化 `PlayerUiSettings v3`：声音总开关、主音量、环境音、语音、音效、进入游戏时全屏、主题模式、文字缩放、对比度、减少动效和按 `scriptId:runId` 隔离的追踪任务。页面收敛到约 68rem，分成“阅读、声音、显示与动效”，每行左侧是名称与说明，右侧是约 22rem 的统一控件区；窄屏改为上下排列。只有真正存在剧本专属偏好时才呈现剧本设置。普通保存状态只通过稳定 live region 播报，错误才显示可见提示。设置使用 `chatgame:settings:v3` 本地键；无效或其他版本数据回退默认值，不维护旧设置迁移路径。开始或续玩不得擅自覆盖玩家声音选择；任务追踪只影响 UI，不进入世界状态。

## 游戏壳与槽位

客户端安全契约的唯一入口是 `@chatgame/ui`，其 UI API 版本为 5。公开槽位只有 `launcher`、`game-shell`、`scene`、`hud`、`objective-tracker`、`toolbar`、`composer`、`pause-menu`、`panel:<id>`、`bubble:<id>`、`message-card:<id>` 与 `settings:<id>`；每个槽位在宿主都有真实消费点和完整 fallback。单例槽位不接受位置或排序参数，同一 bundle 重复注册同一槽位使整个 bundle 注册失败。v4 bundle 直接拒绝，不保留兼容层。

`game-shell` 接收宿主提供的 scene、composer、hud、tracker、toolbar 与 panels renderer，第三方剧本可以重排但不能绕开它们的语义和无障碍边界。默认壳以正文最大约 720px、媒体最大约 960px 的居中转录为唯一长滚动区：世界叙述无气泡，NPC 显示可访问头像与公开资料，玩家消息右对齐且最大约 560px，系统反馈使用低调结果条。地点、事件和物品媒体作为消息卡进入转录，不使用固定场景背景；标题、说明与事件状态必须位于同一媒体消息单元。只有用户原本位于底部时，新消息才自动滚到底，输入变化不重绘整棵转录树。

转录、composer 与媒体共享同一中心网格；转录预留双侧滚动槽以避免滚动条出现时中心轴漂移。启动器、侧栏、行动预检、输入框、Sheet、Dialog、剧本库和设置的滚动表面统一使用 `--cg-scroll-track`、`--cg-scroll-thumb` 与 `--cg-scroll-thumb-hover`，在支持的平台提供标准和 WebKit 滚动条样式。

顶部状态区高度约 60–64px，只常驻剧本/位置/时间、目标和三到四项关键资源。默认壳没有永久右轨；地图、任务、背包、人物、关系、日志和证据通过宿主 Sheet 打开，暂停使用居中 Dialog。默认 composer 与媒体最大宽度一致，提供三到五个 `ActionChoice`，先调用 `previewAction(intentHint)` 在一行内展示时间、资源、风险和不可执行原因，再以 `InputGroup` 中的唯一发送按钮提交建议行动或自由文本；不得提供相互竞争的第二个主提交按钮。

`@chatgame/ui` 同时公开宿主与剧本共用的受控表现原语：`Button`、`Badge`、`Frame`、`FramePanel`、`Input`、`InputGroup`、`Select`、`Switch`、`Slider`、`Checkbox`、`SettingRow`、`Textarea`、`ActionChoice` 和 `Metric`。`Select` 接收受控 value、options 与 `onValueChange`；`Switch`、`Checkbox` 和单值 `Slider` 只暴露受控状态；`SettingRow` 统一名称、说明、控件关联及响应式布局。variant、尺寸和状态使用封闭枚举；宿主与内置剧本不得使用原生 select、checkbox 或 range，也不得重新实现基础按钮、输入框、composer、Dialog、Sheet 或页面网格。剧本 `styles.ts` 只描述该世界独有的读数、图示、资料结构与排版语法。

`LauncherSlotProps.newGame` 是完整 launcher 覆盖的受控新游戏模型，包含 `step`、加载状态、带可用性的出身、当前选择、玩家名字、错误以及选择、前进、返回、重试能力。`LauncherSlotProps.resume` 是当前剧本的受控续玩模型，包含按更新时间选出的最新存档、忙碌状态与恢复 capability；宿主不再保存或公开跨剧本的全局 last-run 指针。第三方 launcher 可以形成不同构图，但不得建立另一套新游戏或续玩状态，也不得直接调用宿主内部接口。

`BubbleSlotProps` 的 `speaker` 只包含公开 NPC id、姓名、简介、职业和关系显示，`isFirstAppearance` 支持首次相遇卡；`PanelSlotProps` 的 `trackedTaskId` 与 `trackTask` 只读写本地追踪偏好。剧本不得从秘密、holder 或任意运行态拼出额外公开档案。

`PauseMenuSlotProps` 提供主题、声音、保存、返回启动器与实时全屏状态；`SettingsSlotProps` 提供当前设置与受控更新；其他槽位只接收对应的语义 view-model。剧本不得直接 fetch 会话 API、控制全局 portal 或持有可变 registry。

## UI bundle 构建与激活

剧本 `ui/index.ts` 或 `ui/index.tsx` 默认导出注册函数并从 `@chatgame/ui` 导入类型与 API。构建只允许剧本目录内的相对依赖、React 运行时和 `@chatgame/ui`；任何逃出剧本目录的路径或其他 bare import 都失败。`@chatgame/ui` 不打入剧本 bundle，而是外部化到宿主持有的 `/api/runtime/ui.mjs`，确保宿主和所有剧本共享同一份 ReUI/Base UI 实现。依赖图内容和 UI API 版本共同生成 hash，bundle URL 带版本参数，响应提供对应 ETag 和 immutable 缓存。

registry 是由 `useSyncExternalStore` 订阅的不可变快照，快照同时包含 scriptId、generation、依赖 hash、主题、slots 和可恢复错误。加载先写临时 registry，只有完整注册成功且 generation 仍为最新时才提交。同一剧本替换失败保留上一完整快照；跨剧本加载失败提交目标剧本的空 slots 并使用宿主 fallback，绝不把旧剧本组件传入新剧本 props。错误边界只隔离当前槽位渲染，提供宿主 fallback 和可恢复错误状态。

`ScriptPresentation.defaultThemeId` 是服务端权威字段，不从主题数组顺序或运行态重新推断。激活时 scriptId、default/current theme 与 UI registry 属于同一 generation；旧请求晚到不得覆盖新激活。

## 主题、素材与声音

`theme.yaml` 和 `themes/*.yaml` 解析为白名单 `ThemeView`。主题只能写入 `--cg-*` 语义变量，包括背景、表面、前景、主操作及其前景、焦点、边界、成功、警告、危险、选中、字体、密度、半径和动效。剧本与宿主组件都不得硬编码颜色或注入任意 CSS；字体文件只来自剧本的 `assets/fonts/`。

`assets.yaml` 是运行时素材索引，`backgrounds` 以地点 id 索引，`illustrations` 以事件 id 索引，`portraits` 与 `icons` 分别服务 NPC 与物品。`MediaCue` 由引擎根据状态差确定性产生 `npc_speech`、`location_enter`、`event` 与 `item_reveal`，LLM 和客户端不决定媒体。未提供图片、音频或剧本槽位时，宿主使用文字、结构和静态 fallback，游戏仍可完成。导入素材的来源与远程热链门禁见 [script-import.md](script-import.md)。

`AudioController` 分离 master、ambient、voice 与 effects gain；设置变化实时应用。声音默认关闭，只有玩家明确开启后播放；进入游戏不改变此选择。全屏失败静默降级为窗口模式，不阻塞游玩。

## 可访问性、响应式与动效

Dialog 与 Sheet 由 Base UI 持有 `aria-modal`、标题/说明关联、背景隔离、焦点陷阱、Esc 关闭和焦点恢复；宿主只保留业务 wrapper。状态通过 `aria-live` 和可见文字反馈，等待、成功、警告与错误不只靠颜色或 opacity。主要目标至少 44×44px，布局在 390px 宽、短横屏、安全区和 200% 文字下保留同一任务顺序。宿主 fallback 图标统一使用 Lucide，剧本 `assets.yaml` 中的 UI slot 素材仍优先。

宿主动效克制表达因果：新消息约 160ms 轻微淡入，媒体卡约 360ms 展开，Dialog 约 220ms 淡入缩放。系统或玩家选择减少动效时移除位移、缩放、clip 展开与环境循环，并取消 Dialog 退出等待；按压、等待文案和结果反馈仍保留。

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

自动化至少覆盖 UI runtime exports、受控 Select/Switch/Slider/Checkbox、UI API v5 版本/重复 slot/版本拒绝/失败保留/跨剧本隔离/A-B generation、三步 launcher、当前剧本最新存档续玩、锁定出身、加载失败重试、主题 token 映射、objective tracker、NPC 公开资料、四类媒体提示、依赖图 hash/边界 import/ETag、快捷行动 preview 与 typed submit、controller 与 EngineHost 并发、AppShell/Sidebar/Dialog/Sheet focus 与 reduced motion、全屏实时状态、设置持久化、两阶段导入和内置源码保护。真实入口分别验证两个剧本的地点卡、NPC 资料、建议行动、自由输入、侧栏展开、任务/背包/地图 Sheet、保存退出与继续。启动器、剧本库和设置覆盖 390×844、768×1024、1440×900、2560×1440、5120×2880，启动器和游戏额外覆盖 844×390、200% 文字、键盘导航、高对比与减少动效；几何断言先验证入口操作位于卡内、续玩不会跨剧本、设置行共享轴线、Slider 等长、当前剧本不是禁用按钮、宿主及内置 UI 没有原生 select/checkbox/range，再更新视觉基线。

```sh
npm run typecheck
npm run lint
npm test -- --project unit
npm run build
npm run script:validate -- scripts/emberfall
npm run script:validate -- scripts/starlight
```
