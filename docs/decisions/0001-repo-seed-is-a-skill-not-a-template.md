# repo-seed 是生成自治理仓库的 skill，不是静态模板

## Status
Accepted
Class: architecture

## Context and Problem Statement

目标是让任意仓库——空的或已存在的、任意技术栈——变成 agent-native：有文档、有决策日志、被机械检查治理，准备好 vibe coding。当时有两个形态可选：用户 fork 或 clone 的静态模板仓库，或在原地生成并维护治理层的 skill。

静态模板有已知的致命缺陷：fork 是单提交快照，没有上游历史，永远无法接收模板改进，也无法适配目标仓库的真实状态。纯运行时 skill 有另一个缺陷：skill 触发不可靠（独立评测测得 56% 的 skill 用例从未触发），而"生成但未提交"的输出不可见、无版本。

## Decision Drivers

- 生成的仓库必须保持可升级：上游治理改进必须能到达已 seed 的仓库。
- 结构处必须确定性，内容处必须自适应。
- 用户必须看到并拥有结果：生成文件是已提交的基线，不是转瞬即逝的上下文。
- 必须复用业界标准形态（AGENTS.md、SKILL.md、MADR），而不是重新发明。

## Considered Options

- 静态模板仓库（fork 起步）。
- 纯运行时 skill，输出永不落盘。
- 一个脚手架化确定性结构、把内容交给模型、用所有权清单管理更新的 skill——即所选路线。

## Decision Outcome

repo-seed 是**一个生成器 skill**（SKILL.md + 零依赖脚本 + `references/` 下的模板）。它向目标仓库写入治理基线（AGENTS.md、docs/、决策日志、两个内嵌 skill、门禁、hook、`.repo-seed/manifest.json`），由用户 review 并提交。重跑 skill 就是升级通道：manifest 记录每个 seeded 文件的 sha256，用户改过的文件默认保留，上游模板演进只应用到未触碰的文件。

### Consequences

- 好：已 seed 的仓库保持可升级——"死模板"失效模式被结构性移除。
- 好：因为结果是已提交基线而非转瞬即逝的上下文，用户拥有它。
- 好：生成器是显式调用的 skill，这是 skill 最可靠的形态。
- 代价：需要一个状态文件（`.repo-seed/manifest.json`）与更新语义；复杂度收敛在一条脚本路径里。

## Pros and Cons of the Options

### 静态模板仓库
- 好：即开即用、确定、零运行时。
- 坏：fork 无法接收上游更新；无法适配仓库状态；没有基于问答的定制。

### 纯运行时 skill，无持久化输出
- 好：触发便宜；调用前不污染仓库。
- 坏：触发不可靠；输出不可见、无版本；无法作为 diff review。

### 带持久化基线与所有权清单的 skill 生成器
- 好：结构确定、内容自适应、基线可升级、结果用户所有。
- 坏：需要维护 manifest 与更新模式逻辑。

## Links
- [ADR 0000](0000-use-markdown-architectural-decision-records.md) — 本记录所在的决策日志。
- [ADR 0002](0002-self-governing-repository-design.md) — 生成基线包含什么。
- [.repo-seed/update-strategy.md](../../.repo-seed/update-strategy.md) — 所有权/更新语义。
