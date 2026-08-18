# 判定机制（Resolution Mechanics）方法学调研：动作成功/失败如何判定

> 调研日期：2026-08-18
> 调研者：research-scout（本文只做调研与报告，不产出决策）
> 用途：为 chatgame（剧本驱动的 AI 聊天游戏：引擎管规则/状态，LLM 管叙事）的判定模块设计提供依据。现有 spec（script-format.md v1.0）已定义五种 resolve 类型——`stat_check`（d20+属性 vs DC）、`skill_check`（d20+技能 vs DC）、`opposed_check`（对抗检定）、`auto`、`narrative_only`——本文回答五个问题：① 经典判定体系各自优劣与适用场景；② 判定权归属（LLM vs 规则引擎）；③ 自由文本→判定的管线；④ 文字战斗回合设计；⑤ 防作弊/超模请求处理。
> 相关性标注：**高** = 直接决定引擎判定模块设计；**中** = 提供局部设计依据；**低** = 背景参考。
> 来源类别：经典规则书及规则社区（D&D 5e、GURPS、CoC 7e、WoD/CoD、Blades in the Dark、MUD/Fallen London）、学术论文（arXiv 2024–2026）、行业报道与社区实践（Hidden Door、AI Dungeon）。规则书为权威一手来源但需注意版本时效（5e 2014/2024 两版并存）；行业产品内部实现多为二手报道，已标注。
> 关联调研：判定权的学术证据与 [game-theory-academic.md](2026-08-18-game-theory-academic.md)（T11 受控自主、T12 一致性承诺、T21 世界模型、T22 PDVA 架构）交叉，本文侧重判定机制设计本身；行业产品现状见 [similar-ai-games.md](2026-08-18-similar-ai-games.md)。

---

## 0. 结论速览

1. **判定机制的关键不是骰子形状，而是"谁裁决、效果从哪来"**。聊天游戏的判定必须由引擎确定性裁决：LLM 只做意图解析建议与叙事演出（§3）。
2. 五种 resolve 类型均有成熟先例支撑；`opposed_check` 建议补充"被动 DC"变体（10+对方修正）并明确平手语义（§2.2）；`narrative_only` 应最小化（§2.7）。
3. **意图合法性检查（动作是否存在、目标是否在场、是否被禁止）必须由引擎确定性代码做**，不能交给 LLM——有直接证据（LLM 裁判被"伪逻辑"话术攻破；LLM 长期一致性差）（§3.1、§4.2）。
4. 战斗用回合制"意图→判定→后果"，数值从简；hp 归零按 run.yaml 三策略（soft_failure / world_continue / hard_reset）处理；**每次行动必须消耗时间或行动点**，否则自由文本无限刷（§5）。
5. 防作弊靠三层：**动作词表映射约束 + 效果来源约束 + 世界规则拒绝**；超模请求用 Blades 式"风险×效果"调档而非硬拒（§6）。

---

## 1. 调研范围

### 1.1 方法
- 经典体系：以官方规则书/官方 SRD 页为权威来源，辅以高票社区分析（RPG StackExchange、规则博客）解释数学性质（方差、成功率）。
- 判定权归属：以 2024–2026 年 arXiv 实证为主（NCP-Bench、RPGBench、CoC-Seduce、LLM-as-Judge 偏见系列），行业侧以 Hidden Door（Forbes 2025-08）、AI Dungeon（社区脚本实证）为案例。
- 管线/战斗/防作弊：综合 IF 解析器传统（Inform 7/TextWorld/NAIL）、MUD 战斗工程（DikuMUD、Achaea）、Fallen London 行动点制与威胁条、Orchestrated Reality 的 PDVA 管道。

### 1.2 未覆盖
- 未读完整规则书原文（仅规则百科/官方 SRD 页面与高票社区解析）；CoC 7e 与 GURPS 的细节以二手转述为准。
- 未覆盖电子游戏中的实时战斗系统（动作游戏/格斗）；本文只处理"文字战斗"回合制问题。
- 未做原创数学推导；所有概率数值均来自标注来源。

---

## 2. 经典判定方法学对比

### 2.1 d20 + 修正 vs DC（D&D 5e）——相关性：高

**机制**：掷 d20 + 属性修正（+技能熟练加值），结果 ≥ DC 即成功。官方 DC 刻度（PHB p.174 / DMG p.238）：5=非常容易、10=容易、15=中等、20=困难、25=很难、30=几乎不可能；DMG 同时给出实用建议"想象世界中的情境，在 10–20 之间选一个数"（2014 DMG p.238，SlyFlourish 引用）；2024 DMG 建议不要把豁免 DC 设到 10 以下或 20 以上（thegamer 转述）。

**数学**：无修正时 DC 10 成功率 55%（需掷 ≥10）、DC 15 为 30%、DC 20 为 5%；+5 修正时对应 80%/55%/30%。**优势/劣势**（掷两次取高/低）平均等价于约 +3.3/−3.3（平均值 13.825 / 7.175 vs 单掷 10.5）；对成功率的最大影响在中段 DC（DC 10 处 +约 24.75pp），对极高/极低 DC 影响小（Columbia Stat Modeling 2014；AnyDice；EpicWinDND）。注意：5e 官方规则中**属性检定没有大成功/大失败**（natural 20/1 只作用于攻击骰与豁免中的部分规则）——社区常见误用（blackcitadelrpg）。

