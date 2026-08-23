# 黑沼地理与六角索引

## 文档性质与来源标记

本文是完整地区的空间参考：17 个原作命名地理区、主要陆路和水路、五英里尺度，以及 75 个 keyed hex 的运行实体与主场景类型都在此建立索引；地点的 canonical 初始事实以链接到的 YAML 实体为准，事件时间契约见 [`events.md`](events.md)。

“移植”表示原稿 Geography 或 Locales 正文明确陈述；“地图阐释”表示依据原始 Blackmarsh Region 地图的地形、海岸、河线与标签判定层级；“运行改编”表示把概率表、冻结镜头或 D&D 数值转换成持续生态、近期证据、Agent 意图或有期限事件。地理区说明均为移植；下表的 hex `placement` 是地图阐释，正文直接点名区域时同时以正文交叉核对；场景类型全部属于运行改编。

## 五英里尺度与空间层级

区域地图每个六角横跨五英里。`placement` 只表达“地点属于哪个地理容器”，不自动表示相邻、可见或瞬间可达；任何旅行仍受 [`world/laws.yaml`](../world/laws.yaml) 的时间和情境因果约束。

以下时间是运行改编的裁决基准，不是固定移动动作：普通旅人沿可靠道路横穿一个六角通常需要约两小时，林地或丘陵约三至四小时，缺乏硬地路径的沼泽、裂谷与高山常需四至八小时或专门工具；骑乘、车队、负重、夜色、天气、伤势和向导会改变结果。河船与海船按船型、流向、风、潮、暗礁和领航知识裁定，不能把五英里简单换算成固定航行秒数。

所有 17 个命名地理区都直接置于 [`blackmarsh-region`](../world/entities/blackmarsh-region.yaml)。每个 keyed hex 也只有一个 spatial parent，但不强求它必须归入 17 个命名区：原图位于未命名平原、丘陵、林地或海岸的坐标可直接置于 `blackmarsh-region`，岛内现场则可置于对应岛屿。跨界影响由事实表达，例如 Rednut River 的空中掠食者会飞入农地，Dragonbone 生物会威胁 Ostrobard 聚落，Grey Sea 风暴会穿过 Sheltered Bay。

原图确认直接归属根区域的未命名地形坐标是 `0309`、`0409`、`0610`、`0616`、`0918`、`1113`、`1506`、`1602`、`1609`、`1706`、`1807`、`2201`、`2203`、`2401`、`2505`、`2509`、`2704`；`1816` 的潟湖沉船归属 Driftwood Isle。

## 十七个命名地理区

