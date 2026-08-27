# Inspector 诊断文本横向溢出

## Executive summary

真实 DeepSeek 推演产生了包含多个运行时 ID 的无空格错误串。Inspector 详情标题没有为该类诊断文本设置断行边界，外层滚动容器又同时允许横向滚动，导致错误信息撑宽右侧详情区并产生左右滑动。短错误 fixture 未覆盖这一输入形态。持久护栏是让详情区只承担纵向滚动、所有诊断文本可在任意安全位置换行，并用接近真实长度的错误串验证不存在横向溢出。

## Summary

推演正确回滚后，Inspector 在“失败原因”中直接展示完整的 causal assertion 错误。错误由多个 `rt:` ID 和冒号连接而成，浏览器没有自然断行机会。详情正文使用 `overflow: auto`，因此没有把字符串约束在右侧栏宽度内，而是生成横向滚动范围。详情栏配置宽度本身没有越过上限，视觉上的“超宽”来自内容溢出。

## Timeline

1. Inspector 详情区支持纵向浏览长 trace，并以 `overflow: auto` 隐藏原生滚动条。
2. 既有失败场景只产生较短的 transport 错误，没有覆盖无空格的长诊断串。
3. Blackmarsh 的 Truth transition 在最终 repair 后返回五个 causal assertion ID。
4. 错误串撑开详情正文，用户需要横向滑动才能阅读完整内容。
5. 详情正文改为仅纵向滚动，标题、阶段和错误文本显式允许 `overflow-wrap: anywhere`。

## Root cause

布局契约只约束了详情面板和若干 Grid 子项的 `min-width`，没有继续约束标题中的实际错误文本。Grid 子项默认的最小内容宽度等于不可断字符串宽度；配合正文的横向 `auto` overflow，浏览器选择扩展 scroll area，而不是在栏内断行。测试检查了滚动容器存在，却没有断言详情正文的 `scrollWidth` 不超过 `clientWidth`。

## Guardrails

- [`globals.css`](../../src/app/globals.css)将详情正文限定为纵向滚动，并为诊断文本补齐收缩与任意位置换行规则。
- [`immersive-game.spec.ts`](../../e2e/flows/immersive-game.spec.ts)注入接近真实 causal assertion 形态的长字符串，断言详情正文不产生横向 overflow。
- Inspector 的 JSON 树继续在自己的局部容器内管理结构化内容，不借用整个详情栏进行横向滚动。
