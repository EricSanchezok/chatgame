# Blackmarsh 单体 Transition 修复耗尽

## Executive summary

Blackmarsh 在 47 个自主 Agent 与一名真人的首步推演中经过六次模型调用、两次 transition repair 后仍回滚。单体 transition 首次遗漏 47 个 outcome，第二次遗漏唯一时间推进，第三次把五个 Agent 私有 claim/evidence/goal ID 当作 canonical Fact 引用。schema 只能检查字符串形状，repair 又重复发送整个约 1.21 MiB 上下文，因此既没有隔离 ID 目录，也没有缩小失败表面。持久护栏是用 `eager-reference@1` 预分配结构槽位、按行动隔离私有上下文、用 typed canonical catalog 约束引用，并把修复限制在违规分量。

## Summary

用户在 Blackmarsh revision 0 提交“我现在在哪里”。运行产生约 36.9 万输入 token 的六次模型 invocation。第一次 transition 只返回一个 outcome；第一次 repair 返回 48 个 outcome，却缺少 `advance_time`；第二次 repair 通过结构检查后，在 causal assertion 验证中引用了三个私有 claim、一个 evidence 和一个 goal。CanonicalCommitter 正确阻止提交，世界仍停在 revision 0。

## Timeline

1. 单体算法把玩家行动、47 个自主行动、完整 canonical world 和全部 Agent epistemic catalog 交给同一 Truth 流程。
2. 初始 transition 未满足每行动一个 outcome。
3. 全局 repair 补齐 outcome，但遗漏步骤唯一正数时间推进。
4. 第二次全局 repair 生成完整外形，却把 `paddock-buyers-may-coordinate`、`storm-likely-before-long`、`maracan-dennis-is-suspicious`、`holbein-northwest-marks` 与 `sapphire-audit-shell-cycle` 写入 `fact_matches`。
5. 因果校验发现这些 ID 不在 canonical Fact 集合中，repair 预算耗尽，原子提交回滚。

## Root cause

算法把本应由内核保证的基数、身份和时间结构交给一个超大模型响应，同时将 canonical 与 47 份私有目录平铺在同一上下文。`fact_matches` 的 JSON schema 只能表达 string，无法区分 canonical FactId 和私有知识 ID。语义 repair 虽报告错误路径，却仍重做整份 transition，使已正确字段和无关主体一同进入新的随机生成。测试使用少量 Agent 和短目录，没有覆盖长上下文下连续出现的槽位遗漏与命名空间混淆。

## Guardrails

- [0063](../decisions/0063-eager-reference-execution.md)用引擎预分配 outcome/time/runtime identity，并按冲突分量裁决。
- Grounding 上下文只含 actor 自己的私有认知；transition 的 causal catalog 只暴露 canonical Fact、Event、Action、Check、Random 与 Law。
- Blackmarsh 47 自主 Agent 的“我现在在哪里”成为真实 provider 回归；技术失败不得以 blocked/partial/noop 伪装。
- 无网络 fixture 分别覆盖 outcome slot、时间推进、canonical/private ID 隔离、局部 repair 与全局 fallback。
