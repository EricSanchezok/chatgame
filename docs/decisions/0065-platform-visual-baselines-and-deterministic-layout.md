# 跨平台视觉基线与确定性布局

## Status
Accepted
Class: testing

## Context and Problem Statement

视觉回归在 macOS 与 Linux 上使用同一截图文件时，会把中文字体栅格化差异误判为产品回归。横向溢出容器内依赖百分比 `grid-auto-columns` 的卡片轨道还会产生真实的跨平台几何差异。测试必须区分不可消除的像素渲染差异与必须修复的布局不确定性。

## Decision Drivers

- CI 与本地开发都必须能使用严格视觉门禁。
- 真实布局漂移不能被增大像素容差掩盖。
- 字体抗锯齿等平台渲染差异不能持续制造误报。
- 基线生成和定位必须保持 Playwright 原生工作流。

## Considered Options

- 所有平台共享一个截图基线并提高允许差异比例。
- 只在 Linux CI 执行视觉测试。
- 保持严格阈值，按平台保存基线，并先修复跨平台几何差异——所选路线。

## Decision Outcome

Playwright 的快照路径包含 `{platform}`，macOS 与 Linux 分别维护视觉基线，所有平台继续使用相同的严格像素阈值。跨平台基线只允许吸收字体栅格化和系统级绘制差异；元素尺寸、换行、溢出、层级与内容差异必须先在 CSS、固定测试数据或断言中消除。

横向卡片轨道使用具有确定容器宽度的 flex basis，不在横向溢出网格的隐式轨道中解析百分比列宽。CI 产物保留 expected、actual 与 diff，失败时先按几何和内容审计，再决定是否更新对应平台基线。

## Pros and Cons of the Options

### 共享基线并提高容差

- 好：文件数量少，本地生成简单。
- 坏：足以覆盖字体差异的阈值也会放过小型布局回归。

### 只在 Linux 执行视觉测试

- 好：CI 只有一个权威渲染环境。
- 坏：macOS 开发者无法在提交前验证自己的平台表现。

### 平台基线与确定性布局

- 好：保持严格阈值，同时让本地与 CI 都能可靠发现各自平台的回归。
- 坏：每个受支持平台需要维护一套截图文件。

## Links

- [0024](0024-frontend-workbench-and-ci.md) — 前端视觉与浏览器门禁的起点。
- [0034](0034-truth-engine-verification-matrix.md) — 分层验证策略。
- [0064](0064-conversation-core-and-agent-perspective-observer.md) — 本次视觉表面的产品契约。
