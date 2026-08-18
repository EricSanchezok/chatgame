# 剧本驱动的 AI 聊天游戏框架：玩法方法论与无限游玩调研报告

> 调研日期：2026-08-18
> 调研者：research-scout（业界方法论：Game Developer/Gamasutra 设计文章、RPS 开发者深度访谈、RogueBasin 社区规范、互动叙事博客、维基案例页）
> 用途：为 chatgame（引擎管规则：时间/背包/战斗/NPC 属性记忆；LLM 管叙事；一个剧本 = 一个可无限游玩的世界）提供"如何好玩、如何可重玩、如何无限游玩"的业界方法论与可操作准则。
> 相关性标注：高 = 直接决定架构与玩法设计；中 = 局部设计依据；低 = 背景参考。

---

## 1. 调研范围与方法

### 1.1 方法
- 本报告来源全部为业界权威材料：设计理论文章（Game Developer / Gamasutra）、开发者深度访谈（Rock Paper Shotgun "The Mechanic" 系列）、社区规范（RogueBasin 柏林解释）、互动叙事博客（Emily Short）、案例维基页（带引用与版本号）。
- 本会话的通用搜索工具多次返回空结果，故采用"已知权威 URL 直接抓取"策略；除注明外，所有链接均为本次抓取验证过的可访问链接。
- 未覆盖：学术文献（由平行报告 [2026-08-18-game-theory-academic.md](2026-08-18-game-theory-academic.md) 覆盖）；GDC 演讲视频（仅以文字稿/二手引述引用）。

### 1.2 来源类别覆盖
| 类别 | 覆盖 | 代表 |
|---|---|---|
| 设计理论文章 | ✅ | Chemistry of Game Design、The Simulation Dream、13 Basic Principles |
| 开发者访谈 | ✅ | RPS: How RimWorld Generates Great Stories |
| 社区规范 | ✅ | Berlin Interpretation（2008 国际 Roguelike 开发会议） |
| 案例维基 | ✅ | RimWorld、The Sims、Fallen London、Hades、CK3、RDR2、Roguelike、Replay value、New Game Plus、Emergent gameplay |
| 互动叙事博客 | ✅ | Emily Short（对话即玩法、Mask of the Rose） |
| GDC 演讲 | 部分 | 以文字稿与二手引述引用 |

---

## 2. 方法论要点

### 2.1 通用玩法方法论（什么让游戏好玩）

#### M1. 乐趣 = 学习新模式；重复 = 死亡 — 相关性：高
- **一句话原则**：玩家乐趣来自大脑掌握新模式的过程；当内容不再提供新模式，乐趣消失——"无限游玩"的心理学天花板就在于此。
- **出处/案例**：Raph Koster《A Theory of Fun》（2004）；Daniel Cook《The Chemistry of Game Design》：技能原子/技能链理论——玩家掌握一个技能原子只获得一次"掌握快感"，之后它只是工具；对原子失去兴趣即 burnout，是流失前兆。
- **对 chatgame 的启示**：无限游玩 ≠ 无限文本，而是"持续提供可学的新模式"：新 NPC 行为、新事件结构、新谜题类型、新世界观碎片。引擎应记录玩家已暴露的模式，做新鲜度调度（novelty scheduling），并可用 burnout 作为遥测信号。

#### M2. MDA 分层背书"引擎管规则、LLM 管叙事" — 相关性：高
- **一句话原则**：机制（确定性规则）→ 动态（运行时行为）→ 美学（体验）；LLM 生成的是 dynamics 的呈现，不是 mechanics 本身。
- **出处/案例**：Hunicke, LeBlanc & Zubek《MDA: A Formal Approach to Game Design》（2004）；Matt Allmer《The 13 Basic Principles of Gameplay Design》（Appeal/Communication/Player 三原则）。
- **对 chatgame 的启示**：LLM 叙事应被约束为"把引擎状态翻译为叙事行为"：战斗胜负、背包变化、关系增减由引擎裁决，LLM 负责演出。这与现架构一致，且是业界对"程序化叙事"的共识（见 M5）。

