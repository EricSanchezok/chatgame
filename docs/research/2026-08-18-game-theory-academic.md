# 剧本驱动的 AI 聊天游戏框架：学术理论调研报告

> 调研日期：2026-08-18
> 调研者：literature-searcher（arXiv 多轮检索 + 经典文献整理）
> 用途：为 chatgame（引擎管规则：时间/背包/战斗/NPC 属性记忆；LLM 管叙事）的三个核心设计问题提供学术依据：
> ① 什么让游戏好玩；② 如何做涌现叙事；③ 如何可重玩/无限游玩。
> 相关性标注：高 = 直接决定架构与玩法设计；中 = 提供评估方法或局部设计依据；低 = 背景参考。

---

## 1. 调研范围

### 1.1 方法
- 全部论文发现均来自本会话内的 arXiv 语义检索（共 9 轮、~90 篇候选），未引用任何训练记忆中的 arXiv 论文。
- 时间策略：第一轮以 2026-02 之后为窗口（cutting-edge），第二轮扩至 2025-08 之后（recent），第三轮对基础文献（Generative Agents、体验驱动 PCG）做无日期限制检索（foundational）。
- 经典书籍与理论（Csikszentmihalyi、MDA、Bartle、Deci & Ryan 等）为研究问题明确点名，且大多不以 arXiv 为载体，故以书籍/期刊信息列出并明确标注"非 arXiv"；这是本报告中唯一允许脱离检索结果的类别。

### 1.2 领域格局（检索结果的总体印象）
- **2026 年的研究主线已从"LLM 能不能讲故事"转向"LLM 叙事如何与规则/状态耦合、如何评估与约束"**：神经符号混合（IVIE、World-State Transformations）、LLM-GM 单例编排（Orchestrated Reality）、叙事承诺一致性基准（NCP-Bench）、AI-native 游戏综述（AI Native Games）直接对应 chatgame"引擎管规则、LLM 管叙事"的架构假设。
- **NPC 自主性研究从"沙盒涌现"走向"受控自主"**：Bounded Autonomy、CASCADE 表明学界正在解决"LLM 角色既要有自主性又要可执行、可约束"的控制问题。
- **长期记忆已成为独立研究领域**：2026 年出现多篇记忆引擎论文（WorldDB、SodaMem、Engram、Memori）与专门诊断记忆更新的工作（Supersede），并普遍发现"记忆维护而非模型能力"是长时程一致性的瓶颈——这正是 chatgame"NPC 属性记忆由引擎管理"的关键证据。
- **玩家动机方向 arXiv 覆盖较薄**：心流/SDT 的权威实证更多在 CHI/心理学期刊；arXiv 上以严肃游戏、社交 VR、游戏化为主，作为补充。

---

## 2. 核心理论清单

### 2.1 问题一：什么让游戏好玩（动机与体验理论）

#### T1. 心流理论（Flow）— 相关性：高
- **定义**：当任务挑战与个人技能匹配、目标明确、反馈即时时，人进入"心流"——深度投入、失去时间感的最优体验状态；心流体验的经典条件包括挑战-技能平衡、清晰目标、即时反馈、专注、控制感。
- **关键文献**：Csikszentmihalyi, *Flow: The Psychology of Optimal Experience* (1990)；Nakamura & Csikszentmihalyi (2002)。
- **对 chatgame 的启示**：
  1. 剧本与系统必须提供**可感知的挑战梯度**：聊天式游玩中"挑战"来自谜题、战斗决策、资源管理，引擎需维护数值难度曲线，LLM 叙事负责把难度包装成情境（不能让玩家觉得是"随机刁难"）。
  2. 心流要求**即时反馈**：引擎状态变更（背包、时间、关系值）应即时可见地反映到叙事输出中；"做了选择但世界无反应"是聊天游戏破坏心流的第一杀手。
  3. 无限游玩的风险是**重复感击穿心流**：Koster（见 T5）的"乐趣=学习"意味着每次会话必须提供可学习的新东西（新机制、新人物关系、新信息），这对生成内容的新鲜度管理提出了硬要求。

#### T2. MDA 框架（Mechanics-Dynamics-Aesthetics）— 相关性：高
- **定义**：把游戏拆为三层——机制（规则/数据/算法）、动态（机制随时间运行时产生的行为）、美学（玩家体验到的情感）。设计应"从美学出发、向机制落"（自上而下），玩家体验则是"机制→动态→美学"（自下而上）。
- **关键文献**：Hunicke, LeBlanc & Zubek, *MDA: A Formal Approach to Game Design and Game Research* (2004)，非 arXiv。
- **对 chatgame 的启示**：
  1. chatgame 的分层天然对应 MDA：**引擎 = 机制层（确定性规则与状态），LLM = 动态层（把机制运行翻译为叙事行为），美学 = 玩家实际感受到的沉浸与掌控**。MDA 直接背书"引擎管规则、LLM 管叙事"的架构——LLM 生成的是 dynamics 的呈现，不是 mechanics 本身。
  2. 设计流程建议：为每个剧本先写"美学目标清单"（如：悬疑、浪漫张力、权力的诱惑），再决定哪些由引擎机制支撑（如忠诚度数值、时间窗），哪些交给 LLM 即兴叙事，避免"什么都让 LLM 即兴"导致机制空洞。

#### T3. 自决理论 / 内在动机（SDT：自主、胜任、关联）— 相关性：高
- **定义**：内在动机来自三种基本心理需要的满足——自主（autonomy：选择与自我决定）、胜任（competence：有效应对挑战）、关联（relatedness：与他人建立连接）；游戏满足这三者则产生内在动机与持续游玩。
- **关键文献**：Deci & Ryan, *Intrinsic Motivation and Self-Determination in Human Behavior* (1985)；Ryan, Rigby & Przybylski, *The Motivational Pull of Video Games: A Self-Determination Theory Approach* (2006)；近期实证：2602.12764（社交 VR 中临在感预测三种需要满足，N=301）。
- **对 chatgame 的启示**：
  1. **自主**：聊天式输入天然提供表达自由，但需要"有意义的后果"支撑——引擎必须把玩家的自由输入转化为真实状态变更（否则自由只是幻觉，反而损害动机）。
  2. **胜任**：需要可累积的能力证据——等级、属性、成就、解锁内容；纯 LLM 叙事若无引擎数值支撑，玩家无法感知成长。
  3. **关联**：NPC 关系记忆是 chatgame 的差异化武器——NPC 记住玩家、关系随时间演变，直接满足"关联"需求；2602.12764 显示社交临在感是三种需要的共同预测因子。

