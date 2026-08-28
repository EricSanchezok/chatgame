# Observation 局部身份修复耗尽

Artifact-Version: 1

## Executive summary

真实 DeepSeek 烟雾测试在观察石门时连续生成与 canonical entity 同名的局部 ID，认知隔离校验正确拒绝候选，但 repair 只获得无专用 code、无字段路径的首个普通错误，无法一次修复玩家和 Agent 各自 Observation 中的全部冲突。确定性测试只证明非法候选会被拒绝，没有证明 repair 上下文足以驱动模型收敛。持久护栏为 transition 提供逐观察者局部身份命名空间，并在一次 repair 中返回全部 canonical/local 冲突的稳定 code 与精确路径。

## Summary

最小参考世界中的石门 canonical ID 为 `gate`，玩家和守门人的初始局部认知均没有石门身份。Truth transition 为两个观察者引入石门时直接把 `gate` 写入 `localEntity.id`。`canonicalEntityId` 是服务端私有 binding，可以合法引用 `gate`；`localEntity.id` 会进入玩家或 Agent 私有认知，必须使用观察者自己的别名。内核拒绝了该候选，revision 保持不变。

## Timeline

1. 认知隔离规则和事务测试覆盖 canonical/local ID 碰撞与局部身份重绑。
2. transition repair 把任意普通 Error 压缩为 `{ code: "Error", path: [], message }`，每次验证在首个冲突处停止。
3. 真实 DeepSeek 为玩家和守门人分别生成同名 `gate` introduction。
4. 两次 repair 只能看到单个无路径错误，未能稳定修改所有 Observation，最终抛出 `ModelSemanticRepairError`。
5. 本地服务可以启动，模型 transport 也成功，但完整引擎烟雾步骤无法提交。

## Root cause

输出校验与模型修复被当成同一个能力验证：测试证明了安全边界会拒绝泄漏，却没有覆盖“多个观察者同时发生同类错误”时的反馈完备性。Truth 已拥有 canonical truth 和各主体 binding，但 transition context 没有把局部身份分配规则整理成可直接执行的约束；普通 Error 又丢失错误位置，使 repair 依赖模型从自然语言自行搜索整份候选。

## Guardrails

- [认知隔离决策](../decisions/0031-epistemic-multi-agent-truth-engine.md)要求 transition context 显式声明局部身份命名空间，并一次返回全部身份冲突。
- [Truth Engine 运行时规格](../game-design/engine-runtime.md#observation-与认知隔离)定义局部身份、private binding 和 claim 引用规则。
- [`llm-field-ownership.test.ts`](../../src/engine/contracts/__tests__/llm-field-ownership.test.ts)证明 Observation 模型不能填写 canonical identity 或运行时字段。
- `npm run test:live:deepseek` 继续通过真实模型完成 bootstrap 与一个完整世界步骤，确保 provider 方言、prompt 和语义 repair 能共同工作。
