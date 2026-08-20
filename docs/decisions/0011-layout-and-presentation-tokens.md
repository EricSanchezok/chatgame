# 对话主舞台布局 + 深度可扩展表现层 Token v1.1

## Status
Superseded by [0023](0023-layout-theme-and-accessibility-v2.md)
Class: feature

## Context and Problem Statement

v1 前端是"能用的调试面板"：游戏页高度链断裂（输入栏与面板按钮条悬浮在视口中上部，底部大块黑空），六面板走右侧抽屉，主视觉没有落在对话流上；主题系统只有 8 色 + 3 档系统字体，剧本无法深度自定义质感（无本地字体、无 UI 图标槽、无 shadow/density/overlay 等材质 token）。

## Decision Drivers

- 对话流是主舞台：聊天式沉浸 UI。
- 面板是覆盖层，不挤 flex 轨道。
- Token 面加法扩展，旧剧本零改仍合法。
- 安全边界不变：无 CSS 注入表面。

## Considered Options

- 只加固颜色消费、不改 schema。
- 允许 theme 内嵌任意 CSS / style 字符串。
- 远程 Google Fonts / CDN URL。
- 作者自定义整页 layout JSON。
- 右侧抽屉 / 底抽屉 / 常驻分栏。
- 新 npm 设计系统 / 图标包依赖。
- UI 图标塞进 `icons` 实体池。
- 双轨旧抽屉 + 新模态。

## Decision Outcome

**布局**：游戏页改为稳定三区壳——`data-region="hud"`（顶栏摘要 + 会话菜单）/ `data-region="stage"`（对话流，唯一滚动容器）/ `data-region="composer"`（固定底栏：输入 + 面板入口）。全页 `h-dvh` 高度链锁死，输入栏在任何状态下贴视口底。六面板从右侧抽屉改为**居中模态**（`position:fixed` 覆盖层，Esc/遮罩/关闭按钮关闭，不参与壳的 flex 轨道）。启动器满高、卡片墙滚动。新增 `UiIcon` 组件消费 `assets.yaml` 的 `ui` 固定槽位，剧本可覆盖 chrome 图标，缺省框架 glyph 兜底表（单一真源）。

**Token v1.1（加法）**：`theme.yaml` 扩展语义 Token 面——`typography`：line_height/letter_spacing_em/faces（剧本本地字体，`assets/fonts/*`，woff2/woff/ttf/otf）/roles（ui/narrative/mono → face id 或系统档）；`effects`：chrome_radius/blur_px/shadow（闭集 none/soft/medium/hard）/border_width_px/density（闭集 compact/cozy/comfy）/overlay_strength。`by_location` 内联覆盖升级为 palette + effects/typography 安全子集（不允许内联 faces 文件）。`assets.yaml` 新增 `ui` 固定枚举槽（inventory/character/relations/tasks/map/log/save/audio_on/audio_off/close/send/warning/hp/location/time 等）。

**安全边界（保持不变并强化）**：禁止任意 CSS 字符串、远程字体 URL、原始 box-shadow；font family 白名单正则；font path 前缀 `assets/fonts/`；ui 槽位固定枚举硬错误；全部 zod strict。

### Consequences

- 布局壳锁死输入栏位置；面板为覆盖层，打开不挤 flex 轨道；移动端 `safe-area` 处理。
- 剧本可深度自定义：色 + 字体（含本地文件）+ 图标 + 材质（radius/blur/shadow/density/overlay）+ 动效；旧剧本零改仍合法（全部默认值兜底）。
- 安全模型：白名单语义 Token 面扩展，无 CSS 注入表面；schema/validate 测试补齐负例。
- 文档同步：`script-format.md` §19–20、`presentation.md` UI 拓扑 + Token 管道。
- 验证：契约 23 + theme 5 + state/cards 等测试全绿；`tsc` 干净。

## Pros and Cons of the Options

### 只加固颜色消费、不改 schema
- 坏：无法满足字体/图标/深度质感需求，用户明确否决"停在颜色"。

### theme 内嵌任意 CSS / style 字符串
- 坏：XSS 与不可控破坏，违背现有安全模型与 AGENTS 约定。

### 远程 Google Fonts / CDN URL
- 坏：隐私、离线、CSP、可用性问题；改为剧本本地字体。

### 作者自定义整页 layout JSON
- 坏：框架壳拓扑固定；扩展停在 token+资产，避免每剧本分叉 UI 逻辑。

### 右侧抽屉 / 底抽屉 / 常驻分栏
- 坏：用户选定居中模态 + 对话主舞台。

### 新 npm 设计系统 / 图标包依赖
- 坏：干净单一原则；SVG 资产 + 小 fallback 表足够。

### UI 图标塞进 icons 实体池
- 坏：与 item id 耦合错误；独立 `ui` 槽。

### 双轨旧抽屉 + 新模态
- 坏：敏捷无双轨，删除抽屉。

## Links
- [ADR 0012](0012-ui-theme-assets-multiscript.md) — 前端与表现层 v1。
- [docs/game-design/presentation.md](../game-design/presentation.md) — 表现层规格。
