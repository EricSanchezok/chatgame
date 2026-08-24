# 运行时身份碰撞与终态 SSE 重连循环

## Executive summary

Blackmarsh 的 47 个 Agent 并发 bootstrap 时，各自独立生成了 `act-001` 一类常见行动 ID；状态允许重复 ID 持久化，直到第一步组装联合行动才因 SQLite 审计约束失败。失败快照已经是终态，浏览器仍从事件尾部打开 SSE，服务端返回 200 空流后又被 EventSource 当作断线持续重连，页面同时显示“世界正在推演”和连接中断。测试只覆盖单 Agent 或预先写死唯一 ID，SSE 测试也只检查重放内容，没有覆盖终态尾游标和浏览器重连语义。持久护栏把发生记录 ID 收归引擎、严格重放身份 ledger，并统一 WorldRun 状态、失败分类、取消恢复和 204 终态协议。

## Summary

AgentMind 输出完整 `AgentActionProposal`，包括本应由调用上下文决定的 `id`、`actorId` 和 `baseRevision`。每个 Agent 的局部校验只确认 actor/revision 与自身相符，bootstrap 汇总和持久状态校验没有检查所有 `nextAction.id` 的全局单义性。47 个彼此隔离的模型调用自然采用相同短 ID，重复值进入 step 0 存档；第一次玩家行动到来后，联合 action 校验才抛出 `duplicate action id`，revision 和 step 保持 0。

WorldRun 正确把该异常保存为 failed，但失败事件固定声明 `retriable: true`，重试会从同一组重复 prepared action 再次失败。客户端在 start 后读取 run 快照，不检查它是否已经快速到达 failed，仍以最后 sequence 创建 EventSource。订阅生成器发现终态且没有剩余事件便返回；Route Handler 把它编码为 200 空响应，原生 EventSource 按协议自动重连并触发错误回调。世界消息没有 observation 时又无条件使用“世界正在推演”占位，三个错误信号互相矛盾。

## Timeline

1. AgentMind 契约沿用模型生成 action ID，单 Agent fixture 和确定性测试 provider 始终生成看似唯一的 actor/revision ID。
2. 47-Agent Blackmarsh 合并并通过结构校验与确定性烟雾；相关测试自身替模型生成了唯一 ID，没有模拟各独立模型都返回 `act-001`。
3. 真实 DeepSeek bootstrap 完成 47 次调用并把只有 40 个 distinct ID 的 next actions 写入新会话。
4. 玩家提交第一步后，联合行动校验发现重复 action ID，事务在 Truth 调用前失败并保持 revision 0。
5. 浏览器取得 failed 快照后仍连接 SSE；终态空流不断 EOF/重连，页面出现“连接暂时中断”和“世界正在推演”。
6. 检查持久会话、运行事件和服务日志后，将行动碰撞与 SSE 请求风暴还原为两个独立但相互放大的不变量缺口。
7. 扩展审计发现 reaction 换绑、跨步技术 ID、Agent 死后复用、Quantity 复合键、失败分类和取消崩溃恢复属于同一类所有权或生命周期问题，因此统一收口。

## Root cause

发生记录身份没有明确所有者。模型同时生成语义内容和内核审计字段，局部 schema 合法被误当成全局历史合法；状态验证又按数组或单步分别查重，没有建立跨历史的 `kind + ID → immutable content` ledger。测试使用比真实独立模型更“懂全局”的 fixture，掩盖了并发 Agent 常见 ID 碰撞。

WorldRun 方面，同一个状态集合同时承担执行是否活跃、目标是否被占用和事件流是否关闭三种语义。Route 测试消费完整 SSE 文本，却没有模拟 EventSource 在 200 EOF 后的行为；前端也没有快速终态、旧连接回调或零 observation 失败的组件测试。因此服务端已原子回滚的故障被界面错误呈现成仍在推演且网络不稳。

## Guardrails

- [决策 0048](../decisions/0048-engine-owned-runtime-identities.md) 将运行时技术 ID 收归引擎，并要求 strict state schema、全历史 ledger、语义身份不可重绑与版本断代。
- [决策 0049](../decisions/0049-world-run-failure-and-stream-boundaries.md) 定义三组运行状态、类型化失败分类、取消恢复事务和终态 204。
- 多 Agent 回归让 2 个和 50 个独立调用返回相同 alias，并验证 bootstrap、连续步骤、reaction 与 retry 的 canonical ID 仍稳定唯一。
- 状态与存档测试从完整 pre-bootstrap truth/Agent/player base 重放 bootstrap commit、玩家输入、认知 patch 与下一行动，并覆盖 reaction 换绑、跨步 prepared action 内容重绑、Agent/Fact tombstone、Quantity tuple、派生 Fact/Evidence、模型审计 ID、未来引用和重算内容 hash 后的篡改拒绝。
- WorldHost 每次读取都把会话内嵌世界契约对照保留的 content-addressed 世界版本与原 seed；公开检定、结果、观察和步骤提交必须精确等于 canonical history 投影，每个历史 run 的 `intentId` 与已提交输入前缀也必须绑定到对应 revision 的 canonical `playerIntent`。
- Route 与组件测试覆盖终态尾游标、快速终态零连接、真实建立过连接后的终态零重连、旧 source/refresh 失效、真实断线恢复、已知和未知 `runId` 的响应丢失后服务端对齐、重复操作互斥、暂停态放弃，以及取消错误和确认终态的正反到达顺序与操作错误归属。
- 故障落盘测试覆盖永久错误终态首次写入失败，确保恢复仍保留原 `retriable=false` 分类。
- 恢复回归覆盖 clarification 已持久化但步骤未提交时取消、cancelled 首次落盘失败，以及旧终态 intent 后跨 revision 建立新目标；SQLite 回归覆盖叙事首尾空白原样往返、有界验证缓存、批量列表容量抖动与命中可观测性，可信世界契约缓存也以逐出/命中行为验证有界，防止校验或优化改变审计字节或形成第二份无界状态。
- 生产 E2E 在完成与快速失败后跨过一个重连窗口，断言不会出现假断线或“世界正在推演”，并验证放弃后可开始新目标。
- 真实 DeepSeek Flash smoke 使用最小 schema-valid 示例，并验证 reaction、revision、step/phase/kind 等可信元数据由引擎注入后仍能完成 bootstrap 与完整步骤；诊断只输出异常类型和 schema issue 路径，不输出 prompt 或原始响应。
