# 表现层规格（Presentation & UI v3）

> 本文是玩家宿主、主题、剧本 UI 扩展与可访问性边界的当前参考。导入协议见 [script-import.md](script-import.md)，剧本表现数据见 [script-format.md](script-format.md)，决策依据见 [0022](../decisions/0022-ui-host-and-script-extension-v3.md) 与 [0023](../decisions/0023-layout-theme-and-accessibility-v2.md)。

## 所有权

浏览器只通过 `GamePort` 访问 Route Handlers；Engine、文件系统、存档和 LLM 保持在服务端。宿主持有路由、会话、网络、portal、Dialog、焦点、错误边界、实时播报、安全区和设置持久化；剧本持有世界内容、主题、静态素材与可选 UI bundle。剧本组件只能消费只读 view-model、宿主 capability 和 `--cg-*` 语义变量，不得创建第二套会话或读写宿主内部状态。

同一会话的 `turn`、`advance`、`save`、`load`、`descriptor` 与销毁共用一条服务端 mutation 队列；销毁等待已排队操作完成并拒绝新操作。每个 `turn` 从最后提交快照运行隔离的候选 Engine，autosave 与 meta 全部持久化成功后才原子发布候选 Engine、世界状态和表现快照；任一持久化失败使 Route Handler 返回错误，读取、转录、后续 preview 和下一回合继续使用前一完整提交，不得泄漏或重复结算失败回合。回合内部的异步中间态不可见；`previewAction` 作为只读操作也排在同一队列中，保证预检基于最新已提交状态。客户端 controller 在一个 generation 内只允许一个操作，取消或换代后的结果不得提交；`submitTurn(text, intentHint?)` 是唯一提交玩家行动的 capability。

## 玩家宿主

`/` 是“剧目单后台”启动器：首视口只突出当前剧本的静态封面、标题、说明和玩家动作。有效的最近存档才显示“继续上次游戏”；“开始新游戏”和“选择存档”分别打开受控 Dialog；“剧本”和“设置”是独立页面。普通网页不显示虚假的退出动作；进入全屏后，暂停菜单监听 `fullscreenchange` 并显示“退出全屏”。

`/scripts` 是纵向档案式剧本库，列表展示名称、作者、规格版本、来源和当前状态，详情、激活、导入、替换与删除互相分离。内置剧本不可替换或删除；导入剧本只有在没有活跃会话时才能删除，删除保留存档。导入预检和确认遵循 [script-import.md](script-import.md)。

`/settings` 保存版本化 `PlayerUiSettings v2`：声音总开关、主音量、环境音、语音、音效、进入游戏时全屏、主题模式、文字缩放、对比度和减少动效。设置使用 `chatgame:settings:v2` 本地键；无效或其他版本数据回退默认值，不维护旧设置迁移路径。开始或续玩不得擅自覆盖玩家声音选择。

## 游戏壳与槽位

客户端安全契约的唯一入口是 `@chatgame/ui`，其 UI API 版本为 3。公开槽位只有 `launcher`、`game-shell`、`scene`、`hud`、`toolbar`、`composer`、`pause-menu`、`panel:<id>`、`bubble:<id>`、`message-card:<id>` 与 `settings:<id>`；每个槽位在宿主都有真实消费点和完整 fallback。单例槽位不接受位置或排序参数，同一 bundle 重复注册同一槽位使整个 bundle 注册失败。

`game-shell` 接收宿主提供的 scene、transcript、composer、hud、toolbar 与 panels renderer，剧本可以重排但不能绕开它们的语义和无障碍边界。默认壳以转录为唯一长滚动区，输入器保持独立局部状态；只有用户原本位于底部时，新消息才自动滚到底，输入变化不重绘整棵转录树。默认 composer 提供真实快捷行动，先调用 `previewAction(intentHint)` 展示时间、资源与风险，再以同一 `intentHint` 提交回合。

`PauseMenuSlotProps` 提供主题、声音、保存、返回启动器与实时全屏状态；`SettingsSlotProps` 提供当前设置与受控更新；其他槽位只接收对应的语义 view-model。剧本不得直接 fetch 会话 API、控制全局 portal 或持有可变 registry。

## UI bundle 构建与激活