**优劣**：
- 优点：单一线性骰，加减修正直观（+2 有利、DC −2 更难），**作者和玩家都容易心算**；DC 是"世界难度"的独立刻度，与角色强度解耦——同一扇门对谁都一样难，符合"世界真实"的直觉；引擎实现是纯整数比较，最易测试。
- 缺点：单骰方差大（均匀分布），高技能角色也可能连环失败；线性概率不符合"熟练者更稳定"的直觉（GURPS 的钟形曲线更贴此直觉）；DC 值本身需要作者判断，"凭空拍数"是新手 GM 常见痛点。

**对 chatgame**：现有 `stat_check`/`skill_check`（d20 + 属性/技能 vs DC）正是 5e 模型，成熟且与剧本声明式 DC 契合——**保留**。建议：剧本作者写 DC 时给出语义刻度（10 容易/15 中等/20 困难）帮助校准；优势/劣势可作为"条件代数"之外的轻量修正手段（如"潜行时对方失明 → 优势"），但应作为引擎可枚举的修饰符而非自由文本。

### 2.2 对抗检定（opposed roll）——相关性：高

**机制（5e）**：双方各掷 d20+修正，高者胜；**平手时局面维持原状**（主动方不成功）（Basic Rules；RPG.SE 113313）。5e 中对抗检定使用极少（擒抱、推撞、隐匿 vs 被动察觉等），多数"人与人对抗"被设计为主动方掷骰 vs **被动值**（10+对方相关修正，如 AC、被动察觉、法术 DC=8+修正）——"被动一方视为掷出 10"是 5e 底层设计（chaoticneutraldm 长文）。

**数学**：双方都掷骰使结果方差显著大于被动 DC 方案。社区分析（chaoticneutraldm 2019；Reddit r/dndnext "Contested Checks are Bad Design"）指出：对抗检定把"有意义的悬念"（我能骗过他吗）与"无意义的噪声"（纯运气翻转）混在一起，且会**系统性削弱属性优势**——差距小的对抗结果接近抛硬币。

**适用场景**（共识）：双方"同时、主动"的竞争（赛跑、掰手腕、互相藏找）适合对抗；"一方主动发起、另一方被动抵御"（说服守卫、偷窃、攻击）适合被动 DC。CoC 7e 用另一种等价方案：**对手技能决定难度档**（对手技能 ≥50 时难度升为 Hard=一半值，≥90 升为 Extreme=五分之一），玩家只需掷一次（philgamer 转述 Keeper Rulebook）。

**对 chatgame**：现有 `opposed_check`（如 steal 对 stealth、deceive 对 deception）有戏剧价值（聊天场景里"双骰对抗"的紧张感），但建议：
1. 提供**被动变体**：`opposed_check` 可配置 `passive: true`（= 10 + 对方属性/技能 vs 玩家 d20+修正），引擎实现成本为零（就是 DC=10+np stat 的 stat_check）；
2. **明确平手语义**：默认"主动方失败/局面不变"（5e 语义），剧本可覆盖；
3. 文档标注方差警告：属性差距小的对抗接近 50/50，剧本作者想要"更可预测"时用被动变体。

### 2.3 百分骰 roll-under（CoC 7e）——相关性：中

**机制**：掷 d100 ≤ 技能值即成功；技能值即成功率百分比，直观。难度分档：Regular（≤技能）、Hard（≤技能/2）、Extreme（≤技能/5）；掷 01 为大成功，技能 ≤49 时 96–100、≥50 时 100 为大失败。**对抗**：比较成功等级（Crit > Extreme > Hard > Regular > Failure），平手比技能值（philgamer / 21st Century Philosopher 转述 Keeper Rulebook）。**Push**：失败后可推（重试），但守则要求**先预示失败后果**，推后再失败按大失败处理——"用更高代价换第二次机会"的成熟模板。

**优劣**：百分比直接可读（60% 就是六成概率），成功等级提供"质量梯度"（大成功/普通成功/失败/大失败）适合叙事演出；但双骰实现略繁，d100 的心算不如 d20 直观；等级比较规则对引擎是枚举比较，反而简单。

**对 chatgame**：不推荐替换 d20 主骰（剧本作者生态与直觉以 d20 为主），但两点可借鉴：**成功质量梯度**（大成功/成功/失败/大失败 → 对应不同效果量级）和 **Push 重试语义**（处理玩家反复尝试，见 §6.5）。

### 2.4 3d6 roll-under（GURPS）——相关性：中

**机制**：3d6 求和 ≤ 有效技能即成功。3d6 的钟形分布把大多数结果集中在 9–12，**技能每 +1 都显著改变成功率**，熟练者表现稳定、极端值罕见（大成功/大失败只占 ~1.8%）；有效技能 <3 时不可尝试（防御例外）（GURPS Wiki；SJGames 论坛）。

**优劣**：最符合"技能反映稳定性"的直觉，惩罚/加值语义精细；但钟形分布下 DC 微调极敏感（+1 ≈ 大影响），剧本作者难以凭直觉调参；三骰求和也比单骰繁。

**对 chatgame**：不采用为主骰；若剧本需要"熟练者稳定、菜鸟搏命"的质感，可把 GURPS 思路做成 d20 的**二次掷骰修正**（如"技能 ≥15 时取优势"）——本质已由优势/劣势覆盖。相关性中。

### 2.5 骰池（WoD / Chronicles of Darkness）——相关性：中

**机制**：骰池 = 属性点数 + 技能点数（个位数 d10）。旧版可变目标数（TN 6/7）；CoD 固定 TN 8，**难度 = 需要的成功数**（每骰 ≥8 记 1 成功，10 重掷可再成功，10-again）；5+ 成功 = exceptional success；池被扣空后仍可掷 1 个 d10 的 **chance roll**（仅 10 成功、1 为戏剧性失败）（Wikipedia Storytelling System；nwod wiki）。**战斗直接挂钩**：攻击掷骰的每个成功 = 1 点伤害（对抗防御后）。