#### T4. 玩家动机模型（Bartle 类型；Yee / Quantic Foundry 动机模型）— 相关性：中
- **定义**：Bartle 按玩家行为把 MUD 玩家分为成就者/探索者/社交者/杀手四类；Yee 的 Quantic Foundry Gamer Motivation Model 用 6 大动机簇（行动、社交、掌控、成就、沉浸、创造）×12 维度刻画动机剖面，并强调玩家是多动机混合体而非单一类型。
- **关键文献**：Bartle, *Hearts, Clubs, Diamonds, Spades: Players Who Suit MUDs* (1996)；Yee, *The Gamer Motivation Profile*（Quantic Foundry, 2016）；近期实证补充：2510.10263（无监督聚类得到 4 类玩家原型，其中"沉浸式社交故事追寻者"与"策略系统导航者"直接相关）；2605.09550（771 名玩家对游戏 AI 的态度剖面，识别出 AI 怀疑者/创作探索者等 7 类）。
- **对 chatgame 的启示**：
  1. 剧本应显式声明目标玩家剖面，并提供**多动机通道**：成就者（任务/收集/数值成长）、探索者（隐藏地点/传说碎片）、社交者（NPC 关系）、杀手（战斗/竞争）；引擎的奖励系统按通道设计，LLM 叙事为各通道生成对应内容。
  2. **个性化动机适配是未解问题**（Rushes 数据集见 T13）：单一人口级目标不足以预测个体选择，chatgame 可把玩家行为数据（选择历史）作为个性化上下文——但这需要专门的用户建模，短期建议只做"粗粒度剧本分支适配"。
  3. 2605.09550 提示：不同玩家对"游戏里用 AI 生成内容"的态度差异巨大，产品层面需要让 AI 生成的内容在观感上与手工设定一致（结合 T8 的感知偏见）。

#### T5. 乐趣=学习（Koster）— 相关性：中
- **定义**：乐趣的本质是大脑对模式的学习与掌握；当内容不再提供新模式（可预测/重复）时乐趣消失，这就是"无限游玩"的心理学天花板。
- **关键文献**：Koster, *A Theory of Fun for Game Design* (2004)，非 arXiv。其原则已被量化用于 PCG：2106.15877（EDRL 用"关卡段间多样性"量化 Koster 的 fun 并作为奖励生成无限马里奥关卡）。
- **对 chatgame 的启示**：无限游玩必须**持续引入新模式**（新 NPC 行为、新事件类型、新谜题结构、新世界观碎片），引擎应记录"玩家已见过哪些模式"并对生成器做去重/渐变（novelty scheduling）。这比单纯"生成更多文本"更重要——文本量不产生乐趣，模式新颖度才产生乐趣。

#### T6. 体验驱动 PCG（EDPCG）与情感闭环 — 相关性：高
- **定义**：不以"几何合法性"而以"玩家体验指标"为生成目标的内容生成范式：用体验模型（难度、趣味、唤起度）作为优化目标，让内容自动适配玩家。
- **关键文献**：Yannakakis & Togelius 的体验驱动 PCG 框架（EDPCG，2011 专著思想）；2106.15877（EDRL：RL 生成器 + 乐趣奖励，无限可玩马里奥关卡）；2408.06346（RL 设计器按目标唤起度轨迹生成赛车赛道）；2402.10133（LLM 零样本按玩家行为数据个性化生成关卡，显著降低弃游率）；2209.00459（生成"既会玩又会有体验反应"的程序化人格用于测试）。
- **对 chatgame 的启示**：
  1. chatgame 的"内容生成器"是 LLM 叙事，同样需要**体验目标函数**：建议引擎维护"叙事节奏状态"（张力、新鲜度、难度、社交压力），LLM 根据目标轨迹生成对应事件——这正是 2408.06346"目标唤起度轨迹"思路的叙事版。
  2. 2402.10133 证明 LLM 可用玩家行为数据做零样本个性化——chatgame 无需训练即可按玩家选择史调整剧本走向。
  3. 2209.00459 提示可用"程序化玩家人格"自动测试剧本（用扮演不同动机的 LLM 代理跑剧本），把 QA 变成可扩展的自动流程。

#### T7. 玩家体验评估方法（测量"好不好玩"）— 相关性：中
- **定义**：通过自报问卷、遥测、生物信号多模态测量玩家体验（PX），支撑设计迭代。
- **关键文献**：2605.27261（Atari 三游戏 19 人的遥测+问卷+生物信号+回述出声思维协议，验证多模态 PX 评估可行）；2607.17128（SAVEstate：用存档文档法研究"反思型/意义型"玩家体验）；2605.01238（EduGage：传感器估计学习投入）。
- **对 chatgame 的启示**：上线后应有**最小化 PX 测量协议**（会话后 2-3 题内在动机量表 + 流失点遥测），用于验证"挑战-技能匹配"与"自主/胜任/关联"是否达成；不要把"好不好玩"留到主观感觉层面。

#### T8. 玩家对 AI 生成内容的感知偏见 — 相关性：中高
- **定义**：玩家对内容的评价与其"认为是谁做的"强相关：被认为是 AI 生成的内容被评价为更挫败、更难，而实际来源无法被识别；且公开披露使用生成式 AI 的游戏在 Steam 评分显著更低（被感知为开发商投入不足）。
- **关键文献**：2602.14254（Mario/Sokoban 双盲实验：信念而非真相驱动体验）；2608.11539（508,192 条 Steam 评论分析：披露 GenAI 的游戏推荐率更低；结论——生成式 AI 应为玩家需要服务，而非为开发省钱）。
- **对 chatgame 的启示**：
  1. 产品沟通与呈现策略重要：AI-native 游戏必须让"生成"服务于玩家可见的价值（个性化、无限内容、NPC 活人感），并让内容经过**一致的风格层**（规则过滤、文风模板、事实校验），避免"AI 味"触发负偏见。
  2. 剧本驱动定位本身就是解药：世界观/角色/机制由剧本定义（人为创作），LLM 只负责"演出"，玩家的"人味"感知锚定在剧本而非生成文本上。

---

### 2.2 问题二：叙事与涌现（互动叙事与 NPC 自主性）