#### M3. 心流：挑战-技能匹配 + 即时反馈 — 相关性：高
- **一句话原则**：挑战与技能匹配、反馈即时，玩家进入最优体验；同一动作换个情境就有完全不同的情绪价值。
- **出处/案例**：Csikszentmihalyi《Flow》；13 Basic Principles 的 Appeal 例："在街上跑不有趣，被政府特工追着跑就有趣"——情境（叙事包装）提升机制价值。
- **对 chatgame 的启示**：引擎状态变更（获得物品、关系变化、时间流逝）必须即时反映到叙事输出；挑战梯度由引擎数值维护、LLM 包装情境。聊天是慢节奏通道，需要"世界推进"机制（离线事件、时间跳转）防止反馈延迟感。

#### M4. 游戏是合著者，不是作者（留白原则）— 相关性：高
- **一句话原则**：模拟不必完整；玩家大脑会自动补全（apophenia，幻想性错觉）——游戏只需暗示，玩家会把故事讲完。
- **出处/案例**：Tynan Sylvester《The Simulation Dream》（2013）：不要模拟一切，复杂模拟不产生故事；"游戏是合著者不是作者，它只需要暗示，玩家的幻想性错觉会填充细节"。"头发复杂度"（hair complexity）：不影响其他系统的装饰性细节（The Sims 话题气泡、Prison Architect 罪犯前科、DF 角色外观）便宜且提供风味。
- **对 chatgame 的启示**：LLM 叙事不必把每个 NPC 的一生写满。文本比图形更抽象，天然留出想象空间（RimWorld 因图形具体反而收窄了想象，见 E2）。剧本应定义"高冲击锚点"（名字、关系标签、重大事件），细节留给玩家脑补——这也直接降低生成成本。

#### M5. 程序化叙事 / 导演系统：事件选择基于"什么会有趣" — 相关性：高
- **一句话原则**：AI 导演分析玩家状态，选择能产生叙事感的事件，而非纯随机或纯固定。
- **出处/案例**：Left 4 Dead 的 AI Director（维基称为 procedural narrative：分析玩家表现，追加能带来叙事感的事件）；RimWorld 的 Storyteller 算法（Cassandra Classic = 起伏节奏、威胁期+喘息期；Phoebe Chillax = 低压；Randy Random = 纯随机）——"评估当前局势，选择什么事件会构成最有趣的叙事"。
- **对 chatgame 的启示**：设计"世界导演"层（引擎侧）：根据玩家压力、进度、新鲜度从剧本声明的事件池中选择下一个事件（威胁/机遇/社交/谜团），LLM 负责演绎。导演参数（节奏、事件类型池、难度曲线）由剧本声明——这是"剧本驱动"的直接落地。

#### M6. 技能原子链与 burnout 可测性 — 相关性：中
- **一句话原则**：把游戏能力拆成技能原子链，玩家在链上"掌握 → 练习 → burnout"；burnout 是清晰可测的流失信号。
- **出处/案例**：Daniel Cook《The Chemistry of Game Design》（2007）：原子未找到新用途即 burnout；早期 burnout 会切断整条技能链。
- **对 chatgame 的启示**：把"对话技巧、侦查、社交、战斗、资源管理"视为技能原子；观察玩家哪些交互类型 burnout（不再使用），反推剧本事件供给问题。可做轻量遥测维度。