| # | 地理区与运行实体 | 原作边界和辨识特征 | keyed hex 主要归属 |
|---:|---|---|---|
| 1 | [Alhert Island](../world/entities/alhert-island.yaml) | 狭长沙洲与灌木障壁岛；初秋 Pyrocantha 可制单次有效且不可叠加的护甲药膏。 | 2015 |
| 2 | [Dragonbone Peaks](../world/entities/dragonbone-peaks.yaml) | 坠山喷射物覆盖西坡；当地普遍相信风化洞穴沿山缘延伸数英里，但尚无全程测绘。 | 1701、1902、1905、2105 |
| 3 | [Driftwood Isle](../world/entities/driftwood-isle.yaml) | 洋流堆积浮木和海上遗失物；东南船骸下藏有身穿 Grand Kingdom 高等贵族式服饰、携王室印记项链的青年遗体，岛上潟湖底另有 Ochre Empire 侦察船残骸。 | 1816 |
| 4 | [Lanis River](../world/entities/lanis-river.yaml) | 从 Southland 北流，入境处宽三英里，深缓且容许船舶和驳船双向通行。 | 0712 |
| 5 | [Pendar Mountains](../world/entities/pendar-mountains.yaml) | White Mountains 支脉，少有人知的谷地居住多支 goblin 部族。 | 0105、0211 |
| 6 | [Rednut River](../world/entities/rednut-river.yaml) | 秋季红果覆盖水面，吸引居民、动物、griffon 与 hippogriff。 | 0302、0702、1002、1103、1302、1305、1503 |
| 7 | [Sandstone Island](../world/entities/sandstone-island.yaml) | 背风侧是撞击震裂的砂岩沟谷，迎风侧过渡为沙丘；裂谷常被用来藏匿财物。 | 无 keyed hex；2706、2707 是更东侧小岛，不归此岛。 |
| 8 | [Sheltered Bay](../world/entities/sheltered-bay.yaml) | 岛链削弱外海风暴，也是进入 Smoking Bay 的唯一海上入口。 | 1316、1515、1914、2114、2410、2411 |
| 9 | [Smoking Bay](../world/entities/smoking-bay.yaml) | 坠山形成的内湾；灾后一个世纪间，蒸汽柱在数百英里外可见，后来虽消退却留下湾名。海床碎石迷宫藏有沉船、未测水道和大型海生物。 | 0909、0912、0913、1107、1112、1306、1307、1309、1406 |
| 10 | [The Black Marshes](../world/entities/black-marshes.yaml) | 南北约十五英里、东西超过五十英里的黑水湖、泥沼与迷宫水道。 | 0214、0413、0415、0515、0814、1014、1213、1214 |
| 11 | [The Crimson Hills](../world/entities/crimson-hills.yaml) | 长期部族战争得名；Bateater、Bloodcrusher 与小氏族共同占据丘陵。 | 1911、2109、2207、2306 |
| 12 | [The Grey Sea](../world/entities/grey-sea.yaml) | 风暴、强流、暗礁与优良渔场并存；Grand Kingdom 海军占优但无法消灭全部 Vasan 与海盗活动。 | 2416、2618、2706、2707、2714 |
| 13 | [The Greywoods](../world/entities/greywoods.yaml) | 千余名精灵居住的灰梣森林，秋季灰种是受严密管理的 Viz 来源。 | 0107、0407、0605、0608、0804 |
| 14 | [The Tave Marshes](../world/entities/tave-marshes.yaml) | 河口、细流与泥沼交织而少有大湖；weretiger 传闻使周边居民避行。 | 1709 |
| 15 | [The White Mountains](../world/entities/white-mountains.yaml) | 向西北延伸的区域已知最高雪峰主脉，Bolzak 在南、Oldan Hold 为北部前哨，盛产猎物与大型掠食者。 | 0217、0318 |
| 16 | [Thornbrush Island](../world/entities/thornbrush-island.yaml) | 背风岸被带刺灌木封锁，野猪踏出的路径形成不断变化的迷宫。 | 无 keyed hex；地理区实体承载生态。 |
| 17 | [The Westwall](../world/entities/westwall.yaml) | 南方是 Vasa Province 西界，北端进入黑沼并居住数支 hill giant 氏族。 | 1217、1518 |

## 道路、河流与航路

原图没有给每条陆路命名，运行世界因此不虚构一套精确道路图。地图可见的硬地走廊提供地图阐释证据：Greywoods 南缘的 Blackoak、Ashdown、Strangeholms 与 Greenton 形成粮食和 Ranger 往来带；北岸的 Wedmor、Camden、Muncaester、Wessex Keep 与 Ethanfeld 形成 Ostrobard 牧业、矿业、市场和边防网络；Inuacus Keep、Jorvik 与 Norbury Castle 构成南部边境接触带；Castle Taldane、Gamla、Daretop 与 Ysby 通过本地道路、河岸和长船维持 Vasan 供给。它们是可判定的路线选择，不是无条件高速传送边。

Lanis River 是原作明确的主航运干线，船只可在 Castle Blackmarsh、Westguard 与 Bolzak 之间双向运输。Rednut River 及 River Eamont 汇流于 Muncaester，承担 Wedmor 盐肉、Camden 铁货、农产和市场客流；Holms Water 串联 Greywoods 南缘农庄，Ruchill Burn 则在 0616 形成深峡并汇入更大的水系。后四条具体连线主要依原图与 locale 文本判读。

Grey Sea 来船必须穿过 Sheltered Bay 才能进入 Smoking Bay。Sheltered Bay 的岛链减弱风浪但制造狭道与横流；Smoking Bay 的碎石海床、0909 漩涡、浅滩和大型生物要求领航；Grey Sea 外航还受强流、暗礁和开局风暴约束。Alhert、Driftwood、Sandstone 与 Thornbrush 等障壁岛改变风浪和视线，因此“直线相邻”不等于存在安全航道。

