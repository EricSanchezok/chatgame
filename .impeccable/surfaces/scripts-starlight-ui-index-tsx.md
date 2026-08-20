---
version: 1
slug: "scripts-starlight-ui-index-tsx"
primary_target: "scripts/starlight/ui/index.tsx"
related_targets: ["scripts/starlight/assets.yaml","scripts/starlight/theme.yaml"]
---

# 星港游戏界面

- Scope: `scripts/starlight/ui/index.tsx` 及剧本自带游戏壳、面板、启动器表现。
- Mode: Operate + Experience。
- Audience/job: 玩家作为普通值班员接收交班、定位事故、比较合法维修/灰色调度/系统服从等处理路径，并承担时间、物资、社区声望和追踪热度后果。
- Success: 首视口在隐藏标题时仍可识别为老旧民用站的交班台，而不是舰长仪表盘；警报和成本可在数秒内理解。
- Direction: 磨损的 Shift Console 与热敏交班记录。获选构图为 [thermal handoff](../mocks/starlight-thermal-handoff.png)；环形图用于地图面板而非支配首屏。
- Memorable moment: 新事故只触发一次琥珀扫灯并在热敏纸上打印新行；玩家签署工单后读数由服务器结果更新。
- Constraints: 不使用冷蓝霓虹、扫描线、玻璃卡、聊天气泡或客户端假时钟；告警同时使用标签、图标和纹理；移动端按状态—事故—方案—输入顺序折叠。

## Fidelity inventory

| Region | Commitment | Medium |
|---|---|---|
| Operations rail | 班次时间、区段、船体、电网、供给和告警源 | semantic HTML + currentColor SVG |
| Station section | 居住、货运、维修、EVA 的纵向路线与权限 | interactive SVG geometry |
| Thermal handoff log | 频道、来源、时间、摘要的连续打印语法 | semantic virtualized list + paper raster texture |
| Work-order sheet | 事故事实、影响人口、设备与三种方案 | semantic HTML |
| Cost preview | 时间、物资、声望、热度与拒绝原因 | semantic HTML + icons |
| Context verbs | 联系、调度、记录及剧本动作 | semantic buttons |
| Radio composer | 频道选择、自由文本和结构化 hint | semantic form |
| Ring map panel | 环形站区、utility flow、当前路线和异常区 | interactive SVG geometry |

Component grammar: 模块化金属面板 8–10px 圆角，纸张和铭牌近直角；不在每块面板同时使用边框和阴影。中文工作型无衬线承载正文，压缩标签和 tabular 数字承载仪表。唯一显著动效是告警扫灯和热敏纸新增行；reduced motion 以静态高亮替代。