#### T9. 互动叙事经典理论（数字化叙事与叙事学）— 相关性：中高
- **定义**：互动叙事研究"故事如何与玩家行为耦合"：Murray 提出数字环境的"变形/沉浸/代理感"（agency 作为关键美学）；Ryan 区分互动叙事的类型学与"叙事作为虚拟现实"的沉浸条件；Riedl & Young 提出从线性故事生成到分支故事图的规划方法，是"叙事=可计算规划问题"的奠基。
- **关键文献**：Murray, *Hamlet on the Holodeck* (1997)；Ryan, *Narrative as Virtual Reality* (2001)；Riedl & Young, *From Linear Story Generation to Branching Story Graphs* (IEEE Computer Graphics & Applications, 2006)；近期工程化：2606.14411（Fabula：以叙事学理论指导的"场景/节拍"分层故事规划系统，42 名专家参与评估）。
- **对 chatgame 的启示**：
  1. **Agency 是互动叙事的核心美学**：玩家的每次输入都要产生可感知、可追溯的故事后果；引擎状态是"后果"的客观锚点。
  2. Fabula 的"层次化节拍结构"值得借鉴：剧本应定义场景级骨架（由引擎/剧本控制），LLM 在节拍内即兴——既保住叙事结构，又保留涌现空间。
  3. 分支故事图思想与 LLM 生成的结合点是"承诺管理"（见 T12）：剧本承诺的事件必须发生（引擎记入承诺列表），LLM 负责过程细节。

#### T10. 涌现叙事（Emergent Narrative）— 相关性：高
- **定义**：叙事不是预先写好的，而是从系统（角色目标、环境规则、玩家行为）的交互中"涌现"出来的；设计者的任务是设置角色动机与冲突空间，而非情节本身。
- **关键文献**：经典源头为 Aylett 及其合作者的 emergent narrative 研究（1999-2004，非 arXiv）；当代实现与实证：2304.03442（Generative Agents：25 个代理仅凭"想办情人节派对"这一初始设定，自主传播邀请、结交朋友、结伴赴会——涌现叙事的当代基准）；2411.10109（用访谈复刻 1,052 个真实个体的态度与行为）；2606.07513（Agentopia：100 个代理自主追求成长、发展关系、满足需求，模拟 10 年）。
- **对 chatgame 的启示**：
  1. 涌现叙事的工程配方（来自 2304.03442）：**记忆 + 反思 + 规划**三段式代理架构——记忆流（观察存档）、反思（高阶归纳）、规划（行动蓝图）。chatgame 的 NPC 系统应照此设计，但把"观察"换成引擎事件日志。
  2. 涌现需要**足够的代理自主权与冲突空间**：剧本应定义 NPC 的长期目标（欲望/秘密/计划），引擎保证世界规则一致，剩下的交给代理交互——"剧本给动机，系统给约束，故事自己长出来"。
  3. 实证警示（Agentopia）：长期模拟会产生丰富涌现行为，但需要**生活奖励/福祉目标函数**来引导——chatgame 需要为 NPC 定义"福祉驱动"（如声望、关系、安全）以防行为漂移。
  4. 成本现实：2304.03442 的完整架构昂贵；Lyfe Agents（2310.02172）证明可用选项-动作框架与 Summarize-and-Forget 记忆把成本降到 1/10~1/100——chatgame 应采用低成本变体。

#### T11. NPC 自主性与"受控自主"（Bounded Autonomy）— 相关性：高
- **定义**：LLM 角色在实时游戏中面临控制问题：既要自主地对话与行动，又要保证可执行（动作能被引擎解析）、社交一致（与世界状态一致）、可被玩家引导。受控自主 = 用架构显式划分"代理-代理交互、代理-世界动作、玩家-代理引导"三个接口。
- **关键文献**：2604.04703（Bounded Autonomy：概率回复链衰减 + 嵌入动作落地管道 + 轻量软引导 whisper 机制，部署于真实多人社交游戏）；2604.03091（CASCADE 三层架构：宏观状态导演 + 协调中枢 + 标签驱动 NPC，只在玩家面对时才调用 LLM，成本可控且行为可分化）；2607.17250（EvolvingWorld：角色代理与世界模型协同演化，开放 schema 支持多种文学世界）。
- **对 chatgame 的启示**：
  1. **动作落地管道**是必需品：NPC 的"叙事动作"（想离开、想送礼、想开战）必须翻译为引擎可校验的动作指令（结构化 JSON），非法动作被拒并回退——这正是"引擎管规则"的运行时含义。
  2. CASCADE 的成本分层极有价值：**低频世界演化用确定性状态机，玩家可见交互才调 LLM**——chatgame 的"离线世界推进"（NPC 在玩家不在时做什么）应优先用规则/脚本驱动，仅关键决策点用 LLM。
  3. 玩家引导接口（whisper 式的软控制）符合 SDT 的自主需求：玩家可影响 NPC 但不剥夺其自主性。

#### T12. 叙事一致性承诺与评估（长时程一致性）— 相关性：高
- **定义**：互动叙事中，模型必须"守约"——维持对剧情承诺（剧透事件、事实、角色立场）的长期一致性；该问题被形式化为 Narrative Commitment Preservation (NCP)。
- **关键文献**：2608.08160（NCP-Bench：100 个电影梗概派生的叙事环境；最优模型 GPT-5.2 在 20 轮后"承诺存活率"仅 42%，事实冲突率 40-68%；结论：语言质量高 ≠ 承诺保持好）；2605.08503（NARRA-Gym：可执行评估环境，9 个前沿模型在故事构建/记忆更新/节奏/移情个性化上的差异巨大）；2607.20767（Rushes：44,226 条真实玩家分支选择记录，前沿 LLM 在个体选择预测上打不过简单基线——人口级对齐不足）；2607.02802（CoC-Seduce：TRPG 裁判被"修辞注入"攻破——LLM 裁判不抗伪逻辑话术）。
- **对 chatgame 的启示**：
  1. **这是 chatgame 架构最有力的学术支撑**：NCP-Bench 证明"纯 LLM 叙事无法保持长期一致性"——因此"剧本承诺（主线事件、角色秘密、世界事实）由引擎记录与校验、LLM 只做局部即兴"是实证支持的必然选择。
  2. 引擎应维护**承诺/事实清单**（结构化的"世界真相"），在每次 LLM 输出后做一致性校验（可参照 2606.13348 IVIE 的符号校验层）。
  3. CoC-Seduce 警示：**不要把规则解释权完全交给 LLM**——关键规则判定应回到引擎的确定性代码，LLM 只裁决开放式情境，且玩家话术不能绕过引擎规则（这正是"引擎管规则"的另一层含义）。

#### T13. 神经符号混合（Neuro-symbolic）互动叙事 — 相关性：高
- **定义**：LLM 负责创意生成（设定、角色、谜题、文本），符号系统负责世界状态的一致性校验与变换；两者分工以兼顾"创造性与一致性"。
- **关键文献**：2605.24719（世界状态变换：LLM 预测状态变更、触发预编程变换，保持一致性同时保留表达自由，Llama-3-70B/Gemini 双语实验）；2606.13348（IVIE：四阶段增量生成管道，LLM 产出 + 符号校验落地为可玩 IF 世界，人类评估确认"一致性不杀死创造性"）；2608.04037（从叙事重建显式持久世界：实体/地点/关系/演化状态的结构化表示支撑一致的游戏化交互）。
- **对 chatgame 的启示**：
  1. chatgame 的"引擎状态 = 符号层，LLM 输出 = 生成层，输出经 schema 校验后落地为状态变更"就是标准的神经符号混合架构——文献表明这是当前唯一兼顾创意与一致性的路线。
  2. IVIE 的经验：校验只拦"不可能"，不拦"创意"；设计校验器时规则要少而硬（物理/因果/规则约束），而不是审美过滤。
  3. 2608.04037 提示可以把"持久世界表示"作为一级对象：从剧本反推世界模型（谁在哪、什么为真、关系如何），再让生成器基于它工作。