#### M7. 对话即玩法：意图性 + 可学机制 + 节奏 — 相关性：高
- **一句话原则**：对话要成为"可计划、可学习、可操纵"的系统化机制，而不是挂在玩法旁边的分支树。
- **出处/案例**：Emily Short《Conversation as Gameplay》（2019 演讲）：玩家要有 intentionality（制定计划并执行）；Versu 的社会模型（关系、情绪、地位；NPC 相互交谈、玩家可旁观）；Ladykiller in a Bind 的"选项随时间出现/消失 + 明示后果"；Jenga 机制（把 NPC 逼到极限看会发生什么）。
- **对 chatgame 的启示**：聊天是唯一交互通道，必须本身是玩法：
  1. 玩家自由输入 → 引擎解析为可裁决动作；
  2. NPC 有可观察的状态（心情、立场、秘密），玩家可学习并利用；
  3. 对话后果可感知（关系值、信息、资源、触发事件）；
  4. 关键选择明示或暗示后果，支持玩家计划。

#### M8. 对话表达性：选项池 + 人格/知识过滤 — 相关性：中高
- **一句话原则**：按玩家特质与已知信息从大池子过滤对话表达，让表达有风格、不过载、不剧透。
- **出处/案例**：Emily Short《Dialogue Expressiveness in Mask of the Rose》（2023）：人格特质 + 着装过滤对话选项池；知识驱动对话——玩家只能表达自己已知/推断的信息；"红绳板"假设形成与检验界面。
- **对 chatgame 的启示**：LLM 生成天然是"大池子"；引擎应提供玩家画像（已暴露信息、关系、特质）过滤，确保 NPC 只回应"玩家知道什么"而非全知——这是对话一致性的引擎侧支撑。

### 2.2 可重玩性设计

#### R1. 程序化生成的目的不是随机，是"重玩仍新鲜" — 相关性：高
- **一句话原则**：随机环境生成的价值在于提高重玩性；固定内容（剧情/谜题/宝库）会削弱随机性带来的新鲜感。
- **出处/案例**：柏林解释（Berlin Interpretation, 2008）："随机环境生成"列为高价值因素——"世界随机生成以提高重玩性；固定内容移除随机"；Replay value 维基：程序化生成使每局不同，是 roguelike 高重玩性的来源。
- **对 chatgame 的启示**：世界初始状态（NPC、地点、秘密、势力关系）半随机生成；核心剧情节拍可固定，但细节与关系随机化。剧本应显式区分"固定骨架（承诺）"与"随机填充（细节）"。

#### R2. 重玩价值来源清单 — 相关性：中高
- **一句话原则**：多职业、多角色、多路径、评分、解锁内容、多结局，都是经过验证的重玩诱因。
- **出处/案例**：Replay value 维基（Mass Effect 选择驱动、Diablo 多职业、Chrono Cross 45 角色）；New Game Plus 维基（起源 Chrono Trigger 1995；保留成长、移除关键剧情道具、提高难度、加入新内容）。
- **对 chatgame 的启示**：剧本提供"身份/出身"选择（不同初始属性、关系、视角）制造多周目差异；失败/死亡后的"世界重置 + 知识保留"（Hades 式，见 R3）比严格 permadeath 更适合聊天游戏的会话成本。

#### R3. Meta-progression：把失败变成进度 — 相关性：高
- **一句话原则**：roguelite 用"局外成长"让每次失败都有收获，重复游玩本身成为叙事载体。
- **出处/案例**：Roguelike 维基（rogue-lite 的 meta-game 解锁永久内容；短局 + 胜利条件 + 重玩性为高价值）；Hades（死亡推进对话与关系，叙事随多次游玩展开；其前作 Pyre 的教训——玩家不重复游玩就看不到分支叙事，所以用 roguelike 结构强迫重复）。
- **对 chatgame 的启示**：玩家失败/死亡后保留：① 已知信息（地图、秘密、人物底细）；② 与部分 NPC 的关系；③ 解锁内容（新出身、新地点）。让"再开一局"有明确的增量回报。NPC 记住玩家多次尝试（"你又来了"）是聊天游戏的天然优势。

