# 测试政策

## 层级

- `npm test`：Vitest 契约、纯内核、仿真集成、SQLite 持久化/租约/CAS、世界版本锁定、导入、Route Handler 与 jsdom UI。
- `npm run test:e2e`：对生产构建运行真实 Next 入口，并通过本地 HTTP 模型服务走生产 `ModelGateway`/DeepSeek adapter，验证主菜单、ZIP 导入、精确 Session 路由、自由输入、SSE、刷新持久化、存档重命名、控制导航和 320px 布局。
- `npm run test:a11y`：分别在主菜单、世界库、空对话和已完成 run 上运行 axe。
- `npm run test:live:deepseek`：使用环境中的真实 DeepSeek 密钥完成 AgentMind 初始化和一个 Truth Engine 步骤；它是手动兼容性烟雾测试，不作为确定性 CI 门禁。
- `npm run diagnose:runtime -- --agents 1,10,50 --steps 1,10,100`：手动运行确定性规模矩阵；CI 执行 1/2 Agent × 1 step 的诊断核心与扩容 replay-base 回归。
- `npm run diagnose:live -- --steps 3`：显式使用真实供应商采样 token、cache 与延迟，不进入 CI。
- `npm run check:fast`：lint、类型、单元/集成、世界夹具、workflow script 引用与治理门禁。
- `npm run check:ui`：生产 E2E 与无障碍门禁，也是 CI 浏览器 job 的稳定入口。
- `npm run check:all`：依次运行 `check:fast` 与 `check:ui`。

## 规则

- 验证世界而非模型自述。断言提交后的 truth、belief、RNG、文件或公开事件，不以叙事声称代替状态证据。
- 只替代外部 LLM HTTP 服务、时钟和 ID 等昂贵或非确定性边界。Provider adapter、队列、脚本 loader、Route Handler、WorldHost、事务和持久化使用真实实现；`ScriptedModelProvider` 仅用于精确的引擎语义单元测试。
- 失败测试必须证明前态字节或 revision 不变；取消测试必须证明只保留完整步骤。
- 多 Agent 身份测试必须让独立模型返回相同 draft alias，并验证引擎分配的运行时 ID 在 bootstrap、reaction、连续步骤和同 revision 重试中稳定单义。
- 认知测试同时放置相互冲突的 truth 与 belief，证明它们不会互相覆盖。
- 随机测试固定 seed，并证明 DC 与 stakes 在骰值生成前提交。
- 公共表面测试搜索 canonical ID/binding 泄漏。
- 恢复测试必须先替换同 ID 世界，再证明旧会话从保留的 content-addressed 版本验证原 `worldHash`、seed 与完整运行时契约；还要篡改内嵌 law 并保持 hash 不变，证明宿主拒绝。SQLite 测试必须覆盖跨连接恢复、generation 冲突、损坏文档拒绝、第二宿主租约拒绝、校验缓存 LRU 逐出、命中/未命中可观测事件，以及含首尾空白但非空的叙事原样往返。
- 持久状态篡改测试不能停在重算 step/document 内容 hash；必须覆盖 model invocation ID、跨步 prepared action、nextAction、belief/character、玩家首次目标与 clarification 输入链、历史 run 的 `intentId`/已提交输入前缀与同 revision canonical `playerIntent` 绑定、终态 intent 后的新 goal、Fact tombstone，以及公开 check/outcome/observation/commit 精确投影。
- WorldRun 测试必须区分 execution-active、stream boundary 与 active-intent owner；覆盖 401/配置/invariant 等永久失败、429/5xx/临时存储/CAS 等可重试失败、递归错误分类、失败与 cancelled 终态首次落盘中断、澄清已落盘但步骤未提交时取消、取消请求后的新宿主恢复、放弃后跨 revision 新建目标、边界尾游标 204、快速终态快照零 SSE，以及浏览器确认建立真实 SSE 后的终态零重连。客户端还要覆盖旧快照不能关闭新 source、已知 `runId` 后读取失败、start 的网络/408/429/5xx 响应在 `runId` 前丢失，以及取消/放弃错误与确认终态的两种到达顺序和新旧错误归属；不确定提交必须保持互斥，直到服务端匹配到该 run 或跨确认窗口连续证明不存在。
- 远程模型测试不得打印密钥、prompt 或原始响应，也不能替代 seed 固定的确定性语义门禁。
- 可观测性测试必须证明模式不改变 truth/belief/公开事件，失败调用只进入运行日志，且轮转、超大事件、非日志文件保护与 sink degraded 符合 [运行时可观测性](game-design/runtime-observability.md)。
- 测试夹具位于 `test/fixtures/open-world-script/`，只证明通用契约，不是内置可玩内容。

测试矩阵的决策依据见 [0034](decisions/0034-truth-engine-verification-matrix.md)。
