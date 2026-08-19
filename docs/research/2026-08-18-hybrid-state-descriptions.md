# 调研：数值 + 描述双轨状态（hybrid numeric-textual state）设计实践

- 调研日期：2026-08-18
- 调研范围：传统模拟/策略/叙事游戏的关系系统（The Sims 4 与 Lovestruck、Dwarf Fortress、RimWorld、Crusader Kings 3、Fire Emblem、Persona 5、Stardew Valley、Disco Elysium）→ LLM 驱动的角色/记忆系统（Generative Agents、Humanoid Agents、Lyfe Agents、AI Dungeon、Character.AI、SillyTavern、星野/Talkie、Inworld）→ 学术证据（一致性与可信度）→ 社区工程实践
- 信息来源：官方 wiki/文档/公告、学术论文（arXiv）、社区讨论（Reddit/Steam 论坛）、开源项目、二手报道
- 决策落点：引擎双轨状态设计（label 确定性 + description LLM 层）见 [决策记录 0007](../../docs/decisions/0007-engine-runtime.md) 与 [docs/game-design/engine-runtime.md](../game-design/engine-runtime.md)

## 核心结论

双轨设计（数值强度 + 质性表达）在传统游戏中是 30 年主流，但传统先例的质性层全部是手写/确定性生成；LLM 让质性层动态化可行，前提是**描述与数值物理隔离、单向生成、可校验可降级**。业界共识为"数值唯一事实源 + 确定性分类层 + 生成解释层"三层物理分离、**描述不参与判定**。

## 来源清单

- The Sims 4 关系条 + 头衔矩阵（Sims Wiki Relationship / Lovestruck）
- Dwarf Fortress 记忆即关系（Dwarf Fortress Wiki）
- RimWorld thoughts = 具名状态条目：名字+文本+数值+原因，判定用求和、文本不参与（RimWorld Wiki）
- Crusader Kings 3 opinion = modifier 列表之和，可审计（Paradox wiki）
- Fire Emblem Support / Persona 5 / Stardew Valley：阈值 + 手写里程碑事件
- Disco Elysium Thought Cabinet：标题+质性描述+数值效果同体展示
- arXiv：2304.03442（Generative Agents）、2310.05418（Humanoid Agents）、2312.17115（SimulateBench）、2507.02197（Belief-Behavior Consistency）、2606.25161（TRUSTMEM）、2601.02845（TiMem）、2509.11860（MOOM）、2402.18659（LLM and Games survey）
- AI Dungeon 官方记忆文档、OnlyKin AI Roleplay Memory 综述（2026-05）、品玩星野羁绊报道（2025）
- @ai-rpg-engine/core、r/LocalLLM 共识贴、DiceTales

## 要点提炼

### 传统先例（30 年双轨主流）

- **Sims 4**：关系条（数值）+ 头衔矩阵（确定性映射），数值→质性的确定性映射是成熟范式；Lovestruck 扩展了动态化关系文本。
- **Dwarf Fortress**：记忆即关系——每个关系事件都是结构化条目，世界模拟直接消费。
- **RimWorld**：thoughts = 具名状态条目（名字 + 文本 + 数值 + 原因）；判定用数值求和，文本纯粹展示——最接近本设计的三层分离。
- **CK3**：opinion = modifier 列表之和，每个 modifier 可审计、可溯源。
- **火纹/P5/星露谷**：阈值 + 手写里程碑事件（对话/场景），阈值是触发条件而非文本生成。
- **Disco Elysium**：Thought Cabinet 标题 + 质性描述 + 数值效果同体展示——质性层与数值层并列呈现给玩家。

### LLM 时代的产品与原型

- **Generative Agents**：纯 LLM 反思无数值锚 → 状态漂移；社区复现需加数值锚。
- **Humanoid Agents**：数值需求/情绪/亲密度 + 生成式行为 = "引擎数值 + LLM 叙事"最接近的学术先例。
- **Character.AI**：三层记忆（长期 Facts 可编辑），LLM 产出但用户可修正。
- **星野**：LLM 生成关系里程碑标记、可编辑。
- **AI Dungeon**：记忆重构为纯 LLM 记忆，仍是最差体验——纯 LLM 记忆不可靠。

### 学术证据（为什么 LLM 不能写状态库）

- **SimulateBench**（2312.17115）：LLM 与设定一致性显著不足。
- **Belief-Behavior Consistency**（2507.02197）：自述信念 ≠ 实际行为。
- **TRUSTMEM**（2606.25161）：LLM 主动管理记忆产生污染/遗漏/捏造三类持久错误；验证器降错 40-79%。
- **社区共识**（r/LocalLLM、@ai-rpg-engine）：不可变事实存储 + 工具化执行器 + LLM 不能直接写数据库；"幻觉被自动否决，最坏情况是 flavor text 与规则无矛盾"。

## 三层分离模型（chatgame 落地）

- **计算层**：数值（引擎）——唯一可参与判定
- **分类层**：确定性标签/头衔/modifier（规则或模板）——可展示、可解锁互动、可参与判定
- **解释层**：动态文本（LLM 或手写）——只解释、只展示、**不判定**

### 描述更新触发（三级）

1. 事件触发（首选）：里程碑/重大剧情事件 → 立即 stale + 重生成
2. 阈值触发：数值跨区间 → 标记 stale，下次读取惰性重生成
3. 定期兜底（可选）：低频整体检查

### 哪些状态配描述（优先级）

- 高：关系值（-100~100，核心）、声望、记忆/关系事件
- 中：属性（惰性）、需求（具名原因条目）、状态效果（确定性模板为主）
- 低/不配：hp、货币、物品数量、时间（纯量化）

### 一致性风险对策

1. 数值唯一事实源，LLM 物理上只能写描述字段
2. 生成输入锚定：当前数值 + 区间语义（剧本映射表）+ 近期事件 + 角色人设
3. 确定性兜底模板（RimWorld thought 风格），生成失败/校验不过降级
4. 低成本校验（极性/关键词匹配区间），不过重试一次或走模板
5. 描述可编辑（玩家/作者），编辑不影响数值
6. stale 机制：跨区间标记过期，惰性重生成
7. 双方关系描述允许单向差异（Sims 双条/RimWorld 单向 opinion 先例）

## 对 chatgame 的设计建议（已采纳）

- 数据模型：`State`（数值，引擎写）+ `Descriptor`（label 确定性标签 + description ≤300 字 LLM 写 + version/generatedAt/stale + sourceEvents 引用）+ `EventLog`（结构化事件：时间/actor/target/类型/数值增量/情感倾向/文本摘要，作为描述素材库）
- 关系三步形态：数值（引擎增减）→ 关系标签（剧本声明区间映射 + 里程碑事件确认，参与判定解锁互动）→ LLM 描述（解释质性，不参与判定）
- 注入分层：常驻注入短标签+区间语义；按需注入描述（World Info 式对象匹配）；UI 显示数值条+标签+描述
- 区间映射表/里程碑/模板兜底由剧本声明（剧本驱动原则），LLM 描述是剧本之上的自由层

## 未解决问题

1. 描述校验（极性/区间一致性）工程误判率无公开数据，需原型验证
2. 描述多次重生成后语义漂移累积（"基于上版改写" vs "基于事件重建"待评估）
3. 区间映射表归属（剧本声明 vs 引擎默认）待规格化验证
4. 核心里程碑（告白/决裂）手写/生成边界判定标准未定
5. 300 字上限是工程约束非用户研究结论
6. Character.AI/星野/Inworld 内部实现未公开，细节可能过时