**优劣**：骰池天然给出"成功质量"（成功数可映射效果量级），支持修正/惩罚（加减骰）不改变目标数；但实现与心算成本最高，且概率分布对作者不直观（TN8 单骰 30%），骰池规模与成功率的关系非线性。

**对 chatgame**：骰池不适合作主骰；但"**成功数 = 效果量级**"思想可低配复刻——d20 判定可输出"余量"（掷出值 − DC 的差）作为效果强度（见 §5.2 伤害建议）。相关性中。

### 2.6 风险 × 效果双轴（Blades in the Dark）——相关性：高

**机制**：玩家声明行动后，GM 同时设定 **Position（风险）**：Controlled / Risky / Desperate 与 **Effect（效果）**：Limited / Standard / Great；默认 Risky/Standard。掷骰结果：6=完全成功，4/5=**部分成功（成功但付代价）**，1–3=失败（伴随后果，且常比失败本身更糟的是"处境恶化"）。（官方 SRD bladesinthedark.com；Reddit 实例贴）。核心原则："**没有风险就不掷骰**"；玩家永远可以尝试任何事，但 GM 决定风险与效果档位——"想用 Wreck（破坏）来交朋友？可以，但那是 Desperate/Limited"（SRD 原例）。

**优劣**：双轴把"能否成功"与"成功到什么程度/付出什么代价"解耦，是处理**超模/奇葩请求**的现成答案——不必拒绝玩家，只需把效果调到 Limited 或把风险调到 Desperate；部分成功（4/5）是叙事游戏的"失败推进"利器（失败 ≠ 停滞，而是局面恶化）。

**对 chatgame**：**强烈建议引入**，作为 `resolve` 之外的**结果修饰维度**：引擎在 stat_check 判定后按结果给叙事层输出"成功等级 + 代价档位"（可配置：普通失败 = 无效果；部分成功 = 效果减半/附带代价事件；大成功 = 效果加倍）。现有 spec 的效果代数（附录 D）可原样承接（部分成功 = 应用一半效果 + 触发一个代价 flag/事件）。这与当前 spec 完全兼容，只增加一个结果枚举（fail / partial / success / crit）。相关性高。

### 2.7 对比表与 chatgame 适用性

| 体系 | 骰型 | 成败判据 | 难度表达 | 成功质量 | 对 chatgame |
|---|---|---|---|---|---|
| D&D 5e | d20 | ≥DC（roll high） | 世界 DC 刻度 | 无（纯成败） | **主骰，保留 stat/skill_check** |
| 5e 对抗 | d20×2 | 高者胜，平手局面不变 | 对手属性 | 无 | opposed_check 保留，补被动变体 |
| CoC 7e | d100 | ≤技能（roll low） | 技能×1/2、×1/5 | 四级成功 | 借鉴质量梯度、Push 重试 |
| GURPS | 3d6 | ≤技能 | 修正值 | 边缘临界 | 不采用（钟形对作者不友好） |
| WoD/CoD | d10 池 | 成功数 ≥ 需求 | 需求成功数 | 成功数 | 借鉴"余量=效果量级" |
| Blades | d6 池 | 6/4-5/1-3 | 风险+效果双轴 | 部分成功 | **引入 position/effect 作为结果修饰** |
| 无骰 | — | 无风险即成功 | — | — | auto 先例（5e/CoC 均建议 trivial 不掷骰） |

**对五种 resolve 类型的总体评估**：
- `stat_check` / `skill_check`：成熟、保留；补 DC 语义刻度建议。
- `opposed_check`：保留，补 `passive: true` 变体 + 平手语义说明。
- `auto`：与"无风险不掷骰"共识一致；条件是"真的没有失败可能"，而非"作者懒得写 DC"。
- `narrative_only`：**最危险的一类**——等于把成败交给 LLM（证据见 §3.1）。建议限制为"**无状态后果的社交/氛围行为**"（闲聊、姿态），且剧本必须声明"本动作不改变任何引擎状态"；任何触碰状态（关系值、物品、位置）的动作都不应使用 narrative_only。

---

## 3. 判定权归属：LLM 判定 vs 规则引擎判定

### 3.1 证据：LLM 裁决为什么不可靠——相关性：高

**长期一致性（最硬证据）**：NCP-Bench（Ma et al., ICML 2026, arXiv:2608.08160）——100 个电影梗概派生的互动叙事环境，LLM 作为叙述者自由回应玩家，固定审计器检查"事实冲突 / 承诺保持 / 玩家输入冲突"。结果：最强模型 GPT-5.2 在 20 轮后承诺存活率仅 **42%**；各模型事实冲突率 **40%–68%**；100 轮内几乎没有 run 满足全部剧情承诺。结论原文："语言流畅度 ≠ 逻辑承诺保持"。**这正是 chatgame 要防的：如果成败由 LLM 文本裁决，20 轮后同一个检定同一套属性可能得到相反结果。**

**规则执行能力**：RPGBench（Yu et al., 2025-02, arXiv:2502.00595）——LLM 作为文字 RPG 引擎，用结构化事件-状态表示要求其"连续多轮更新状态并执行规则"。结果：**LLM 能产出吸引人的故事，但难以实现一致、可验证的规则机制，尤其在长/复杂场景**。状态更新遗漏、变量违背是系统性问题。

**LLM 裁判可被话术攻破**：CoC-Seduce（Chen et al., 2026, arXiv:2607.02802，转述自 game-theory-academic.md T12）——20 个目标裁判模型在 TRPG 场景中被玩家"伪逻辑"修辞注入普遍攻破（如用诡辩迫使裁判改判）。**若合法性判断由 LLM 做，玩家用文字"说服"裁判绕过规则是必然发生的攻击面。**

