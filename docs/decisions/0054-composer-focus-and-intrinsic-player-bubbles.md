# Composer 聚焦静默与玩家气泡内在尺寸

## Status

Accepted
Class: bug-fix

## Context and Problem Statement

[0053](0053-context-local-settings-overlays.md) 已把大面积包围式焦点框收敛为短底部标记，但该蓝色标记在 composer 自动聚焦后仍成为首屏的无关视觉状态。与此同时，玩家消息根节点使用 `auto` 网格列承载受百分比上限约束的气泡；中文可在任意字间断行，浏览器因此按单个汉字的 min-content 宽度收缩该列，使“你好”显示为两行。

文本输入已有插入光标表达当前编辑位置。普通主题继续额外绘制装饰线不会提供新的操作含义；玩家气泡则必须先按完整短句的内在宽度布局，只有超过会话轴上限时才换行。

## Decision Drivers

- composer 普通主题聚焦前后不能出现边框、阴影或附加线条的视觉跳变。
- forced-colors 下键盘焦点仍由系统高对比 outline 明确表达。
- 两个及其他短中文字符在可用空间充足时保持同一行。
- 玩家气泡继续按内容收缩、右对齐，并在长消息达到 85% 会话宽度或 34rem 后自然换行。
- 不为中英文分别维护尺寸逻辑，不保留旧网格或焦点伪元素作为回退。
- 浏览器回归直接验证短消息行数、气泡内在宽度和 composer 聚焦前后几何不变。

## Considered Options

- 保留 composer 的短底部焦点标记，只修复气泡。
- 给中文消息设置最小字符宽度，继续使用 `auto` 网格列。
- composer 普通主题只使用文本插入光标，forced-colors 保留系统 outline；玩家消息改为全宽右对齐 flex 容器和受上限约束的 max-content 气泡——所选路线。

## Decision Outcome

本记录取代 [0053](0053-context-local-settings-overlays.md)。其中世界包工作台、上下文内设置弹层、持久游戏布局、WorldRun External Store、三动作控制球、模态基础设施及普通非文本控件的非包围式焦点契约保持不变；本记录重新定义 composer 焦点与玩家消息尺寸。

composer 没有 `::after` 焦点伪元素。普通主题中 textarea 聚焦不改变 composer 的静态边框或阴影，也不增加独立标记，编辑位置由文本插入光标表达；`forced-colors: active` 使用系统 `Highlight` outline，不能被普通主题规则屏蔽。

玩家消息根节点是占满会话轴、内容向行尾对齐的 flex 容器。气泡使用 `inline-size: max-content` 取得短消息内在宽度，再以 `max-inline-size: min(85%, 34rem)` 限制长消息；超长连续内容以 `overflow-wrap: anywhere` 安全断行。该结构不包含参与气泡收缩计算的 `auto` 网格列。

### Consequences

- 鼠标点击、桌面自动聚焦和键盘进入 composer 时，普通主题不会新增装饰性蓝线。
- 高对比模式仍有明确系统焦点轮廓；其他按钮、链接和开关继续使用共享的非包围式焦点标记。
- 短玩家消息保持自然行宽，长消息不会越出 44rem 会话轴。
- 气泡尺寸只有一个 CSS 实现，不按语言、字符数或消息状态分支。

## Pros and Cons of the Options

### 保留短底部标记

- 好：所有可聚焦元素都拥有同形状的自绘指示。
- 坏：文本插入点之外再出现一条与内容无关的蓝线，自动聚焦时尤其像残留状态。

### 为中文设置最小宽度

- 好：可以直接遮住“两个字两行”的具体症状。
- 坏：字符数、字号和语言都会改变所需宽度，硬编码最小值不能处理英文、标点、换行和 200% 字号。

### 静默 composer 与 max-content 气泡

- 好：分别使用文本输入和 CSS 内在尺寸的原生语义，短句紧凑、长句受限且没有语言分支。
- 坏：普通主题的 composer 不再拥有独立于插入光标的自绘焦点指示，需要依赖 forced-colors 系统轮廓覆盖高对比需求。

## Links

- [0053](0053-context-local-settings-overlays.md) — 被本记录继承并取代的上下文设置与会话表现契约。
- [表现层参考](../game-design/presentation.md) — 当前会话轴、气泡和焦点表现规格。
- [事故复盘 0023](../postmortems/0023-composer-marker-and-cjk-bubble-collapse.md) — 装饰线与中文气泡收缩为何逃过既有门禁。
