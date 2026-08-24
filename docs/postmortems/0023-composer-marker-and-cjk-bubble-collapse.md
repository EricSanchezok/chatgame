# Composer 装饰线与中文玩家气泡收缩

## Executive summary

会话页在去除大面积聚焦框后仍给 composer 绘制一条短蓝线，自动聚焦使它长期停留在首屏；玩家消息又通过 `auto` 网格列包裹受百分比上限约束的气泡，中文的 min-content 宽度可缩成单个汉字，导致“你好”逐字换行。既有测试把蓝线本身写成预期，只验证短气泡右对齐而没有验证单行文字几何，因此同时固化了不必要的焦点装饰并漏掉内在尺寸退化。

## Summary

composer 的蓝线来自 `.aui-composer-shell::after`，并非 assistant-ui 或浏览器默认样式。它只在 textarea `:focus-visible` 时显示，但桌面空态会自动聚焦，所以用户会把它理解成输入框残留的选中线。

玩家消息使用 `grid-template-columns: minmax(72px, 1fr) auto`。气泡的百分比 `max-width` 依赖 auto 列，而 auto 列的收缩尺寸又依赖气泡；中文允许字间换行后，浏览器选择单字 min-content 宽度。外层 padding 仍让气泡看似完整，文本却垂直堆叠。

## Timeline

1. 为避免完整聚焦外框，composer 增加固定宽度的底部 `::after` 标记。
2. 玩家气泡从固定宽度收敛为自适应宽度，但继续放在 auto 网格列中。
3. E2E 明确断言蓝线为 2px 高，并只验证 composer 锚点与会话轴宽度。
4. 视觉快照使用较大的整页容差，既把蓝线接受为基线，也没有用两个中文字符触发最窄内容尺寸。
5. 用户在真实深色会话中指出蓝线没有语义，并发送“你好”观察到逐字换行。

## Root cause

焦点设计仍把“必须自绘一个状态”当作前提，没有区分文本编辑器已有插入光标与普通按钮需要焦点指示的不同语义。气泡布局则把“自适应”实现为 shrink-to-fit 网格列，却没有显式定义计算顺序：短句应先取 max-content，之后才接受会话宽度上限。

测试重复了实现细节而不是用户结果。它精确测量旧蓝线，反而阻止删除；消息测试只确认文本出现，没有测量一个短中文句子的行高、宽度或行数。

## Guardrails

- [决策 0054](../decisions/0054-composer-focus-and-intrinsic-player-bubbles.md) 固定普通主题 composer 无附加焦点装饰、forced-colors 系统轮廓和 max-content 玩家气泡。
- `.aui-composer-shell` 不拥有焦点伪元素；Playwright 验证 textarea 聚焦前后 composer 边框与阴影完全不变。
- `.aui-user-message-bubble` 是唯一气泡尺寸实现，使用 max-content 后再应用 85%/34rem 上限，旧 auto 网格删除。
- Playwright 对真实中文短消息读取文字行高和实际高度，要求在空间充足时保持单行，并继续覆盖 320px、200% 字号无横向溢出。
- 组件级 composer 快照保留，但不再把装饰性焦点标记当作无障碍替代；forced-colors 审计继续验证系统焦点轮廓。
