# 聚焦边框过重与控制球状态卡碰撞

## Executive summary

assistant-ui 会话表面重建后，输入框和共享控件的聚焦指示复用了中性深灰 `--cg-ring`，composer 还在 `focus-within` 时把自身边框直接替换成该颜色，导致浅色主题点击输入后出现一整圈近黑边框。控制球展开算法只为状态卡与部分径向按钮坐标预留静态距离，没有按当前方位计算全部按钮的外包络，卡片边缘与按钮及阴影在右下展开时视觉相撞。首轮 axe、几何测试和整页视觉快照分别只验证“焦点存在”“元素没有越界”和占整页比例较大的变化，均没有约束焦点的视觉语义或卡片与按钮之间的相交关系。持久修复是统一非中性的主题焦点 token、禁止 composer 用焦点改写边框，并直接测试状态卡与每个按钮的 bounding box 零相交。

## Summary

全局焦点规则使用 `--cg-ring`，但该 token 的明暗值都来自中性灰阶。普通小控件的 2px outline 已显得偏重，composer 又同时执行 `border-color: var(--cg-ring)` 和外层 box-shadow，聚焦后整个大圆角轮廓明显变黑。由于文本输入在指针点击后也可能匹配 `:focus-visible`，问题并不限于键盘操作。

状态卡使用固定的横向位移，按钮使用按边缘和垂直区域变化的多组径向坐标。固定值只与单个预期位置比较，右侧底部展开仍只剩约 14px 几何间距，按钮阴影进入卡片边界，左侧和中间区域也没有由同一算法证明安全。

## Timeline

1. 会话重建建立全局 `:focus-visible` 规则和中性 `--cg-ring`，composer 另加 `focus-within` 边框变化。
2. 控制球测试覆盖按钮不越出视口，但没有读取状态卡 bounding box。
3. 整页视觉快照允许 1% 像素差，聚焦边缘只占页面很小比例，焦点色变化无法可靠触发失败。
4. 用户在 5120px 浅色会话中直接观察到黑色聚焦框，并在展开控制球的局部放大图中确认状态卡与按钮视觉重叠。
5. 焦点系统改为主题蓝色 `--cg-ring`；composer 保留静态边框，只显示柔和光晕；状态卡位移改为由全部径向按钮外包络加 32px 间距计算。

## Root cause

焦点 token 只被当作“有一个可见颜色”，没有同时承担视觉语义。中性深灰与正文色过近，在大面积圆角控件上会被理解成选中或高压描边，而不是轻量键盘定位。composer 的局部 `focus-within` 又绕过共享规则，产生了第二种更重的焦点表现。

控制球的位置计算把按钮方位和状态卡位移分成两个事实来源。按钮包络会随 edge 与 vertical zone 改变，卡片却只读取 edge，因此无法从结构上保证间距。测试重复了同样的分离：只检查按钮相对视口，不检查按钮相对卡片。

## Guardrails

- [决策 0051](../decisions/0051-assistant-ui-upstream-session-surface.md) 固定焦点 token、composer 边框语义和状态卡包络间距。
- [全局样式](../../src/app/globals.css)统一普通控件的 `:focus-visible`，文件选择器用 `:has(input:focus-visible)`，composer 只用同一 token 的低对比外层光晕；forced-colors 使用系统 `Highlight`。
- `radialCardOffset` 从当前 edge/zone 的全部按钮坐标、按钮尺寸与 inset 计算卡片位移，单元测试覆盖左右边缘和 top/middle/bottom 六种组合的 32px 间距。
- Playwright 对状态卡与四个按钮逐一计算矩形相交，并验证 composer 聚焦前后边框渲染色一致、焦点 token 不等于正文色。
- composer 焦点增加组件级 light/dark 视觉快照，避免整页像素容差吞掉小面积焦点退化。
