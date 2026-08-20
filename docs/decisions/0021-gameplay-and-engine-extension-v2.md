# 玩法与引擎扩展契约 v2

## Status
Accepted
Class: architecture

## Context and Problem Statement

现有世界步进已接通多数声明式系统，但任务目标、重复任务、跨午夜日程、声望阈值、逐边旅行、知识过滤和剧本生命周期仍存在契约与运行时不一致。剧本只能注册孤立动作、条件和效果，无法以确定性生命周期实现班次、周期结算和持续系统。

## Decision Drivers

- 引擎继续持有时间、资源、任务、知识和规则的唯一权威。
- validator、运行时、HTTP 和 UI 对同一动作与任务目标使用同一类型。
- 通用生命周期允许复杂剧本出现，但框架不理解剧本专属状态。
- 未注册或不可执行的声明必须响亮失败。

## Considered Options

- 继续扩充现有松散对象并由各剧本自行解释。
- 把班次、证据、空间站系统等玩法写进框架。
- 建立强类型动作、目标与生命周期扩展 v2。

## Decision Outcome

采用以下互相约束的玩法与 Engine Extension v2 契约：

1. **权威动作入口**：客户端与服务端共享 `TurnInput`、`IntentHint` 和 `ActionPreview` DTO。`intentHint` 只提供动作、目标和参数提示，引擎仍重新执行动作存在性、条件、冷却、成本、世界规则和处理器校验。动作 handler 返回纯 `ActionHandlerPlan`：计划包含拒绝、动态货币/物品/资源成本和权威耗时，`execute(state, grade)` 只在真实结算中调用一次；规划收到与权威 `WorldState`、`WorldDefinition`、参数完全隔离的深度只读快照，任何写入都响亮失败，预检禁止通过 dry-run effects 或 execute 推测结果。引擎合并声明成本与动态成本，在骰点和效果前统一校验并仅扣除一次；预检用同一计划与可支付性检查，计划耗时在预检与执行都钳制为至少一小时。
2. **静态声明与精确注册**：带 `engine/index.ts` 的剧本必须在 `script.yaml.engine_extension` 声明 `api_version: 2` 及 effects、conditions、action handlers、rule mechanisms、lifecycle。validator 检查引用是否已声明，加载器检查声明集合与实际注册集合完全相等；代码与声明必须同时存在，声明和注册都不允许重复。未知 effect/condition/rule 在运行时同样响亮失败，不能静默跳过。编译产物按剧本 ID、API 版本和完整 `engine/` 源码树 hash 内容寻址，同 ID 的预览与已安装版本不共享可变 bundle 文件。
3. **纯生命周期**：扩展可按注册顺序执行 `onSessionStart`、`onTurnResolved`、`onHour`、`onDayBoundary`。handler 只接收不可变快照与上下文，只返回新状态和摘要，不能切换 `scriptId`。session hook 仅在 fresh session 的开场前执行，load v5 不重放；turn hook 在动作与世界步进后执行；hour hook 在每小时衰减和日程更新后执行；day-boundary hook 在通用日界系统后执行。摘要进入可审计事件日志。
4. **规则机制闭集**：通用规则只接受 schema 导出的内置机制，剧本规则必须通过 v2 注册；诸如 `inventory`、`combat`、`travel` 的含糊空实现不是合法机制。规则检查收到动作、任意实体目标及结构化参数，预检与执行保持一致。
5. **通用玩法语义**：任务目标是按类型区分的联合类型；investigate 明确声明 flag/fact marker 或 `any`，`any` 从激活日志后的事件游标开始计数，激活/完成/失败写入 `WorldState.eventLog`。`time_limit.days` 包含精确截止日，重复任务尊重完成/失败后的 cooldown。跨午夜日程按环形时间窗口判断。旅行按总分钟最短路径选择，并以逐段抵达时钟校验实际遍历边的出口、连接和入口条件；同一目的地的平行边不以第一条边代替。fresh session 保留世界生成器选出的确定性 starting event，通过唯一 `playEvent` 入口播放一次并写入开场 MediaCue；load 不重放。声望效果在上升穿越阈值时立即、仅一次地触发阈值效果。秘密正文按运行时 `secretHolders` 注入与防泄露，定义 owner 不构成第二知识边界。
6. **持续系统与存档语义**：need 阈值采用持久化的边沿触发集合，持续低值不重复施加永久效果；所有 status 效果通过单一 `addStatus` 语义，重施加刷新时长，堆叠状态同时增加层数；成长只作用于触发行为对应的实体与 stat/skill。状态中新增长期事实要求存档 schema v5；序列化与反序列化共用完整、严格的 `SaveFile`/`WorldState` schema，伪造版本号但缺少必需字段或嵌套字段类型错误的 v5 必须拒绝，旧存档不提供兼容迁移。

剧本专属算法和持久状态只存在于剧本扩展与 `runtimeState`；框架不出现内置剧本的世界名称或专属分支。

## Pros and Cons of the Options

### 松散对象由剧本解释

- 好：短期改动少。
- 坏：validator、UI 和运行时继续漂移，两个剧本会产生互不兼容的私有协议。

### 专属玩法写进框架

- 好：内置剧本实现直接。
- 坏：破坏剧本驱动原则，框架会积累世界名称与专属分支。

### 强类型契约与生命周期 v2

- 好：规则可验证、可预览、可测试，复杂剧本共享时序能力而不共享专属含义。
- 坏：扩展声明与注册必须同步维护；存档 v5 断代，要求所有内置剧本同步迁移。

## Links

- [0004](0004-game-first-principles.md) — 游戏第一性原理。
- [0008](0008-engine-completeness.md) — 早期运行时完备化范围。
- [0022](0022-ui-host-and-script-extension-v3.md) — 消费动作预检与扩展状态的 UI 契约。