#### T14. 长叙事多代理生成与情节规划 — 相关性：中
- **定义**：用多个角色代理（各自有人格与世界状态视角）共同推进长故事，并对世界状态图做幻觉检测，以维持长文一致性。
- **关键文献**：2607.00918（MAGNET：人格化角色代理 + 共享世界状态 + 目标驱动叙事；ATLAS 图管道检测幻觉；100 页规模下比单模型减少 41% 注释错误、50% 幻觉）；2604.21253（PLOTTER：在事件图/角色图上做"评估-规划-修订"，优于直接文本规划）；2605.04831（StoryReward：首个故事偏好奖励模型基准，最好的奖励模型也只有 66.3% 准确率——故事偏好建模仍是开放问题）；2510.09869（NarraBench：叙事理解任务分类学，78 个基准中仅 27% 任务被现有基准覆盖）。
- **对 chatgame 的启示**：
  1. 若引入多 NPC 并行叙事，共享世界状态图（而非各自上下文里存文本）是减少幻觉的关键——与 T13 的"持久世界"结论一致。
  2. 长程剧情建议**先规划后生成**：剧本提供事件图，LLM 沿图生成；纯文本端到端生成长剧情在 100 页尺度上仍不可靠。
  3. "故事好不好"的自动评估仍是开放问题（66.3% 上限）——chatgame 评估叙事质量应以玩家行为（留存、重玩、选择熵）为主、LLM 打分仅作辅助。

#### T15. 叙事节奏与戏剧结构控制 — 相关性：中
- **定义**：用经典叙事弧（英雄之旅、三幕结构）约束生成内容的戏剧走向，以及用因果/悬念结构计算驱动张力管理。
- **关键文献**：2605.01245（Forking Garden：叙事弧条件化的分支关卡生成，用弧引导约束算法组装节点图）；2605.02475（Shadow-Loom：把叙事转为版本化图模型，用 Pearl 因果阶梯 + 悬念/惊奇/戏剧反讽四结构读者状态打分，LLM 只在抽取/渲染边界使用）；2606.14411（Fabula 的场景/节拍分层）。
- **对 chatgame 的启示**：
  1. 无限游玩需要**可复用的戏剧弧**：把"张力曲线"做成引擎参数（紧张-释放周期），LLM 按弧生成事件——既保证戏剧体验又保持开放。
  2. Shadow-Loom 的思路可移植：引擎维护"玩家已知信息 vs 世界真相"的差异，用于制造悬念与反讽（玩家知道 NPC 在撒谎，但角色不知道）——这是聊天游戏高价值的情感引擎。

---

### 2.3 问题三：可重玩性与无限游玩（程序化生成与持久世界）

#### T16. 程序化内容生成（PCG）— 相关性：高
- **定义**：用算法代替手工生成游戏内容（关卡/世界/物品/敌人），是可重玩性的经典工程手段；现代方向包括 RL 生成（PCGRL）、LLM 辅助生成与"高维 PCG"（把玩法机制维度纳入生成空间）。
- **关键文献**：Togelius 等的 PCG 研究体系（2011 起，非本次检索但为领域公认源头）；2602.18943（High-Dimensional PCG：把重力反转、平行世界等非几何机制维度纳入联合生成空间，是可验证的下一代 PCG 框架）；2509.09919（WFC 的马尔可夫形式化：局部约束与全局目标解耦优化）；2510.04862（PCG 作为多智能体 RL 问题：生成器模块化、泛化更好）；2606.03857（BSP+图遍历的 dungeon 生成，10 万地图 91% 连通性验证）；2512.10501（双代理 LLM 零样本配置 PCG 工具参数）。
- **对 chatgame 的启示**：
  1. chatgame 的"程序化内容"是**叙事内容**：事件、NPC 关系、支线、秘密。同样需要约束求解——剧本定义的约束（一致性、因果、世界观规则）是生成器必须满足的硬约束，可类比 WFC 的局部约束（2509.09919 的"约束满足与目标解耦"思想）。
  2. 高维 PCG 思想（2602.18943）对 chatgame 的映射：叙事生成的"维度"包括时间（世界推进）、关系图、信息差、资源分布——生成器应显式操作这些维度而非只生成文本。
  3. PCG 需要**验证回路**（见 T17）：生成的事件必须被引擎规则自动校验（可玩性/一致性），不合格则重生成。

#### T17. PCG 的评估（生成内容"好不好"）— 相关性：高
- **定义**：程序化生成的核心难点是没有人类设计师的审美判断；研究提出从玩家视角评估生成内容（可感知性、唤起性、行动召唤）与运行时自动验证。
- **关键文献**：2509.19030（Landmarks/Monuments/Beacons：从游戏研究与 Game AI 提炼玩家中心的三级概念——地标（可感知）、纪念碑（可唤起）、灯塔（召唤行动），用于自动化分解评估 PCG）；2605.01783（运行时 PCG 评估：双自主代理（空中扫描 + 地面遍历）在关卡到达玩家之前预检可玩性/多样性/可控性）；2408.06346（体验目标轨迹验证）。
- **对 chatgame 的启示**：
  1. 引入"灯塔"概念作为叙事生成器的**验收标准**：每个生成的事件应可感知（玩家能注意到）、可唤起（与已有记忆/关系相关）、召唤行动（给出可做的选择）——三条即 LLM 叙事输出的自动评分维度。
  2. 2605.01783 的"生成-预检-放行"流水线直接适用于 chatgame：LLM 生成事件草案 → 规则校验器（事实/因果/资源）预检 → 通过才进入玩家视野，避免"生成的剧情自相矛盾"出现在玩家面前。

