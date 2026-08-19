# NPC 长期记忆与遗忘机制调研

- 调研日期：2026-08-19
- 触发：对现有 NPC 记忆机制（脚本写入 + 分级硬保留天数 + 取最新 8 条注入）"不够 solid"的质疑，重点在遗忘与检索。
- 范围：学术文献（arXiv，15 篇核心，2023-04 至 2026-08）+ 业界实践（生成式智能体、商业游戏/角色产品、开源框架、社区）双线并行，与仓库内既有调研交叉验证。
- 结论摘要：现有机制方向正确但只实现了业界共识的一个子集——写入分层 ✅、遗忘（硬天数）⚠️ 半套、检索 ❌（纯 recency）；缺"事实被推翻"的更新路径。业界与学术界高度收敛于同一套模式，且全部可在不违反"引擎管状态"（I3）的前提下确定性补齐。

## 来源清单

### 学术（论文原文 / arXiv）

| 论文 | arXiv | 年份 | 相关主题 |
|---|---|---|---|
| Generative Agents: Interactive Simulacra of Human Behavior（UIST'23） | 2304.03442 | 2023 | 记忆流、检索评分、反思、NPC 记忆鼻祖 |
| MemoryBank: Enhancing LLMs with Long-Term Memory | 2305.10250 | 2023 | Ebbinghaus 遗忘曲线、分层存储、AI 陪伴 |
| MemGPT: Towards LLMs as Operating Systems（ICLR'24） | 2310.08560 | 2023 | 分层内存、换页、主动驱逐 |
| A Survey on the Memory Mechanism of LLM based Agents | 2404.13501 | 2024 | 早期设计模式综述 |
| HippoRAG（NeurIPS'24） | 2405.14831 | 2024 | 知识图谱记忆、多跳检索 |
| LongMemEval（ICLR'25） | 2410.10813 | 2024 | 长期记忆基准：更新/拒答能力 |
| A-MEM: Agentic Memory for LLM Agents | 2502.12110 | 2025 | 记忆演化（改写旧记忆、保留链接） |
| Rethinking Memory in AI: Taxonomy, Operations, ... | 2505.00675 | 2025 | 遗忘作为一等操作的六原子框架 |
| Memory for Autonomous LLM Agents（综述） | 2603.07670 | 2026 | 写-管-读循环、开放挑战（学会遗忘） |
| MemArchitect: Policy Driven Memory Governance | 2603.18330 | 2026 | 显式策略层：衰减 + 冲突解决 |
| From Recall to Forgetting: Benchmarking ... (Memora) | 2604.20006 | 2026 | 失败模式证据：复用失效记忆、FAMA 指标 |
| Learning What to Remember: Multi-Factor Value Model | 2606.12945 | 2026 | 七因子价值函数；recency 保留率 0.368 vs 0.770 |
| Temporal Validity in Retrieval Memory (MemStrata) | 2606.26511 | 2026 | 双时态账本、失效而非删除、陈旧事实污染 |
| Caching for the Future: Scrub Jay Episodic Memory | 2608.04746 | 2026 | 逐条类型化衰减优于统一 tier 归档（消融 5.7×） |
| LARP: Language-Agent Role Play for Open-World Games | 2312.17653 | 2023 | 游戏 NPC 角色扮演认知架构 |

候选扩展：2512.12818（Hindsight）、2605.20616（Auto-Dreamer）、2606.09900（Engram）、2608.08055（SodaMem）、2505.12814（PsyMem）、2602.01313（EverMemBench）、2508.19828（Memory-R1）、2412.15266（Structural Memory）、2601.05215（MineNPC-Task）。

### 商业产品 / 官方文档

