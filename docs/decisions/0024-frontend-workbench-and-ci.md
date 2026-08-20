# 前端测试工作台与 CI

## Status
Accepted
Class: testing

## Context and Problem Statement

现有 Vitest 以 Node 环境为主，UI 只有少量纯函数测试；仓库没有 Storybook、浏览器组件测试、视觉回归、axe 或 CI workflow。异步 bundle 注册、焦点、响应式、主题和完整玩家路径因此可以在 lint、build 与 schema 校验全部通过时失效。

## Decision Drivers

- 测试真实入口路径和玩家可观察世界。
- 组件状态、交互、无障碍和视觉变化均可在本地复现。
- 快速门禁与耗时浏览器矩阵分层。
- 测试夹具不依赖任一内置剧本的内容 ID。

## Considered Options

- 继续使用 Node Vitest 与人工浏览器检查。
- 只添加 Playwright E2E。
- Storybook、Vitest/RTL、Playwright、axe 与截图基线分层组合。
- 使用托管视觉回归 SaaS。

## Decision Outcome

Storybook 使用 `@storybook/nextjs-vite` 和 `test/workbench/game-preview-harness.tsx`；Vitest/RTL 分别在 Node 与 jsdom 环境测试契约和组件，Storybook browser mode 覆盖交互和组件级 axe；Playwright 通过 `next start` 对生产构建执行真实路由 E2E、页面级 axe 和确定性视觉快照。

共享 `test/workbench/core-test-script.ts` 与 `MockGamePort` 生成不依赖内置剧本 ID 的平台夹具。视觉矩阵覆盖 390×844、768×1024、1440×900、短横屏、200% 文字、减少动效、高对比和主要空、失败、长内容状态，基线保存在 `e2e/__screenshots__/`。

命令分为 `check:fast`、`check:ui`、`check:all`；`.github/workflows/frontend-workbench.yml` 在 Node 22 上分别执行快速门禁与 Chromium 浏览器矩阵。视觉回归不依赖外部 SaaS。

## Pros and Cons of the Options

### Node 测试与人工检查

- 好：依赖少、速度快。
- 坏：无法验证浏览器、焦点、布局和异步模块时序。

### 仅 Playwright

- 好：覆盖真实入口。
- 坏：组件失败定位慢，状态矩阵成本高。

### 分层本地测试栈

- 好：单元、组件、交互、无障碍、视觉和真实流程各有最合适的验证层。
- 坏：依赖和 CI 时间增加，需要维护确定性 fixture 与快照。

### 托管视觉服务

- 好：审阅界面成熟。
- 坏：引入外部账户、费用和不可离线依赖。

## Links

- [0022](0022-ui-host-and-script-extension-v3.md) — 被测试的 UI 契约。
- [0023](0023-layout-theme-and-accessibility-v2.md) — 视觉与无障碍矩阵。