#### T18. 无限游玩与开放世界（Open-Endedness）— 相关性：高
- **定义**：开放性是系统持续产生新颖、有趣、不可预测内容的能力（"最后一个宏大挑战"）；对 LLM 代理而言，问题是它们能否持续自主探索、提出自己的任务并积累知识。
- **关键文献**：2511.00529（即兴艺术 × 开放性：从舞蹈/音乐即兴专家访谈提炼"保持结构-惊奇平衡（混沌边缘）、非评判心流、内在动机维持趣味"等设计原则）；2510.14548（开放视角下的 LLM 代理：能自设任务、跨运行积累知识，但倾向重复生成任务、无法形成自我表征）；2606.24893（AgentOdyssey：程序化生成开放文本游戏，评估测试时持续学习——短时记忆是最有效的单一组件）；2508.15119（开放宇宙协助博弈：从开放对话中提取目标分布）；2509.17192（开放兵棋推演综述：按玩家/裁判创造性自由度构建本体论，LLM 作为裁判的注意事项）。
- **对 chatgame 的启示**：
  1. 2510.14548 的"重复任务生成"缺陷说明：**无约束的 LLM 无限生成会自我重复**——无限游玩不能只靠"生成更多"，必须靠引擎驱动的多样性（T5 的 novelty scheduling + T17 的验收标准）。
  2. 2511.00529 的"混沌边缘"原则可操作化：张力/惊喜参数保持在"可预测-不可预测"的临界带，由引擎根据玩家状态调节（连续受挫则收敛，连续平淡则加惊奇）。
  3. 2509.17192 的开放性本体论提醒：chatgame 应显式定义"玩家自由度和裁判（引擎+LLM）自由度"的分工边界，防止 LLM 裁判在开放情境中行为失控。

#### T19. 内在动机的计算理论（好奇心/赋能/自由能）— 相关性：中
- **定义**：把"内在动机"形式化为计算原则——学习进步（curiosity-as-learning-progress）、赋能最大化（empowerment）、信息增益、自由能最小化、最大占用原则等；这些理论解释开放行为的产生机制。
- **关键文献**：2601.10276（综述：目标-内在奖励-驱动-目标-外在奖励的层次组织，四种内在动机形式化）；2602.24100（Artificial Agency Program：好奇心=学习进步 + 资源受限代理的研究纲领，把内在动机与信息论/有界理性统一）。
- **对 chatgame 的启示**：为玩家（而非仅 NPC）做**好奇心驱动的动态难度/内容调度**提供了理论依据：内容调度器可近似"学习进度最大化"——每次提供"玩家当前模式略高一档"的新信息，与 T1 心流的挑战-技能匹配互为表里。

#### T20. Agent 长期记忆（写-管-读循环与记忆更新）— 相关性：高
- **定义**：LLM 代理的记忆 = 跨交互持久化、组织、选择性召回信息的写-管-读循环；2022-2026 年研究已产出机制分类学（时间范围×表示基底×控制策略）与专门诊断"事实更新/过期"问题的基准。
- **关键文献**：
  - 综述：2603.07670（Memory for Autonomous LLM Agents：写-管-读形式化、五类机制、开放挑战：持续整合、因果检索、可信反思、学会遗忘、多模态记忆）。
  - 记忆更新缺口：2606.27472（Supersede：把 LLM 全上下文换成自维护记忆后准确率 92%→77%；对话增长 24 倍时准确率从 68% 掉到 28%，且加内存无效——瓶颈是记忆维护而非理解；GRPO 可训练修复）。
  - 记忆引擎：2604.18478（WorldDB：内容寻址不可变节点 + 写时程序化边（supersede/contradict/same-as），LongMemEval-s 96.4%，比 HydraDB 高 5.61pp）；2608.08055（SodaMem：证据锚定的时间图记忆，92.8%）；2603.19935（Memori：语义三元组+摘要，81.95% 且仅用全上下文 5% token）；2606.09900（Engram：双时态知识图，精简配置 83.6% > 全历史 73.2%，token 少 8 倍）；2606.22877（DynamicMem：15 个月多应用档案基准，>93% 失败源于检索而非模型）。
  - 生命模拟：2606.07513（Agentopia：100 代理 10 年社会模拟，生活奖励训练提升代理福祉并泛化到角色扮演基准 +15.6%）。
- **对 chatgame 的启示**：
  1. **记忆不是"把历史塞进上下文"**：2606.09900 与 2606.22877 证明检索式精简上下文优于全历史（准确率更高、成本低一个量级）——chatgame 的 NPC 记忆应做成结构化存储 + 按需检索，而非对话历史拼接。
  2. **事实更新是最难的部分**：Supersede 的"记忆更新缺口"（规模增大不缓解）说明"NPC 属性记忆由引擎管理"不仅是架构选择，更是**实证必要的**——事实的当前值（装备、关系状态、承诺）应放在引擎的确定性存储里，LLM 记忆只做叙事性补充（印象、观点、情感），两者分离。
  3. 记忆应带**时间戳与来源**（SodaMem 的证据锚定、WorldDB 的不可变+替代链）：NPC 记忆的"我在三天前听说 X，后来发现是假的"正是关系深度的来源，也是 Shadow-Loom（T15）信息差叙事的记忆侧支撑。
  4. Agentopia 表明长期记忆+生活目标会涌现丰富社会行为，但需要福祉目标函数防漂移（同 T10）。

#### T21. 世界模型与状态追踪 — 相关性：中
- **定义**：语言世界模型学习环境状态转移（"预测下一步"），与 LLM 直接推理相比，显式状态空间上的推理更稳定（长程游戏胜率 79% vs 11%）。
- **关键文献**：2606.24597（Qwen-AgentWorld：35B/397B 语言世界模型，7 领域 1000 万轨迹训练，可作解耦环境模拟器与代理基础模型预热）；2605.23972（Flux：自然语言规则编译为显式状态转移模拟器后，RL 代理胜率 ~79% vs LLM 直接玩 ~11%——LLM 长程状态追踪不稳定）。
- **对 chatgame 的启示**：2605.23972 提供了"引擎为何必须持有状态"的硬证据：LLM 直接推理状态在长程游戏中失败率高；chatgame 引擎的确定性状态（背包/时间/关系/承诺）就是"显式状态空间"，LLM 只消费状态的叙事投影（POMDP 观察），这一架构与 2606.16014（T22）的形式化完全一致。

#### T22. LLM 驱动的持久世界模拟（GM 架构）— 相关性：高
- **定义**：把世界状态作为单一规范对象（canonical JSON 实体树），由一个类桌游 GM 的编排代理负责：状态只通过"计划-差异-校验-应用"（PDVA）管道以 schema 校验、内容哈希的 JSON 增量提交，玩家的观测是状态的叙事投影。
- **关键文献**：2606.16014（Orchestrated Reality：把 LLM 游戏世界形式化为参数化动作 POMDP：状态 = 规范 JSON 实体树，动作 a=(意图类型k, 结构化参数x_k)，观测 o=O(s) 为叙事投影，转移核 F 为 PDVA 管道；已部署 15 类事件实录，人类玩家研究为后续工作）。
- **对 chatgame 的启示**：这篇论文的架构与 chatgame 的"引擎管规则、LLM 管叙事"几乎同构，可作为**架构蓝图的直接引用**：
  1. 世界状态是引擎拥有的规范对象（JSON schema 校验），LLM 永远不能直接改状态，只能提交"增量提案"。
  2. 玩家看到的是叙事投影 o=O(s)，不是原始状态——这同时满足沉浸（不暴露数值）与可审计（状态与文本分离）。
  3. 单例 GM 编排 vs 多代理：作者指出单例编排是当前可行路线，多 NPC 并发代理是未来工作——chatgame 起步应采纳单例编排 + 受控 NPC 自主（T11）。