## 七十五个 keyed hex

场景主类型采用 [`events.md`](events.md#事件分类) 的四类。`deadline_event` 只用于三个已预先承诺的跨地点时钟；其他原作“正在发生”镜头已经成为近期证据、生态压力、地点常态或由 Agent 决定的意图。

| Hex | 运行实体 | 主要归属 | 主类型 | t0 状态口径 | 归属证据 |
|---|---|---|---|---|---|
| 0105 | [Daur Anthar 遗址](../world/entities/hex-0105-daur-anthar.yaml) | Pendar Mountains | `historical_site` | Viz 金属矿与仍履职的土元素守卫持续存在。 | 地图阐释 |
| 0107 | [复仇者行军道](../world/entities/hex-0107-blackoak-march.yaml) | Greywoods | `deadline_event` | Sigrun 纵队已经东进；截止与结果见事件契约。 | 地图阐释 |
| 0211 | [Graptar 的山谷据点](../world/entities/hex-0211-graptars-base.yaml) | Pendar Mountains | `persistent_condition` | 一百五十名 goblin、十二亲卫与 Newcombe 敌意构成持续据点。 | 正文+地图 |
| 0214 | [黑龙进食草甸](../world/entities/hex-0214-black-dragon-meadow.yaml) | Black Marshes | `encounter_ecology` | 母子黑龙把草甸纳入猎区；新鲜鹿尸和双重足迹保留近期证据。 | 地图阐释 |
| 0217 | [Oldan Hold](../world/entities/hex-0217-oldan-hold.yaml) | White Mountains | `persistent_condition` | Bolzak 北部前哨、Viz 探索市场与当期 5–50 名外商持续运作；来源没有季节限定。 | 正文+地图 |
| 0302 | [红果河蛇窟湾](../world/entities/hex-0302-rednut-snake-dens.yaml) | Rednut River | `encounter_ecology` | 原作每行进一百码以六个等概率结果中的三个触发遭遇，触发后按 4:2 区分蛇穴与活动巨蛇。 | 正文+地图 |
| 0309 | [崩毁法师堡](../world/entities/hex-0309-ruined-wizard-keep.yaml) | Blackmarsh Region（未命名地形） | `historical_site` | 失败实验遗址由多只胶怪和大厅中的巨型 black pudding 占据。 | 地图阐释 |
| 0318 | [恶脾野猪谷](../world/entities/hex-0318-boar-valley.yaml) | White Mountains | `encounter_ecology` | 原作每小时以四个等概率结果中的一个触发遭遇，触发后的野猪数为四次独立四结果之和（4–16）。 | 正文+地图 |
| 0407 | [Blackoak Castle](../world/entities/hex-0407-blackoak-castle.yaml) | Greywoods | `persistent_condition` | Rangers 总部、训练场、补给中心、实用魔法学校及跨族驻民。 | 正文+地图 |
| 0409 | [Strangeholms](../world/entities/hex-0409-strangeholms.yaml) | Blackmarsh Region（未命名地形） | `persistent_condition` | 半身人农庄供应 Blackoak，并长期承受西北法师堡生物压力。 | 正文+地图 |
| 0413 | [发光律剑林地](../world/entities/hex-0413-sword-grove.yaml) | Black Marshes | `persistent_condition` | 一百九十名 kobold 围绕不可触碰的发光秩序之剑建立统治与崇拜。 | 正文+地图 |
| 0415 | [Three Sisters](../world/entities/hex-0415-three-sisters.yaml) | Black Marshes | `persistent_condition` | 三名 nixie 姐妹各占一岛并以魅惑、俘虏和交易彼此竞争。 | 正文+地图 |
| 0515 | [Lake King 宫廷](../world/entities/hex-0515-lake-kings-court.yaml) | Black Marshes | `persistent_condition` | 国王、八十名 nixie 与带回三姐妹的赎俘政策持续存在。 | 正文+地图 |
| 0605 | [灰林位面裂口](../world/entities/hex-0605-greywood-rift.yaml) | Greywoods | `persistent_condition` | 四十八对十二的原作战斗成为近期大战痕迹；受损封印、余火和轮值封锁仍在。 | 正文+地图 |
| 0608 | [Ashdown](../world/entities/hex-0608-ashdown.yaml) | Greywoods | `persistent_condition` | 退役 Ranger、现役家属和 Neera 领导的跨族村议会。 | 正文+地图 |
| 0610 | [Greenton](../world/entities/hex-0610-greenton.yaml) | Blackmarsh Region（未命名地形） | `persistent_condition` | Newcombe 首府、Sack 商人村与二十名 constables 维持农产市场。 | 地图阐释 |
| 0616 | [Ruchill Burn 法师遗址](../world/entities/hex-0616-ruchill-conclave.yaml) | Blackmarsh Region（未命名地形） | `historical_site` | 五十英尺峡谷、分层研究所与不安全跨崖桥保留 Bright Empire Viz 结社。 | 正文+地图 |
| 0702 | [商队覆灭地](../world/entities/hex-0702-caravan-killing-ground.yaml) | Rednut River | `historical_site` | troll 已离开固定镜头；余烟、尸体、车辆、足迹与食腐演替仍在变化。 | 地图阐释 |
| 0712 | [Lanis Lighthouse](../world/entities/hex-0712-lanis-lighthouse.yaml) | Lanis River | `historical_site` | 灯塔地下复合体被认为已清空，但四十年没有连续监视。 | 正文+地图 |
| 0804 | [Stardell Falls](../world/entities/hex-0804-stardell-falls.yaml) | Greywoods | `persistent_condition` | Greywood 王廷、Viz 瀑布、双塔和瀑后 Silvanus 神殿。 | 正文+地图 |
| 0814 | [沼泽植物结社遗址](../world/entities/hex-0814-bog-conclave.yaml) | Black Marshes | `historical_site` | 下沉石路、散布住宅与占据生物确实存在；未完成实验和异常植物仍只是未核实报告。 | 正文+地图 |
| 0909 | [烟湾大漩涡](../world/entities/hex-0909-maelstrom.yaml) | Smoking Bay | `persistent_condition` | 水元素主动捕猎，半英里海盆累积船骸和财货。 | 正文+地图 |
| 0912 | [烽火渔岛](../world/entities/hex-0912-watch-island.yaml) | Smoking Bay | `persistent_condition` | 一百名渔民以守望义务换取岛权，南塔接入 Castle Blackmarsh 烽火链。 | 正文+地图 |
| 0913 | [Castle Blackmarsh](../world/entities/hex-0913-castle-blackmarsh.yaml) | Smoking Bay | `persistent_condition` | 最大港城、精灵托管、议会和未清 Atacyl 地下层。 | 正文+地图 |
| 0918 | [Darkheart 法师结社](../world/entities/hex-0918-darkheart-conclave.yaml) | Blackmarsh Region（未命名地形） | `persistent_condition` | Sir Autse Darkheart 与多类亡灵已把 Bright Empire 遗址变成活动据点。 | 地图阐释 |
| 1002 | [Wedmor](../world/entities/hex-1002-wedmor.yaml) | Rednut River | `persistent_condition` | 秋季赶牛、盐肉河运与 Lord Octa 的季节护卫需求正在运作。 | 正文+地图 |
| 1014 | [Chimera 育幼岛](../world/entities/hex-1014-chimera-island.yaml) | Black Marshes | `encounter_ecology` | chimera 群在巢、猎区和饮水点间活动并保卫幼兽。 | 正文+地图 |
| 1103 | [Centaur 劫牛场](../world/entities/hex-1103-centaur-rustling.yaml) | Rednut River | `historical_site` | 十六名 centaur 已转移牛群；蹄印、破栏和牧人报告让追踪继续。 | 地图阐释 |
| 1107 | [Neptar 王窟](../world/entities/hex-1107-neptars-grotto.yaml) | Smoking Bay | `persistent_condition` | 八十六名 merman 正在举行丧子葬仪，死亡与 0909 水元素造成持续压力。 | 正文+地图 |
| 1112 | [Bright Empire 宝船墓场](../world/entities/hex-1112-treasure-fleet-wrecks.yaml) | Smoking Bay | `historical_site` | 十二艘 galleys、黄金、adamant、Viz 货箱与鲨群、海蛇共享海床。 | 正文+地图 |
| 1113 | [Inuacus Keep](../world/entities/hex-1113-inuacus-keep.yaml) | Blackmarsh Region（未命名地形） | `persistent_condition` | 五十人前哨同时面对沼泽生物、Jorvik 和黑沼堡复权政治。 | 正文+地图 |
| 1213 | [Witch Hill](../world/entities/hex-1213-witch-hill.yaml) | Black Marshes | `historical_site` | Ramat 地基、圣矛失载与会移动的走失宠物共同形成可退化证据。 | 正文+地图 |
| 1214 | [Warlock Coven Island](../world/entities/hex-1214-warlock-island.yaml) | Black Marshes | `persistent_condition` | 少数年迈 warlock 维持曾促成 Atacyl 吸血复生的衰败结社。 | 正文+地图 |
| 1217 | [Westwall 巨人家园](../world/entities/hex-1217-hill-giant-steading.yaml) | Westwall | `encounter_ecology` | 八名 hill giant 以家园为中心选择性袭击 Jorvik 与 Norbury 农地。 | 正文+地图 |
| 1302 | [Camden](../world/entities/hex-1302-camden.yaml) | Rednut River | `persistent_condition` | 两百一十四名居民、分散铁矿和兵力摊薄的 Lord Varxis。 | 地图阐释 |
| 1305 | [Muncaester](../world/entities/hex-1305-muncaester.yaml) | Rednut River | `persistent_condition` | 汇流岛首府、跨海市场与 Duke Caedwine 的宴饮政治。 | 正文+地图 |
| 1306 | [Muncaester Fishing Isles](../world/entities/hex-1306-fishing-isles.yaml) | Smoking Bay | `persistent_condition` | 五岛上的捕鱼氏族与绕过公爵税吏的走私网络。 | 正文+地图 |
| 1307 | [Naomi's Island](../world/entities/hex-1307-naomis-island.yaml) | Smoking Bay | `persistent_condition` | Naomi 与 dryads 主动维护原始林岛并执行可改变的排外政策。 | 正文+地图 |
| 1309 | [The Mountain That Fell](../world/entities/hex-1309-mountain-that-fell.yaml) | Smoking Bay | `persistent_condition` | Viz 富集陡岛、Wizard 领地与鎏金机仆巡护持续存在；多类飞行生物来自报告，只有部分活动痕迹可核实，并非全部已确认筑巢。 | 正文+地图 |
| 1316 | [Jorvik](../world/entities/hex-1316-jorvik.yaml) | Sheltered Bay | `persistent_condition` | 纳贡旧盟村、Atacyl 支持者网络、市场和 Maracan 的帝国误导计划。 | 地图阐释 |
| 1406 | [Egil 的长船泊位](../world/entities/hex-1406-egils-longships.yaml) | Smoking Bay | `persistent_condition` | 两船一百五十名战士休整；日出袭击是 Egil 意图而非地点自动时钟。 | 地图阐释 |
| 1503 | [Egbert's Farm](../world/entities/hex-1503-egberts-farm.yaml) | Rednut River | `encounter_ecology` | 九只 hippogriff 的近期牲畜损失与群体觅食路径替代冻结进食镜头。 | 地图阐释 |
| 1506 | [Ethanfeld](../world/entities/hex-1506-ethanfeld.yaml) | Blackmarsh Region（未命名地形） | `persistent_condition` | 渔村、探险补给站和二十人 Dragonbane Company。 | 地图阐释 |
| 1515 | [Mannann 海神祠](../world/entities/hex-1515-mannann-shrine.yaml) | Sheltered Bay | `persistent_condition` | Tavis 与单桅小船持续承担附近水域搜救职责。 | 正文+地图 |
| 1518 | [Norbury Castle](../world/entities/hex-1518-norbury-castle.yaml) | Westwall | `persistent_condition` | Grand Kingdom 五年新堡、一百二十驻军和对 Maracan 日增的怀疑。 | 正文+地图 |
| 1602 | [Wessex Keep](../world/entities/hex-1602-wessex-keep.yaml) | Blackmarsh Region（未命名地形） | `persistent_condition` | 五十人东部边防与 Bedewald 的农地屏障。 | 地图阐释 |
| 1609 | [Shelleater Territory](../world/entities/hex-1609-shelleater-territory.yaml) | Blackmarsh Region（未命名地形） | `persistent_condition` | 三百二十五名 kobold 分属六个争斗氏族，外敌入侵时才协商联合。 | 正文+地图 |
| 1701 | [八首 Hydra 洞穴](../world/entities/hex-1701-hydra-cave.yaml) | Dragonbone Peaks | `persistent_condition` | hydra 会改变猎区，Wessex 巡逻只周期性确认是否南移。 | 正文+地图 |
| 1706 | [Roc 与幼龙残骸地](../world/entities/hex-1706-roc-feeding-ground.yaml) | Blackmarsh Region（未命名地形） | `historical_site` | 幼龙与焦黑第五只 roc 的残骸、四只活 roc 的近期痕迹替代固定进食。 | 正文+地图 |
| 1709 | [Tave 黑色独石](../world/entities/hex-1709-black-monolith.yaml) | Tave Marshes | `persistent_condition` | 坠山同材独石与跨族 weretiger 的满月周期仪式。 | 正文+地图 |
| 1807 | [Brotherhood Ravines](../world/entities/hex-1807-brotherhood-ravines.yaml) | Blackmarsh Region（未命名地形） | `persistent_condition` | 一百五十八名 Raven 精灵、二百名被奴役者与碎片化指挥结构。 | 地图阐释 |
| 1816 | [Ochre Empire 侦察船残骸](../world/entities/hex-1816-ochre-wreck.yaml) | Driftwood Isle | `historical_site` | 五年前沉船、贿赂黄金和远征补给保留失踪调查证据。 | 正文+地图 |
| 1902 | [Scytheback 焚村](../world/entities/hex-1902-burned-silver-settlement.yaml) | Dragonbone Peaks | `historical_site` | 数十年前龙火废墟与周边废弃银矿。 | 地图阐释 |
| 1905 | [Rinisar's Camp](../world/entities/hex-1905-rinisars-camp.yaml) | Dragonbone Peaks | `deadline_event` | 十五名 Raven 精灵准备驱赶 1701 hydra；截止与结果见事件契约。 | 地图阐释 |
| 1911 | [Bateater Caves](../world/entities/hex-1911-bateater-caves.yaml) | Crimson Hills | `persistent_condition` | 一百零五名兽人与向 Brotherhood 支付年贡的政治义务。 | 正文+地图 |
| 1914 | [Dragon Turtle 漂游水域](../world/entities/hex-1914-dragon-turtle-drift.yaml) | Sheltered Bay | `encounter_ecology` | 沉睡 dragon turtle 随潮和惊扰移动，观察只能更新其位置。 | 正文+地图 |
| 2015 | [Egil's Supply Camp](../world/entities/hex-2015-egils-supply-camp.yaml) | Alhert Island | `persistent_condition` | 十名 Vasan 轮守返航补给，撤离由舰队消息和命令决定。 | 地图阐释 |
| 2105 | [Scytheback's Lair](../world/entities/hex-2105-scythebacks-lair.yaml) | Dragonbone Peaks | `persistent_condition` | 古老红龙、Bright Empire 宝藏、Raven 盟约、伴侣和两头在巢后代。 | 正文+地图 |
| 2109 | [The Tribute Place](../world/entities/hex-2109-tribute-place.yaml) | Crimson Hills | `persistent_condition` | Kinkaris、二十守卫与两大兽人部族年贡的强制节点。 | 正文+地图 |
| 2114 | [月贝岛](../world/entities/hex-2114-mermaid-island.yaml) | Sheltered Bay | `persistent_condition` | 五名 mermaid 每逢满月收集 `4d6`（4—24）枚会转化为 Viz 的贝壳，并送往 Azure 王廷。 | 正文+地图 |
| 2201 | [黑石诅咒城堡](../world/entities/hex-2201-black-castle.yaml) | Blackmarsh Region（未命名地形） | `historical_site` | 多代骸骨与满月后重占者重复死亡的周期现象。 | 地图阐释 |
| 2203 | [树台 Pixie 村](../world/entities/hex-2203-pixie-village.yaml) | Blackmarsh Region（未命名地形） | `persistent_condition` | 八十五名 pixie 在树台聚落主动误导和骚扰入侵者。 | 地图阐释 |
| 2207 | [Bloodcrusher Caves](../world/entities/hex-2207-bloodcrusher-caves.yaml) | Crimson Hills | `persistent_condition` | 二百四十三名兽人、Suduk 与 G’mung 的统治及反贡压力。 | 正文+地图 |
| 2306 | [Crimson Ravine Battlefield](../world/entities/hex-2306-ravine-battlefield.yaml) | Crimson Hills | `historical_site` | 十五对三十的近期交战成为伤亡痕迹和持续争夺走廊。 | 正文+地图 |
| 2401 | [巨蚁河谷巢](../world/entities/hex-2401-giant-ant-warrens.yaml) | Blackmarsh Region（未命名地形） | `encounter_ecology` | 三百只 giant ant、密封立方体与约二十分之一 Viz 蚁卵产率。 | 地图阐释 |
| 2410 | [六黑柱浅滩](../world/entities/hex-2410-black-pillars.yaml) | Sheltered Bay | `historical_site` | 六根二十英尺黑柱和接受 Viz 的槽室持续存在，效果未知。 | 正文+地图 |
| 2411 | [Ysby](../world/entities/hex-2411-ysby.yaml) | Sheltered Bay | `persistent_condition` | 八十人渔村保留 Vasan 难民中转站的历史与亲缘。 | 地图阐释 |
| 2416 | [Azure King's Hall](../world/entities/hex-2416-azure-kings-hall.yaml) | Grey Sea | `persistent_condition` | 海山洞窟、三百名 merman、Azure King 与 Sapphire Enchantress 王廷。 | 正文+地图 |
| 2505 | [Castle Taldane](../world/entities/hex-2505-castle-taldane.yaml) | Blackmarsh Region（未命名地形） | `persistent_condition` | 两百人流亡王堡、复国理想与 Ragnar 的耻辱和失能。 | 地图阐释 |
| 2509 | [Gamla](../world/entities/hex-2509-gamla.yaml) | Blackmarsh Region（未命名地形） | `persistent_condition` | 四百零五人的 Vasan 农区，以西侧沼泽屏障和肥沃土地获得有限繁荣。 | 地图阐释 |
| 2618 | [Ochre Empire 搜索舰](../world/entities/hex-2618-ochre-scout-ship.yaml) | Grey Sea | `deadline_event` | Travvarn 与 Devers 已驶向黑沼；截止与结果见事件契约。 | 地图阐释 |
| 2704 | [Daretop](../world/entities/hex-2704-daretop.yaml) | Blackmarsh Region（未命名地形） | `persistent_condition` | 四百一十五人的 Vasan 粮食产地，是 Castle Taldane 的主要供应节点。 | 地图阐释 |
| 2706 | [Giant Crab Hunting Isle](../world/entities/hex-2706-crab-island.yaml) | Grey Sea | `encounter_ecology` | giant crab 种群与四个 Vasan 聚落的周期捕猎。 | 地图阐释 |
| 2707 | [Kostbera's Island](../world/entities/hex-2707-kostberas-island.yaml) | Grey Sea | `persistent_condition` | 独居预言者以补给交换烟火占兆；解释不等于 canonical truth。 | 地图阐释 |
| 2714 | [晶体骨架报告点](../world/entities/hex-2714-crystal-skeleton.yaml) | Grey Sea | `persistent_condition` | 跨年报告把百英尺海底晶体骨架描述得更完整；水面持续冒泡，但骨架是否自行复原及其机制均未决。 | 正文+地图 |

## 覆盖与边界

上表恰好覆盖 [`source-ledger.md`](source-ledger.md#六角地点索引) 的 75 个坐标，每个坐标只有一个 `hex-coordinate` 事实和一个 spatial parent；该父级可以是命名地理区、根 `blackmarsh-region` 或具体岛屿。没有 keyed hex 的 Sandstone Island 与 Thornbrush Island 仍是完整运行实体；其地貌与生态不需要虚构一个原作不存在的编号，Driftwood Isle 则以 `1816` 承载岛上潟湖沉船。

原图坐标只承担身份和检索，不表示玩家必须按编号探索。地点内的具名人物可以离开，聚合人口和兽群可以迁移、分裂或受损，遗址可以被重新占据，航船会越过六角；后续 canonical truth 应更新真实 `placement` 或相关事实，而不是为了保留本索引的开局画面而冻结世界。