#### R4. 随机性与确定性的平衡：按层分配 — 相关性：高
- **一句话原则**：随机产生变化，确定产生意义；两者按层级分配，而不是二选一。
- **出处/案例**：柏林解释（固定内容用于高价值节点）；Joshua Bycer 对 rogue-lite 的观察（rogue-lite 有固定事件与 boss 结构，roguelike 没有——可预测性本身是一种设计选择）。
- **对 chatgame 的启示**：分层策略：世界初始 = 随机；主线承诺 = 确定（必须发生）；中程事件 = 半随机（导演选择）；微细节 = LLM 即兴。确定性层保证故事有意义，随机层保证新鲜，LLM 层保证表达。

### 2.3 无限游玩 / 涌现叙事

#### E1. 涌现来自"简单规则 × 抽象表示"，不是更多内容 — 相关性：高
- **一句话原则**：少量通用规则作用于所有实体，交互产生开发者没预料到的行为——这是无结局游戏的标准配方。
- **出处/案例**：Emergent gameplay 维基：Dwarf Fortress 中任何生物都可能醉酒（抽象表示让系统通用）；Minecraft/DF/Space Station 13 无 endgame 标准；沉浸模拟（Deus Ex）多解法。
- **对 chatgame 的启示**：引擎规则要"通用"——饥饿、醉酒、受伤、恋爱对玩家和 NPC 一视同仁（柏林解释的低价值因素"怪物与玩家同规则"实际上对涌现极有价值）；LLM 把通用状态翻译为具体叙事。禁止给单个 NPC 写死逻辑而绕过剧本。

#### E2. Apophenia 是故事生成器的核心机制 — 相关性：高
- **一句话原则**：玩家从事件中读出的故事意义远超机制实际表示的——设计目标是"让玩家的脑补启动"。
- **出处/案例**：RPS《How RimWorld Generates Great Stories》（2016）：命名角色、把殖民地居民限制在 ~12 人（让玩家记住每个人及其历史）、健康与关系两个原始人类关注点、记忆影响情绪、极简细节留白（"必须留下未定义的东西"）；图形越具体反而收窄想象（作者羡慕 DF 的抽象）。
- **对 chatgame 的启示**：
  1. 核心 NPC 数量可控（玩家能记住并产生历史感）；
  2. 关系标签（姐妹、仇人、旧情人）+ 事件记忆 → NPC 反应有因果感；
  3. 文本天然抽象，留白让玩家补全；
  4. 随机事件相互重叠也能成故事（RimWorld Randy 模式证明：系统重叠让随机变叙事）。

#### E3. 记忆系统是关系驱动的引擎 — 相关性：高
- **一句话原则**：NPC 的记忆（事件 + 情绪偏移）决定 NPC 如何看待玩家，是长期游玩的粘合剂。
- **出处/案例**：RPS 访谈：RimWorld 记忆 → mood → mental break 的因果链（"他踢掉酒瘾、六周前离婚、处于暴躁中"）；"妹妹死了比路人死了更难过"（关系标签放大情绪）。The Sims：关系分 + 话题气泡（装饰层）。
- **对 chatgame 的启示**：NPC 记忆 = 引擎管理的结构化事实（谁救过谁、谁骗过谁、何时何地），LLM 在对话中引用。记忆分层：重大事件长期保留，琐事淡出（RimWorld：想法会淡出，疤痕永久保留——因为疤痕提供故事钩子）。

#### E4. "头发复杂度"：装饰性模拟的性价比 — 相关性：中
- **一句话原则**：不影响其他系统的细节模拟（外观、闲谈话题）便宜且提供风味，但不要指望它驱动玩法。
- **出处/案例**：Tynan《The Simulation Dream》：The Sims 话题气泡、DF 角色外观、Prison Architect 罪犯前科——"sticks off the main ball of relationships without feeding back into it"。
- **对 chatgame 的启示**：LLM 天然擅长生成"头发复杂度"（寒暄、外貌、小癖好）——成本低、风味足；但必须明确哪些是"真数据"（引擎管），哪些是"装饰文本"（LLM 管）。AGENTS.md 原则"状态绝不放进对话文本"与此一致：装饰可生成，真状态必须回引擎。