#### T23. AI-native 游戏综述（整体地图）— 相关性：高
- **定义**：以"运行时生成式 AI 是否构成核心循环的不可替代部分"为判据定义 AI-native 游戏，并给出 G/N 双轴分类法（玩家面向的游戏类型 × 主导 AI 机制）；核心设计问题被概括为"把语义开放性组织成稳定玩法"。
- **关键文献**：2607.00527（AI Native Games: A Survey and Roadmap：筛选 53 个 AI-native 游戏与原型；集中度高的方向：叙事冒险、认知交互、生成叙事；低覆盖方向：语义裁决、多代理模拟、生成建造、关系/陪伴玩法；结论：AI-native 设计依赖机械不变量——目标、规则、状态、反馈、节奏、玩家代理，使开放 AI 输出可解释、有后果）。
- **对 chatgame 的启示**：
  1. 综述确认 chatgame 所处的"叙事冒险/生成叙事"象限是当前最主流但也最拥挤的 AI-native 形态；差异化机会在低覆盖象限：**关系/陪伴玩法（NPC 长期关系记忆）与多代理模拟（活的小社会）**——chatgame 的"NPC 属性记忆由引擎管理"恰好是支撑这两个象限的架构。
  2. "机械不变量"清单（目标/规则/状态/反馈/节奏/代理）应成为 chatgame 每个剧本的**设计检查表**：剧本作者被要求显式回答"这六个不变量是什么"，防止剧本退化为无机制聊天。

#### T24. 持久世界的"生命力"（世界在玩家离线时演化）— 相关性：中
- **定义**：世界状态与角色状态随时间持续推进与演化，即使玩家不在场；研究重点是"如何让演化可信且与叙事承诺一致"。
- **关键文献**：2607.17250（EvolvingWorld：角色与世界的协同演化框架，开放 schema，57 本书构建 138,596 训练样本，10 维度 20 指标轨迹级评估）；2608.04037（从叙事重建持久世界的案例研究）；2606.07513（Agentopia 十年模拟）。
- **对 chatgame 的启示**：离线世界推进应遵循 CASCADE（T11）的成本分层：离线演化用确定性规则/脚本推进宏观状态，关键事件结果预生成（如"三天后拍卖会举行，若玩家缺席则 NPC X 拍得宝物"），玩家上线时通过叙事投影得知世界变化——让玩家感到"世界不因我下线而冻结"。

#### T25. 玩家长期行为一致性（跨游戏/跨会话）— 相关性：低
- **定义**：玩家个体行为跨环境具有一致性（专精 vs 灵活），游戏结构对行为的塑造弱于个体特质。
- **关键文献**：2603.16136（4,830 名跨游戏玩家行为分析：个体代理比游戏结构更能预测行为）。
- **对 chatgame 的启示**：为"玩家画像个性化"提供弱支持（个体差异真实存在且稳定），但短期不必做精细建模——先做剧本级粗粒度适配（T4）。

---

## 3. 对 chatgame 的总体设计启示（汇总）

以下是把上述理论压缩为可直接执行的架构/设计结论：

1. **分层即正确**：MDA（T2）、神经符号混合（T13）、POMDP-GM 架构（T22）与长程一致性证据（T12、T21）共同证明"确定性引擎状态 + LLM 叙事生成 + 叙事投影呈现"是当前唯一兼顾一致性、创造力与沉浸的路线。引擎持有规范状态（JSON schema 校验），LLM 只能提交经校验的增量，玩家只看到叙事投影。
2. **剧本承诺清单**：主线事件/角色秘密/世界事实作为结构化承诺由引擎维护，LLM 输出需过一致性校验（T12、T13）；关键规则判定回到引擎代码，不交给 LLM 裁判（T12 的 CoC-Seduce 警示）。
3. **NPC 记忆双轨制**：事实性记忆（当前值、时间戳、来源）放引擎确定性存储（T20 的 supersession 证据 + WorldDB/SodaMem 设计）；印象性记忆（观点、情感、传言）放 LLM 侧叙事记忆；检索式精简上下文优于全历史（T20）。
4. **NPC 分层成本架构**：离线/低频世界演化用确定性规则（CASCADE 思想，T11）；玩家可见交互才调 LLM；NPC 动作经"落地管道"翻译为结构化引擎动作，非法动作拒绝回退（T11）。
5. **叙事生成器带体验目标与验收标准**：引擎维护张力/新鲜度/难度目标轨迹（T6、T19），生成事件按"可感知-可唤起-召唤行动"三标准自动验收（T17），不合格重生成；节奏保持在"混沌边缘"（T18）。
6. **多样性管理防重复**：记录玩家已见模式，用 novelty scheduling 持续引入新模式（T5、T18）；"生成更多"不产生乐趣，"新模式"才产生。
7. **剧本检查表**：每个剧本必须显式回答目标/规则/状态/反馈/节奏/代理六个机械不变量（T23），并声明目标玩家动机通道（T4）。
8. **测量先行**：内置最小 PX 测量（内在动机简表 + 流失点遥测，T7），以玩家行为（留存/重玩/选择多样性）为主要质量指标，LLM 打分仅辅助（T14 的 66.3% 上限证据）。
9. **呈现策略**：内容风格层过滤 + 剧本锚定人味感知，规避"AI 生成"负偏见（T8）。
10. **差异化机会**：关系/陪伴玩法与多代理小社会是 AI-native 低覆盖象限，与"NPC 记忆由引擎管"的架构优势互补（T23）。

---

## 4. 参考文献列表

### 4.1 arXiv 论文（本次检索所得，按主题分组）

**涌现叙事与生成式代理**
1. Park et al., *Generative Agents: Interactive Simulacra of Human Behavior*, 2023. arXiv:2304.03442
2. Park et al., *Generative Agent Simulations of 1,000 People*, 2024. arXiv:2411.10109
3. Wang et al., *Agentopia: Long-Term Life Simulation and Learning in Agent Societies*, 2026. arXiv:2606.07513
4. Kaiya et al., *Lyfe Agents: Generative agents for low-cost real-time social interactions*, 2023. arXiv:2310.02172
5. Yu et al., *Affordable Generative Agents*, 2024. arXiv:2402.02053

