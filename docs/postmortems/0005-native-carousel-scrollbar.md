# 出身卡 Carousel 泄漏系统滚动条

## Executive summary

出身选择 Carousel 在 macOS 浏览器中显示了系统横向滚动条，破坏了统一的 ReUI 表面。共享 CSS 虽声明了 WebKit scrollbar 颜色，但 overlay scrollbar 的最终绘制仍受浏览器与操作系统影响；自动视觉测试所在环境没有呈现同样的系统条，因此错误被基线放行。持久教训是：带有独立箭头、键盘和触控语义的 Carousel 不应把系统滚动条作为可见控件，测试必须直接验证其计算样式。

## Summary

玩家进入“选择出身”步骤后，卡组底部出现一条长灰色横向 thumb。它与剧本 token、卡片边界和操作按钮没有视觉关系，并在超宽屏下格外明显。卡组已有邻卡露出、前后箭头、方向键和触控板滚动，所以这条系统控件没有提供必要能力。

## Timeline

1. AppShell 重写为出身卡组增加 `overflow-x: auto` 与 CSS scroll snap。
2. Carousel 被并入共享 scrollbar 选择器，设置 track、thumb 和 hover token。
3. Playwright 视觉基线所在浏览器没有复现 macOS overlay scrollbar 的系统外观，截图验收通过。
4. 玩家在 macOS 的真实本地预览中看到原生横向滚动条并报告问题。
5. Carousel 从共享可见 scrollbar 契约中移除，系统滚动条被跨浏览器隐藏，箭头、键盘、触控板和 scroll snap 保持可用。

## Root cause

直接原因是把操作系统 scrollbar 当成 Carousel 的稳定视觉部件。`::-webkit-scrollbar` 能设置部分 WebKit 呈现，但不能保证 macOS overlay scrollbar 在所有浏览器状态下遵循同一轨道形态。

逃逸原因是结构测试只验证卡组存在和可滚动，视觉测试只比较执行环境中的像素；两者都没有断言 Carousel 的系统 scrollbar 必须不可见。人工验收也关注卡片位置与步骤切换，没有在 macOS 真实入口中专门检查滚动槽。

## Guardrails

- 出身 Carousel 使用 `scrollbar-width: none` 与 `::-webkit-scrollbar { display: none }`，可见导航只由邻卡、前后箭头和选中状态承担。
- [布局端到端测试](../../e2e/flows/layout.spec.ts) 断言 Carousel 的计算 `scrollbar-width` 为 `none`，同时继续验证 listbox 与确认操作可用。
- 本地验收在 macOS 实际入口中检查计算样式、前后箭头引起的 `scrollLeft` 变化以及选中项更新，不以非 macOS 视觉快照代替平台检查。
