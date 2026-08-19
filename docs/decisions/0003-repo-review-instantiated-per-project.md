# repo-review 按项目实例化，而非静态分发

## Status
Accepted
Class: architecture

## Context and Problem Statement

seed 分发两个内嵌 skill：repo-decisions（绑定 MADR 标准的流程）与 repo-review（评审政策）。repo-review 的模板曾经是静态的：每个被 seed 的仓库拿到相同的 blocking requirements 与 manual checks。证据表明这是错的：模板的 manual checks 是为 agent 工具仓库写的（生命周期/并发竞态、模型视角评审），难以泛化到其他技术栈；静态政策不携带项目红线（部署顺序、禁用工具、schema 义务）；而且它违背 ADR 0001 确立的生成器原则——结构确定、内容实例化。其余承载内容的 seeded 文档（architecture.md、testing.md）都用 token 实例化；唯独 repo-review 分发静态散文。

## Decision Drivers

- 评审政策是项目专属的；价值在于具体，而非统一。
- seed 必须保持技术栈无关：不预设某个栈家族的检查。
- 现有机制（verify-placeholders 范围、manifest 拒绝逻辑）在模板携带 token 时已经强制实例化。
- 流程与政策 skill 不同：流程（怎么写 ADR）绑定 seed 自己的标准，可以静态分发；政策（这里必须检查什么）不能。

## Considered Options

- 每个项目静态 repo-review（原状）。
- 完全通用的 repo-review，无项目内容。
- 通用核心 + 按项目实例化 + 推导标准——即所选路线。

## Decision Outcome

repo-review 模板携带通用核心（语义散文评审、文档匹配代码、决策已记录、测试存在）加两个实例化 token——`REVIEW_PROJECT_BLOCKING` 与 `REVIEW_PROJECT_CHECKS`——由模型在 seed 时根据 AGENTS.md 硬规则、架构接缝、栈检测与访谈 Q8（评审政策输入）组合。repo-seed skill 携带推导标准（`references/review-standard.md`）与按栈风险目录；它是 skill 侧指南，不 seed 进目标仓库。记录步骤通过 `--user-owned` 标志把实例化文件的 manifest 条目标记为 `userModified`，重跑永不刷新 user-owned 条目。同时移除了"门禁绿"这一 blocking 项（CI 机械证明门禁；评审者复述 CI 是在机器可证的事实上浪费评审），并把"指南而非清单"声明替换为硬/软二分：blocking requirements 阻塞变更；manual checks 排序剩余风险。

### Consequences

- 好：被 seed 的仓库获得点名自己真实失效模式与红线的评审政策。
- 好：占位符门禁机械阻止未实例化的 repo-review 流出。
- 好：上游演进仍应用于通用核心；项目内容受保护。
- 代价：实例化质量取决于执行模型，由推导标准与通用核心下限缓解。
- 代价：项目专属内容不再从上游刷新——这是设计使然。

## Pros and Cons of the Options

### 静态 repo-review（原状）
- 好：零实例化成本；上游可编辑。
- 坏：技术栈偏向的检查；无项目红线；违背生成器原则。

### 完全通用 repo-review
- 好：对任何项目都不会错。
- 坏：价值趋近于零；评审者需要项目专属门禁才有用。

### 通用核心 + 按项目实例化
- 好：关键处具体、标准处统一；既有门禁强制执行。
- 坏：依赖 seed 时模型组合内容的质量。

## Links
- [ADR 0001](0001-repo-seed-is-a-skill-not-a-template.md) — 本决策为其恢复的生成器原则。
- [ADR 0002](0002-self-governing-repository-design.md) — 本决策改变的 L3 层。
- [repo-review SKILL](../../.agents/skills/repo-review/SKILL.md) — 实例化结果。
- [.repo-seed/update-strategy.md](../../.repo-seed/update-strategy.md) — 用户所有权与刷新语义。