**NPC 自主性与受控代理**
6. Guo et al., *Bounded Autonomy: Controlling LLM Characters in Live Multiplayer Games*, 2026. arXiv:2604.04703
7. Xu, *CASCADE: A Cascading Architecture for Social Coordination with Controllable Emergence at Low Cost*, 2026. arXiv:2604.03091
8. Zong et al., *EvolvingWorld: An Open-Schema Framework for Co-Evolving Role-Play Agents and World Model*, 2026. arXiv:2607.17250

**LLM 驱动的世界模拟与 GM 架构**
9. Huang et al., *Orchestrated Reality: From Role-Play to Living, Playable Game Worlds*, 2026. arXiv:2606.16014
10. Xu et al., *AI Native Games: A Survey and Roadmap*, 2026. arXiv:2607.00527
11. Matlin et al., *Shall We Play a Game? Language Models for Open-ended Wargames*, 2025. arXiv:2509.17192
12. Delafuente et al., *Does Reasoning Help LLM Agents Play Dungeons and Dragons?*, 2025. arXiv:2510.18112

**叙事一致性、承诺与评估**
13. Ma et al., *Can LLM Agents Stick to the Script? A Benchmark for Long-Horizon Consistency in Interactive Narratives (NCP-Bench)*, 2026. arXiv:2608.08160
14. Huang et al., *NARRA-Gym for Evaluating Interactive Narrative Agents*, 2026. arXiv:2605.08503
15. Xu et al., *Rushes: A Human Preference Dataset for Pluralistic Alignment*, 2026. arXiv:2607.20767
16. Chen et al., *Seduced by the Narrative: Assessing Rule Adherence in Semi-Open Textual Sandboxes (CoC-Seduce)*, 2026. arXiv:2607.02802

**神经符号互动叙事与持久世界**
17. Góngora et al., *World-State Transformations for Neuro-symbolic Interactive Storytelling*, 2026. arXiv:2605.24719
18. Vaucher et al., *IVIE: A Neuro-symbolic Approach to Incremental and Validated Generation of Interactive Fiction Worlds*, 2026. arXiv:2606.13348
19. Chen, *Reconstructing Persistent Worlds from Narratives for Narrative-Grounded Interactive Experiences*, 2026. arXiv:2608.04037
20. Wilmot, *Shadow-Loom: Causal Reasoning over Graphical World Model of Narratives*, 2026. arXiv:2605.02475

**长叙事生成与情节规划**
21. Aluru et al., *From Personas to Plot: Character-Grounded Multi-Agent Story Generation (MAGNET/ATLAS)*, 2026. arXiv:2607.00918
22. Gu et al., *Planning Beyond Text: Graph-based Reasoning for Complex Narrative Generation (PLOTTER)*, 2026. arXiv:2604.21253
23. Xia et al., *StoryAlign: Evaluating and Training Reward Models for Story Generation*, 2026. arXiv:2605.04831
24. Hamilton et al., *NarraBench: A Comprehensive Framework for Narrative Benchmarking*, 2025. arXiv:2510.09869
25. Wen et al., *The Garden of Forking Paths: Narrative Arc-Conditioned Gameplay Planning*, 2026. arXiv:2605.01245
26. Mirowski et al., *Fabula: Building a Narrative Storytelling Sidekick with the Writers' Community*, 2026. arXiv:2606.14411

**开放世界与无限游玩**
27. Hu, *On Improvisation and Open-Endedness: Insights for Experiential AI*, 2025. arXiv:2511.00529
28. Nachkov et al., *LLM Agents Beyond Utility: An Open-Ended Perspective*, 2025. arXiv:2510.14548
29. Zhang et al., *AgentOdyssey: Open-Ended Long-Horizon Text Game Generation*, 2026. arXiv:2606.24893
30. Ma et al., *Open-Universe Assistance Games*, 2025. arXiv:2508.15119

**程序化内容生成与评估**
31. Xu & Verbrugge, *High Dimensional Procedural Content Generation*, 2026. arXiv:2602.18943
32. Yiu et al., *A Markovian Framing of WaveFunctionCollapse*, 2025. arXiv:2509.09919
33. Earle et al., *Video Game Level Design as a Multi-Agent Reinforcement Learning Problem*, 2025. arXiv:2510.04862
34. Hervé et al., *Landmarks, Monuments, and Beacons: Understanding Generative Calls to Action*, 2025. arXiv:2509.19030
35. Kar, *Runtime Evaluation of Procedural Content Generation in an Endless Runner Game*, 2026. arXiv:2605.01783
36. Shu et al., *Experience-Driven PCG via Reinforcement Learning: A Super Mario Bros Study*, 2021. arXiv:2106.15877
37. Barthet et al., *Closing the Affective Loop via Experience-Driven Reinforcement Learning Designers*, 2024. arXiv:2408.06346
38. Hafnar & Demšar, *Zero-Shot Reasoning: Personalized Content Generation Without the Cold Start Problem*, 2024. arXiv:2402.10133
39. Barthet et al., *Generative Personas That Behave and Experience Like Humans*, 2022. arXiv:2209.00459

**Agent 长期记忆**
40. Du, *Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers*（综述）, 2026. arXiv:2603.07670
41. Patel, *Supersede: Diagnosing and Training the Memory-Update Gap in LLM Agents*, 2026. arXiv:2606.27472
42. Ganesan, *WorldDB: A Vector Graph-of-Worlds Memory Engine*, 2026. arXiv:2604.18478
43. Wan et al., *SodaMem: Evidence-Grounded Temporal Graph Memory for LLM Agents*, 2026. arXiv:2608.08055
44. Borro et al., *Memori: A Persistent Memory Layer for Efficient, Context-Aware LLM Agents*, 2026. arXiv:2603.19935
45. Wang, *Less Context, More Accuracy: A Bi-Temporal Memory Engine for LLM Agents (Engram)*, 2026. arXiv:2606.09900
46. Xie et al., *DynamicMem: A Long-Horizon Memory Benchmark in Real-World Settings*, 2026. arXiv:2606.22877

**世界模型与状态追踪**
47. Zuo et al., *Qwen-AgentWorld: Language World Models for General Agents*, 2026. arXiv:2606.24597
48. Alaswad et al., *Why We Need World Models for AGI: Where LLMs Fail and How World Models May Outperform*, 2026. arXiv:2605.23972

**内在动机的计算理论**
49. Moreno-Bote et al., *How Intrinsic Motivation Underlies Embodied Open-Ended Behavior*, 2026. arXiv:2601.10276
50. Csaky, *Artificial Agency Program: Curiosity, compression, and communication in agents*, 2026. arXiv:2602.24100

