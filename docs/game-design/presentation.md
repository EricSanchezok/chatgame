# 表现层规格（Presentation & UI）

> 前端与表现层 v1 的规格——"剧本长什么样"的呈现契约：UI 结构、Route Handlers、主题系统（Token v1.1）、资产管线、多剧本管理。决策依据见 [决策记录 0012](../decisions/0012-ui-theme-assets-multiscript.md) 与 [决策记录 0011](../decisions/0011-layout-and-presentation-tokens.md)；剧本侧契约见 [script-format.md](script-format.md)。

## 总体架构

```
浏览器 ── HTTP ──> src/app/api/**/route.ts（薄层：解析 → EngineHost 调用 → JSON）
                          │
                  src/server/engine-host.ts（globalThis 单例，会话注册表 + 串行队列）
                          │
                  src/engine（既有门面 + presentation.ts / media/）
                          │
                  scripts/<id>/（剧本 + theme.yaml + themes/ + assets.yaml + assets/）
```

- **引擎只在服务端运行**（fs/YAML/API key）；客户端通过 Route Handlers 访问，不存在浏览器内跑引擎的路线。
- **EngineHost**（`src/server/engine-host.ts`）：会话注册表（创建/取回/销毁/30 分钟闲置回收/上限 20）、剧本扫描、zip/目录导入（单一核心 `script-import.ts`，web 与 CLI 共用）、资产文件安全服务（resolve 前缀校验防穿越）、每会话**串行化队列**（同一会话并发回合排队）。
- **前端**（`src/app/`，'use client'，无新依赖）：`lib/api.ts`（类型化 fetch，唯一 HTTP 入口）、`lib/theme.ts`（JSON 主题 → CSS 变量 + @font-face）、`lib/audio.ts`（AudioController）、`lib/fullscreen.ts`（全屏封装）、`lib/script-registry.ts`（剧本 UI 槽位注册）、`lib/react-bridge.tsx`（宿主 React 单实例注入）、`ui/launcher.tsx`（主菜单）、`ui/game/`（state/chat/cards/panels/hud/toolbar/pause-menu/icons/slots/ui-icon）。

## Route Handlers（全部）

| 路由 | 方法 | 语义 |
|---|---|---|
| `/api/scripts` | GET / POST | 剧本库列表 / multipart zip 导入（20MB 上限，重复 id 需 `replace=true`） |
| `/api/scripts/:scriptId` | GET | presentation（主题列表）+ origins + catalog（面板静态标签）+ assets（资产清单）+ saves（存档摘要） |
| `/api/scripts/:scriptId/entity-assets/:kind/:entityId` | GET | 实体资产：声明文件优先，否则媒体 provider 按 prompt 生成（缓存 `.chatgame/media-cache/`）；无可用资产 404 |
| `/api/scripts/:scriptId/ui-bundle` | GET | 剧本前端扩展 bundle（`ui/index.tsx` 编译产物，`text/javascript` + Cache-Control；无 ui 入口 404） |
| `/api/runtime/react.mjs` / `jsx-runtime.mjs` | GET | 宿主 React 单实例薄壳（剧本 bundle 经此共享同一 React，防双实例崩 hooks） |
| `/api/sessions` | GET / POST | 会话列表 / 创建（`{scriptId, originId?, seed?, playerName?, loadRunId?}`；新游戏需 originId，续档需 loadRunId） |
| `/api/sessions/:id/state` | GET | worldState + presentation |
| `/api/sessions/:id/presentation` | GET | themes + currentTheme + hasAssets |
| `/api/sessions/:id/turn` | POST | 一回合（返回 TurnResult + 新 state + presentation，区域主题即时生效） |
| `/api/sessions/:id/advance` | POST | 离线推进 `{hours}` |
| `/api/sessions/:id/save` / `saves` / `load` | POST / GET / POST | 存档 / 存档列表 / 按 runId 读档 |
| `/api/sessions/:id/descriptor` | POST | 描述层用户编辑 |
| `/api/sessions/:id` | DELETE | 销毁会话（未保存进度丢弃） |

## UI 拓扑（v2：沉浸壳 + 悬浮工具栏 + 暂停菜单）

