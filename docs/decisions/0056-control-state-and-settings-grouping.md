# 控件状态与设置空间分组

## Status

Superseded by [0062](0062-world-instance-participation-and-action-window.md)
Class: bug-fix

## Context and Problem Statement

[0054](0054-composer-focus-and-intrinsic-player-bubbles.md) 保留了普通非文本控件的主题蓝色底部焦点标记，世界演化详情页签又用独立伪元素绘制选中底线。一个页签获得焦点且被选中时会同时出现两条蓝线，其他点击后保持焦点的控件也会残留相同装饰。设置面板同时让 fieldset 和内部设置行各自承担分隔线与纵向 padding，开发者工具附近因此出现连续横线和不成比例的空白。

## Decision Drivers

- 选中状态不能依赖或附加底部蓝线，状态形状只能由控件自身背景、文字、图标或边界表达。
- 删除装饰线不能让键盘焦点消失；普通主题仍需要至少 2px 的可见焦点周界，forced-colors 继续使用系统 `Highlight`。
- composer 普通主题继续只使用插入光标，不新增焦点轮廓；玩家气泡继续使用 [0054](0054-composer-focus-and-intrinsic-player-bubbles.md) 的 max-content 单一尺寸路径。
- 设置分组优先使用空间和浅层表面，不用连续横线承担层级。
- 组间距至少是组内距的两倍，设置尾部控件继续共享同一对齐列并在窄屏自然堆叠。

## Considered Options

- 保留蓝色底线，只调整长度或颜色。
- 删除全部自绘焦点状态，只保留选中背景。
- 选中态只用控件背景与字重，键盘焦点改用中性周界；设置用空间和浅层表面分组——所选路线。

## Decision Outcome

本记录取代 [0054](0054-composer-focus-and-intrinsic-player-bubbles.md)。composer 聚焦静默与玩家气泡 max-content 契约保持不变；普通按钮、链接和表单控件的 `:focus-visible` 使用 `--cg-foreground` 绘制 2px outline，不能使用底部 box-shadow。文件导入代理把同一轮廓绘制在可见容器上，forced-colors 使用系统 `Highlight`。页签和分段控件的选中态只使用已有背景、前景与字重，不创建底部伪元素。

`SettingsPanel` 的顶层内容以网格间距分组。外观与文字大小保留原生 fieldset；减少动态效果与重置位置是无分隔线的设置行表面；开发者工具是带标题与说明的独立 section，内部控制行使用嵌套表面。所有设置行使用同一尾部控制列，48rem 以下收窄该列，30rem 以下改为正文与控件纵向排列。

### Consequences

- 鼠标选中控件不会在下方残留蓝线；键盘导航仍有与主题前景一致的完整可见轮廓。
- 世界演化详情页签只保留一个选中状态来源，不再叠加焦点和选中装饰。
- 设置面板没有 fieldset/row 连续分隔线，开发者工具的说明、控制和重置动作拥有明确组内与组间节奏。
- 视觉回归增加设置桌面与窄屏基线；功能回归直接验证无底部装饰、焦点周界和设置分隔线为零。

## Pros and Cons of the Options

### 保留底线并调整

- 好：改动最小，沿用既有焦点实现。
- 坏：焦点与选中仍可叠成两条线，鼠标操作后也会留下与语义无关的蓝色装饰。

### 删除全部自绘焦点

- 好：视觉最安静。
- 坏：部分浏览器和主题下键盘用户无法稳定辨认当前焦点，违反可达性底线。

### 中性焦点周界与空间分组

- 好：选中、焦点和内容分组各有单一视觉来源，横线噪声消失且键盘路径仍明确。
- 坏：键盘焦点会占用控件外侧 2px 空间，需要避免被 overflow 容器裁切。

## Links

- [0054](0054-composer-focus-and-intrinsic-player-bubbles.md) — 被本记录取代的 composer、气泡与普通控件焦点契约。
- [0055](0055-trusted-world-evolution-inspector.md) — 使用详情页签和开发者设置入口的受信任调试器。
- [事故复盘 0024](../postmortems/0024-state-lines-and-settings-divider-accumulation.md) — 两类局部装饰为何通过既有门禁。
- [表现层参考](../game-design/presentation.md) — 当前设置分组、选中态和焦点规格。