**玩家动机、体验测量与感知**
51. Kanwal et al., *Unveiling Gamer Archetypes through Multimodal Feature Correlations and Unsupervised Learning*, 2025. arXiv:2510.10263
52. Hsu et al., *Who embraces AI in play? Exploratory modeling of player preference profiles toward game AI*, 2026. arXiv:2605.09550
53. Bazzaz & Cooper, *Playing the Imitation Game: How Perceived Generated Content Shapes Player Experience*, 2026. arXiv:2602.14254
54. Bazzaz & Cooper, *Player Perceptions of Generative AI in Games: A Steam Review Analysis*, 2026. arXiv:2608.11539
55. Chen et al., *Social, Spatial, and Self-Presence as Predictors of Basic Psychological Need Satisfaction in Social Virtual Reality*, 2026. arXiv:2602.12764
56. Jarma Montoya et al., *Atari Games Challenge: A Pilot Study on Multimodal Player Experience Assessment*, 2026. arXiv:2605.27261
57. Devasia et al., *SAVEstate: A Method for Documenting Player Reflection in Digital Games*, 2026. arXiv:2607.17128
58. Chen et al., *Change is Hard: Consistent Player Behavior Across Games with Conflicting Incentives*, 2026. arXiv:2603.16136

### 4.2 经典书籍与理论文献（非 arXiv，任务指定的核心理论源）

1. Csikszentmihalyi, M. *Flow: The Psychology of Optimal Experience*. Harper & Row, 1990.（心流）
2. Hunicke, R., LeBlanc, M., Zubek, R. *MDA: A Formal Approach to Game Design and Game Research*. Proc. AAAI Workshop on Challenges in Game AI, 2004.（MDA）
3. Deci, E. L., Ryan, R. M. *Intrinsic Motivation and Self-Determination in Human Behavior*. Plenum Press, 1985.（SDT 奠基）
4. Ryan, R. M., Rigby, C. S., Przybylski, A. *The Motivational Pull of Video Games: A Self-Determination Theory Approach*. Motivation and Emotion, 30(4), 2006.（游戏 × SDT 实证）
5. Bartle, R. *Hearts, Clubs, Diamonds, Spades: Players Who Suit MUDs*. Journal of MUD Research, 1(1), 1996.（玩家类型）
6. Yee, N. *The Gamer Motivation Profile*（Quantic Foundry 玩家动机模型）, 2016. https://quanticfoundry.com（12 维度动机剖面）
7. Koster, R. *A Theory of Fun for Game Design*. Paraglyph Press, 2004.（乐趣=学习）
8. Murray, J. *Hamlet on the Holodeck: The Future of Narrative in Cyberspace*. MIT Press, 1997.（互动叙事/代理感）
9. Ryan, M.-L. *Narrative as Virtual Reality: Immersion and Interactivity in Literature and Electronic Media*. Johns Hopkins University Press, 2001.（互动叙事类型学）
10. Riedl, M. O., Young, R. M. *From Linear Story Generation to Branching Story Graphs*. IEEE Computer Graphics and Applications, 26(3), 2006.（叙事规划）
11. Salen, K., Zimmerman, E. *Rules of Play: Game Design Fundamentals*. MIT Press, 2004.（规则系统设计）
12. Schell, J. *The Art of Game Design: A Book of Lenses*. Morgan Kaufmann, 2008.（设计透镜法）
13. Short, T. X., Adams, T. (eds.) *Procedural Generation in Game Design*. CRC Press, 2017.（程序化生成与 roguelike 设计实践）
14. Yannakakis, G. N., Togelius, J. *Artificial Intelligence and Games*. Springer, 2018.（游戏 AI 综述教材，含 EDPCG）
15. Aylett, R. *Narrative in Virtual Environments: Towards Emergent Narrative*. Proc. AAAI Fall Symposium on Narrative Intelligence, 1999.（emergent narrative 概念源头，经典会议论文）
16. Wardrip-Fruin, N. *Expressive Processing: Digital Fictions, Computer Games, and Software Studies*. MIT Press, 2009.（过程化表达与模拟）

---

## 5. 未解决问题（对本框架的开放风险）

1. **长时程叙事承诺保持仍是硬伤**：最优模型 20 轮后承诺存活率仅 42%（NCP-Bench, 2608.08160）。引擎承诺清单能缓解但无法根除；"引擎校验粒度"（哪些承诺入引擎、哪些留给 LLM）本身是开放设计问题。
2. **记忆更新的 supersession 缺口未被模型规模解决**：事实更新准确率随对话增长而崩（28%），加内存无效（Supersede, 2606.27472）；NPC 记忆中"观点演化"（昨日信、今日疑）如何不污染事实层，缺成熟方案。
3. **个体化玩家建模不足**：人口级对齐模型预测个体选择不如简单基线（Rushes, 2607.20767）；个性化剧本适配缺乏轻量可行方案（当前选项：粗粒度动机通道 + 行为遥测，但无权威方法）。
4. **LLM 裁判/规则解释的鲁棒性**：20 个目标裁判模型普遍被"伪逻辑"修辞注入攻破（CoC-Seduce, 2607.02802）；"引擎裁决 + LLM 即兴"的边界如何应对玩家社会工程，需要产品级规则设计。
5. **故事质量的自动评估无共识**：最好的故事奖励模型仅 66.3% 准确率（StoryRMB, 2605.04831）；"无限游玩"的质量验收高度依赖玩家行为代理指标，如何定义"叙事新鲜度"度量是空白（PCG 侧已有 Landmarks/Beacons 思路，叙事侧尚无对应物）。
6. **无限生成的模式重复**：LLM 开放代理倾向生成重复任务（2510.14548）；novelty scheduling 的工程实现（模式指纹、去重、渐变调度）无现成方案，需自研。
7. **成本经济性**：完整生成式代理架构（Generative Agents）在真实游戏中成本过高；低成本变体（Lyfe Agents、CASCADE）牺牲了部分涌现深度；"多少 LLM 调用/会话"的预算分配缺乏指导数据。
8. **玩家对 AI 内容的负偏见**：感知即现实（2602.14254、2608.11539）；AI-native 定位的沟通策略与"人味"呈现层设计属于产品研究问题，学术上无解。
9. **离线世界演化的可信度**：世界在玩家不在时的推进（EvolvingWorld 是研究原型，非产品）可能产生与玩家期待冲突的不可逆后果；"可逆性/回滚"策略未被研究。
10. **涌现叙事的评估方法**：NARRA-Gym 等基准以 LLM-as-judge 为主，与真实玩家体验的相关性未被验证；"涌现好故事"vs"一致世界"的双目标平衡缺乏度量。

---

*报告完。所有 arXiv 条目均来自本会话 2026-08-18 的检索结果；经典书籍为任务指定的理论源并以出版信息列出。*
