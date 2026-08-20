# 前端沉浸式游戏化与剧本代码扩展（v2）

## Status
Superseded by [0022](0022-ui-host-and-script-extension-v3.md)
Class: feature

## Context and Problem Statement

用户反馈前端"太丑、AI 感重、是 debug 调试面板"：HUD 是一行文本 + 主题下拉框 + 按钮条；面板是纯文本列表；启动器是"剧本库卡片墙"且整页不应用剧本主题；无全屏、无 Esc 设置页、无血条 UI；两个内置剧本（emberfall/starlight）资产几乎为空，全靠首字母头像/纯色卡降级。同时用户要求"前端几乎所有内容可被剧本替换"——扩展性拉满，让剧本能设计出足够沉浸的感觉。

## Decision Drivers

- 用户拍板：不搞"安全可校验"的白名单（信任本地剧本作者）；绝不向后兼容（五连强调）；引擎扩展 seam 同步开；HUD 默认顶部 + 右侧悬浮（剧本可覆盖）；内置剧本用精致矢量插画重做。
- 引擎管规则、LLM 管叙事边界保留：扩展 handler 为纯函数（immutable state 更新），内置闭集语义不变。
- 前端硬编码颜色零容忍（`--cg-*`）。
- 只抄薄模式（注册表 + 槽位 + 默认兜底），不抄 deepseek-harness 的 54 包规模。

## Considered Options

- 纯声明式表现契约（ui.yaml 白名单）：用户明确否决；声明式无法满足"任意替换"，代码注册是唯一满足需求的路线。
- 完整插件框架（Cordis 式服务/事件瀑布流/54 包拆分）：50 万行结构性代价；chatgame 只取"注册表 + 槽位 + 默认兜底"薄模式。落选。
- bundle 内联第二份 React：直接产生双 React hooks 崩溃。落选——宿主单实例全局桥（window 上的 CG 运行时桥）+ 薄壳 re-export。
- importmap / 独立 React 打包：双 React 实例会崩 hooks。落选。
- 旧存档兼容/迁移层：用户五连强调否决；v4 直接断 v3。
- 剧本代码携带（`engine/` + `ui/`）+ 前端游戏化 + 内置剧本重做——所选路线。

## Decision Outcome

**剧本从"YAML 数据"升级为"YAML 数据 + 可携带代码"**：

1. **引擎扩展 seam（服务端）**：
   - `src/engine/extensions.ts`：`EngineExtensionContext` 注册 API（`registerEffect` / `registerConditionSource` / `registerActionHandler`）。
   - `src/script/runtime-code.ts`：esbuild 编译 `scripts/<id>/engine/index.ts` → CJS → `createRequire` 加载，内容 hash 缓存 `.chatgame/build/<id>/engine.cjs`；无 `engine/` 目录的剧本返回空扩展（完全合法）。
   - schema 放宽：`effectSchema` 新增自定义 kind 兜底分支（内置 kind 集拒绝）；`conditionSourceSchema` 允许任意字符串 source；`actionEntrySchema` 新增可选 `handler` 字段、`resolve` 在 handler 模式下可省略。
   - 执行器接入：`applyEffects` 对未知 kind 查 `definition.extensions.effects`（未注册则跳过并记录 summary）；`evalConditionLeaf` 对未知 source 查 `extensions.conditions`（未注册恒 false）；`resolveAction` 对声明 `handler` 的动作走自定义处理器。
   - `WorldState.runtimeState: Record<string, unknown>`：扩展自定义持久态，引擎不解释内容，随存档 v4 持久化。
   - 校验：`collectEffectRefs` 跳过自定义 effect kind；action 无 resolve 且无 handler 报错。

2. **前端剧本代码加载（浏览器）**：
   - `src/server/script-ui-build.ts`：esbuild 编译 `scripts/<id>/ui/index.tsx` → ESM browser bundle（react 三包 external），产物后处理把 react 导入重写为 `/api/runtime/react.mjs`、`/api/runtime/jsx-runtime.mjs` 薄壳 URL；`.chatgame/build/<id>/ui.mjs` 内容 hash 缓存，dev 强制重编译。
   - 宿主 React 单实例（防双 React 崩 hooks）：`src/app/lib/react-bridge.tsx` 在 window 上注入宿主 React 运行时全局桥（标识为 CG，前后各两个下划线），两个 runtime 薄壳 route 返回固定 ESM 文本，从该全局桥解构导出。
   - `GET /api/scripts/[scriptId]/ui-bundle`：scriptId 白名单正则防路径注入；失败 404 + JSON error；成功 `text/javascript` + Cache-Control。

3. **前端游戏化**：
   - `src/app/lib/fullscreen.ts`：开始新游戏点击（用户手势）请求全屏，失败静默降级窗口模式。
   - 主菜单（Launcher 重构）：开始新游戏 / 继续 / 继续上次游戏 / 设置·导入剧本 / 切换剧本；选中剧本的主题/字体/背景立即应用（`launcher:background` 槽位）；删除"剧本卡片墙"首页形态；标题旁展示 age_rating 徽标（[0016](0016-dead-contract-wiring-and-ui-consumption.md) 的 launcher 消费保留）。
   - Esc 暂停设置页（PauseMenu，`pause-menu` 槽）：主题选择、声音开关、保存 / 返回；删除 v1 顶栏按钮条。
   - HUD 默认实现（`hud.tsx`）：顶部玻璃信息条——血条 + 时钟徽章 + 地点徽章；整槽可被剧本替换。
   - 右侧悬浮工具栏（`toolbar.tsx`）：玻璃胶囊按钮组（背包/角色/关系/任务/地图/日志），与 composer 解耦。
   - UI 图标：emoji 兜底表替换为内联 SVG 图标集（`icons.tsx`，stroke=currentColor）。
   - state：新增 `paused` 状态 + Esc 优先关面板再切暂停。

4. **内置剧本重做（emberfall/starlight）**：手写分层 SVG 资产套件（场景/立绘/物品图标/UI 槽图标）+ 各配 `engine/index.ts` 与 `ui/index.tsx` 扩展示例。

5. **已合并决策的 UI 功能在新结构中保留**（集成时裁决）：A 的"继续上次游戏"入口与出身解锁过滤保留在主菜单/新游戏模态；C 的 SystemFeedbackBlock（worldEvents/taskCompletions/deathFired/fellBackToTalk）、描述编辑与快进控件保留在 panels/chat 中。

## Pros and Cons of the Options

- 所选路线：前端从调试面板变为沉浸式游戏界面（主菜单/全屏/HUD/工具栏/暂停页）；剧本可替换几乎所有 UI 结构；引擎扩展 seam 让剧本能力上限提升；内置剧本有真实视觉资产。代价：信任模型改变（导入 zip = 运行他人代码，UI 明示）；存档 v4 断 v3；esbuild 新依赖。
- 声明式白名单：不能满足"任意替换"。落选。
- 完整插件框架：结构性代价过大。落选。

## Links

- [0016](0016-dead-contract-wiring-and-ui-consumption.md)（TurnResult 消费、描述编辑、快进）
- [0017](0017-session-persistence-refresh-recovery-meta.md)（继续上次、出身解锁、SaveStore）
- [0004](0004-game-first-principles.md)（剧本驱动第一性原理）
- `docs/research/`（deepseek-harness 插件架构调研）
