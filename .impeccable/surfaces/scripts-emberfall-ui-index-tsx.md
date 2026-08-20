---
version: 1
slug: "scripts-emberfall-ui-index-tsx"
primary_target: "scripts/emberfall/ui/index.tsx"
related_targets: ["scripts/emberfall/assets.yaml","scripts/emberfall/theme.yaml"]
---

# 灰烬镇游戏界面

- Scope: `scripts/emberfall/ui/index.tsx` 及剧本自带游戏壳、面板、启动器表现。
- Mode: Experience + Operate。
- Audience/job: 玩家作为公共灰灯持有人，在一次矿井班次中看清位置、灯火、灰蚀、路线代价、证据和公共炉承诺，完成准备—下井—带回—结算。
- Success: 首视口在隐藏标题时仍可识别为矿镇当班工具；12 个行动内可完成一轮；所有读数来自服务器权威状态。
- Direction: 煤尘账簿与矿井测绘台。获选构图为 [mine cross-section](../mocks/emberfall-mine-cross-section.png)；field-book 只提供证据账的局部语言。
- Memorable moment: 两个独立证据被青白粉笔线连接，结论盖章可用；青白是唯一超自然高亮。
- Constraints: 不使用旧棕色几何 SVG、玻璃、泛用卡片、聊天气泡模板或脚本外硬编码；移动端先保住班次和行动，再把台账放入宿主管理的 panel。

## Fidelity inventory

| Region | Commitment | Medium |
|---|---|---|
| Shift rail | 时间、深度、灯火、灰蚀、炉存单行可扫读 | semantic HTML + currentColor SVG |
| Mine cross-section | 5–6 矿层节点、路径成本、风险与当前位置 | interactive SVG geometry |
| Active mine scene | 横向劳动空间、偏置人物与真实工具 | generated raster background |
| Incident/testimony log | 来源、时间和证词语法，不用聊天气泡 | semantic HTML |
| Promise ledger | 人、期限、资源与冲突对象 | semantic HTML + paper raster texture |
| Evidence graph | 来源—物证—结论只由确定性状态连边 | interactive SVG + HTML labels |
| Context actions | 动作名、时间、灯耗、灰蚀与风险预检 | semantic buttons |
| Composer | 值班记录输入与结构化 hint | semantic form |

Component grammar: 纸张区域近直角，金属操作件 8–12px 圆角；细铜分隔与大面积无边框纸面互斥；阴影只用于纸张覆盖。标题为中文宋体，数据为窄体无衬线/等宽数字。动作按压像印章下落，reduced motion 保留状态变化但取消位移。
