# 初始事件与时间推进

## 事件分类

原作六角条目混合了长期地点、历史遗迹、生态遭遇和“发现时正在发生”的镜头。运行世界为每个地点采用一种主类型，避免所有镜头在玩家抵达前永久冻结。

- `persistent_condition`：聚落、政权、巢穴、贡赋与长期异常，持续存在但会被行动改变。
- `historical_site`：遗迹、沉船、废矿与已发生事件留下的证据，除非主体重新利用，不自行推进。
- `encounter_ecology`：野兽密度、季节活动与区域危险，为裁判提供遭遇原因，不按固定概率自动刷怪。
- `deadline_event`：已经有行动主体、准备状态和明确时间压力的局势；达到或越过截止后必须发生、取消或因新原因改变。

全部 75 个六角的类型和空间归属由 [`geography.md`](geography.md) 统一记录。

## 自然日历

月相由 `blackmarsh-region` 的唯一锚点和 `lunar-calendar` 硬规则推进：t0 为盈凸月，六天后到下一次满月，随后按统一朔望周期重复。它驱动 2114 月贝转化、1709 weretiger 集会和 2201 黑堡杀戮现象，但不是任何 Agent “拥有”的行动时钟。`lunar-last-settled-node` 从 -1 起记录全局最后结算节点；时间达到或越过满月时，仍须根据当时的贝壳、参与者、占据者与因果条件原子提交真实结果并推进节点，没有对象时不能凭周期凭空制造库存、伤亡或到场者。Tave 仪式圈另以 `lunar-last-gathered-node` 证明本节点集会已完成，但不把聚合共同体永久搬到独石；其常态 placement 继续表示成员分散所在的沼泽。黑堡以 `lunar-last-evaluated-node` 记录每次条件检查，因此空堡也会完成检查但不会凭空产生死者，同一节点不能重复触发。

## 三个开局时钟

开局只预先承诺三个跨地点事件时钟。`deadline-seconds` 是从 `elapsedSeconds = 0` 计算的绝对阈值，不是相对剩余秒数；每个截止主体唯一持有一个 `operation-state` 和一个 `operation-target`。主体可以提前、推迟、泄露、取消或被阻止，但不能在截止后仍保持 `preparing` 或 `in-progress`。

### Sigrun 进军 Blackoak

Sigrun the Boneless 正带领一百一十五名 brigands 向 Blackoak Castle 推进，公开理由是向 Rangers 复仇。`sigrun-brigand-column` 以 `in-progress` 持有进军状态、以 Blackoak Castle 为目标，并在绝对阈值 `36,000` 结算是否抵达可发动攻击的位置。Sigrun、斥候、天气、补给、谈判和 Rangers 的反应都能改变结果。

### Raven 驱赶八首 Hydra

Rinisar Anothil 的十五名 Raven 精灵已经在 Dragonbone Peaks 建立营地，准备惊扰 `1701` 的八首 Hydra 并把它赶向 Ostrobard 土地。`rinisar-raven-cell` 以 `preparing` 持有行动状态、以八首 Hydra 为直接目标，并在绝对阈值 `64,800` 结算侦察、诱饵和撤退准备。Rinisar 必须在内部暴露风险和行动收益之间取舍，计划不是自动成功的陷阱脚本。

### Ochre 搜索船抵达

Lord Travvarn 与 Archon Devers 正率船寻找五年前失踪的 Ochre Empire 侦察队。`ochre-search-expedition` 以 `in-progress` 持有航段状态、以 Sheltered Bay 外海为本段目标，并在绝对阈值 `108,000` 结算是否进入可被沿岸势力稳定发现的水域；改道、受损、被引航或遭拦截会改变截止与入口。

## 由 Agent 决定的近期行动

Egil Longhair 原计划次日日出袭击，但它是他的当前意图而非独立自动时钟。今夜风暴、目标情报、船员士气和 Vasan 政治都可能让他保留、替换或放弃行动；只有最终联合行动与 Truth 提交才能让袭击成为世界事实。

Chief Yngvar 正考虑挑战或叛乱，Hamdir 不认同父亲的忠王立场，King Suduk 厌恶贡赋，Sir Causari 要求人类复权。这些都是 Agent 目标和信念，不是倒数结束后必然爆发的剧情。

## 转为背景或生态的原作镜头

黑龙母子进食、精灵与 flame demons 交战、trolls 吞食商队、centaurs 劫牛、hippogriffs 吃家畜、rocs 吞食幼龙、berserkers 与 orcs 战斗等镜头被表达为近期痕迹、已经造成的损失、长期危险或条件触发事件。它们仍能产生故事，但不会在世界时间中无限维持同一姿势。

漂入海湾的 dragon turtle 与正在进食的野兽归入生态事件；只有当迁徙、天气、食物或行动让其与当前地点发生因果接触时，Truth Engine 才需要生成具体遭遇。

## 截止后的完整性要求

任何达到或越过时钟截止的已提交步骤都必须通过 `deadline-integrity` 在同一原子提交中把对应 `operation-state` 更新为 `implemented`、`blocked` 或 `cancelled` 并移除截止，或以新的因果依据替换截止；实际改变的地点证据也必须同步提交。不能只在叙事中声称袭击、抵达或计划失败而保留旧准备状态；不能为了维持原作场景把 `elapsedSeconds` 停在截止前；不能让不在场 Agent 凭空知道结果。地点不会为了“同步”而复制主体的意图或编成。
