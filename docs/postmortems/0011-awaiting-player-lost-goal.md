# awaiting_player 无法继续原玩家目标

## Executive summary

Truth Engine 能返回“需要玩家决定”，但 run 只会停止并关闭事件流，没有接受补充输入并恢复同一目标的入口；用新 run 继续会把回答误作新 goal。根因是玩家 intent 把目标和最近输入压成一个文本字段，WorldRun 状态机只设计了停止，没有设计暂停后的所有权和幂等恢复。护栏是稳定 `goal`、独立 `latestInput`、同 run 输入资源、输入/执行事件分离和 active intent 精确归属校验。

## Summary

`requiresPlayerDecision` 能把 run 标为 awaiting_player，但客户端和 API 只能创建新 run、重试失败 run 或取消。原 intent 仍 active 时，新 run 又应被拒绝；即使允许创建，它也无法判断补充文本是旧目标的方法还是全新目的。该状态因此既不能安全继续，也不能无损重建玩家意图。

## Timeline

1. WorldRun 引入 `awaiting_player` 作为流停止状态。
2. 首期 API 只提供创建、读取、重试、取消和 SSE，没有 run input 子资源。
3. 玩家 intent 只携带当前文本，未区分稳定目标与 clarification。
4. 会话状态机审计发现 awaiting 状态没有合法向前迁移，且创建新 run 会破坏唯一 active intent。
5. 同 run 输入日志与幂等 continuation 入口加入，等待、失败和步骤上限获得明确恢复路径。

## Root cause

设计把 `requiresPlayerDecision` 当作终止条件处理，而不是一个持久暂停点。测试验证流会在 awaiting 后关闭，却没有继续提交玩家答案并断言 run ID、intent ID 与原 goal 保持不变。API 事件也把“run 开始”和“玩家输入”混为一次性事实，无法表达第二次执行。

## Guardrails

- [决策 0039](../decisions/0039-resumable-player-intent.md) 定义 stable goal、latest input、幂等 ID 和 run 所有权。
- [`world-host.test.ts`](../../src/server/__tests__/world-host.test.ts) 从真实 awaiting 状态追加 clarification，断言同一 run 完成、原 goal 保留，并覆盖相同/冲突幂等重发。
- [`world-session-store.ts`](../../src/server/world-session-store.ts) 要求 active intent 精确属于一个非终态 run，latest input 与事件日志一致。
- [`inputs/route.ts`](../../src/app/api/sessions/[id]/runs/[runId]/inputs/route.ts) 提供唯一 continuation HTTP 入口。
