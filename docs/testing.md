# 测试政策

## 层级

- `npm test`：Vitest 契约、纯内核、仿真集成、持久化、导入、Route Handler 与 jsdom UI。
- `npm run test:e2e`：对生产构建运行真实 Next 入口，验证空世界工作台。
- `npm run test:a11y`：对同一生产入口运行 axe。
- `npm run check:fast`：lint、类型、单元/集成、世界夹具与治理门禁。
- `npm run check:all`：快速门禁加生产 E2E 与无障碍。

## 规则

- 验证世界而非模型自述。断言提交后的 truth、belief、RNG、文件或公开事件，不以叙事声称代替状态证据。
- 只 mock 外部 LLM、时钟和 ID 等昂贵或非确定性边界。脚本 loader、Route Handler、WorldHost、事务和持久化使用真实实现。
- 失败测试必须证明前态字节或 revision 不变；取消测试必须证明只保留完整步骤。
- 认知测试同时放置相互冲突的 truth 与 belief，证明它们不会互相覆盖。
- 随机测试固定 seed，并证明 DC 与 stakes 在骰值生成前提交。
- 公共表面测试搜索 canonical ID/binding 泄漏。
- 测试夹具位于 `test/fixtures/open-world-script/`，只证明通用契约，不是内置可玩内容。

测试矩阵的决策依据见 [0034](decisions/0034-truth-engine-verification-matrix.md)。