### 2.4 世界长期运转机制

#### W1. 时间系统：世界在玩家不在时也前进 — 相关性：高
- **一句话原则**：明确的游戏内时间推进 + NPC 日程独立于玩家，造成"世界活着"感。
- **出处/案例**：The Sims（时间流逝、需求衰减）；RDR2（营地 NPC 有自己的日程与情绪，跨场景延续；开发目标"让玩家感觉生活在一个世界，而不是玩任务看演出"）；Fallen London（行动点 = 时间货币，现实时间节流）。
- **对 chatgame 的启示**：引擎维护世界时钟；NPC 有日程状态（在/不在、忙/闲）；玩家离线期间世界可推进（事件摘要）。LLM 只在玩家在场时演绎，离线推进用规则 + 事件日志（成本分层思想，见学术报告 T11 CASCADE）。

#### W2. NPC 关系与记忆系统：社交模拟三大件 — 相关性：高
- **一句话原则**：关系值 + 关系标签 + 记忆事件，足以支撑社交模拟与涌现故事，不需要更复杂。
- **出处/案例**：RPS 访谈（RimWorld 关系矩阵"就是数字+标签，但贴近人类最关心的东西，大脑自动补全因果"）；CK3（性格特质、好感、秘密、王朝传承——每个角色都可继续玩，是角色扮演沙盒的核心）；The Sims（需求 + 关系 + 情绪）。
- **对 chatgame 的启示**：NPC 档案 = 属性 + 特质 + 关系矩阵 + 记忆流 + 当前需求/目标。关系不是单一数值，应含"事件标记"（他救过我、她背叛过我）供 LLM 引用。

#### W3. 世界事件系统：压力与释放的节奏 — 相关性：高
- **一句话原则**：事件不是随机噪声，而是按节奏投递的"剧情燃料"，并带失败处理。
- **出处/案例**：RimWorld Storyteller（Cassandra 起伏节奏、威胁随财富与战力升级）；Fallen London 威胁条（Nightmares/Suspicion/Wounds/Scandal 过高 → 被移送到副作用地点，如流放到墓穴殖民地——世界内的失败处理而非游戏结束）。
- **对 chatgame 的启示**：事件系统三要素：① 剧本声明事件类型池（威胁/机遇/社交/谜团）；② 引擎按玩家状态选择并排节奏；③ 失败有"世界内后果"（入狱、流放、负债、声望受损）而非读档——威胁条模式非常适合聊天游戏。

#### W4. 持续运营叙事：长线目标 + 定期新内容 — 相关性：中
- **一句话原则**：无结局游戏靠"长线野心 + 持续内容 + 收集/社交"维持。
- **出处/案例**：Fallen London（2009 年运营至今；四属性 + 数百个状态追踪；Ambitions 长线任务线；Mr Eaten 剧情线可永久毁档 = 玩家自主选择的极端承诺；StoryNexus 引擎）；Paradox CK3（DLC 持续扩展，2025 年销量超 400 万）。
- **对 chatgame 的启示**：剧本应声明"野心"级长线目标（玩家的主线）+ 可无限重复的中程循环（委托、事件、探索）。产品层面：新剧本/新事件包 = 持续内容。

#### W5. 玩家失败与死亡的设计 — 相关性：中高
- **一句话原则**：无限世界需要"软性失败"与"可逆但代价高"的后果，而不是读档重来。
- **出处/案例**：Fallen London 威胁条（被移走 ≠ 死亡）；Hades（死亡 = 回据点，叙事继续）；RimWorld 双模式（commitment/permadeath 可选）。
- **对 chatgame 的启示**：默认提供"世界继续"的失败处理（坐牢、流放、负债、声望受损），死亡作为可选模式；死亡后保留 meta 进度（R3）。玩家角色死亡后世界延续（后继者/后代），避免"世界随玩家一起死"（CK3 继承机制）。

