# 世界演化调试器的失败盲区

## Executive summary

一次真实世界推演失败后，调试器虽然画出了未提交 attempt，却没有自动选中它，五个详情页签看起来为空，主体点击也没有把失败上下文切到该 Agent；原始模型和事件数据只能以大段 JSON 文本滚动阅读。更隐蔽的是，同一 `stepAttemptId` 上发生在事务终点之后的存档读取仍被计入 attempt，导致“最新事件”、耗时和数量不可信。系统把“数据存在”误当成“诊断可用”，测试也只验证路由、节点和 JSON 出现，没有验证用户从失败提示走到原因、阶段、主体和 payload 的完整任务。持久修复把终止边界与诊断归纳收回服务端，失败自动进入时间线，所有选择共享单一路径，原始 payload 改为延迟加载的可折叠 JSON 树。

## Summary

失败步骤正确回滚且 revision 保持为 0，运行日志也保留了模型和事务事件，因此引擎安全性没有受损。但工作台沿用面向 committed history 的默认图谱与空详情状态，attempt 卡片和 Agent 列表之间没有可操作的关联。点击图谱节点还同时存在 React Flow 与内部按钮两条路径，实际事件命中不稳定；详情页签只接收一个完整事件数组，再用 `JSON.stringify` 放进 `<pre>`，使错误、模型 invocation、拟议行动和回滚证据没有层级。

attempt 投影只按 correlation 分组，没有在事务终止事件处裁剪。SQLite 或文件读取为方便诊断继续携带原 step correlation 时，后续事件会把失败卡片的终止时间和最新状态推迟；界面即使展示更多数据，也不能可靠回答失败发生在哪里。

## Timeline

1. 调试器以 canonical committed history 为主干，引入 RuntimeEvent attempt 作为附加分支。
2. 初版 attempt 投影按 `stepAttemptId` 聚合全部事件，详情通过统一 JSON 文本容器暴露技术对象。
3. 功能与视觉回归覆盖成功提交、世界/Agent 图谱和五个页签存在，但没有使用真实快速失败入口检查零 revision 会话。
4. 用户触发世界推演失败后发现工作台没有自动定位失败，页签与主体选择也不能解释错误。
5. 审计进一步确认 persistence 事件污染终点、图谱存在重复选择路径、大型 payload 在摘要中复制并一次挂载。

## Root cause

信息架构以 committed step 为中心，失败 attempt 被当成“另一种节点”，没有被建模成需要独立默认选择、阶段归纳和主体视角的首要诊断对象。服务端 DTO 只传原始事件，客户端被迫把展示层当成诊断层；当没有 committed detail 时，多数现有组件自然退化为空状态。

RuntimeEvent correlation 表达归属，不表达生命周期终点。投影错误地把“相同 correlation”当成“仍属于 attempt 的有效时间窗”，没有把 transaction terminal event 作为二次边界。后续存档读取本身正确，但组合后改变了 attempt 的统计语义。

测试检查了资料可达性而非调试任务可完成性。API 测试确认 attempt 存在，E2E 确认成功图谱可点，视觉测试确认成功工作台稳定；没有断言失败自动选择、五页签有效内容、Agent 拟议行动、终止时间不受后续事件影响或 payload 折叠前零请求。Axe 也无法判断一块合法的 `<pre>` 是否可用于定位问题。

## Guardrails

- [决策 0057](../decisions/0057-failure-aware-world-inspector.md) 固定 Inspector v2、事务终止裁剪、服务端阶段/主体投影、延迟 payload 与单一选择路径。
- 服务端单测在 rollback 后追加同 correlation 的 persistence 事件，要求 attempt 的终止时间、耗时、事件数和最新事件保持在 rollback，并核对失败阶段、直接相关 Agent 与回滚 hash。
- API 测试要求 step、attempt 与调试 SSE 只返回无 payload 的事件摘要，稳定事件 ID 可读取脱敏 payload，过期 ID 返回 404。
- 组件测试覆盖错误路径默认展开、折叠子树懒挂载、数组每批 100 项、根节点无重复复制、字段单入口的路径/值复制、复制 live region、payload 首次展开才请求、失败原位重试与两侧分栏键盘宽度计算。
- Playwright 通过“触发 E2E 快速失败”验证零 revision 自动时间线、最新失败选择、五个页签、Agent 尝试视角、按需 payload、两侧分栏的真实指针拖拽与持久化、两个 separator 中线与相邻面板共同边界重合、隐藏滚动条后的 overflow 语义和图谱 Enter；明暗桌面/移动视觉基线覆盖成功与失败两套工作台。
- forced-colors 流程从失败卡片以 Tab 到达 separator，检查可见系统焦点并在展开原始事件后运行 axe。
