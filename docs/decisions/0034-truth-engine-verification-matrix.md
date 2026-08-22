# Truth Engine 验证矩阵

## Status
Accepted
Class: testing

## Context and Problem Statement

旧测试栈围绕两个内置剧本、固定动作预检、动态 UI bundle、Storybook 和大量视觉快照组织。开放世界重构删除了这些产品表面；继续保留旧 harness 会让测试证明已不存在的系统，并显著增加依赖与维护成本。新引擎的核心风险转为认知隔离、联合步骤原子性、开放状态约束、持久运行恢复和公开事件防泄漏。

## Decision Drivers

- 测试必须证明 canonical truth、Agent belief 与玩家知识不会串线。
- 任意自然语言输入必须走真实会话、WorldRun 和 SSE 入口。
- 随机检定、失败回滚、取消和恢复必须可重复验证。
- 空安装状态和导入入口必须在生产构建中可访问。
- 外部 LLM 是唯一允许 mock 的昂贵非确定性边界。

## Considered Options

- 迁移全部旧 Storybook、浏览器组件与视觉快照。
- 只保留引擎单元测试。
- Vitest 契约/集成测试 + 少量生产构建 Playwright/axe 测试——所选路线。
- 用真实远程 LLM 作为 CI 门禁。

## Decision Outcome

Vitest 直接覆盖事实与信念分离、d20 预承诺和种子复现、数值守恒、阈值、动态 Agent、全体同 revision 联合行动、模型修复失败回滚、脚本严格加载、ZIP 安全、会话逐步持久化、崩溃恢复、取消边界、Route Handler 和 SSE 重放。前端用 jsdom 验证零世界空态和导入入口。

Playwright 只对 `next build` 后的真实应用运行两类门禁：核心玩家入口和页面级 axe。测试使用不含世界包的独立根目录与隔离数据目录，启动真实 Route Handler；`CHATGAME_LLM_PROVIDER=mock` 只在模型边界提供符合正式 schema 的确定性输出。Storybook、浏览器组件模式、旧内置剧本 E2E 和像素基线不再属于当前测试栈。

`check:fast` 运行 lint、类型、Vitest、世界夹具校验与治理门禁；`check:all` 在此基础上增加生产构建的 E2E 和无障碍测试。

## Pros and Cons of the Options

### 迁移全部旧矩阵

- 好：保留细粒度视觉覆盖。
- 坏：验证已经删除的 UI 扩展和内置内容，依赖多且不能证明新的认知/事务不变量。

### 只保留单元测试

- 好：快且定位明确。
- 坏：无法证明 Next 路由、SSE、生产构建和浏览器空态真的可用。

### 分层的新验证矩阵

- 好：高风险语义由确定性测试穷举，真实入口仍有浏览器证据，依赖面显著缩小。
- 坏：不再提供逐像素视觉回归；视觉重构需按风险另加针对性测试。

### 真实 LLM CI

- 好：最接近线上模型行为。
- 坏：昂贵、慢、不稳定且需要密钥，不能作为可重复事务门禁。

## Links

- [0024](0024-frontend-workbench-and-ci.md) — 被本记录取代的旧前端工作台矩阵。
- [0031](0031-epistemic-multi-agent-truth-engine.md) — 联合仿真与认知隔离不变量。
- [0033](0033-persistent-streaming-world-runs.md) — 真实 Route Handler、SSE 与持久运行边界。
- [测试政策](../testing.md) — 当前命令和测试分层。