- AI Dungeon Memory System（help.aidungeon.com/faq/the-memory-system、/faq/what-goes-into-the-context-sent-to-the-ai）：压缩（Auto Summarization）+ 检索（Memory Bank，embedding 相关性排序）；Memory Bank 满时淘汰 least-used（LRU），被频繁使用的旧记忆可永久保留；摘要每 15 actions 滚动压缩、细节记忆每 6 actions 一个；从 Voyage 移植时故意不带游戏状态（health/quests/inventory 留在 Voyage）。
- Character.AI 记忆 blog ×2（blog.character.ai/memory/）：2026 三层 = Story Memory（用户可写/pin、受保护不被整理清掉）+ Facts（自动抽取可编辑、可跨新聊天复制）+ Memory Usage 可视化；官方承认后台"tidies older context and keeps what matters"。
- Convai LTM（convai.com/blog/long-term-memeory）：Mimir 分层（scene-aware short/medium/long-term）；LLM 提取摘要 + importance 评分；混合检索（语义 + BM25）+ importance log₁₀ 缩放 + 高斯 recency 偏差防旧记忆主导；per-speaker 记忆树做隐私隔离；明确引用 Lost-in-the-Middle 作为不依赖大窗口的理由。
- Inworld（inworld.ai/blog/introducing-long-term-memory）：广告长期记忆（知识检索、跨会话关系），公开实现细节极少，公司已转型语音基建。
- Kindroid：社区一致认为其 memory book（用户可编辑记忆库）是同类最佳；"用户决定哪些记忆重要"本身是产品功能。（注：调研目标曾写 "Kindred"，实为 Kindroid。）

### 开源框架（官方 docs / GitHub）

| 框架 | 提取 | 存储 | 检索/评分 | 遗忘 |
|---|---|---|---|---|
| Mem0 | LLM 抽取事实（ADD-only、去重、实体链接） | 向量 + 图（实体）+ SQL 历史 | 语义 + BM25 + 实体 + 时间四信号融合 | 无自动遗忘，显式 update/delete |
| Zep/Graphiti（arXiv:2501.13956） | LLM 抽取实体/关系/事实，带 validity window | 时序知识图谱 + episodes provenance | 语义 + BM25 + 图遍历混合 | 事实失效（invalidate）不删除 |
| LangMem | LLM 结构化提取（trustcall schema）+ thread 摘要 | LangGraph store，namespace 隔离 | 语义检索；核心记忆常驻 | Reflection 更新/淘汰（LLM 决策） |
| Cognee | ECL：抽取→图+向量（LLM 实体/关系） | 知识图谱（Kuzu）+ 向量（LanceDB） | 向量 + 图遍历（多跳） | Memify 后处理：清 stale 节点、重加权 |
| Letta/MemGPT | 对话→核心记忆块更新（LLM 决策） | 内存块 + MemFS（git） | 常驻核心块 + 分页 | 记忆压力换页 + dreaming 整合 |

### 社区实践

- SillyTavern：角色卡 + 世界书（关键词触发注入）+ 摘要记忆三件套是社区事实标准；关键实证：纯摘要丢细节，需 raw 日志 + summary 混合、检索块加 padding（细节只在 raw 里）。
- Event[0] 访谈：把"AI 记忆残缺"直接写成角色设定（老化飞船 AI），技术缺陷转叙事资产——游戏内叙事性遗忘的唯一案例。
- Respan 一致性工程文：把"重要事件"做成常驻/可检索状态（即 chatgame 已有的状态层），缓解 NPC 重复给已完成任务。

### 仓库内既有调研（交叉验证）

- docs/research/2026-08-18-similar-ai-games.md（Character.AI/AI Dungeon/SillyTavern/Generative Agents 已有分析）
- docs/research/2026-08-18-game-theory-academic.md（T20 Agent 长期记忆、2603.07670 综述）
- docs/research/2026-08-18-methodology-playability.md（E3 记忆系统是关系驱动的引擎；RimWorld 记忆→情绪→崩溃因果链）
- docs/research/2026-08-18-hybrid-state-descriptions.md（TRUSTMEM：LLM 主动管理记忆产生污染/遗漏/捏造——支持 I3）

## 要点提炼

### 1. 检索：业界无一例外是加权打分，不是取最新

- Generative Agents：`score = α·recency + β·importance + γ·relevance`；recency 按距**上次访问**的指数衰减（官方实现 0.995 底数）；importance 写时打分；relevance 语义相似度。消融证明"检索不到相关记忆"是最大错误源之一。记忆条目含创建时间戳 + 最近访问时间戳（last access）。
- Mem0 四信号（语义 + BM25 + 实体 + 时间）、Convai 混合检索 + importance 缩放 + 高斯 recency 偏差、Zep 混合检索 + 图遍历——全部收敛于同一公式族。
- 对 chatgame：取最新 8 条 = 只实现 recency 一个因子；一个 trivial 但高度相关的记忆（"欠了玩家一个人情"）在相关时刻永远不会被注入。

