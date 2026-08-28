# CharacterPatch 事件依据修复耗尽

Artifact-Version: 1

## Executive summary

真实 DeepSeek 烟雾测试越过 Truth transition 后，AgentMind 为一个没有关联本步骤事件的 Observation 生成了情绪更新。角色演化校验正确拒绝无因变化，但模型上下文没有明确列出哪些 Observation 具备合法事件依据及其影响级别，repair 又只收到无字段路径的普通错误，连续重试仍未收敛。确定性测试只覆盖拒绝与回滚，没有验证模型拥有满足约束所需的信息。持久护栏是显式提供 `Observation → Event impact` 依据，并一次返回全部违规 CharacterPatch operation 的稳定 code 与精确路径。

## Summary

CharacterPatch 不是任意叙事改写。每个 operation 必须引用该 Agent 在本步骤收到的 Observation，且至少一条引用的 Observation 必须关联本步骤 WorldEvent；event impact 决定人格、动机、情绪和态度允许变化的幅度。AgentMind 原先只收到 Observation 的 `sourceEventIds`，既不知道这些 ID 是否属于当前候选事件，也看不到对应 impact。模型因此把无事件依据的感知用于 `set_emotion`，事务内核拒绝候选，revision 保持不变。

## Timeline

1. CharacterPatch 校验已要求当前私有 Observation、belief evidence 和当前事件依据。
2. 测试覆盖非法角色变化会失败并回滚，但没有覆盖 repair 反馈能否驱动模型改正。
3. 真实 DeepSeek 生成 `set_emotion`，其 source Observation 没有关联本步骤 WorldEvent。
4. 两次 repair 只收到 `set_emotion has no current-step event basis`，没有 operation 路径或可选合法来源，最终抛出 `ModelSemanticRepairError`。
5. Truth 阶段已成功完成，失败发生在并发 AgentMind 阶段，canonical revision 未推进。

## Root cause

校验器掌握 Observation、WorldEvent 和 step，却没有把这三者形成的合法输入域投影给 AgentMind。提示词要求“有事件影响级别支撑”，上下文却不给影响级别，构成不可完全执行的模型契约。普通 Error 同时丢失 operation 索引；当多个 operation 违规时，逐个失败还会浪费有限 repair 次数。

## Guardrails

- [认知隔离决策](../decisions/0031-epistemic-multi-agent-truth-engine.md)要求 CharacterPatch 只引用本步骤私有且具有当前事件依据的 Observation。
- [引擎运行时规格](../game-design/engine-runtime.md#observation-与认知隔离)定义 AgentMind 的可见输入、事件依据与空 patch 规则。
- [`open-world-core.test.ts`](../../src/engine/runtime/__tests__/open-world-core.test.ts)覆盖 CharacterPatch、Observation 和认知状态的不变量。
- `npm run test:live:deepseek` 通过真实模型完成 bootstrap、Truth、全部 AgentMind 和原子提交，验证上下文与 repair 契约共同可执行。
