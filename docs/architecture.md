# 系统架构

chatgame 的运行时是“单一客观世界 + 多个有限认知主体 + 唯一联合裁判”。动作表达是开放的，状态提交是严格的。

## 模块边界

| 层 | 目录 | 唯一职责 |
|---|---|---|
| 世界契约 | `src/script/` | 严格读取 schema v3 YAML，构造初始 `WorldDefinition` 与 `SimulationState` v2 |
| 仿真内核 | `src/engine/` | AgentMind、角色演化、自身状态投影、Truth Engine、有限反应、d20、观察隔离与状态事务 |
| 会话宿主 | `src/server/` | 世界仓库、WorldRun 生命周期、逐步原子持久化、恢复、导入 |
| HTTP 表面 | `src/app/api/` | 会话与 run 资源、SSE、世界列表与导入 |
| 浏览器 | `src/app/` | 只展示公开快照/事件并提交任意自然语言目标 |
| 公共契约 | `src/shared/world-api.ts` | 浏览器安全 DTO；不含 canonical identity 或完整 truth |

依赖方向固定为：浏览器 → Route Handler → WorldHost → SimulationEngine → AgentMind/TruthEngine。`src/engine/` 与世界 YAML 不进入浏览器 bundle。

## 三种现实

`CanonicalWorldState` 是唯一客观现实，包含实体、位置、事实、数值、时间、生命周期、客观事件与 RNG 状态。每个 `AgentState` 拥有独立的稀疏 `AgentBeliefState` 和分层 `AgentCharacterState`：前者用局部实体 ID 表达可与真相冲突的主观认知，后者保存人格、特质、价值、情绪、态度、目标和承诺。`PlayerKnowledgeState` 只保存玩家已知信息，不记录或推断真人心理。

`EpistemicBinding` 只在服务端把局部身份映射到 canonical entity。服务端以该映射派生去 canonical ID 的 `AgentSelfStateView`；AgentMind 能精确看到自身生命周期、时间、地点表象、数值与授权 Fact，却看不到底层 entity、placement、meter 或 rating identity。AgentMind prompt 与公共 API 都移除 binding，所以模型和浏览器不能靠 ID 绕过认知边界。

## 一个世界步骤

1. 当前玩家目标和每个存活 Agent 已准备的自由行动绑定同一 `baseRevision`，按 actor/proposal identity 规范排序形成初始联合输入。
2. Truth Engine 可以先预承诺 perception checks，再至多一次请求有结构化感知依据的 Agent 对本步骤玩家行动 keep/replace；未被请求者保留预备行动。
3. 最终行动集锁定后，Truth Engine 可以预承诺 resolution checks；resolution 开始后 reaction window 永久关闭。
4. Truth Engine 基于最终行动集提出 outcome、世界 delta、带影响级别的事件、逐观察者 outcome observation 与玩家目标状态。
5. 事务层在克隆前态上校验引用、阶段、因果、守恒、范围、包含关系、观察覆盖和正数时间推进；公开信息守卫拒绝 canonical identity、私密事实和其他主体私密信念进入玩家结果。
6. 每个 AgentMind 只看自己的 belief、character、self view、私有 stimulus 和 outcome observation，按 `BeliefPatch → CharacterPatch → nextAction` 更新；新创建 Agent 也在本步初始化。
7. 全部结果有效后，revision、step、RNG、truth、belief、character、玩家知识和审计历史一次提交。审计保存 initial/final actions、reaction、完整检定、角色 patch、模型尝试和内容 hash，不保存 prompt、原始响应或思维链。任一失败则整个步骤回滚。

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
- 每个 Agent 恰好有一个局部 self binding；自身状态投影不得泄漏 canonical identity 或其他实体状态。
- 每步最多一轮玩家刺激 reaction；每个 actor 最终恰好一个行动，resolution 开始后不得反应。
- Truth 输出、Observation、BeliefPatch、CharacterPatch、reaction 与下一行动全部通过 schema 与语义校验。
- 客户端永远不接收 canonical bindings、其他 Agent 信念、内部模型 ID、内部错误或隐藏检定。

## 扩展到超大世界

当前状态模型没有地图格数量或动作种类上限；地点只是实体，移动只是带因果的 placement 变化。真正的大世界瓶颈是内容量、上下文选择、Agent 数量、存储和模型成本，而不是动作表达。首版故意让全部 Agent 每步行动以验证语义；未来可以加入区域分片、分层时间和 Agent 调度，但它们必须保留同 revision 联合语义和唯一 truth 提交点。

架构理由见 [0031](decisions/0031-epistemic-multi-agent-truth-engine.md)、[0032](decisions/0032-open-world-facts-and-d20-kernel.md)、[0033](decisions/0033-persistent-streaming-world-runs.md) 与 [0036](decisions/0036-agent-evolution-self-awareness-and-reaction-window.md)。
