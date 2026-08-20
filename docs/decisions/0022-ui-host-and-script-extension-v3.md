# 前端宿主与剧本 UI 扩展契约 v3

## Status
Accepted
Class: architecture

## Context and Problem Statement

现有前端扩展注册表是异步可变 Map，加载完成不触发 React 更新，快速切换可能让旧 bundle 覆盖新剧本。公开插槽多数没有真实消费点，剧本各自复制 props 类型并读取错误状态。启动器、会话 Context、动态缓存和错误边界没有形成可验证的宿主边界。

## Decision Drivers

- 剧本可以重塑完整体验，但不能创建第二套会话、存档或状态权威。
- 所有公开插槽必须真实可达、强类型、可回退。
- 剧本激活、主题与 bundle 必须原子一致。
- 客户端只消费稳定、只读的语义 view-model 与 capability。
- 已加载剧本目录在活跃会话结束前保持不变，避免回合、预检、主题与扩展代码跨安装版本。

## Considered Options

- 继续维护模块级 Map 和按需补接插槽。
- 只允许主题 token，不允许运行时代码。
- 建立版本化 UI API、响应式原子 registry 和宿主 I/O 边界。
- 让剧本接管路由、网络和会话状态。
- 允许替换活跃会话的导入剧本并让既有 Engine 继续运行旧版本。

## Decision Outcome

建立客户端安全的 UI API v3。唯一契约由 `@chatgame/ui` 导出；剧本 bundle 声明版本并一次注册到临时不可变 registry，重复 slot 或任一校验失败使整次注册失败。registry 通过 `useSyncExternalStore` 被 React 订阅；最后一次完整激活版本独立于所有进行中的请求保留，同一剧本的重叠激活失败仍恢复该版本，跨剧本失败提交目标剧本的空 slots 并使用宿主 fallback，旧剧本组件不得接收新剧本 view-model。

剧本激活的 scriptId、主题与 slots 作为一个 generation 提交；较早请求晚到时不得覆盖新激活。依赖图内容与 UI API 版本共同进入 bundle URL，服务端提供 ETag 与不可变缓存。构建只允许剧本目录内相对依赖、React 运行时和 `@chatgame/ui` 浏览器安全边界，禁止把宿主服务端模块或任意本地文件打入 bundle。

宿主实现 `GameStore/controller + GamePort`，生产使用 `HttpGamePort`，测试与 Storybook 使用 `MockGamePort`。Context 只负责稳定注入和选择器。请求带 generation 与取消信号，过期结果不得更新活跃会话。EngineHost 只发布最后一次完整提交的会话快照，并让预检等待同一会话的 mutation 队列，异步回合内部状态不得被读取接口观察。

UI API v3 仅暴露 `launcher`、`game-shell`、`scene`、`hud`、`toolbar`、`composer`、`pause-menu`、`panel:*`、`bubble:*`、`message-card:*`、`settings:*`。单例替换槽没有 position/order。剧本获得只读 view-model 和 `start`、`continue`、`openPanel`、`previewAction`、`submitTurn` 等 capability；路由、存档、网络、portal、焦点、错误隔离和可访问壳由宿主持有。

`ScriptPresentation` 明确返回 `defaultThemeId` 与版本化 `uiBundle`，剧本摘要从资产清单读取静态封面。两阶段导入在执行剧本代码前展示校验、来源、权限与冲突；暂存 token 绑定预检时目标安装的完整内容身份、安装代次、冲突和替换权限。每次成功安装写入新的 opaque 安装代次，commit 同步重算并比较目标身份，因此缺失、替换、删除后原样重装等任一变化都会使旧 token 返回 409，必须重新预检。EngineHost 是活跃会话的唯一权威，Web commit、host zip 导入和 host 目录导入在原子替换前都由它拒绝仍有活跃会话的 scriptId；失败消费 Web token，结束会话后必须重新预检。

## Pros and Cons of the Options

### 补接现有 Map

- 好：改动最小。
- 坏：竞态、类型复制、缓存陈旧和不可观察注册继续存在。

### 仅主题 token

- 好：安全面和实现复杂度最低。
- 坏：无法满足剧本完整替换交互结构的产品要求。

### UI API v3 与宿主边界

- 好：扩展能力深且可测试，宿主仍能保证状态与无障碍不变量。
- 坏：需要重写现有 UI bundle，并维护一套公共客户端契约。

### 剧本接管宿主

- 好：自由度最高。
- 坏：会话、存档、错误处理与无障碍分叉，无法保持框架一致性。

### 替换活跃会话的剧本

- 好：安装操作无需等待玩家退出。
- 坏：会话 Engine、候选回合重新加载的目录、行动预检、主题和 UI bundle 可能来自不同安装版本，无法形成一致快照。

## Links

- [0012](0012-ui-theme-assets-multiscript.md) — 被本记录完整取代的前端与多剧本契约。
- [0018](0018-immersive-frontend-script-code-v2.md) — 被本记录取代的代码扩展契约。
- [0021](0021-gameplay-and-engine-extension-v2.md) — 引擎动作与生命周期契约。
- [0023](0023-layout-theme-and-accessibility-v2.md) — 宿主表现约束。
