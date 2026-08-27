# 实例仪表盘替换了会话核心

## Executive summary

World Instance 重构保留了执行和持久化内核，却把可玩的 assistant-ui 对话、控制球与 WorldInspector 入口替换成公共事件仪表盘。根因是架构迁移把“旧后端必须删除”错误扩大为“旧产品交互也应删除”，并以新 API 可达性代替了既有游戏流程的视觉与行为回归。持久护栏是把 Participant 会话、Observer 视角和 Inspector 权限写成独立契约，并以创建新游戏到首条旁白、提交行动、控制球和调试器的真实入口 E2E 固定产品核心。

## Summary

世界库与实例创建仍可使用，执行也继续进入 World Instance 和 Execution Ledger；进入实例后却只显示“世界正在发生什么”、推进按钮和角色侧栏。玩家无法通过聊天提交自然语言行动，持久 Arrival 不再是第一条 World 消息，控制球、存档、设置和完整 Inspector 也从主体验消失。Observer 与 Participant 被压成同一个公共仪表盘，导致产品表面不再符合游戏第一性原理。

## Timeline

1. WorldRun 后端被 WorldInstance、Participant 和 ActionWindow 取代。
2. 前端迁移以新实例状态和无人推进能力为中心，移除了依赖旧 Session API 的会话组件。
3. 新页面通过类型、单元测试和实例 API 测试，但测试只断言世界可创建、可推进和可读取。
4. 用户进入实际实例后发现聊天、控制球与 Inspector 入口全部缺失，并指出新游戏应先在当前页面选择 Origin，再以旁白开始会话。
5. 产品契约改为 World Instance 派生会话和 Agent 视角 Observer；旧后端不恢复，原交互主线接到新数据模型。

## Root cause

重构边界没有区分后端资源所有权与前端交互资产。删除旧 Session/WorldRun 是保持单一执行路径的正确要求，但 assistant-ui 消息流、控制球和 Inspector 只是客户端投影，可以迁移到新 API。实现按“哪些组件引用旧类型”决定删除范围，没有先把用户不可失去的核心旅程写成验收契约。

测试矩阵偏向引擎正确性和 HTTP 可达性。它没有从世界详情页打开 Origin 弹层、确认后读取第一条 Arrival、发送一次行动并得到 Observation，也没有断言 Participant 页面不存在批量推进、控制球仍可拖动以及 Inspector 默认隐藏。页面视觉快照只覆盖了新仪表盘，因此把设计替换本身当成了新基线。

## Guardrails

- [决策 0064](../decisions/0064-conversation-core-and-agent-perspective-observer.md)固定会话主舞台、Observer Agent 视角、控制转移和三类权限投影。
- [表现层规格](../game-design/presentation.md)把新游戏、Participant、Observer、控制球和 Inspector 的当前行为列为产品契约。
- `e2e/flows/immersive-game.spec.ts` 从真实世界详情入口覆盖 Origin 弹层、Arrival 首消息、单步行动、Observer 切换与接管。
- `e2e/a11y/immersive-game.a11y.spec.ts` 覆盖会话、弹层、控制球、320 px、200% 缩放、forced colors 与焦点恢复。
- 前端迁移评审必须分别列出被替换的后端事实源和必须保留的用户旅程；新 API 通过不等于旧体验可以删除。