---

## 3. 案例拆解

### 3.1 Minecraft — 无目标自驱沙盒
- **靠什么**：工具系统（挖-造-自动化）+ 探索未知（地形生成）+ 玩家自设目标 + 创作/分享社交。被 Emergent gameplay 维基明确点名为无 endgame 标准的游戏。
- **对 chatgame**：聊天世界需要"工具性玩法"——玩家的行动（交谈、交易、调查）要能改变世界状态（势力、资源、地形），形成"因为我能改变，所以我想继续"的循环。

### 3.2 The Sims — 需求驱动的微型社会
- **靠什么**：需求条（饥饿/社交/娱乐）+ 关系分 + 情绪 → 每个小人持续有"待办"，玩家当导演。Tynan 指出其话题气泡是"头发复杂度"的典型（无关紧要但风味足）。
- **对 chatgame**：NPC 应有持续的需求/欲望（饥饿、爱、野心、恐惧），驱动他们主动找玩家与彼此互动——NPC 主动性是"世界活着"的关键。

### 3.3 Dwarf Fortress — 抽象系统 + 极端深度
- **靠什么**：极抽象表示（ASCII）让规则通用；任何实体可醉酒/受伤/恋爱；大量平行系统重叠产生开发者未预料的叙事（社区传奇 Boatmurdered 等）。
- **对 chatgame**：抽象 = 留白 = 想象空间；规则通用性 = 涌现。文本界面就是 chatgame 的"ASCII 时刻"——信息密度低反而故事密度高。

### 3.4 RimWorld — 故事生成器（与 chatgame 最接近的模型）
- **靠什么**：Apophenia 设计（命名、小群体 ~12 人、健康/关系锚点、记忆→情绪→崩溃的因果链）+ Storyteller 事件导演 + 极简细节留白。设计目标不是挑战而是"叙事体验"。
- **对 chatgame**：核心移植项：① 记忆→情绪→行为的因果链；② 事件导演（Storyteller）；③ 留白原则；④ 关系标签放大情绪。

### 3.5 Paradox（CK3）— 角色扮演沙盒
- **靠什么**：人物属性/特质/关系网 + 继承系统（角色会死，但世界和家族继续）+ 长线大战略目标 + DLC 持续扩展。销量超 400 万，单局可数百小时。
- **对 chatgame**：继承/传承机制值得借鉴——玩家角色死亡或退场后世界延续（新角色、后代、后继者），把"一局游戏"变成"一个世界"。

### 3.6 Fallen London — 纯文本持续运营的鼻祖
- **靠什么**：行动点节流 + 长线野心 + 数百状态 + 威胁条软失败 + 16 年持续内容 + 社区。纯文本却运营至今，是"文本无限游戏"的直接先例。
- **对 chatgame**：行动点/时间节流制造会话节奏；威胁条是优雅的失败设计；野心系统提供长线目标。其 StoryNexus 引擎的"故事卡/质量"机制是现代 storylet/quality-based narrative 的先驱。

### 3.7 Hades — 叙事 × 重复游玩
- **靠什么**：roguelike 结构让死亡 = 推进剧情（每次死亡新对话、关系增长）；meta-progression（资源、武器解锁）。前作 Pyre 的教训：不强迫重复，分支叙事就浪费。
- **对 chatgame**：死亡/失败 = 剧情推进点。NPC 对玩家多次尝试的记忆是聊天游戏的天然优势——每次会话都是 Hades 的一局。

### 3.8 RDR2 — 活的世界
- **靠什么**：NPC 日程、记忆、情绪延续；营地 = 可互动的日常；世界事件与主线交织。目标"活在世界上"而非"做任务"。
- **对 chatgame**：NPC 对玩家行为的记忆和态度变化（声望、关系）必须跨会话延续；日常细节（NPC 在做什么）让世界可信。

