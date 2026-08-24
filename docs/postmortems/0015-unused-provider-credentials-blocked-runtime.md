# 未使用供应商凭据阻塞单供应商世界

## Executive summary

默认模型目录注册了 DeepSeek、OpenAI 与 xAI，Gateway 却在首次宿主初始化时强制解析三家密钥，导致只使用 DeepSeek 的 Blackmarsh 仍因缺少 OpenAI 密钥让世界与会话 API 返回 500。单元测试把“缺任一目录密钥即拒绝启动”当作正确契约，快速开始文档也要求三把密钥；合并后只验证首页 200，没有探测会初始化 WorldHost 的真实 API。持久护栏把目录能力与实际 Profile 依赖分离，并为 Gateway、会话预检和动态 Agent 增加回归测试。

## Summary

`ModelCatalog` 同时包含多家 provider 及其可选 Profile，而 Blackmarsh 的五个 Truth 阶段和 47 个 Agent 全部只引用 DeepSeek。`ModelGateway` 构造器仍遍历目录全集并同步要求每个 `api_key_env` 非空，因此根页面可以渲染，但首次访问 `/api/worlds` 或 `/api/sessions` 就在 WorldHost 装配阶段失败。统一 HTTP 错误响应隐藏了内部配置消息，使浏览器只看到通用服务器错误。

## Timeline

1. 多供应商 Gateway 把“目录中已注册”与“当前世界实际使用”合并为同一个启动凭据条件。
2. 契约测试明确断言缺少任一供应商密钥时构造失败，文档与测试共同固化了错误边界。
3. Blackmarsh 合并后通过世界结构校验，但校验不初始化生产 Gateway，也不走本地数据库中的世界列表入口。
4. 本地服务启动后仅以根页面 HTTP 200 判断可体验，没有同时检查 `/api/worlds` 与 `/api/sessions`。
5. 真实浏览器体验触发 API 500；逐项检查环境变量与 Gateway 构造后定位到未使用 OpenAI Profile 的密钥要求。
6. Gateway 改为只激活具有凭据的 provider，WorldHost 与动态 Agent 在实际 Profile 激活边界预检，默认 DeepSeek Profile 同时改为 Flash 非思考模式。

## Root cause

设计把模型目录误当成单个部署的依赖清单，而它实际是多个世界共享的能力目录。测试只证明 eager 校验按既定实现工作，没有构造“目录含三家、世界只用一家”的反例；手工启动检查又停在不触发 WorldHost 的静态根页面。世界校验、Gateway 契约与真实 Route Handler 之间缺少一条单供应商组合门禁。

## Guardrails

- [决策 0047](../decisions/0047-on-demand-model-provider-credentials.md) 定义目录能力、实际 Profile 与凭据激活边界。
- [`model-provider.test.ts`](../../src/engine/__tests__/model-provider.test.ts) 证明仅有 DeepSeek 密钥时可调用 DeepSeek，缺密钥 Profile 在 fetch 与排队前失败，并且不会暴露给动态 Agent。
- [`world-host.test.ts`](../../src/server/__tests__/world-host.test.ts) 证明世界引用的全部 Profile 在 Agent bootstrap、首次持久化和中断恢复写入之前完成预检。
- [`multi-agent-simulation.test.ts`](../../src/engine/__tests__/multi-agent-simulation.test.ts) 证明动态 Agent 引用不可用 Profile 时不提交状态且不进入 transition repair，并证明 AgentMind 不重试配置错误。
- 本地可体验性检查同时探测根页面、`/api/worlds` 与 `/api/sessions`，不能再以静态页面 200 代替运行时健康。
