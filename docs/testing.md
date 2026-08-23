# 测试政策

## 层级

- `npm test`：Vitest 契约、纯内核、仿真集成、持久化、导入、Route Handler 与 jsdom UI。
- `npm run test:e2e`：对生产构建运行真实 Next 入口，并通过本地 HTTP 模型服务走生产 `ModelGateway`/DeepSeek adapter，验证空态、ZIP 导入、会话、自由输入、SSE、刷新持久化和窄屏布局。
- `npm run test:a11y`：分别在空态、导入后的会话工作台和已完成 run 上运行 axe。
- `npm run test:live:deepseek`：使用环境中的真实 DeepSeek 密钥完成 AgentMind 初始化和一个 Truth Engine 步骤；它是手动兼容性烟雾测试，不作为确定性 CI 门禁。
- `npm run diagnose:runtime -- --agents 1,10,50 --steps 1,10,100`：手动运行确定性规模矩阵；CI 只执行 1 Agent × 1 step 的诊断核心测试。
- `npm run diagnose:live -- --steps 3`：显式使用真实供应商采样 token、cache 与延迟，不进入 CI。
- `npm run check:fast`：lint、类型、单元/集成、世界夹具、workflow script 引用与治理门禁。
- `npm run check:ui`：生产 E2E 与无障碍门禁，也是 CI 浏览器 job 的稳定入口。
- `npm run check:all`：依次运行 `check:fast` 与 `check:ui`。

## 规则

- 验证世界而非模型自述。断言提交后的 truth、belief、RNG、文件或公开事件，不以叙事声称代替状态证据。
- 只替代外部 LLM HTTP 服务、时钟和 ID 等昂贵或非确定性边界。Provider adapter、队列、脚本 loader、Route Handler、WorldHost、事务和持久化使用真实实现；`ScriptedModelProvider` 仅用于精确的引擎语义单元测试。
- 失败测试必须证明前态字节或 revision 不变；取消测试必须证明只保留完整步骤。
- 认知测试同时放置相互冲突的 truth 与 belief，证明它们不会互相覆盖。
- 随机测试固定 seed，并证明 DC 与 stakes 在骰值生成前提交。
- 公共表面测试搜索 canonical ID/binding 泄漏。
- 远程模型测试不得打印密钥、prompt 或原始响应，也不能替代 seed 固定的确定性语义门禁。
- 可观测性测试必须证明模式不改变 truth/belief/公开事件，失败调用只进入运行日志，且轮转、超大事件、非日志文件保护与 sink degraded 符合 [运行时可观测性](game-design/runtime-observability.md)。
- 测试夹具位于 `test/fixtures/open-world-script/`，只证明通用契约，不是内置可玩内容。

测试矩阵的决策依据见 [0034](decisions/0034-truth-engine-verification-matrix.md)。
