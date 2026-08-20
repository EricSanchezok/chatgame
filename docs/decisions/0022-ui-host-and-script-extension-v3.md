# 前端宿主与剧本 UI 扩展契约 v3

## Status
Proposed
Class: architecture

## Context and Problem Statement

现有前端扩展注册表是异步可变 Map，加载完成不触发 React 更新，快速切换可能让旧 bundle 覆盖新剧本。公开插槽多数没有真实消费点，剧本各自复制 props 类型并读取错误状态。启动器、会话 Context、动态缓存和错误边界没有形成可验证的宿主边界。

## Decision Drivers

- 剧本可以重塑完整体验，但不能创建第二套会话、存档或状态权威。
- 所有公开插槽必须真实可达、强类型、可回退。
- 剧本激活、主题与 bundle 必须原子一致。
- 客户端只消费稳定、只读的语义 view-model 与 capability。

## Considered Options

- 继续维护模块级 Map 和按需补接插槽。
- 只允许主题 token，不允许运行时代码。
- 建立版本化 UI API、响应式原子 registry 和宿主 I/O 边界。
- 让剧本接管路由、网络和会话状态。

## Decision Outcome

建立客户端安全的 UI API v3。剧本 bundle 声明版本并一次注册到临时不可变 registry，全部校验成功后与主题原子切换；registry 通过 `useSyncExternalStore` 被 React 订阅。依赖图内容哈希进入 bundle URL，服务端提供 ETag 与不可变缓存；版本错误或渲染异常回退宿主实现。

宿主实现 `GameStore/controller + GamePort`，生产使用 `HttpGamePort`，测试与 Storybook 使用 `MockGamePort`。Context 只负责稳定注入和选择器。请求带 generation 与取消信号，过期结果不得更新活跃会话。

UI API v3 仅暴露 `launcher`、`game-shell`、`scene`、`hud`、`toolbar`、`composer`、`pause-menu`、`panel:*`、`bubble:*`、`message-card:*`、`settings:*`。单例替换槽删除无效的 position/order。剧本获得只读 view-model 和 `start`、`continue`、`openPanel`、`submitTurn` 等 capability；路由、存档、网络、portal、焦点、错误隔离和可访问壳由宿主持有。

`ScriptPresentation` 明确返回 `defaultThemeId` 与版本化 `uiBundle`，剧本摘要从资产清单读取静态封面。两阶段导入在执行剧本代码前展示校验、来源、权限与冲突。

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

## Links

- [0012](0012-ui-theme-assets-multiscript.md) — 被本记录完整取代的前端与多剧本契约。
- [0018](0018-immersive-frontend-script-code-v2.md) — 被本记录取代的代码扩展契约。
- [0021](0021-gameplay-and-engine-extension-v2.md) — 引擎动作与生命周期契约。
- [0023](0023-layout-theme-and-accessibility-v2.md) — 宿主表现约束。