- **游戏页 = 沉浸壳**：`data-region="hud"`（顶部玻璃信息条：血条/时钟/地点徽章，不滚动，**整槽可被剧本替换**）/ `data-region="stage"`（对话流，**唯一**滚动容器，`min-h-0 flex-1 overflow-y-auto`）/ `data-region="composer"`（固定底栏：输入 + 发送，**面板入口已移出**）/ `data-region="toolbar"`（右侧悬浮胶囊工具栏：背包/角色/关系/任务/地图/日志入口，**整槽可被剧本替换**）。全页 `h-dvh` 高度链锁死，**输入栏在任何状态下都贴视口底**（空转录/长消息/开模态都不漂移）。
- **次要世界数据 = 居中模态**（`PanelFrame`）：`position:fixed` 覆盖层，`max-w-lg` + `max-h-[min(80dvh)]` + 内滚；遮罩浓度走 `--cg-overlay-strength`；Esc / 点遮罩 / 关闭按钮关闭；**不参与壳的 flex 轨道**。
- **Esc 暂停设置页**（`PauseMenu`，`pause-menu` 槽）：Esc 打开；主题选择（跟随剧本/手动）、声音开关、保存 / 不保存返回 / 保存并返回主菜单；**顶栏的主题下拉框/声音/保存/返回按钮条已删除**。Esc 优先关闭打开的面板，再切换暂停。
- **全屏**：开始新游戏点击（用户手势）请求 `requestFullscreen`；浏览器策略拒绝时静默降级为窗口模式，不阻塞游玩（`lib/fullscreen.ts`）。
- **主菜单**（`Launcher`）：框架通用壳——**开始新游戏 / 继续 / 设置·导入剧本 / 切换剧本**；选中剧本的主题/字体/背景立即应用（`launcher:background` 槽位），主菜单视觉随剧本变化。旧"剧本卡片墙"首页形态已删除，剧本切换为紧凑胶囊条。
- **UI 图标槽**：`UiIcon` 组件消费 `assets.yaml` 的 `ui` 固定槽位（inventory/character/relations/tasks/map/log/save/audio_on/audio_off/close/send/warning/hp/location/time）；剧本可覆盖，缺省框架 **SVG 图标集**（`ui/game/icons.tsx`，stroke=currentColor 随主题，**替换了 emoji 兜底表**）。
- **剧本 UI 槽位**（`lib/script-registry.ts` + `ui/game/slots.tsx`）：剧本 `ui/index.tsx` 默认导出 `(ctx) => ctx.register(slot, { component, position?, order? })`；槽位 = `hud` / `toolbar` / `pause-menu` / `launcher` / `launcher:background` / `panel:<id>` / `bubble:<id>` / `message-card:<id>` / `composer` / `settings:<id>`。未注册槽位回退框架默认组件；切换剧本/加载失败时清空注册表（防跨剧本泄漏）。

## 主题系统（Token v1.1）

- **契约**：剧本根 `theme.yaml`（可选）声明默认主题 + `themes/*.yaml` 附加主题；`by_location` 按玩家所在区域切换（引用主题 id 或内联 palette/effects/typography 安全子集）。字段全部白名单（hex、enum、clamp、font path 前缀），**无任意 CSS 注入**（禁止原始 box-shadow/远程字体/style 文本）。
- **Token 面**：色（8 palette）＋字体角色与**剧本本地字体**（`typography.faces` → `assets/fonts/*`，woff2/woff/ttf/otf）＋字号尺度（scale 驱动 rem）＋行高/字距＋气泡/chrome 半径＋glass/blur＋shadow 闭集＋density 间距闭集＋border 宽度＋motion＋scene_tint/overlay 强度。
- **引擎解析一次**（`src/engine/presentation.ts` 的 `resolveTheme`）：default → by_location 覆盖 → 扁平 `ThemeView`（`toThemeView` 为唯一 DTO 映射）；无主题剧本回退内置 `framework-dark` / `framework-light`。
- **前端消费**：`lib/theme.ts#applyTheme` 把 ThemeView 写入 `:root` 的 `--cg-*` 变量（shadow/density 由框架闭集映射），并注入单一 `<style data-cg-fonts>` @font-face 块（切换主题时替换）；`globals.css` 声明 600ms 颜色过渡、`scale` 驱动根字号、`scene_tint` 背景氛围、`prefers-reduced-motion` 全尊重。玩家设置：默认"跟随剧本"（by_location 动态切换），可手动选择任意剧本主题或内置主题。
- 主题可读性不做 v1 强校验（作者自由可能低对比），内置主题兜底。

