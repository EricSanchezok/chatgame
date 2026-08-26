# 失败感知的世界演化诊断工作台

## Status

Accepted
Class: bug-fix

## Context and Problem Statement

[0055](0055-trusted-world-evolution-inspector.md) 建立了独立的受信任只读调试表面，但 attempt 详情把同一 `stepAttemptId` 的全部后续事件视为一次尝试，存档读取可以污染终止时间、事件数和最新状态。失败且没有 committed revision 时，工作台仍按常规图谱偏好打开，节点、主体和页签又缺少稳定的选择反馈；右侧把大型事件数组直接格式化为文本，调试者无法从失败原因进入阶段、模型调用、拟议行动和原始 payload。

## Decision Drivers

- attempt 必须以事务终止事件为边界，后续存档读取不能改变这次尝试的状态、耗时或事件数。
- 失败诊断的阶段、模型角色、修复、回滚与相关主体必须由服务端结构化事件归纳，客户端不能解析英文错误文本猜测。
- 没有提交的失败会话必须直接显示最新失败，同时保留用户对成功历史的图谱或时间线偏好。
- 图谱节点、时间线记录、世界和 Agent 必须共享一条选择路径，并支持鼠标、Enter、Space 与方向键。
- 大型 full payload 不能进入窗口或 attempt/step 摘要，也不能在折叠状态创建大量 DOM。
- 工作台两侧栏都需要可调宽度和连续窄屏阅读；内部长列表保留滚动能力但不让常驻滚动条争夺视觉层级，同时保持只读、认知隔离与现有 Truth Engine 语义。

## Considered Options

- 保留 Inspector v1，只修正几个点击处理器和 CSS。
- 客户端下载全部 RuntimeEvent，再自行归纳失败阶段并使用第三方 JSON viewer。
- 将失败投影、事件摘要和按需 payload 统一升级为 Inspector v2，并用原生 disclosure 构建诊断工作台——所选路线。

## Decision Outcome

`src/shared/world-inspector-api.ts` 只保留 Inspector v2。服务端按 `stepAttemptId` 聚合后，以 `step.committed`、`step.rolled_back`、`step.persistence_rolled_back` 或取消边界裁剪 attempt；persistence rollback 优先于候选 commit。摘要包含真实终止时间与耗时、参与和直接关联主体、失败阶段、模型调用、输出拒绝、修复调用及回滚 hash 结论。拟议行动来自 `step.joint_actions.generated`，阶段诊断与主体关联由 `src/server/world-inspector.ts` 单一投影。

step、attempt 与调试 SSE 只返回 `WorldInspectorRuntimeEventSummary`。摘要保留信封、错误、指标、稳定不透明 ID 与 `hasPayload`，不内联 payload；`GET /api/sessions/:id/inspector/runtime-events/:eventId` 按需从 Execution Ledger artifact 返回已脱敏的完整事件。事件 ID 由 timestamp、sequence 和事件名生成，用于同一持久 trace 中的精确读取。

失败且没有 committed revision 时，工作台初次打开强制进入时间线并选中最新失败；其他情况按活动 attempt、最新失败、最新提交排序选择。手动查看旧记录会关闭追随，只有“追随最新”开启时 SSE 才改变选择，“回到最新”立即选择当前最新记录。图谱统一由 React Flow `onNodeClick` 接收节点选择，节点内部原生 button 保留键盘语义与方向键漫游。

桌面主体栏和详情栏都使用原生 Pointer Events 调宽，范围分别为 11–22.5rem 和 22–42rem；两个 separator 都支持 Pointer Capture、方向键、Shift 加速与 Home/End。separator 所在网格轨道为零宽，可见 1px 线精确覆盖相邻面板的共同边界，透明命中面则以边界为中心向两侧扩展，左右使用同一定位模型。`livingworld:inspector-layout:v2` 只保存经校验的 `{ view, actorWidth, detailWidth }`。窄屏忽略桌面宽度并继续使用时间线、主体抽屉和下方详情。主体列表、时间线、详情正文和 JSON 树保持 `overflow: auto`、触控板、滚轮与键盘滚动，但隐藏常驻原生滚动条；分隔区保留悬停、激活、键盘焦点反馈，不再以粗色带占据内容边界。

右侧五个页签都先展示服务端归纳内容。模型页按 invocation 分组；原始事件按信封与 payload 分层。递归 JSON Inspector 使用原生 disclosure，错误路径默认展开，其他大型节点折叠；子树只在展开后挂载，数组每批 100 项。工具栏提供当前对象复制，每个非根字段只显示一个上下文复制入口，再明确选择“复制路径”或“复制值”；入口与字段保持同一行，不创建独立工具行。每层子树使用固定缩进、对齐的 disclosure 占位和增强导引线表达层级，复制结果由 live region 反馈。实现不引入第三方 viewer 或分栏依赖，也不改变 Truth Engine 的失败、重试或事务语义。

### Consequences

- 失败会话在零 revision 时也能直接回答失败阶段、调用、参与主体、拟议行动和回滚结果。
- 窗口与详情响应不再复制大型 payload；展开原始数据会增加一次 Ledger 只读请求。
- Inspector 内部契约发生破坏性升级；快速迭代期不保留 v1 或内联 payload 双轨。
- 组件与 E2E 回归需要覆盖终止裁剪、延迟读取、JSON 单入口复制与层级缩进、两侧分栏的指针与键盘操作、隐藏滚动条后的连续滚动、失败选择、Agent 视角及明暗/窄屏视觉。

## Pros and Cons of the Options

### 局部修补 Inspector v1

- 好：改动范围小，既有 DTO 与渲染结构保持不变。
- 坏：错误的 attempt 边界、大型 payload 和客户端无诊断语义仍然存在，新的点击修补会继续形成重复选择路径。

### 客户端归纳与第三方 viewer

- 好：服务端类型改动少，JSON 交互可以快速获得现成功能。
- 坏：浏览器必须下载全部敏感大对象并从错误文本猜测业务阶段；依赖增加且服务端、客户端会形成两套诊断语义。

### Inspector v2 服务端投影与原生工作台

- 好：终止、阶段、主体和回滚只有一个权威投影，大 payload 按需读取，交互与无障碍契约可以针对产品任务验证。
- 坏：内部 API、组件和视觉基线需要同步破坏性升级，原生 JSON 树需要维护 disclosure 与批量挂载逻辑。

## Links

- [0055](0055-trusted-world-evolution-inspector.md) — 保持不变的受信任只读边界与 canonical replay 来源。
- [0049](0049-world-run-failure-and-stream-boundaries.md) — WorldRun 失败和步骤回滚语义。
- [0059](0059-unified-execution-kernel-and-ledger.md) — Execution Ledger 与 full artifact 所有权。
- [事故复盘 0025](../postmortems/0025-world-inspector-failure-blindness.md) — 失败诊断为何在真实使用中不可操作。
- [表现层参考](../game-design/presentation.md) — 当前工作台交互与响应式规格。
- [运行时可观测性](../game-design/runtime-observability.md) — attempt 裁剪、事件摘要与按需 payload 契约。
