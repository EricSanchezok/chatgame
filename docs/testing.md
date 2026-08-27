# 测试政策

## 层级

- `npm test`：Vitest 契约、纯内核、仿真集成、SQLite 持久化/CAS、世界版本、导入、Route Handler 与 jsdom UI。
- `npm run test:e2e`：对生产构建运行真实 Next 入口，并通过本地 HTTP 模型服务走生产 Gateway，验证 Origin 弹层、Participant 会话、Observer 视角、控制转移、ActionWindow、控制球和 Inspector。
- `npm run test:a11y`：在 Origin 弹层、Participant 会话、Observer、控制球、角色面板和 Inspector 上运行 axe，并覆盖 320 px、200% 缩放和 forced colors。
- `npm run test:live:deepseek`：使用进程环境中的真实 DeepSeek 凭据完成 Blackmarsh headless 与 Participant 烟测；它是手动兼容性测试，不属于确定性 CI 门禁。
- `npm run experiment:run -- --agents 1,10,50,1000 --steps 1`：通过统一 Ledger 执行确定性规模矩阵；算法比较使用独立 world/seed 重复单位。
- `npm run check:fast`：lint、类型、单元/集成、世界夹具和治理门禁。
- `npm run check:ui`：生产 E2E 与无障碍门禁。
- `npm run check:all`：依次运行 `check:fast` 与 `check:ui`。

视觉快照按操作系统保存独立基线，继续使用相同的严格像素阈值；布局必须先消除跨平台几何差异，平台基线只吸收字体栅格化等不可消除的渲染差异。

## 通用规则

- 验证世界而非模型自述。断言提交后的 truth、belief、RNG、文件、公开事件或授权角色视图，不以叙事声称代替状态证据。
- 只替代外部 LLM HTTP、时钟和 ID 等昂贵或非确定性边界。Provider adapter、队列、loader、Route Handler、WorldHost、事务和持久化使用真实实现；`ScriptedModelProvider` 只用于精确语义单元测试。
- 失败测试必须证明 revision、canonical state 和策略 roster 不变；取消与 deadline 测试必须证明只保留完整步骤。
- strict schema 必须验证字段所有权：模型可命名语义 ID 和候选 alias；revision、step、phase、Profile、lifecycle、provenance、threshold ledger、时间戳和运行时 ID 必须由引擎物化。
- 认知测试同时放置相互冲突的 truth 与 belief，并证明二者不互相覆盖。公共 API 测试必须搜索 canonical binding、其他 Agent belief 和 Inspector payload 泄漏。
- 随机测试固定 seed，并证明检定请求、DC、stakes 和分布在 RNG 抽取前提交。
- 远程模型测试不得打印密钥、prompt 或原始响应，也不能替代确定性语义门禁。

## Eager reference

- 每个存活 model Agent 必须产生一次行动并进入 grounding；external 行动来自 ActionWindow；idle 与 timeout 由内核生成 typed noop。
- grounding 测试覆盖 read/write/audience 相交、独立分量、未知依赖 global fallback、跨分量引用合并和私有 ID 不能进入 canonical catalog。
- 每个 action 必须恰有一个引擎预分配 outcome slot；`advance_time` 必须由内核生成且为正数。
- Observation 测试覆盖模型输入字节分批、固定 observer slot、完整物化、权限校验和局部 repair；单个观察者超预算必须显式失败。
- AgentMind 使用完整 settlement。网络、取消、配置或 Ledger 失败丢弃候选；单个 Agent 的语义 repair 耗尽必须留下可计数的 typed fallback，且不得伪造信念。external 与 idle Agent 不执行 AgentMind。
- Blackmarsh 48 个自主 Agent 的 headless 一步是结构完整性回归；领域行动可以 blocked/partial/noop，但不能因缺 outcome、缺时间或 ID 命名空间混淆而失败。

## World Instance 与 Participant

- headless 世界必须支持单步、十步 batch、实时启动/暂停和重启恢复；调度测试使用 fake clock 证明无重入、无离线 backlog、generation fencing 和上一步提交后才安排下一步。
- ActionWindow 使用内部双 Participant 测试收齐、幂等重试、并发冲突、deadline noop、掉线和 revision CAS；产品 UI 仍限制一个 active Principal。
- Origin 测试验证对话框打开时 URL 不变、取消无孤儿实例，以及确认后的确定性 ID、出生点、资源、persona、goal 和显示定制。
- Arrival 测试证明它是第一条持久 World 消息、只读授权视角、三条建议不自动提交、失败使用回退文本、Ledger 完整记录且 semantic/state hash 不变。
- Participant 会话测试证明一次自然语言提交自动创建一个 advance、最多推进一步，并在刷新、重复请求、失败和重启后保持相同消息投影。Participant composer 不得出现 batch 或 realtime 控制。
- Observer 测试逐 Agent 验证行动、Observation、character 与 belief 投影，搜索 canonical binding 和其他 Agent 私有状态泄漏；接管、退出和直接切换必须在一个 revision CAS 中恢复原角色 model 策略。
- 控制球测试覆盖拖动恢复、移动 Sheet、存档、设置、角色工具、焦点返回，以及高级 detach 和 Inspector 默认隐藏。
- 静态资源测试覆盖真实 MIME、动画、尺寸、单文件/总预算、路径穿越、Unicode/大小写冲突、符号链接和恶意 ZIP。
- 持久化测试覆盖跨连接恢复、generation 冲突、损坏 document 拒绝、校验缓存、WorldRuntimeContract 与 content-addressed world hash 锁定。

## Ledger 与研究复现

- Execution Ledger 测试必须证明完整请求、响应和候选可按 execution 取回，关键写入失败阻止 revision，失败 execution 保留，Instance CAS 与 terminal record 原子提交。
- recorded replay 不访问网络且产生相同 semantic hash 和 state hash；compare 按 transition、observation、mind 分区；export 只从原始事件和 artifact 派生。
- 聚合指标拒绝 Agent、Participant、Instance、Event 和 invocation 等高基数维度；主体级细节仍可从 trace 查询。
- 1/10/50/1000 Agent 矩阵以 world/seed 为重复单位，不能把同一世界的 Agent 当成独立样本。

测试夹具位于 `test/fixtures/open-world-script/`，只证明通用契约，不是内置可玩内容。测试矩阵的决策依据见 [0034](decisions/0034-truth-engine-verification-matrix.md)、[0063](decisions/0063-eager-reference-execution.md)与 [0064](decisions/0064-conversation-core-and-agent-perspective-observer.md)。