### 2. 遗忘：连续强度 + 访问强化，无人用纯硬天数当最终形态

- MemoryBank：Ebbinghaus 曲线 `R = e^(-t/S)`，S 为记忆强度、首次提及初始化为 1、**每次被检索到时 S+1**（spaced repetition：复习重置遗忘曲线）；遗忘由"时间流逝 + 相对重要性"共同决定。
- AI Dungeon：LRU 淘汰——被频繁使用的旧记忆可永久留在库中（访问强化的工程形态）。
- Scrub Jay（2026）：每条记忆带可腐坏系数 πᵢ 与效用时域 τᵢ，按内容类型差异化衰减；消融衰减使 GenGap 崩塌 5.7×——逐条类型化衰减优于统一 tier 归档，与 importance tier 互补而非冲突。
- MemoryAgentBench：把 selective forgetting 列为记忆 agent 四大核心能力之一，现有系统普遍未达标。
- 对 chatgame：`archived` 布尔 + 硬天数 = 二值遗忘，无强度连续值、无访问强化、无逐条类型化。

### 3. 更新：append-only 无失效 = 最大的隐藏风险

- Memora（2026）：append-only 记忆 + 不失效更新 = 频繁复用无效记忆、无法调和演进记忆；FAMA 指标专门惩罚依赖过期/失效记忆。
- MemStrata（2026）：事实被取代后，向量检索几乎分不出新旧（AUROC 0.59 ≈ 随机）；双时态账本 + 确定性取代规则把陈旧事实污染从 15–40% 降到 ~0%。**"失效而非删除"是唯一可靠解法**。
- 路线之争：Mem0 主张 ADD-only + 显式删除（自动遗忘 = 信息丢失风险）；MemoryBank/游戏侧主张自动遗忘（拟人、叙事需要）。游戏场景更偏后者，但应让剧本作者可控。
- 对 chatgame：记忆只增不改，被推翻的事实（"欠 20 金币"→ 已还）永远留在列表里污染检索；`archived` 标记与 supersede 语义同构，但无任何触发机制。

### 4. 分层：三层结构是独立收敛的共识

原始流（episodes）→ 提取事实（facts）→ 摘要（summary），每层不同衰减与注入策略（MemoryBank、AI Dungeon、Character.AI、SillyTavern 各自独立收敛到同一形状）。核心原则：**保留原始、只影响"注入什么"**（Graphiti episodes、Mem0 SQL 历史、AI Dungeon 原始 actions 均保留可追溯）。

### 5. 已知失败模式与缓解

| 失败模式 | 缓解（业界收敛） |
|---|---|
| recency 偏差（最新主导、旧重要事实丢失） | importance/relevance 加权、LRU 反淘汰、重要性缩放 |
| lost in the middle（大上下文中间信息利用率骤降） | 只注入精选记忆而非堆全文（Convai 明确引用该论文） |
| 纯摘要丢细节 | 摘要 + 原始双轨 |
| 事实冲突/陈旧 | Mem0 保留双版本（LLM 用时间判断）、Graphiti invalidate、Character.AI 用户可编辑 Facts |
| 人物漂移/任务重复 | 把"重要事件"做成常驻/可检索状态（= chatgame 状态层） |
| "记得一切"反而损害体验 | 好的记忆 = 记住该记的、忘记不该留的（陪伴社区共识） |

### 6. 争议与空白

- 自动遗忘 vs 显式管理（MemoryBank vs Mem0）——游戏场景偏前者，但需作者可控。
- 重要性 vs 相关性主导（遗忘决策 vs 检索决策）——2026 观点：两个时点应使用不同价值函数（写时重要性 ≠ 查询时相关性），勿混用。
- **游戏 NPC 记忆一致性在学术上几乎空白**：无专门研究，最接近的是 LARP（2312.17653）与角色扮演方向（PsyMem/Character-LLM/ChatHaruhi）；结论需从对话 agent 文献外推。
- 硬天数有可解释性优势（作者可预测），业界最多把它当粗粒度下限。

## 对 chatgame 的启示

### 现状核实（2026-08-19；2026-08-20 已按本调研落地）