剧本 `ui/index.ts` 或 `ui/index.tsx` 默认导出注册函数并从 `@chatgame/ui` 导入类型与 API。构建只允许剧本目录内的相对依赖、React 运行时和 `@chatgame/ui`；任何逃出剧本目录的路径或其他 bare import 都失败。依赖图内容和 UI API 版本共同生成 hash，bundle URL 带版本参数，响应提供对应 ETag 和 immutable 缓存。

registry 是由 `useSyncExternalStore` 订阅的不可变快照，快照同时包含 scriptId、generation、依赖 hash、主题、slots 和可恢复错误。加载先写临时 registry，只有完整注册成功且 generation 仍为最新时才提交。同一剧本替换失败保留上一完整快照；跨剧本加载失败提交目标剧本的空 slots 并使用宿主 fallback，绝不把旧剧本组件传入新剧本 props。错误边界只隔离当前槽位渲染，提供宿主 fallback 和可恢复错误状态。

`ScriptPresentation.defaultThemeId` 是服务端权威字段，不从主题数组顺序或运行态重新推断。激活时 scriptId、default/current theme 与 UI registry 属于同一 generation；旧请求晚到不得覆盖新激活。

## 主题、素材与声音

`theme.yaml` 和 `themes/*.yaml` 解析为白名单 `ThemeView`。主题只能写入 `--cg-*` 语义变量，包括背景、表面、前景、主操作及其前景、焦点、边界、成功、警告、危险、选中、字体、密度、半径和动效。剧本与宿主组件都不得硬编码颜色或注入任意 CSS；字体文件只来自剧本的 `assets/fonts/`。

`assets.yaml` 是运行时素材索引，`MediaCue` 由引擎根据状态差确定性产生，LLM 不决定媒体。未提供图片、音频或剧本槽位时，宿主使用文字、结构和静态 fallback，游戏仍可完成。导入素材的来源与远程热链门禁见 [script-import.md](script-import.md)。

`AudioController` 分离 master、ambient、voice 与 effects gain；设置变化实时应用。声音默认关闭，只有玩家明确开启后播放；进入游戏不改变此选择。全屏失败静默降级为窗口模式，不阻塞游玩。

## 可访问性、响应式与动效

Dialog 使用 `aria-modal`、标题/说明关联、背景 inert、焦点陷阱、Esc 关闭和焦点恢复；没有可用控件时焦点停在 dialog surface。状态通过 `aria-live` 和可见文字反馈，等待、成功、警告与错误不只靠颜色或 opacity。主要目标至少 44×44px，布局在 390px 宽、短横屏、安全区和 200% 文字下保留同一任务顺序。

宿主动效是 Corporate / rigid：CSS 只使用 quick、standard、deliberate 三档 `--cg-*` 时序，hover 小于 100ms，按压 120–180ms，Dialog 以约 360ms ease-out 进入并以约 220ms ease-in 退出。系统或玩家选择减少动效时移除空间位移与环境循环，并取消 Dialog 退出等待；按压、等待文案和结果反馈仍保留。

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
| `/api/runtime/react.mjs`、`jsx-runtime.mjs` | GET | bundle 与宿主共享的 React 运行时 |
| `/api/sessions` | GET / POST | 会话列表与创建/续档 |
| `/api/sessions/:id/state`、`presentation` | GET | 当前世界与表现快照 |
| `/api/sessions/:id/action-preview` | POST | 无状态行动成本预览 |
| `/api/sessions/:id/turn` | POST | `{text, intentHint?}` 玩家回合 |
| `/api/sessions/:id/advance`、`save`、`load`、`descriptor` | POST | 排队的会话 mutation |
| `/api/sessions/:id/saves` | GET | 存档摘要 |
| `/api/sessions/:id` | DELETE | 排队销毁会话 |

## 验证矩阵

自动化至少覆盖 UI API 版本/重复 slot/失败保留/跨剧本隔离/A-B generation、依赖图 hash/边界 import/ETag、快捷行动 preview 与 typed submit、controller 与 EngineHost 并发、Dialog focus/inert/reduced motion、全屏实时状态、设置持久化、两阶段导入和内置源码保护。布局试玩覆盖 390×844、桌面、短横屏、200% 文字、键盘导航、系统与显式减少动效、空/长转录、输入中、新消息到达、加载/成功/错误和全屏进入/退出。

```sh
npm run typecheck
npm run lint
npm test -- --project unit
npm run build
npm run script:validate -- scripts/emberfall
npm run script:validate -- scripts/starlight
```
