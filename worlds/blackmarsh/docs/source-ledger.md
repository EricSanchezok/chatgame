# Blackmarsh 来源账本

## 权威来源

提取基于 Robert Conley 发布的 *Blackmarsh* version 11 Markdown 原稿，文件和许可信息见 [`../ATTRIBUTION.md`](../ATTRIBUTION.md)。原始地图用于核对六角坐标、道路、水系、聚落和区域相对位置；地图图片不进入严格运行目录，地点关系由实体层级与事实表达。

本账本使用三种标记：“移植”表示上游明确陈述；“阐释”表示为消除歧义或变成可运行状态所作的保守推演；“原创”表示为补齐自主 Agent、起始时刻或引擎表达而新增的材料。

## 逐章覆盖

| 原稿范围 | 内容 | 世界中的家 | 处理 |
|---|---|---|---|
| Introduction，行 1–80 | 六角沙盒、NPC 动机、无人干预时间线、后果累积 | [`design-brief.md`](design-brief.md) | 移植为设计原则 |
| Overview，行 82–195 | Mountain That Fell、Bright Empire、The Shattering、四类人类聚落、Viz | `world-bible.md`、`world/laws.yaml`、`world/mechanics.yaml` | 移植并调和年代 |
| Geography，行 197–339 | 17 个命名地理区域 | `geography.md`、地理实体 | 移植 |
| Rumors，行 340–363 | 20 条真假传闻 | `knowledge-and-secrets.md`、相关 Agent belief | 移植，真假留在认知层；玩家开局不自动获得传闻池 |
| Locales，行 364–1030 | 75 个六角地点 | `geography.md`、六角实体与 Agent | 全量移植 |
| Castle Blackmarsh Establishments，行 588–693 | 11 个城内机构与场所 | `factions.md`、城内实体与 Agent | 全量移植 |
| OGL 与 CC BY，行 1032–1516 | 上游授权 | [`../ATTRIBUTION.md`](../ATTRIBUTION.md) | 采用 CC BY 4.0 路径 |

## 六角地点索引

以下 75 个编号全部进入内容清单。设计文档负责索引与来源解释；可变人口、编成、认知和行动只在对应运行主体拥有 canonical 事实，六角实体只拥有坐标、稳定场景与现场证据。

```text
01: 0105 0107
02: 0211 0214 0217
03: 0302 0309 0318
04: 0407 0409 0413 0415
05: 0515
06: 0605 0608 0610 0616
07: 0702 0712
08: 0804 0814
09: 0909 0912 0913 0918
10: 1002 1014
11: 1103 1107 1112 1113
12: 1213 1214 1217
13: 1302 1305 1306 1307 1309 1316
14: 1406
15: 1503 1506 1515 1518
16: 1602 1609
17: 1701 1706 1709
18: 1807 1816
19: 1902 1905 1911 1914
20: 2015
21: 2105 2109 2114
22: 2201 2203 2207
23: 2306
24: 2401 2410 2411 2416
25: 2505 2509
26: 2618
27: 2704 2706 2707 2714
```

## 黑沼堡机构索引

1. Blackmarsh Castle
2. Temple of Thoth
3. Temple of Thor
4. Merry Legs Banquet Hall
5. The Scholar’s Inn
6. The Viz Club
7. Dax Brothers Outfitters
8. Emporium of the Strange and Arcane
9. The Abrams Company
10. The Blackmarsh Company of Adventurers
11. The Company of Honorable Men

## 明确排除与替换

- Witch Hill 的 *The Ruins of Ramat* 外部模组不属于来源；只保留 Blackmarsh 原稿自身陈述的遗址、失踪宠物和圣矛传说。
- 职业等级、HD、阵营字母、AC、固定怪物概率和金价不是运行态事实；它们只帮助判断相对威胁、资源与社会地位。
- `Cee-Three` 是上游对机械仆从的明确称呼；运行实体保留该名称，并用 `gilded-construct` 与职责事实表达其世界内身份，不引入名称之外的第三方设定。
- 原稿把 Mountain That Fell 同时写作约两千年前与精灵力量延续两千五百年；运行世界采用“约两千五百年前”，其余相对年代保持原意。
- 原稿偶见 `Oldan Hold`/`Olden Hold`、`Actacyl`/`Atacyl`、`Taldane`/`Taldene` 拼写差异；运行 ID 分别统一为 `oldan-hold`、`atacyl-oathbinder`、`castle-taldane`，展示名保留最常见拼写。

## 新增内容的来源级别

城内机构负责人、部分无名部族代表、每个 Agent 的私有证据和三个开局截止的精确秒数属于原创；从职位、既有盟敌和现场局势推出的短期目标属于阐释。开局距满月 `518,400` 秒与朔望周期 `2,551,443` 秒也是原创日历标定，只用于让原作三个满月现象共享可运行时间。0605 大战后的受损临时封印与精灵轮值是避免冻结战斗镜头的原创开局后果，不是上游明示结局；其参战数量和位面裂口来自上游。

原作的随机数量不作为旧规则表达式进入运行包，但保留分布语义：2114 月贝产量是四次独立六结果之和（4–24）；Oldan Hold 当期外来商人是五次独立十结果之和（5–50），没有季节限定；0318 每小时以四个等概率结果中的一个触发遭遇，触发后的野猪数是四次独立四结果之和（4–16）；0302 每百码以六个等概率结果中的三个触发遭遇，触发后再以 4:2 权重区分蛇穴与活动巨蛇。具体值在需要时通过可复现承诺产生。Castle Blackmarsh 下层、Muncaester 北方商路、Camden 铁料运输线与失踪 Ochre 远征实体属于为避免“整堡/整河冒充具体概念”而作的结构化阐释。

除上游明示的人口、队伍/生物数量、物件、Viz 数量与报价外，实体的 `vitality`、Rating 以及可支配 `coin`、`provisions`、`viz` 初值都是为通用运行机制做的改编数值，不应倒推成原作统计。任何原创补写都不得改变上游明确的统治关系、人口、资源、历史事件和地点坐标。