**LLM-as-judge 系统性偏见**（若用 LLM 打分判定过程）：位置偏见（2406.07791，150k 实例）、提示敏感性（2604.23478 JudgeSense：9 个 judge 中 8 个在 pairwise 任务出现退化 always-A）、"高重测可靠性与强位置偏见并存"（2606.19544，kappa 缩水 33–41pp）。**用 LLM 做二值判定（过/不过）会引入这些偏见且不可审计。**

**状态追踪失败**：Flux（Alaswad et al., 2026, arXiv:2605.23972，转述自 T21）——LLM 直接推理玩长程游戏胜率 ~11%，同一任务显式状态模拟器 ~79%。**长程状态下 LLM 数值推理不可靠。**

**反方证据（LLM 能做什么）**：FIREBALL（Zhu et al., 2023, arXiv:2305.01528）——给 LLM 真实游戏状态信息可提升生成质量；微调后 LLM 可以**生成可执行的 Avrae 规则命令**（自然语言→命令映射是可行的）。CALYPSO（2308.07540）——行业实证 LLM 适合做 **DM 助手**（信息检索、灵感），人保留裁决权。这些支持"LLM 负责解析意图、生成叙事，不负责裁决"的分工。

### 3.2 行业实际——相关性：高

- **AI Dungeon（Latitude）**：无规则引擎、无真实状态——背包/血量/时间都在文本里，结果是众所周知的**一致性漂移**（similar-ai-games.md 已详述）。**社区自发补救**：第三方脚本（AID-dice-rolling，GitHub）把 `!skillcheck`、`!attack`、`!battle` 命令"焊"进 LLM 管线——攻击公式 `攻击者属性 + d20 − 防御者属性`，通过改写输入/输出文本强加确定性判定。**这个事实本身说明：玩家要规则，纯 LLM 判定满足不了。**
- **Hidden Door**：把授权世界观改编为 "**structured, rules-based environment**"，玩家角色与叙事"operate within the logic of the original work"；团队为每部作品人工构建 tropes/plot beats/characters/rules 的结构化表示；"AI replaces the game master"（Forbes, 2025-08-14）。**行业最接近的竞品走的正是"规则化环境 + AI 演出"路线，而非"LLM 自由判定"。**
- **学术架构共识**：Orchestrated Reality（2606.16014）把 LLM 游戏世界形式化为参数化动作 POMDP：状态 = 引擎规范 JSON；动作 = (意图类型 k, 结构化参数 x_k)；**LLM 只能提交"增量提案"，经 计划-差异-校验-应用（PDVA）管道由引擎落地**；玩家只看到叙事投影。这与 chatgame 的"条件代数 + 效果代数 + 输出校验"同构。Bounded Autonomy（2604.04703）同样要求 NPC 动作经"落地管道"翻译为可校验指令，非法动作拒绝回退。

### 3.3 混合分工模型与 chatgame 建议——相关性：高

**判定权光谱**（从左到右 = 引擎确定性递增）：
1. **纯 LLM 判定**（AI Dungeon 默认）→ 一致性崩溃，否决；
2. **LLM 提议 + 引擎复核**（LLM 建议"这算 stealth 检定 DC 13"，引擎校验并执行）→ 保留创造性但受审计，**可作为进阶选项**（需引擎对"LLM 提议的 DC/动作"做白名单校验）；
3. **LLM 解析 + 引擎判定**（LLM 把玩家文本解析为"动作 id + 目标 + 参数"，引擎查表执行）→ **推荐默认**；
4. **纯引擎判定**（命令式，如 `/attack`）→ 确定性最强，但损失聊天自然度，仅用于调试/无障碍。

**对 chatgame 的具体建议**：
- 成败判定（过/不过/部分成功）与效果结算（效果代数应用）**永远在引擎**——对应现 spec 的 `resolve` + `effects` + 条件/效果代数。
- LLM 负责：① 把玩家自由文本解析为结构化动作提案（FIREBALL 证明可行）；② 把判定结果演出为叙事（含失败叙事、部分成功代价描写）。对应现 spec 的 `llm_freedom`。
- `llm_freedom` 三档需澄清语义（见 §8 未解决问题 3）：spec 中 `attack` 示例为 `llm_freedom: process`（"过程即兴、结果 LLM 定"）同时带 `effects: hp −5`——若"结果"指成败与数值，则与引擎结算冲突；建议把 `process` 语义收窄为"过程叙事自由，结果（成败/数值）引擎定"，或重命名为 `narration` 变体。
- **可审计性**：每次判定应生成结构化日志（动作 id、修正、骰值、DC、结果、效果清单）——这是"LLM 判定"永远给不了的（LLM 无骰值、无日志）。日志同时是测试与玩家复盘的基础。

---

## 4. 自由文本 → 判定管线设计建议

### 4.1 管线总览——相关性：高

```
玩家自由文本
  → ① 意图解析（LLM 建议 / 引擎模板匹配）
  → ② 动作选择与参数化（动作 id + 目标 + 参数）    [引擎白名单]
  → ③ 意图合法性检查（动作存在/启用、目标在场、条件代数、资源、冷却、世界规则）
                                                      [引擎确定性]
  → ④ 判定（resolve 引擎执行：掷骰 vs DC/对抗）
  → ⑤ 后果结算（效果代数应用 + 状态变更 + 承诺/事实校验）
                                                      [引擎确定性]
  → ⑥ 叙事生成（LLM：把结果演出为文本，含失败/部分成功/成功）
  → ⑦ 输出校验（叙事不得篡改已结算状态；违规重试/截断）
```

