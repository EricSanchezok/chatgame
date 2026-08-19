# 自治理仓库设计

## Status
Accepted
Class: architecture

## Context and Problem Statement

"有文档"但"无人治理"的生成仓库会漂移：链接腐烂、占位文本存活、决策被反复重提、seeded 文件被悄悄手改、流程步骤被跳过。单靠文档挡不住漂移；需要机械门禁、hook 与分层指令组成的系统。生产级 agent 工具仓库（deepseek-harness）的证据表明：长期治理是一个系统，不是一份文档——十一个内嵌 skill、几十个 verifier 脚本、git hooks、分层 AGENTS.md、生命周期决策日志与 postmortems。

开放问题：种子仓库第一天该拿到这套系统的多少、以什么形态，同时不把 seed 耦合到任何技术栈或任何一家厂商的工具链？

## Decision Drivers

- 抗漂移机制必须机械：hook 与 verifier，而非劝诫。
- seed 必须技术栈无关：不生成构建配置、不生成 CI。
- seed 必须对 agent 工具通用：AGENTS.md 与 SKILL.md 是行业标准；不用厂商私有扩展。
- 第一天范围是治理骨架，不是完整 harness 机器；升级通道负责成长。

## Considered Options

- 单层治理：一个大 AGENTS.md 承载一切，无门禁。
- 第一天就到 harness 规模：移植全部 35+ 门禁、中英对照、覆盖率门禁、vendoring 政策。
- 五层治理骨架 + 升级通道——即所选路线。

## Decision Outcome

生成的仓库由**五层加一条升级通道**治理：

- **L0 — 常驻指令**：根 `AGENTS.md`（软预算 100 行）加 `CLAUDE.md` 通过 `@AGENTS.md` 导入它。承载治理循环硬规则与安全规则（未经明确请求绝不 commit/push）。
- **L1 — 确定性门禁与 hook**：五个零依赖 verifier（`verify-decisions`、`verify-doc-links`、`verify-placeholders`、`verify-manifest`，空白检查内置于 `git diff --cached --check`），由 `scripts/install-hooks.mjs` 安装为 pre-commit hook。
- **L2 — 统一决策日志**：带 `Class:` 扩展的 MADR 记录（见 [ADR 0000](0000-use-markdown-architectural-decision-records.md)），由 `verify-decisions` 强制。
- **L3 — 内嵌 skill**：`repo-review`（按项目实例化的评审政策：通用核心 + seed 时组合的 blocking requirements 与 manual checks）与 `repo-decisions`（决策日志写作流程），放在 `.agents/skills/`，被所有主流 agent 工具发现。
- **L4 — 流程记忆**：`docs/testing.md` 政策、`docs/postmortems/` 指南与模板、PR 模板核对清单。
- **升级通道**：`.repo-seed/manifest.json` 记录 seeded 文件哈希；重跑 repo-seed 刷新未触碰的 seeded 文件、保留用户编辑、绝不删除用户文件。

### Consequences

- 好：漂移与路径级幻觉被每次 commit 都运行的 hook 机械捕获。
- 好：seed 技术栈无关、跨工具；不新增任何构建配置。
- 好：第一天范围是骨架而非机器；更重的门禁随仓库成熟通过升级通道加入。
- 代价：语义正确性（措辞是否真实）无法被门禁证明；`repo-review` 与决策日志的"放弃了什么"纪律缓解但无法消除。这是行业性限制，不是 repo-seed 的缺口。

## Pros and Cons of the Options

### 单层治理
- 好：seed 最简单。
- 坏：常驻指令容量有限（上下文限制）；无机械验证；流程步骤衰减。

### 第一天 harness 规模
- 好：从一开始就最大严格度。
- 坏：对新仓库不成比例；把 seed 耦合到特定工具链；违反技术栈无关约束。

### 五层骨架 + 升级通道
- 好：在最关键处机械抗漂移；技术栈无关；随仓库成长。
- 好：诚实地标注语义正确性限制。
- 坏：第一天就需要 manifest/更新机制。

## Links
- [ADR 0000](0000-use-markdown-architectural-decision-records.md) — 决策日志标准。
- [ADR 0001](0001-repo-seed-is-a-skill-not-a-template.md) — 为何生成器形态是 skill。
- [.repo-seed/update-strategy.md](../../.repo-seed/update-strategy.md) — 所有权与更新语义。
- [docs/AGENTS.md](../AGENTS.md) — 文档标准（L0/L2 纪律）。
