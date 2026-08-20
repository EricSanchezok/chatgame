# 架构总览

chatgame 是剧本驱动的 AI 游戏框架。系统分层：

| 层 | 职责 |
|---|---|
| 剧本（Script） | 内容载体：世界观、背景、人物、机制配置 + 可选扩展代码（`engine/` 服务端规则、`ui/` 前端表现） |
| 引擎核心（Engine Core） | 世界状态与游戏进程：时间推进、事件调度、机制执行、存档/读档、剧本扩展加载 |
| 机制层（Mechanisms） | 通用机制：角色属性与记忆、背包、战斗、生命值等；由剧本配置或扩展 |
| LLM 桥（LLM Bridge） | 把世界状态与玩家动作转化为叙事与角色行为 |
| 界面（UI） | 沉浸式游戏界面：主菜单 / 全屏 / HUD / 悬浮工具栏 / 暂停设置页 / 槽位渲染 |

核心原则（决策依据见 [第一性原理决策记录](decisions/0004-game-first-principles.md)）：

- 剧本决定"世界是什么"，机制层决定"世界如何运转"，LLM 决定"世界如何回应"。
- 引擎管状态与规则（规范性），LLM 管叙事与行为（随机性）。
- 游戏状态是引擎管理的真实数据，不以对话文本为载体。

## 模块地图

```
src/script/   契约层：剧本格式 schema（zod strict）+ 校验（validate.ts / validate-presentation.ts）+ 剧本代码编译加载（runtime-code.ts）
src/engine/   引擎运行时：世界状态、回合循环（PDVA）、机制、事件/任务、双轨状态描述层、存档、表现层、扩展注册（extensions.ts）
├── mechanics/   通用机制：inventory / needs / status / combat / progression（不可变快照 + 纯函数）
├── narrative/   LLM 桥：provider + prompt + 意图解析 + 一致性校验（Mock / Vercel AI SDK）
└── media/       MediaProvider 接缝（off / mock；真实文生图/TTS 为 V2）
src/server/   服务托管：EngineHost（会话注册表 + 串行队列）+ script-import（web 与 CLI 共用的导入核心）+ script-ui-build（剧本 ui/ 编译）
src/app/      UI + Route Handlers：沉浸式前端（主菜单 / game + 槽位渲染）+ lib/theme / lib/audio / lib/api / lib/script-registry
```

各层详情见 [docs/game-design/](game-design/README.md) 规格；架构决策见 [docs/decisions/](decisions/README.md)。

## 剧本代码扩展 seam

剧本 = 纯配置（YAML 模块）+ **可选代码目录**（`engine/` 与 `ui/`）。剧本代码与框架同权（**信任本地剧本作者**——本地部署、作者即玩家；导入 zip = 运行他人代码，导入 UI 已明示）。配置表达不了的规则/表现由代码扩展缝承接：

- **`engine/index.ts`**（服务端）：默认导出 `(ctx: EngineExtensionContext) => void`，注册自定义效果 kind / 条件 source / 动作 handler / 规则机制 / 生命周期；动作 handler 先返回纯 `ActionHandlerPlan`（拒绝、动态成本、耗时、单次 `execute`），预检只读计划、执行阶段才调用 `execute`。自定义持久状态写入 `WorldState.runtimeState`（引擎不解释，随存档 v5 持久化）。由 `src/script/runtime-code.ts` 用 esbuild 编译为 CJS 加载（`.chatgame/build/<id>/` 内容 hash 缓存）。
- **`ui/index.tsx`**（浏览器）：默认导出 `(ctx: ScriptUiContext) => void`，注册组件到槽位（`hud` / `toolbar` / `pause-menu` / `launcher` / `launcher:background` / `panel:<id>` / `bubble:<id>` / `message-card:<id>` 等）；未注册槽位回退框架默认组件。由 `src/server/script-ui-build.ts` 编译为 ESM bundle（react 外部化 + 宿主单实例共享），浏览器经 `/api/scripts/<id>/ui-bundle` 动态加载。

内置闭集（effect/condition/action 的白名单语义）保持不变；未知或未注册的 kind/source/handler/rule 在剧本校验和运行期都响亮失败，不允许把无效声明静默降级为游戏结果。
