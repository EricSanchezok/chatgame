# 表现层规格（Presentation & UI）

> 前端与表现层 v1 的规格——"剧本长什么样"的呈现契约：UI 结构、Route Handlers、主题系统、资产管线、多剧本管理。决策依据见 [.agents/notes/implemented/feature/2026-08-19-ui-theme-assets-multiscript.md](../../.agents/notes/implemented/feature/2026-08-19-ui-theme-assets-multiscript.md)；剧本侧契约见 [script-format.md](script-format.md)。

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
- **前端**（`src/app/`，'use client'，无新依赖）：`lib/api.ts`（类型化 fetch，唯一 HTTP 入口）、`lib/theme.ts`（JSON 主题 → CSS 变量）、`lib/audio.ts`（AudioController）、`ui/launcher.tsx`（剧本卡片墙）、`ui/game/`（state/chat/cards/panels）。

## Route Handlers（全部）

| 路由 | 方法 | 语义 |
|---|---|---|
| `/api/scripts` | GET / POST | 剧本库列表 / multipart zip 导入（20MB 上限，重复 id 需 `replace=true`） |
| `/api/scripts/:scriptId` | GET | presentation（主题列表）+ origins + catalog（面板静态标签）+ assets（资产清单）+ saves（存档摘要） |
| `/api/scripts/:scriptId/assets/*` | GET | 资产文件字节流（MIME 白名单，防穿越 400） |
| `/api/scripts/:scriptId/entity-assets/:kind/:entityId` | GET | 实体资产：声明文件优先，否则媒体 provider 按 prompt 生成（缓存 `.chatgame/media-cache/`）；无可用资产 404 |
| `/api/sessions` | GET / POST | 会话列表 / 创建（`{scriptId, originId?, seed?, playerName?, loadRunId?}`；新游戏需 originId，续档需 loadRunId） |
| `/api/sessions/:id/state` | GET | worldState + presentation |
| `/api/sessions/:id/presentation` | GET | themes + currentTheme + hasAssets |
| `/api/sessions/:id/turn` | POST | 一回合（返回 TurnResult + 新 state + presentation，区域主题即时生效） |
| `/api/sessions/:id/advance` | POST | 离线推进 `{hours}` |
| `/api/sessions/:id/save` / `saves` / `load` | POST / GET / POST | 存档 / 存档列表 / 按 runId 读档 |
| `/api/sessions/:id/descriptor` | POST | 描述层用户编辑 |
| `/api/sessions/:id` | DELETE | 销毁会话（未保存进度丢弃） |

## 主题系统

- **契约**：剧本根 `theme.yaml`（可选）声明默认主题 + `themes/*.yaml` 附加主题；`by_location` 按玩家所在区域切换（引用主题 id 或内联调色板覆盖）。字段全部白名单（hex `^#[0-9a-fA-F]{3,8}$`、字体 enum、scale 0.85–1.3、bubble_radius 0–24、glass 0–1、motion enum），无任意 CSS 注入。
- **引擎解析一次**（`src/engine/presentation.ts` 的 `resolveTheme`）：default → by_location 覆盖 → 扁平 `ThemeView`；无主题剧本回退内置 `framework-dark` / `framework-light`。
- **前端消费**：`lib/theme.ts` 把 ThemeView 写入 `:root` 的 `--cg-*` 变量；`globals.css` 声明 600ms 颜色过渡，`scene_tint` 作为背景氛围层（radial-gradient）。玩家设置：默认"跟随剧本"（by_location 动态切换），可手动选择任意剧本主题或内置主题。
- 主题可读性不做 v1 强校验（作者自由可能低对比），内置主题兜底。

## 资产管线

- **契约**：根 `assets.yaml`（可选）单一索引——`portraits/backgrounds/icons/sprites/voices/ambient/effects`，键为实体 id；条目 `{file}`（静态文件）和/或 `{prompt}`（文生图/TTS 占位）。引用校验硬错误（键必须对应存在的 npc/location/item/event id）；文件存在性软警告（prompt-only 合法）。文件类型白名单：svg/png/jpg/jpeg/webp/gif + mp3/wav/ogg。`assets.yaml` 是唯一资产真源。
- **媒体线索**：引擎从状态差确定性推导 `MediaCue`（`npc_speech` / `location_enter` / `event`），LLM 不参与媒体决策。`TurnResult.mediaCues` + 转录条目携带。
- **呈现**：`mediaCues` + `resolution` 驱动消息内嵌卡片（NpcCard 立绘+关系标签 / LocationCard 场景 / EventCard / ResolutionChip / ItemCard）；无立绘显示首字母头像、无场景纯色卡、无音频静默——任何剧本优雅降级。
- **音频**：`AudioController`（`lib/audio.ts`）ambient 循环 800ms 交叉淡入、voice/sfx 一次性；启动器点击即满足自动播放策略；location_enter → 环境音切换、event → 音效、npc_speech → 语音。
- **MediaProvider**（`src/engine/media/`）：`off`（默认，全 null）/ `mock`（确定性 SVG 占位图 + 静音 WAV，演示与测试），env `CHATGAME_MEDIA_PROVIDER`；真实文生图/TTS 为 V2（AI SDK v7 `generateImage`/`generateSpeech` 预留路线）。

## 多剧本管理

- **启动器**：已安装剧本卡片（名称/描述/作者/主题色渲染）；新游戏（出身选择：名称/描述/难度）→ 继续（存档列表：时间戳）→ 导入 zip（非法 zip 报错不影响库，合法出现新卡片）。
- **游戏内流转**：返回启动器有未保存提示（dirty 标记）→ 保存并销毁会话 → 回启动器。
- **转录进存档**：`WorldState.transcript`（player/world/system 条目 + mediaCues）随存档 v3 持久化，续玩完整恢复历史。

## 会话与并发

- 会话内存注册表（非数据库）；同一会话 `playerTurn`/`advance` 串行队列，不同会话独立；闲置 30 分钟回收。
- 存档文件 `.chatgame/saves/<scriptId>/<runId>.json`；媒体缓存 `.chatgame/media-cache/`（gitignore）。

## 验证

```sh
npm test                        # 446：契约/引擎/服务/API handler 直调/组件（主题变量、音频映射、状态机、卡片降级）
npm run lint
npm run build
npm run script:validate -- scripts/emberfall scripts/starlight
npm run play                    # 引擎 CLI 冒烟
```

手动清单：启动器两卡片 → 新游戏（出身）→ 多回合对话（NPC 卡 + 判定 chip）→ 移动（场景卡 + 区域主题过渡 + 环境音切换）→ 背包面板 → 主题切换 → 保存 → 返回 → 继续（历史完整）→ zip 导入第三张卡片。
