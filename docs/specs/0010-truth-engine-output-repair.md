# Truth Engine 输出质量与局部 Repair 分层

Artifact-Version: 1
Status: Approved

## Intent

模型输出质量、语义修复、冲突范围和观察渲染必须各自承担清晰责任。未知引用、旧 mechanic 字段、单个观察者隐私错误和结构化输出错误不能扩大为全局冲突，也不能通过上下文裁剪掩盖根因。优化保持开放语义、完整上下文、原子提交和 replay determinism。

## Contract

模型输出错误进入有界 semantic repair loop，记录 scope、issue class、attempt、target IDs 和完整 model audit。transport、configuration、overload 与取消错误不进入 semantic repair。上下文按完整 canonical truth、完整 semantic history、完整 joint actions 和完整 groundings构造；超过 profile 的 `max_input_bytes` 直接抛出 `ContextLimitExceeded`，不截断、摘要或隐式删除字段。

未知 Entity、Fact、Audience、Pool、Alias 或 private evidence 只产生 action 或 invocation 局部 reference issue。`globalFallback` 仅在模型给出 canonical `{kind:"global",id:"world"}` 且校验通过时成立；真实全局语义仍进入全局组件。Action Compilation 的合法 slot 保留，结构错误可从原始 slot 输出定位时只重试失败 slot。

Truth Transition 将已启用 RulePackage 的 package、version、rule、description 和 JSON input schema 注入完整上下文。每个 mechanic invocation 在可信 rule 执行前进行 preflight；旧字段只触发 invocation-level repair，修复失败由拥有该候选的组件处理，禁止 direct operation 绕过 contract。

Resolution plan verifier 按 finding 的最小 plan target 修复并重新验证，随机承诺在 verifier 接受前不提交。Causal verifier 对仅涉及 observation 的 finding 只重渲染受影响 observer；其它无法证明局部安全的 finding 才让当前组件重新生成，最终候选仍由 CanonicalCommitter 原子校验。

Observation Renderer 为每个 observer 建立独立输出、audit 和 repair ledger，所有 observer 并发执行，每次请求仍包含完整候选世界和授权视图。单 observer 的结构、引用或隐私失败只影响该 observer；repair 耗尽时生成 typed uncertainty observation，不改变 canonical transition。

## Plan

共享 semantic repair orchestration 和 transport/output telemetry 负责错误分类；action dependency、Action Compilation、RulePackageRegistry、TruthEngine、Observation Renderer 和 deterministic fixture 分别实现局部契约。参考世界内容保持脚本驱动，测试基线使用 schema v13 与当前 core-resolution package。

## Verification

验证未知和 private 引用不会产生 global component，真实 global 引用仍覆盖所有节点；验证 malformed slot、缺失 resolution plan、旧 mechanic input、causal observation finding 和 observer 隐私失败均只影响声明的目标；验证并发完成顺序变化不改变 world hash、causal hash 或 RNG transcript，且任何 context limit 和 repair exhaustion 都不会产生部分 canonical 提交。

运行 `npm run check:fast`、`npm test`、`npm run typecheck`、`npm run lint`、`npm run verify:prompts`、`npm run world:validate -- worlds/blackmarsh/world` 和 `node scripts/run-gates.mjs`。

## Evidence

实现证据由 [mechanic contract tests](../../src/engine/mechanics/__tests__/rule-package.test.ts)、[resolution pipeline tests](../../src/engine/mechanics/__tests__/resolution-pipeline.test.ts)、[observation renderer tests](../../src/engine/cognition/__tests__/observation-renderer.test.ts)、[action dependency tests](../../src/engine/mechanics/__tests__/action-dependency.test.ts) 和 [eager reference tests](../../src/engine/algorithms/eager-reference/__tests__/eager-reference.test.ts) 固化。