这个管线与 Orchestrated Reality 的 PDVA（计划-差异-校验-应用）同构：②③=计划与校验，⑤=差异与应用，⑥⑦=投影。IF 解析器传统（Inform 7/TextWorld）提供同一结构的 40 年先例：**玩家只能做解析器理解的动作，动词+名词受前置条件（preconditions）约束**——"非法动作被拒"是文字游戏的第一原则（TextWorld：Côté, MSR）。

### 4.2 每步职责与"意图合法性检查由谁做"——相关性：高

**结论：③由引擎确定性代码做，且只用剧本声明数据（条件代数 + 引用校验），不让 LLM 参与裁决。** 理由：CoC-Seduce（LLM 裁判被话术攻破）+ NCP-Bench（LLM 一致性差）+ 可审计性要求。LLM 可以"建议"动作映射（①），但**拒绝与否决永远由引擎给出**，拒绝原因以结构化枚举返回（`action_unknown` / `target_not_present` / `condition_failed` / `no_resource` / `cooldown` / `world_rule_violation`），再由 LLM 把拒绝理由写成叙事（"你伸手去摸账本，艾拉正擦着柜台，目不转睛地看着你"）。

合法性检查的具体内容（映射到 spec 已有数据）：
- **动作存在且启用**：actions.yaml 动作词表（26 个内置动作）——玩家文本必须映射到已知动作 id，映射失败 = 拒绝（IF parser 传统）；
- **目标合法性**：目标实体存在、在当前地点（locations.yaml 的 npcs_present/items）、类型匹配（如 attack 目标须为实体）——spec 附录 E 引用校验的自然延伸为运行时校验；
- **条件代数**（附录 C）：动作的 `conditions` 求值（时间、位置、flag、关系、资源）；
- **世界规则**（world.yaml rules）：如 no-matter-creation → 拒绝"凭空造物"类意图；`mechanism` 字段指向引擎执行器；
- **资源/冷却/负面状态**：costs、cooldown、status_effects。

### 4.3 意图解析的实现与失败处理——相关性：高

- 解析方式建议**两级**：LLM 结构化输出（动作 id + 参数 JSON，schema 校验）为主，模板/关键词匹配为降级兜底（LLM 失败或不可用时）。FIREBALL 证明 LLM 微调后能生成可执行命令；Bounded Autonomy 要求嵌入动作落地管道；两者都验证"LLM 提议、引擎校验"可行。
- **歧义**（"把药水给他"——给谁？）：解析结果置信度低时，回问玩家（"给谁？"），**不自动猜测**——自动猜测是状态错误的来源。
- **多动作**（"我拔剑砍他并大喊"）：只执行主动作（解析器约定第一个有效动作），其余并入叙事。
- **解析失败**：确定性拒绝 + 建议文案（"你可以：交谈/调查/偷窃/……"），由 LLM 生成礼貌版本。**不要把"解析失败"当成"叙事自由发挥"的入口**（这是 AI Dungeon 漂移的根源之一）。
- PAYADOR（2504.07304）提供另一思路：不映射动作、直接预测结果（grounded 在最小世界表示上）——可作 `narrative_only` 受限动作的学术参照，但一致性证据（§3.1）不支持作为主路径。

### 4.4 对 spec 的映射总结——相关性：高

| 管线环节 | 谁做 | spec 落点 |
|---|---|---|
| ① 意图解析 | LLM（+模板兜底） | LLM Bridge 的解析层（新） |
| ② 动作选择/参数化 | LLM 提议 → 引擎白名单 | actions.yaml + 运行时目标解析（新） |
| ③ 合法性检查 | **引擎** | 条件代数 + world.yaml rules + 引用校验（附录 E 运行时化） |
| ④ 判定 | **引擎** | resolve 五型 |
| ⑤ 后果结算 | **引擎** | 效果代数（附录 D）+ 承诺/事实日志 |
| ⑥ 叙事 | LLM | llm_freedom |
| ⑦ 输出校验 | **引擎** | 状态差异校验（新，防 LLM 篡改） |

---

## 5. 文字战斗设计建议

### 5.1 回合制结构——相关性：高

文字战斗的回合制共识（IF/MUD 工程）：**每回合 = 玩家意图 → 判定 → 后果 → 对手意图 → 判定 → 后果**。两种节奏模式：
- **同步回合（单机 IF/D&D 式）**：玩家每回合输入一个动作，引擎结算后叙述结果——适合聊天场景，玩家有思考时间（Helderman《How to program a text adventure》ch.20）；
- **自动循环（MUD 式）**：DikuMUD 用 PULSE_VIOLENCE（约 1.5s）自动攻击循环，玩家用命令介入（施法、吃药、逃跑）——适合实时多人，**不适合聊天 LLM 场景**（每循环都调 LLM 成本爆炸）。

**对 chatgame 建议**：同步回合。每回合玩家可自由文本输入，但**引擎只结算一个主动作**；NPC 回合由引擎规则（AI 决策表/威胁条）+ LLM 演出。战斗状态（hp、buff 回合数、位置）全部引擎持有，叙事只描述。

### 5.2 命中/伤害/防御数值化——相关性：高

参考系（都验证过）：
- **5e**：攻击骰 vs AC（防御 = 被动值 10+修正）；命中后掷伤害骰；防御是被动阈值而非再掷一次——**一掷命中 + 独立伤害**。
- **WoD**：攻击骰的成功数 = 伤害点（命中与伤害合一，骰池两次——攻击 vs 防御）。
- **CoC 7e**：等级成功决定命中质量（Crit 满伤、Extreme 半伤等）+ 武器伤害骰。
- **chatgame spec 现状**：`attack` = stat_check(strength, DC 12) + 固定效果 `hp −5`——单检决定命中、伤害固定。

