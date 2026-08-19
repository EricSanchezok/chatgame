# 决策日志

每个决策——架构或流程——都只在一个地方：本目录。这是统一决策日志：架构决策与流程决策共享同一格式、同一生命周期、同一门禁。不存在第二套体系。

## 格式

格式为 **MADR（Markdown Any Decision Records）**，带一个文档化的 `Class:` 扩展。命名与结构遵循行业标准，现有 MADR 工具可直接解析；扩展对不认识它的工具透明。

决策记录是直接位于本目录的 `NNNN-title.md` 文件（4 位零填充编号、`-`、kebab-case 标题）。编号顺序分配；编号是记录的身份，永不改变。

### 必选章节

每条记录恰好包含以下 `##` 章节，按此顺序：

1. `## Status`
2. `## Context and Problem Statement`
3. `## Decision Drivers`
4. `## Considered Options`
5. `## Decision Outcome`
6. `## Pros and Cons of the Options`
7. `## Links`

`## Links` 可以为空（"None."）但必须存在。`## Links` 之后可以按需追加其他 `##` 章节。

### 状态行

`## Status` 下的第一个非空行是状态值。合法值：

- `Proposed` — 正在考虑的决策；尚未交付。
- `Accepted` — 决策已交付；记录描述现状。
- `Rejected` — 曾考虑并否决；只要其理由能防止一个诱人的、有意义的错误就保留。
- `Deprecated` — 不再推荐；被一条链接的记录取代。
- `Superseded by [NNNN](NNNN-title.md)` — 被更新的记录取代；目标必须存在。

状态为 `Accepted`、`Deprecated` 或 `Superseded by …` 的记录描述当前或已冻结的现实。它永不改写成相反决策：要改变决策，新增一条记录并把旧记录标记为 `Superseded by NNNN`。两条记录都保留，交叉链接。

### Class 行（扩展）

状态值之后的紧邻行可以是 `Class: <value>`。它给决策分类：

| Class | 覆盖 |
|---|---|
| `architecture` | 交付源码的结构：模块、边界、运行时词汇 |
| `process` | 代码周边的工具、政策、工作流：门禁、包管理器、约定 |
| `testing` | 测试基础设施与策略 |
| `feature` | 新的用户或模型可见能力 |
| `bug-fix` | 修正缺陷或填补 postmortem 暴露的缺口 |
| `simplification` | 移除代码、行为或表面积，不新增能力 |

`Class:` 行缺失是合法的（它是扩展）；非法值是违规。

## 生命周期

决策从 `Proposed` 开始。实现后状态变为 `Accepted`，记录与交付保持一致（仅事实——名称、路径、结构——不是决策本身）。被否决的提案是 `Rejected`；只有当其理由不再能防止一个貌似可信的错误时才删除。过时的 accepted 决策变为 `Superseded by NNNN` 或 `Deprecated`；绝不编辑成相反决策。

## 写作规则

- 每个非平凡改动包含至少一条新决策记录或更新一条既有记录，且在同一改动内。"非平凡"指改变行为、架构、跨文件共享的契约、流程或工具、测试策略，或维护者可能合理重审的决策。
- 陈述决策、它赢过了谁、放弃了什么。`## Considered Options` 列出真实的备选方案；`## Pros and Cons of the Options` 记录输家为何输。没有备选方案的决策会被反复重提。
- 用相对 Markdown 链接交叉引用记录（`[0001](0001-title.md)`），绝不裸编号。
- 记录当前现实，不写变更历史。变更故事进 commit；决策记录陈述活契约。

## 门禁

`scripts/verify-decisions.mjs` 强制：文件命名、唯一顺序编号、必选章节、合法状态值、出现时合法的 `Class:` 值、`Superseded by NNNN` 目标存在。任何违规退出非零。门禁由 `scripts/install-hooks.mjs` 安装为 pre-commit hook，也可单独运行。

## 索引

- [0000 — 使用 Markdown 架构决策记录（MADR）](0000-use-markdown-architectural-decision-records.md)
- [0001 — repo-seed 是生成自治理仓库的 skill，不是静态模板](0001-repo-seed-is-a-skill-not-a-template.md)
- [0002 — 自治理仓库设计](0002-self-governing-repository-design.md)
- [0003 — repo-review 按项目实例化，而非静态分发](0003-repo-review-instantiated-per-project.md)
- [0004 — 游戏第一性原理——剧本驱动的通用 AI 游戏框架](0004-game-first-principles.md)
- [0005 — 剧本格式 v1.0——声明式目录剧本 + zod 可执行契约](0005-script-format-v1.md)
- [0006 — 引擎 mechanics 模块（背包/需求/状态/战斗/成长）](0006-engine-mechanics-modules.md)
- [0007 — 引擎运行时 v1——不可变快照 + 注入 RNG + PDVA 防作弊 + 双轨状态描述层](0007-engine-runtime.md)
- [0008 — 引擎运行时完备化——v1 未接线系统一次交付](0008-engine-completeness.md)
- [0009 — 文档体系与 Agent Notes 决策记录](0009-documentation-and-agent-notes.md)
- [0010 — 导入暂存目录清理](0010-import-staging-cleanup.md)
- [0011 — 对话主舞台布局 + 深度可扩展表现层 Token v1.1](0011-layout-and-presentation-tokens.md)
- [0012 — 前端与表现层 v1——沉浸聊天式 UI + 剧本资产/主题系统 + 多剧本管理](0012-ui-theme-assets-multiscript.md)
- [0013 — 采用 repo-seed 自治理层](0013-adopt-repo-seed-governance-layer.md)
- [0014 — LLM 上下文管理——对话历史注入与滚动摘要](0014-llm-context-management.md)
- [0015 — 记忆系统升级——相关性检索、连续遗忘与失效语义](0015-memory-strength-retrieval-supersede.md)
- [0016 — 死契约接线与 UI 消费点补全（cooldown / llm_freedom / safety / zip 加固）](0016-dead-contract-wiring-and-ui-consumption.md)
- [0017 — 会话持久化、刷新恢复与 meta 链路](0017-session-persistence-refresh-recovery-meta.md)
- [0018 — 前端沉浸式游戏化与剧本代码扩展（v2）](0018-immersive-frontend-script-code-v2.md)