| 维度 | 现状（落地后） | 差距 |
|---|---|---|
| 写入 | 引擎 effect 唯一写入（I3），worldgen 播种初始记忆 | ✅ 差异化优势（防幻觉污染，TRUSTMEM 佐证）；提取需确定性替代方案 |
| 检索 | `selectMemories` 打分 top-K：strength + 相关性加成（tag 命中 npc/location/输入），平局按 createdAtDay 稳定排序 | ✅ 已落地（替代纯 recency 注入） |
| 遗忘 | 连续强度 `strength`（0–1，按层级初始），日界按 `tier_retention_days` 曲线衰减，跌破阈值归档；注入时强化（`ACCESS_BOOST` + `lastAccessedDay`） | ✅ 已落地（替代硬天数二值归档） |
| 更新 | memory effect 支持 `replaces`：旧条目归档 + `supersededBy`，注入只给新版 | ✅ 已落地（替代 append-only） |
| 分层 | 单一列表 + importance tier；摘要压缩占位已删除 | ✅ 死配置清除；LLM 摘要层留 V2 |
| 标签 | tags 字段由 effect 写入，参与相关性检索 | ✅ 已落地（替代运行时硬编码 `[]`） |
| 关系记忆 | 关系状态独立存在（relations matrix） | ✅ 天然单一事实源，可派生关系类记忆 |

### 可落地的 5 个模式（全部确定性、不违反 I3）

1. **相关性检索替代纯最新**（收益最大、成本最低）：`score = α·tag/关键词相关 + β·importance + γ·recency衰减(距今天数)`，注入 top-K 而非最新 8 条。tags 字段已存在，只需约定剧本作者在 memory effect 里声明标签。
2. **访问强化 + 连续衰减**：加 `strength`（0–1）与 `lastAccessedDay` 字段；日界按层级平滑衰减（把现有 tier_retention_days 平滑化为曲线）、被注入时强化（对应 MemoryBank S+1 / Generative Agents last-access）；`archived` 保留为最终二值结果，由连续强度阈值触发——字段与现有存档兼容。
3. **supersede 语义**：memory effect 增加可选 `replaces: <id>`，注入时只给最新版、旧版归档；剧本作者显式处理"事实变了"（身份转变、关系破裂），比 Graphiti 全自动 invalidate 更轻、更可控。
4. **记忆分 kind（事件/关系/事实/人格）**：关系类记忆由引擎从关系状态派生（单一事实源），事件类走现有 effect；不同 kind 不同衰减与注入时机（关系类常驻、事件类按相关性）。与现有 `meta_progression.keep: [lore, relations_overview]` 方向一致，正规化即可。
5. **日界整合层（确定性代理摘要）**：日界把当日记忆按场景/标签分组为"当日事件"单元（规则驱动，零 LLM），注入时先给当日组、再给检索到的历史组；未来如需 LLM 摘要，作为剧本显式效果（作者 declare 时才调用）而非框架默认行为——保住确定性。

### 不建议

- 引入 LLM 自动写记忆（违反 I3；TRUSTMEM 证据：LLM 管理记忆产生污染/遗漏/捏造）。
- 引入 embedding/向量库作为必需品（可后置为可选增强；MemStrata 证明纯向量在事实演化时不可靠）。
- 完全照搬 Mem0 ADD-only（游戏需要遗忘作为叙事特性）。

## 未解决问题

- Generative Agents 公式数值（0.995 底数、权重）来自论文正文 + 官方实现复现，未逐字核对 PDF（高置信，需时以 PDF 复核）。
- Character.AI / Inworld 内部实现无公开技术文档（官方只发公告）。
- SillyTavern 官方文档抓取失败，机制结论来自官方 FAQ（Reddit 转载）+ 社区工作流。
- 2026 年多篇关键论文为单作者 preprint，未经同行评审，数字谨慎采信（MemStrata、Engram、SodaMem、SuperLocalMemory 等）。
- 游戏内"遗忘作为叙事设计"只有 Event[0] 单案例，无系统研究。
- LongMemEval/LoCoMo/MemoryAgentBench 基准结果未逐一核对，仅作引证。
- 若未来确认要引入 LLM 提取管道（违反现有 I3），需架构决策讨论。