**建议**（与 spec 兼容的最小增强）：
1. **伤害 = 基础值 + 判定余量**（借鉴 WoD 成功数思想）：`damage = base + max(0, roll − DC)` 或按成功等级倍率（Blades/CoC 思想：普通成功 = 1×、部分成功 = 0.5×、大成功 = 2×）。用效果代数的 value 字段即可表达（`value: -5` + 引擎按结果等级缩放）。
2. **防御 = 被动阈值**（5e AC 思想）：`defend` 动作或 NPC 防御体现为"攻击 DC = 10 + 防御值"而非每次掷对抗——省一次掷骰与一次叙事解释，且方差更小（§2.2）。
3. **伤害类型 × 防御类型**：spec 已有 `damage_types`/`defense_types`（physical/fire/arcane × armor/ward）——实现为"伤害类型在防御类型列表内则减免 X%"的引擎规则，世界规则（world.yaml rules）可覆盖（如"火免"）。
4. **数值从简**：聊天 LLM 场景每次判定都有延迟与成本，**每回合至多 1 次攻击判定 + 1 次伤害结算**；避免多段命中/多次豁免的桌游复杂度。

### 5.3 hp 归零：胜负与死亡策略——相关性：高

- 桌游先例：5e 死亡 = 0 hp 倒地 + 死亡豁免（三次失败死亡）；CoC 0 hp 昏迷濒死；WoD 健康等级（最后一级 = 濒死）。
- **chatgame spec 已有完整死亡策略**（run.yaml `death_policy`）：`soft_failure`（威胁条满 → 移送副作用地点，Fallen London 式）、`world_continue`（世界延续、玩家换角色）、`hard_reset`（世界重置）。这是比传统桌游更适合聊天游戏的设计（避免硬死亡挫败长会话投入），**保留**。
- **建议补充**：
  1. 战斗失败不必等于死亡：hp 归零 → 默认进入 `soft_failure`（昏迷/被俘/丢装备），硬死亡留给剧本显式配置；
  2. **威胁条（threat_gauge）作为战斗外的压力累积**：战斗处于下风时上升，满条触发软失败——让"打不过"有渐进的叙事出口，而不是瞬间判死；
  3. 敌人 hp 归零的后果（死亡/昏迷/逃跑）由效果代数 + 事件触发表达，叙事由 LLM 演出；
  4. 死亡后果需**可逆性**（meta_progression keep/reset 已定义）：至少保证玩家投入的"记忆/关系"有保留档。

### 5.4 回合成本（时间推进）——相关性：高

**核心问题：聊天游戏的自由输入使"刷动作"零成本——每回合必须消耗资源，否则玩家会无限尝试同一动作直到成功**（"反复撬锁直到成功"）。成熟方案：
- **行动点制（Fallen London）**：每次行动消耗 1 点，点数随时间恢复（历史上约 20 点上限、5–10 分钟/点——具体数值随版本调整，标注待核实）——把"自由输入"变成有代价的选择；
- **游戏内时间推进**：每次动作推进时间单位（chatgame time.yaml 已按小时计、travel 有 travel_time、NPC 有 schedules）——动作消耗时间 = 世界自然流动 = 合法性的天然调节器（"你在门口撬了一小时锁，巡逻队来了"）。

**对 chatgame 建议**：
1. **动作级时间成本**：每动作推进固定时间步（如 5–15 分钟），战斗动作推进更小步（或战斗内单独计时）——引擎在动作结算时写时间事件；
2. **失败重试惩罚**：同一动作同一目标连续失败，DC 不降反升或推进更多时间（CoC Push 思想的廉价实现：重试 = 时间成本 + 后果升级）；
3. 时间推进同时驱动世界（NPC 作息、事件池、威胁条衰减）——时间本身就是"防刷"机制，与 spec 的 time.yaml/schedules 天然契合。

---

## 6. 防作弊 / 超模请求设计建议

### 6.1 意图映射约束（只能映射到已知动作 + 合法目标）——相关性：高

- 玩家文本**永远不能直接产生效果**，只能映射到 actions.yaml 的动作 id + 合法目标（IF parser 第一原则；Orchestrated Reality 动作参数化 (k, x_k)）。
- "我瞬移到宝库拿走一切"→ 解析尝试：`move`? `take`? ——瞬移不在动作空间；宝库不在当前地点（地点图可达性校验）；"拿走一切"超出 take 的参数范围（单物品）→ **引擎拒绝**（`action_unknown` / `target_not_present`），LLM 叙事化拒绝。
- 允许剧本声明**扩展动作**（现 spec 已支持从内置 26 个动作选择配置；STORY2GAME 证明 LLM 动态生成新动作可行但需要引擎同步更新前置条件/效果——列为远期可选）。

### 6.2 效果来源约束（效果只能来自引擎结算）——相关性：高

- **状态变更只能由效果代数（附录 D）产生，且只能由引擎在 ④⑤ 步执行**。LLM 输出文本中出现的状态变化（"你的金币多了 100"）一律不落地，⑦ 输出校验把 LLM 文本与已结算状态做差异比对，冲突则重试/截断。
- 这正是"引擎管规则、LLM 管叙事"的运行时含义（Orchestrated Reality PDVA；Bounded Autonomy 落地管道；NCP-Bench 的审计器思路——**chatgame 把审计器从"事后 LLM 审计"换成"确定性差异校验"**，比 NCP-Bench 更硬）。
- "我拿到账本了"——玩家文本可以**声称**，但账本进背包必须经过 `take`/`steal` 动作的成功结算。

