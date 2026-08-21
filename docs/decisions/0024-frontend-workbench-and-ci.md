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

Storybook 使用 `@storybook/nextjs-vite` 和 `test/workbench/game-preview-harness.tsx`；Vitest/RTL 分别在 Node 与 jsdom 环境测试契约和组件，Storybook browser mode 覆盖交互和组件级 axe；Playwright 通过 `next start` 对生产构建执行真实路由 E2E、页面级 axe 和确定性视觉快照。生产玩家流程不拦截 `/api/**`，请求经 Route Handler、EngineHost 与引擎到 Mock LLM 这一非确定性边界。

共享 `test/workbench/core-test-script.ts` 与 `MockGamePort` 提供 Storybook、单元和视觉状态；`MockGamePort` 不进入生产玩家流程。`test/fixtures/core-test-library/core-test-script/` 提供可由生产 loader 读取的独立严格 YAML、Engine API v2 与 UI API v4 fixture，Playwright 用隔离 scripts/data root 驱动它并在套件边界清空数据。

引擎、宿主和脚本契约的通用测试也必须从该独立 fixture 构造世界，不得把《灰烬镇》或《星港》当作平台夹具。只有验证某个内置剧本具体内容关系、素材清单或完整事件闭环的测试可以加载该剧本，并必须放在明确命名的内容回归分组中。

fixture 注册全部公开 UI slot；注册集合由单元契约验证，真实生命周期覆盖 launcher、完整回合、event/location cue、自定义 bubble、panel、pause/save/exit/destroy/continue 与剧本设置。generation 竞态测试保证 world、主题和 bundle 描述符原子归属同一剧本。

视觉矩阵覆盖 390×844、768×1024、1440×900、短横屏、200% 文字、减少动效、高对比和主要空、载入、失败、长内容、dialog、剧本库与设置状态，基线保存在 `e2e/__screenshots__/`。
截图前必须等待字体与所有有限动画完成，再允许最终帧动画状态进入截图；不得通过“禁用动画”把 Dialog 的入场帧固定为透明。全页最大差异像素比例为 1%，避免深色背景掩盖主要构图的完整变化。

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

- [0027](0027-session-first-ui-api-v4.md) — 被测试的 UI 契约。
- [0028](0028-conversation-first-game-layout.md) — 视觉与无障碍矩阵。
