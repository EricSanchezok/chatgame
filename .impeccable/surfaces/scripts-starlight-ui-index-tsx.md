---
version: 2
slug: "scripts-starlight-ui-index-tsx"
primary_target: "scripts/starlight/ui/index.tsx"
related_targets: ["scripts/starlight/assets.yaml","scripts/starlight/theme.yaml","src/app/ui/game/chat.tsx"]
---

# 星港会话界面

- Scope: `scripts/starlight/ui/index.tsx` 的值班 HUD、工单追踪、行动建议和资料浮层；宿主管理会话、滚动、媒体、网络与焦点。
- Mode: Operate + Experience。
- Audience/job: 玩家作为普通值班员，从连续交班对话定位 P-07 事故，比较维修、旁路与配给例外并承担资源后果。
- Success: 首屏数秒内理解事故、当前位置和下一步；成本预览与实际执行一致；世界反馈持续写入同一会话时间线。
- Direction: 暖灰、奶油、琥珀、低饱和青绿与热敏记录只作为消息/HUD/浮层的材料语言，不再把页面做成满屏控制台。
- Memorable moment: P-07 事故插画作为消息卡展开；完成现场检查后，输入器即时切换为三种有真实代价的解法。
- Constraints: 不注册 `game-shell` 或固定 `scene`；不使用冷蓝霓虹、扫描线、客户端假时钟或第二套交班转录；只有一个发送动作。

## Fidelity inventory

| Region | Commitment | Medium |
|---|---|---|
| Compact HUD | 班次、位置、EVA 氧、疲劳、电网与供给 | semantic HTML |
| Conversation | 世界、无线电/NPC、玩家和系统结果 | host renderer |
| Inline media | 舱段、事故、关键物品随消息出现 | host MediaCue cards + local WebP |
| Objective | 右上只追踪 P-07 当前目标 | objective-tracker slot |
| Suggested actions | 检查或三解路径，含时间/资源/风险预览 | composer slot |
| Free input | 始终可用且只有一个发送动作 | semantic form |
| Station section | 四区、当前位置与工作路线 | centered modal |
| Handoff/work order | 公开交班日志、事故状态与配给影响 | centered modal |

Component grammar: 中文工作型无衬线承载正文，等宽数字只承载读数。警示同时依赖标签与颜色。新消息约 160ms，媒体约 360ms，面板约 220ms；reduced motion 取消位移和缩放，不使用循环告警动画。