### 6.3 世界规则拒绝（规则在引擎，拒绝也是世界的一部分）——相关性：高

- world.yaml `rules`（引擎执行）："任何人不能凭空创造物品"→ 引擎在 ③ 拒绝；**拒绝也要有叙事**（"你摊开手，什么都没有出现"），拒绝文案由 LLM 生成但理由由引擎给出（§4.2 的拒绝枚举）。
- `taboos`（LLM 遵守）：hard/soft 分级——这是对 LLM 输出侧的限制（防剧透/防越权叙事），与规则拒绝互补。
- **话术不能绕过规则**：CoC-Seduce 的直接推论——玩家写小作文"说服"系统让其豁免检定，在 chatgame 中不可能成功，因为**裁决权在代码不在裁判**。这是架构性防作弊，比任何提示词工程都硬。

### 6.4 超模请求：风险/效果调档而非硬拒——相关性：高

"我一拳打爆太阳"这类请求有两种处理（都可支持）：
1. **硬拒**（目标不在场/动作无效）：确定性拒绝 + 叙事化（§6.1）；
2. **允许但调档**（Blades in the Dark 模式）：若玩家坚持对合法目标做超模动作（"我一拳打死巨龙"），引擎/导演系统把该次判定设为 **Desperate/Limited**：DC 拉到极值、效果降档、失败代价升级（"你的拳头落在龙鳞上，龙甚至没低头；它打了个喷嚏，你被气浪掀飞，hp −15"）。**效果上限由效果代数与目标 hp 决定**——即使成功，一击也只能造成效果代数允许的伤害，不可能"秒杀"未配置秒杀的实体。
- 具体机制：在 resolve 上增加可选 `position_effect` 覆盖（剧本可预设"该场景风险/效果档"），导演系统（director.yaml 张力）可动态调档——张力越高，玩家动作的风险档越高（Desperate 更频繁）。
- 附带好处：玩家"试奇葩操作"变成可玩内容（高风险高回报），而不是对抗系统——比硬拒更符合聊天游戏的乐趣。

### 6.5 再试型作弊（刷检定）——相关性：高

- 反复尝试同一检定直到成功：CoC 明确"无时间/条件则不能重试"；Push 允许重试但**先预示后果、失败按大失败处理**。
- chatgame 落地：③ 合法性检查中"该动作最近失败过且条件未变"→ 拒绝重试（返回 `condition_failed`），或要求玩家改变方法（不同动作/不同条件）才可再检；若剧本允许重试，则按 §5.4 增加时间成本 + 后果升级。引擎记录"上次尝试的时间戳与上下文"，用 flag/事实存储即可。

---

## 7. 来源链接

### 经典规则（权威一手，标注版本）
- D&D 5e Basic Rules（2014，d20/DC/对抗检定/优势劣势）：https://www.dndbeyond.com/sources/dnd/basic-rules-2014 （含 DMG p.238 DC 建议的引用处：https://slyflourish.com/choosing_dcs.html ）
- 5e DC 刻度与"属性检定无大成功"澄清：https://blackcitadelrpg.com/difficulty-class-5e/ ；优势/劣势平均 +3.3 数学：https://statmodeling.stat.columbia.edu/2014/07/12/dnd-5e-advantage-disadvantage-probability/ 、https://epicwindnd.com/blogs/dice-guides/how-advantage-and-disadvantage-work-in-dnd-5e
- 对抗检定平手语义：https://rpg.stackexchange.com/questions/113313/who-wins-a-grapple-contest-if-the-checks-tie
- 对抗检定方差批评与被动值替代：https://chaoticneutraldm.com/2019/05/18/using-the-rules-better-fixing-contested-checks/ ；https://www.reddit.com/r/dndnext/comments/rpqc73/contested_checks_are_bad_design/
- GURPS Success Roll（3d6 roll-under；技能<3 不可尝试）：https://gurps.fandom.com/wiki/Success_Roll ；https://forums.sjgames.com/showthread.php?t=141344
- CoC 7e 技能检定（Regular/Hard/Extreme；对手技能定难度；Push）：https://philgamer.wordpress.com/2018/02/13/lets-study-call-of-cthulhu-7th-edition-part-2a-skill-rolls/ ；https://morganhua.blogspot.com/2020/08/call-of-cthulhu-7th-ed-skill-checks-q.html
- WoD/CoD 骰池（TN 8、10-again、chance roll、exceptional success）：https://en.wikipedia.org/wiki/Storytelling_System ；http://nwod.org/wiki/index.php/Storytelling_System
- Blades in the Dark 官方 SRD（Position/Effect、Action Roll、4/5 部分成功）：https://bladesinthedark.com/action-roll 、https://bladesinthedark.com/setting-position-effect ；社区实例：https://www.reddit.com/r/bladesinthedark/comments/749d21/help_understanding_position_and_effect
- MUD 战斗工程（DikuMUD 自动循环/伤害公式、Achaea 冷却、回合制 vs 实时、PRNG 存档）：https://flylib.com/books/en/4.241.1.66/1/ 、https://nisfeb.com/research/15-combat-and-skill-systems/ 、https://mudcoders.com/off-the-cliff-ep2-text-based-3d-physics-2b63ea25f2d8/ 、Helderman《How to program a text adventure in C》ch.20：https://home.hccnet.nl/r.helderman/adventures/htpataic.html

