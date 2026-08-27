# 隐藏控制层造成无障碍扫描竞态

## Executive summary

控制球打开角色 Dialog 时先把菜单卡透明退出，再打开 Dialog。Linux CI 恰好在退出动画尚未结束时运行 axe；虽然菜单卡已 `aria-hidden` 且不可点击，它仍参与像素合成，导致底层文字被判定为低对比度。macOS 执行速度没有触发该窗口。修复让关闭菜单立即 `visibility: hidden`，并在无障碍测试中等待角色 Dialog 可见与旧菜单不可见后再扫描。

## Summary

行为 E2E、视觉快照和大多数无障碍场景通过，Participant 的角色弹层扫描稳定报告大量 `color-contrast` 节点。报告中的前景和背景颜色来自底层会话与正在淡出的控制球卡片叠加，并非主题 token 本身不足。

## Timeline

1. 控制球菜单点击“角色”后将 `open` 设为 false，并在 microtask 中打开角色 Dialog。
2. 菜单卡的 `opacity` 在 180ms 内从 1 过渡到 0；`aria-hidden` 与 `pointer-events: none` 立即生效，但元素继续绘制。
3. macOS 本地扫描落在过渡结束后并通过。
4. Linux CI 在过渡期间扫描，axe 按实际合成颜色报告对比度失败。
5. 关闭态增加 `visibility: hidden`，测试等待新 Dialog 可见且旧菜单不可见。

## Root cause

实现把“不可访问”“不可交互”和“不可绘制”当成同一状态。`aria-hidden` 只影响无障碍树，`pointer-events: none` 只影响命中测试，`opacity` 过渡仍会改变屏幕上的最终颜色。测试只等待点击完成，没有等待旧浮层退出绘制，因此执行速度决定扫描结果。

## Guardrails

- 控制球菜单和动作在关闭状态使用 `visibility: hidden`，不会覆盖后续 Dialog 或正文。
- 角色弹层无障碍测试同时断言新 Dialog 可见与旧菜单不可见，再运行 axe。
- [测试规格](../testing.md)要求浮层切换分别验证访问树、命中测试与绘制状态。
