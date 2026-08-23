# 系统架构

chatgame 的运行时是“单一客观世界 + 多个有限认知主体 + 唯一联合裁判”。动作表达是开放的，状态提交是严格的。

## 模块边界

| 层 | 目录 | 唯一职责 |
|---|---|---|
| 世界契约 | `src/script/` | 严格读取 schema v2 YAML，构造初始 `WorldDefinition` 与 `SimulationState` |
| 仿真内核 | `src/engine/` | AgentMind、Truth Engine、d20、观察隔离、信念更新、状态事务 |
| 会话宿主 | `src/server/` | 世界仓库、WorldRun 生命周期、逐步原子持久化、恢复、导入 |
| HTTP 表面 | `src/app/api/` | 会话与 run 资源、SSE、世界列表与导入 |
| 浏览器 | `src/app/` | 只展示公开快照/事件并提交任意自然语言目标 |
| 公共契约 | `src/shared/world-api.ts` | 浏览器安全 DTO；不含 canonical identity 或完整 truth |

依赖方向固定为：浏览器 → Route Handler → WorldHost → SimulationEngine → AgentMind/TruthEngine。`src/engine/` 与世界 YAML 不进入浏览器 bundle。

## 三种现实

`CanonicalWorldState` 是唯一客观现实，包含实体、位置、事实、数值、时间、生命周期、客观事件与 RNG 状态。每个 `AgentState` 拥有独立的稀疏 `AgentBeliefState`，用局部实体 ID 表达其相信、怀疑或否认的内容；它可以与真相冲突。`PlayerKnowledgeState` 只保存玩家已知信息，不记录或推断真人心理。

`EpistemicBinding` 只在服务端把局部身份映射到 canonical entity。AgentMind prompt 与公共 API 都移除该映射，所以模型和浏览器不能靠 ID 绕过认知边界。

## 一个世界步骤

1. 当前玩家目标和每个存活 Agent 已准备的自由行动都绑定同一 `baseRevision`，并按 actor/proposal identity 规范排序后形成联合输入。
2. Truth Engine 一次看到完整 canonical truth、世界法典、认知映射与联合行动，先决定是否需要检定。
3. 需要随机性时，它先提交 DC、修正来源、优势/劣势、风险和可见性；内核随后掷骰。
4. Truth Engine 提出覆盖每个行动的 outcome、世界 delta、事件、逐观察者 observation 与玩家目标状态。
5. 事务层在克隆前态上校验引用、因果、守恒、范围、包含关系、观察覆盖和正数时间推进；公开信息守卫同时拒绝 canonical identity、私密事实和其他主体私密信念进入玩家结果。
6. 每个 AgentMind 只看自己的 belief 与 observation，更新 belief 并准备下一步骤行动；新创建 Agent 也必须在本步初始化。
7. 全部结果有效后，revision、step、RNG、truth、belief、玩家知识和审计历史一次提交。审计保存完整检定请求/结果、模型配置与尝试次数、内容 hash，不保存 prompt、原始响应或思维链。任一失败则整个步骤回滚。

## 规则扩展

世界通过 `rule_packages` 引用服务端受信任注册表中的规则包 ID、精确版本和严格配置。ZIP 不能携带可执行规则代码；未知包、版本不符或多余配置在加载时拒绝。核心只预装 `core-d20`，题材规则继续由世界法典、开放事实和通用数值表达，未来规则包通过同一注册接口加入而不产生动作白名单。

## 长程 WorldRun

`WorldHost` 把一次玩家目标作为后台 `WorldRun` 执行。每个已完成步骤立即以 checksum envelope 原子写盘，并通过 SSE 发布公开检定、玩家观察和提交进度。运行在目标完成、目标失败、需要玩家决定、取消、安全步骤上限或模型失败时停止。

取消只在世界步骤边界生效。进程重启时，磁盘中的 queued/running run 被标为可重试失败；已提交步骤不回滚。一个会话同时只允许一个活动 run。

## 硬不变量

- 玩家文本和 Agent action 都是企图，不是状态命令。
- 每个步骤恰好包含一次正数时间推进。
- 每个联合行动恰好有一个 outcome。
- 所有 delta 与事件都有可解析 causal provenance。
- Quantity 转移守恒；生产/消耗必须由目录允许并引用世界法则。
- Meter/Rating 必须在剧本定义范围内；threshold 只触发一次。
- placement 不得形成循环；Agent 必须绑定活动实体。
- Truth 输出、Observation、BeliefPatch 与下一行动全部通过 schema 与语义校验。
- 客户端永远不接收 canonical bindings、其他 Agent 信念、内部模型 ID、内部错误或隐藏检定。

## 扩展到超大世界

当前状态模型没有地图格数量或动作种类上限；地点只是实体，移动只是带因果的 placement 变化。真正的大世界瓶颈是内容量、上下文选择、Agent 数量、存储和模型成本，而不是动作表达。首版故意让全部 Agent 每步行动以验证语义；未来可以加入区域分片、分层时间和 Agent 调度，但它们必须保留同 revision 联合语义和唯一 truth 提交点。

架构理由见 [0031](decisions/0031-epistemic-multi-agent-truth-engine.md)、[0032](decisions/0032-open-world-facts-and-d20-kernel.md) 与 [0033](decisions/0033-persistent-streaming-world-runs.md)。