### 学术论文（arXiv，标注日期）
- NCP-Bench（LLM 叙事长期一致性，ICML 2026）：https://arxiv.org/abs/2608.08160 （2026-08-08）
- RPGBench（LLM 作为 RPG 引擎的规则执行）：https://arxiv.org/abs/2502.00595 （2025-02-01）
- CoC-Seduce（LLM 裁判被话术攻破）：https://arxiv.org/abs/2607.02802 （2026-07，转述自 game-theory-academic.md T12）
- Orchestrated Reality（PDVA 管道/POMDP 形式化）：https://arxiv.org/abs/2606.16014 （2026-06）
- Bounded Autonomy（动作落地管道）：https://arxiv.org/abs/2604.04703 （2026-04）
- STORY2GAME（LLM 生成动作前置条件/效果）：https://arxiv.org/abs/2505.03547 （2025-05）
- PAYADOR（预测结果而非映射动作）：https://arxiv.org/abs/2504.07304 （2025-04）
- FIREBALL（状态信息提升 NLG、LLM 生成可执行命令）：https://arxiv.org/abs/2305.01528 （2023-05）
- CALYPSO（LLM 作为 DM 助手）：https://arxiv.org/abs/2308.07540 （2023-08）
- D&D 对话挑战（状态预测与对话生成）：https://arxiv.org/abs/2210.07109 （2022-10）
- NAIL（IF 代理）：https://arxiv.org/abs/1902.04259 （2019-02）
- LLM-as-judge 偏见：position bias https://arxiv.org/abs/2406.07791 ；JudgeSense https://arxiv.org/abs/2604.23478 ；reliability-without-validity https://arxiv.org/abs/2606.19544
- Flux（显式状态模拟 vs LLM 直接玩）：https://arxiv.org/abs/2605.23972 （2026-05）

### 行业与社区
- Hidden Door（rules-based environment、AI 取代 GM）：Forbes 2025-08-14 https://www.forbes.com/sites/charliefink/2025/08/14/hidden-door-turns-fan-worlds-into-licensed-revenue-sharing-story-platforms/ ；https://www.hiddendoor.co
- AI Dungeon 社区骰子/检定脚本（玩家自发加规则）：https://github.com/Gutek8134/AID-dice-rolling
- TextWorld（文本游戏动作/状态环境，MSR）：https://www.microsoft.com/en-us/research/project/textworld/
- Fallen London（行动点制、威胁条软失败——行业常识级，具体数值随版本调整）：https://www.failbettergames.com/fallen-london/ （具体 AP 数值待核实）
- 本仓库关联调研：docs/research/2026-08-18-game-theory-academic.md 、2026-08-18-similar-ai-games.md 、2026-08-18-methodology-playability.md

---

## 8. 未解决问题

1. **判定结果质量梯度（partial/crit）与现 spec 的兼容深度**：引入 Blades 式"部分成功/大成功"需要 resolve 输出从 bool 扩展为枚举，并定义效果缩放规则（0.5×/2× 如何与效果代数 value 类型对齐）——需要规格决策。
2. **LLM 意图解析的失败率基线**：FIREBALL 证明微调后可生成命令，但零样本/少样本下"自由文本→动作 id+参数"的准确率数据缺乏；若解析失败率过高，聊天体验会频繁"被拒绝"。需要原型测量（建议按动作词表 26 项 + 中文语料做小评测）。
3. **`llm_freedom` 语义澄清**：`process`（结果 LLM 定）与"效果引擎结算"并存有语义冲突（见 §3.3）；需明确三档的实际约束边界，或收窄档位。
4. **对抗检定变体的默认配置**：opposed_check 是否默认 passive、平手语义默认值，需要规格决定；社区共识偏向被动 DC（§2.2），但聊天戏剧性可能偏向双掷。
5. **超模请求的调档阈值**：position/effect 调档（§6.4）的"何时调档、调几档"目前依赖剧本/导演配置，缺乏可操作的默认策略（如"目标与玩家 hp 差距 >N 倍 → 强制 Desperate/Limited"）。
6. **战斗内时间推进粒度**：每小时单位下，战斗回合推进多少时间、战斗是否暂停世界时间（避免"打一架世界过了 3 小时"），需与 time.yaml/schedules 的交互设计确认。
7. **叙事输出校验（⑦）的误伤率**：确定性差异校验在 NCP-Bench 里是固定审计器，但聊天叙事中"比喻/修辞"（"你的怒火烧穿了胸膛"）可能误判为状态篡改；"叙事篡改 vs 修辞"的判别规则无现成方案，需要规则白名单或语义宽松层。
8. **Fallen London 行动点制的具体数值**（上限、恢复速率）为行业常识级二手信息，正式采用前需按 chatgame 的时间粒度（小时制）重新设计，而非照搬。

## 附：对 chatgame 最直接的可执行结论

- 主判定：保留 d20+属性/技能 vs DC；DC 刻度语义化（10/15/20）；优势/劣势作可枚举修正符。
- opposed_check：补 `passive: true`（DC=10+对方修正）变体，平手默认"主动方失败"。
- narrative_only：限定"无状态后果"行为；任何触碰状态的动作必须走引擎结算。
- 结果质量：resolve 输出扩展为 fail/partial/success/crit（Blades 4/5 部分成功思想），效果按等级缩放——对剧本与叙事都是免费增值。
- 判定权：成败与效果永远引擎结算（PDVA 式）；LLM 只做意图解析与叙事；拒绝理由结构化枚举 + LLM 叙事化。
- 战斗：同步回合；一回合一个主动作；伤害 = 基础值 × 结果等级；防御用被动阈值；hp 归零默认 soft_failure（威胁条/Fallen London 式）。
- 防作弊：意图映射 + 效果来源 + 世界规则三层全在引擎；超模请求用 position/effect 调档；重试要时间成本与后果升级。
- 每次判定写结构化日志（骰值/DC/修正/结果/效果）——可审计、可测试、可复盘。