### 3.9 塞尔达 BotW — 系统性世界（简略，置信度中）
- **靠什么**：物理/天气系统与世界反应（雷雨天金属导电、NPC 日程、血月刷新怪物）——"世界规则一致适用于一切"产生聪明世界感。本次未深度抓取该案例，基于公认机制。
- **对 chatgame**：引擎规则应模拟"世界如何运转"（规则一致、可预测），LLM 只在规则之上叙事——避免"LLM 万能"导致世界不可预测。

---

## 4. 可操作设计清单（chatgame 适用）

优先级：P0 = 架构级（引擎/协议必须支持）；P1 = 剧本模板级（内容声明规范）；P2 = 打磨/产品级。

### 4.1 引擎侧（规则/状态）
- [P0] **世界时钟**：游戏内时间推进；NPC 日程状态（位置/忙闲）；离线推进 = 规则模拟 + 事件摘要（W1）
- [P0] **NPC 档案**：属性 + 特质 + 关系矩阵（含事件标记）+ 记忆流（分层：长期事实/短期情绪）+ 当前需求/目标（W2, E2）
- [P0] **事件导演**：事件类型池由剧本声明；引擎按玩家压力/新鲜度/进度选择事件并排节奏（M5, W3）
- [P0] **软失败系统**：威胁条/债务/声望受损/流放，替代读档（W5, 3.6）
- [P1] **承诺/事实清单**：剧本主线事件与已揭露事实由引擎记录，LLM 输出后做一致性校验（对齐学术报告 T12 NCP）
- [P1] **新鲜度记账**：记录玩家已暴露的事件模式/人物关系，调度器避免重复（M1）
- [P2] **继承机制**：玩家角色死亡后世界延续（后继者/后代）（3.5, W5）

### 4.2 剧本模板侧（内容声明）
- [P0] **固定骨架 vs 随机填充**：主线承诺固定；NPC、地点、秘密、初始关系半随机（R1, R4）
- [P0] **高冲击锚点**：命名角色 + 关系标签 + 重大事件，细节留白（E2, M4）
- [P1] **野心/长线目标**：每个剧本声明 1-3 个"野心"级目标（3.6, W4）
- [P1] **中程循环**：可无限重复的任务环（委托/调查/交易/社交）（W4）
- [P1] **多出身/视角**：不同初始身份制造多周目差异（R2）
- [P2] **威胁条定义**：每个剧本定义 2-4 条威胁及其副作用地点（3.6）

### 4.3 叙事侧（LLM 约束）
- [P0] **对话引用记忆**：NPC 对话必须能引用引擎记忆（事件、关系标记），禁止全知（E3, M8）
- [P0] **状态→叙事翻译**：引擎状态变更必须即时反映到叙事输出；装饰文本不写回状态（M3, E4）
- [P1] **意图解析**：玩家自由输入 → 解析为可裁决动作；非法动作被拒并回退（对齐学术报告 T11 动作落地）
- [P1] **后果明示度**：关键选择明示或暗示后果，支持玩家计划（M7）
- [P2] **表达过滤**：按玩家已知信息过滤 NPC 回应（M8）

### 4.4 产品/留存侧
- [P1] **Meta-progression**：失败保留信息/关系/解锁（R3, 3.7）
- [P2] **会话节流**：行动点或时间推进成本，制造"明天再来"节奏（3.6）
- [P2] **Burnout 遥测**：追踪玩家不再使用的交互类型（M6）

---

## 5. 来源链接