## 资产管线

- **契约**：根 `assets.yaml`（可选）单一索引——`portraits/backgrounds/icons/sprites/voices/ambient/effects`（实体 id 键）+ `ui`（固定 chrome 槽位键）。实体键引用校验硬错误（必须对应存在的 npc/location/item/event id）；`ui` 键必须属于固定枚举（硬错误）；文件存在性软警告（prompt-only 合法）。文件类型白名单：svg/png/jpg/jpeg/webp/gif + mp3/wav/ogg + woff2/woff/ttf/otf。`assets.yaml` 是唯一资产真源。
- **媒体线索**：引擎从状态差确定性推导 `MediaCue`（`npc_speech` / `location_enter` / `event`），LLM 不参与媒体决策。`TurnResult.mediaCues` + 转录条目携带。
- **呈现**：`mediaCues` + `resolution` 驱动消息内嵌卡片（NpcCard 立绘+关系标签 / LocationCard 场景 / EventCard / ResolutionChip / ItemCard）；无立绘显示首字母头像、无场景纯色卡、无音频静默——任何剧本优雅降级。
- **音频**：`AudioController`（`lib/audio.ts`）ambient 循环 800ms 交叉淡入、voice/sfx 一次性；启动器点击即满足自动播放策略；location_enter → 环境音切换、event → 音效、npc_speech → 语音。
- **MediaProvider**（`src/engine/media/`）：`off`（默认，全 null）/ `mock`（确定性 SVG 占位图 + 静音 WAV，演示与测试），env `CHATGAME_MEDIA_PROVIDER`；真实文生图/TTS 为 V2（AI SDK v7 `generateImage`/`generateSpeech` 预留路线）。

## 多剧本管理

- **主菜单**：选中剧本即应用其主题/背景（`launcher:background` 槽位）——菜单本身穿剧本的"皮肤"；开始新游戏（出身选择：名称/描述/难度）→ 继续（存档列表：时间戳）→ 设置·导入 zip（非法 zip 报错不影响库）。
- **游戏内流转**：Esc 暂停菜单保存/返回；返回主菜单有未保存提示（dirty 标记）→ 保存并销毁会话 → 回主菜单。
- **转录进存档**：`WorldState.transcript`（player/world/system 条目 + mediaCues）随存档 v5 持久化，续玩完整恢复历史；加载既有会话不重复执行 `onSessionStart`。

## 会话与并发

- 会话内存注册表（非数据库）；同一会话 `playerTurn`/`advance` 串行队列，不同会话独立；闲置 30 分钟回收。
- 存档文件 `.chatgame/saves/<scriptId>/<runId>.json`；媒体缓存 `.chatgame/media-cache/`（gitignore）。

## 验证

```sh
npm test                        # 契约/引擎/服务/API handler 直调/组件（主题变量、音频映射、状态机、卡片降级、Token schema）
npm run lint
npm run build
npm run script:validate -- scripts/emberfall scripts/starlight
npm run play                    # 引擎 CLI 冒烟
```

手动清单：主菜单选剧本（主题/背景立即变化）→ 新游戏（出身）→ 全屏进入 → 多回合对话（NPC 卡 + 判定 chip）→ 移动（场景卡 + 区域主题过渡 + 环境音切换）→ 右侧工具栏开背包面板（居中模态）→ Esc 暂停设置页（主题切换色+半径+玻璃可见变化）→ 保存 → 返回主菜单 → 继续（历史完整）→ zip 导入。几何检查：空转录 / 多消息 / 开面板 / 开暂停页四种状态下，输入栏 y 位置一致（贴视口底）。
