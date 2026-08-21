---
version: 2
slug: "scripts-emberfall-ui-index-tsx"
primary_target: "scripts/emberfall/ui/index.tsx"
related_targets: ["scripts/emberfall/assets.yaml","scripts/emberfall/theme.yaml","src/app/ui/game/chat.tsx"]
---

# 灰烬镇会话界面

- Scope: `scripts/emberfall/ui/index.tsx` 的 HUD、目标追踪、行动建议和资料浮层；会话、滚动、消息媒体和焦点由宿主管理。
- Mode: Experience + Operate。
- Audience/job: 玩家作为公共灰灯持有人，沿连续对话理解班前准备、下井巡查、双源取证和公共配火。
- Success: 首屏按顺序回答“发生了什么、我在哪里、现在能做什么”；十二个行动内可完成一轮；所有读数与预检来自服务器权威状态。
- Direction: 煤尘账簿、矿井剖面、氧化铜与冷白灰火只进入消息细节、紧凑 HUD 和按需浮层，不再成为永久三栏工作台。
- Memorable moment: 地点/事件插画随世界消息展开；两个独立证据在证据浮层中连接，结论成立后会话里的下一组行动变为公共配火。
- Constraints: 不注册 `game-shell` 或固定 `scene`；不建立第二套转录、滚动、网络或存档；不显示内部事件 id；自由输入和唯一发送始终可见。

## Fidelity inventory

| Region | Commitment | Medium |
|---|---|---|
| Compact HUD | 灰烬镇、班相、位置/深度、灯火、支护/灰蚀 | semantic HTML |
| Conversation | 世界/NPC/玩家/系统四种消息语法 | host renderer |
| Inline media | 地点、事件、证据与物品随消息出现 | host MediaCue cards + local raster |
| Objective | 同时只显示一个本班目标 | objective-tracker slot |
| Suggested actions | 3–5 个当前行动及权威成本、风险、拒绝原因 | composer slot |
| Free input | 始终可用且只有一个发送动作 | semantic form |
| Mine map | 矿层节点、当前位置和路径 | centered modal + currentColor SVG |
| Evidence | 实物—证词—结论 | centered modal + semantic HTML |

Component grammar: 中文正文使用宿主中文字体栈；剧本等宽标签只服务读数。旧纸与煤尘是局部材料，不做全屏背景。新消息约 160ms 淡入，媒体约 360ms 展开，面板约 220ms；reduced motion 取消位移和缩放。