**方法论文章**
- [The Chemistry of Game Design（技能原子/技能链，Daniel Cook / Lost Garden）](https://www.gamedeveloper.com/design/the-chemistry-of-game-design)
- [The Simulation Dream（Tynan Sylvester）](https://www.gamedeveloper.com/design/the-simulation-dream)
- [The 13 Basic Principles of Gameplay Design（Matt Allmer）](https://www.gamedeveloper.com/design/the-13-basic-principles-of-gameplay-design)
- [Conversation as Gameplay（Emily Short 演讲文字稿）](https://emshort.blog/2019/01/20/conversation-as-gameplay-talk/)
- [Dialogue Expressiveness in Mask of the Rose（Emily Short）](https://emshort.blog/2023/11/22/dialogue-expressiveness-in-mask-of-the-rose/)

**开发者访谈与案例深度文**
- [How RimWorld Generates Great Stories（RPS The Mechanic）](https://www.rockpapershotgun.com/2016/08/12/how-rimworld-generates-great-stories/)
- [RimWorld GDC 2019 演讲（Tynan Sylvester，YouTube）](https://www.youtube.com/watch?v=VdqhHKjepiE)

**社区规范与维基**
- [Berlin Interpretation（RogueBasin）](http://www.roguebasin.com/index.php/Berlin_Interpretation)
- [Emergent gameplay（Wikipedia）](https://en.wikipedia.org/wiki/Emergent_gameplay)
- [Replay value（Wikipedia）](https://en.wikipedia.org/wiki/Replay_value)
- [New Game Plus（Wikipedia）](https://en.wikipedia.org/wiki/New_Game_Plus)
- [Roguelike（Wikipedia）](https://en.wikipedia.org/wiki/Roguelike)

**案例页**
- [RimWorld（Wikipedia）](https://en.wikipedia.org/wiki/RimWorld)
- [The Sims（Wikipedia）](https://en.wikipedia.org/wiki/The_Sims)
- [Fallen London（Wikipedia）](https://en.wikipedia.org/wiki/Fallen_London)
- [Hades（Wikipedia）](https://en.wikipedia.org/wiki/Hades_(video_game))
- [Crusader Kings III（Wikipedia）](https://en.wikipedia.org/wiki/Crusader_Kings_III)
- [Red Dead Redemption 2（Wikipedia）](https://en.wikipedia.org/wiki/Red_Dead_Redemption_2)

**书籍**
- Raph Koster, *A Theory of Fun for Game Design*（2004）
- Jesse Schell, *The Art of Game Design: A Book of Lenses*（2008）
- Tynan Sylvester, *Designing Games: A Guide to Engineering Experiences*（O'Reilly, 2013；[tynansylvester.com/book](https://tynansylvester.com/book/)）

---

## 6. 未解决问题

1. **离线世界推进的模拟粒度**：LLM 成本约束下，玩家不在场时世界推进到什么程度才足够真实又不烧钱？（学界 CASCADE 建议：玩家不可见时用状态机/规则驱动——需要明确引擎侧模拟的边界。）
2. **记忆压缩与遗忘**：长期游玩的记忆流如何分层、遗忘、摘要，防止上下文爆炸（对齐学术报告 T10 的 Summarize-and-Forget；RimWorld 的"想法淡出、疤痕保留"是语义层参考）。
3. **新鲜度的可操作度量**：什么算"新模式"？需要剧本侧声明模式标签（事件类型、关系类型、谜题结构），才能做去重与渐变调度。
4. **多局世界 vs 单局延续**：玩家死亡后是"新开局（Hades 式知识保留）"还是"世界延续（CK3 式继承）"？两者成本与体验差异未验证，可能按剧本类型提供选项。
5. **死亡角色的记忆迁移**：NPC 对已死玩家的记忆如何迁移到后继角色，保持因果连贯又不信息过载。
6. **导演参数的剧本 DSL**：事件类型池、节奏曲线、威胁条如何用剧本语言声明，业界无直接先例（Fallen London 的 StoryNexus 最接近，但未公开 DSL 规范）。
7. **AI 生成内容感知偏见**（对齐学术报告 T8）：披露策略与"人味"锚定未定；剧本驱动定位是解药，但产品沟通层面仍需验证。
8. **文本界面能承载多少"系统深度"**：塞尔达式物理系统与聊天形式的张力——当前倾向"规则模拟世界运转、LLM 描述结果"，但玩家的系统操作通道（能做什么动作）需要设计验证。
