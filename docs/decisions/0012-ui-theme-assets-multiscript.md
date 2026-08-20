# 前端与表现层 v1——沉浸聊天式 UI + 剧本资产/主题系统 + 多剧本管理

## Status
Superseded by 0022
Class: feature

## Context and Problem Statement

chatgame 此前只有"能跑的引擎 + Next 脚手架页面"：无任何游戏 UI，剧本没有主题/资产表达，玩家无法多剧本切换、无存档续玩（读档无对话历史）。四项用户需求：沉浸聊天式 UI（对话流为主、世界数据进覆盖面板）、资产管线（立绘/场景/图标/语音/音效，静态文件 + 文生图/TTS 提示词占位）、主题系统（剧本自带 theme.yaml + 按区域动态切换整站视觉）、多剧本管理（启动器列表/新游戏选出身/继续读档/zip 导入）。

## Decision Drivers

- 引擎只在服务端：fs/YAML/API key 决定不可行。
- 媒体决策归引擎：LLM 永不参与媒体决策。
- 转录进存档：续玩恢复对话历史。
- 敏捷模式：存档 v2→v3 直接断，无迁移。

## Considered Options

- 视觉小说式主界面。
- 引擎跑在浏览器。
- 资产字段内联进 npc/location/item schema。
- 脚本导入走 public/ 静态目录。
- 前端状态库（redux/zustand）或动画库。
- 存档 v2 迁移层。

## Decision Outcome

按 Blueprint（前端与表现层 v1）落地，核心决策：

- **表现层进入引擎与契约**（非纯前端补丁）：契约层新增两个可选根模块 `theme.yaml`（+ `themes/*.yaml`）与 `assets.yaml`——纯加法，不改既有 18 模块任何字段。主题字段全白名单（hex 正则、字体 enum、scale/radius/glass clamp），无任意 CSS 注入；assets 是**唯一资产真源**，键引用实体 id 硬错误、文件存在性软警告（prompt-only 合法）。
- **媒体决策归引擎**：`MediaCue`（`npc_speech`/`location_enter`/`event`）由 `deriveMediaCues(prev, next, resolution)` 从状态差确定性推导——"引擎管规则，LLM 管叙事"的延伸，LLM 永不参与媒体决策。`MediaProvider`（off/mock）只是生成接缝，真实文生图/TTS 为 V2。
- **转录进存档**：`WorldState.transcript`（player/world/system 条目 + mediaCues）完整对话历史随存档 v3 持久化，续玩恢复历史。敏捷模式：v2→v3 直接断，无迁移。
- **EngineHost 服务托管**（`src/server/`）：会话注册表（globalThis 单例防 HMR 双实例、30 分钟闲置回收、上限 20）、每会话串行队列、剧本扫描、zip/目录导入（单一核心 `script-import.ts`，web 与 CLI 共用；zip-slip 拒绝）、资产文件服务（resolve 前缀校验防穿越）。
- **Route Handlers 薄 API + 'use client' 前端**：引擎只在服务端；前端无新依赖（Context+reducer、CSS transition）。主题 = `--cg-*` CSS 变量（`lib/theme.ts` 写入 `:root`，600ms 过渡），`by_location` 按玩家区域动态切换；UI 硬编码颜色零容忍。音频 = `AudioController`（ambient 交叉淡入/voice/sfx，用户手势解锁，缺文件静默）。
- **根因修复（发现于实现中）**：`applyDeathPolicy` 的 world_continue/hard_reset 原实现**无条件触发**——starlight 每回合都重跑世界（丢失 transcript 等全部状态）。修复为显式触发门（soft_failure 看威胁条阈值，另两种看玩家 hp 归零）+ hard_reset reroll 保留转录 + 死亡叙事写入 system 转录条目。

### Consequences

- 契约层 +2 可选模块（校验硬错/软警告通道）；引擎 +presentation.ts +media/ +transcript +mediaCues +存档 v3；服务层 +EngineHost +导入核心 +CLI；API 全 Route Handlers；前端启动器/游戏屏/六面板/主题引擎/音频控制器。
- 测试：契约 14 + 引擎 14 + 服务 17 + API 11 + 组件 25（主题变量/音频映射/状态机/卡片降级），全仓 446 通过；`lint`/`build`/`script:validate`/`play` 全绿。
- 已知边界：转录 v1 无上限（V2 压缩/裁剪）；主题对比度不强制校验（内置主题兜底）；真实文生图/TTS、回合流式、剧本市场为 V2。

## Pros and Cons of the Options

### 视觉小说式主界面
- 坏：用户明确否决（沉浸聊天式）。

### 引擎跑在浏览器
- 坏：fs/YAML/API key 决定不可行。

### 资产字段内联进 npc/location/item schema
- 坏：改动面 ×3、strict schema 连锁；选单一 `assets.yaml` 索引（每个事实一个家）。

### 脚本导入走 public/ 静态目录
- 坏：运行时导入的剧本无法覆盖静态目录；选 Route Handler 流式服务 + 防穿越。

### 前端状态库或动画库
- 坏：v1 规模 Context+reducer + CSS transition 足够；拒绝新依赖。

### 存档 v2 迁移层
- 坏：与敏捷原则冲突；v3 直接断。

## Links
- [ADR 0007](0007-engine-runtime.md) — 引擎运行时。
- [ADR 0011](0011-layout-and-presentation-tokens.md) — 布局与 Token v1.1。
- [docs/game-design/presentation.md](../game-design/presentation.md) — 表现层规格。
