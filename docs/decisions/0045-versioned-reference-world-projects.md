# 版本化参考世界采用作者工程与严格运行目录分层

## Status

Accepted
Class: feature

## Context and Problem Statement

引擎删除旧内置剧本后只保留最小测试夹具，无法用一套真实、可玩的中型世界持续验证 20–50 Agent、有限认知、跨地点行动和长程后果。世界作者还需要保存来源、许可、世界圣经与设计理由，但 schema v5 世界根为保证安全导入而严格拒绝 README、文档、资产和额外目录。

## Decision Drivers

- 参考世界必须通过与用户导入相同的严格 loader，而不是获得仓库专用旁路。
- 创作资料、许可和内容来源必须与运行 YAML 一同版本化并可审阅。
- 应用在零配置时不能隐式安装或选择一个世界。
- 世界观、人物与机制必须留在剧本侧，不得为 Blackmarsh 向通用引擎加入题材硬编码。
- 上游开放内容的署名、修改和排除边界必须明确。

## Considered Options

- 仓库继续只保留最小测试夹具。
- 只提交一个没有创作文档的严格世界目录。
- 放宽 schema v5 根目录以接受 README、文档与资产。
- 使用外层作者工程和内层严格 `world/` 目录——所选方案。

## Decision Outcome

仓库在 `worlds/<world-id>/` 版本化参考世界作者工程。作者工程保存 README、许可与设计文档；其中 `world/` 是唯一可校验、打包和导入的 schema v5 目录，继续只接受四个根 YAML 和 `entities/*.yaml`。参考世界不在应用启动时自动安装，必须经过普通 ZIP 导入入口进入本地世界库。

首个参考世界位于 `worlds/blackmarsh/`，以 CC BY 4.0 的 Blackmarsh version 11 为来源。它使用现有 `core-d20@1.1.0` 与开放事实原语，不携带执行代码，不改变 loader 的目录白名单，也不把 D&D 专用属性或动作写入引擎。

### Consequences

- 世界内容和创作证据可以在同一 PR 中接受语义评审，运行目录仍与不受信任 ZIP 使用同一安全边界。
- 仓库体积会随参考世界文档和 YAML 增长，但应用安装状态与仓库内容保持分离。
- 作者必须维护外层文档与内层可执行事实的一致性，并为关键数量、认知隔离和来源覆盖提供测试。

## Pros and Cons of the Options

### 只保留测试夹具

- 好：仓库最小，内容维护成本低。
- 坏：无法证明真实中型世界的作者体验、内容一致性和 Agent 规模。

### 只提交严格世界目录

- 好：结构最简单，可直接导入。
- 坏：许可、来源和人物设计只能散落到仓库其他位置，世界本身不可审阅也难以继续创作。

### 放宽 schema v5 根目录

- 好：ZIP 看起来像一个包含所有材料的普通项目。
- 坏：扩大不受信任导入表面，破坏严格布局，并迫使 loader 区分可执行与非执行文件。

### 作者工程包裹严格运行目录

- 好：创作资料与运行内容共同版本化，同时保持单一 loader、安全边界和显式安装。
- 坏：作者需要理解外层工程与内层运行包的区别，打包时必须选择 `world/` 内容。

## Links

- [0004](0004-game-first-principles.md) — 剧本即世界与非剧情树原则。
- [0032](0032-open-world-facts-and-d20-kernel.md) — 开放事实与通用数值原语。
- [0033](0033-persistent-streaming-world-runs.md) — 显式世界导入与无旧内置剧本运行时。
- [0042](0042-causal-assurance-and-staged-model-profiles.md) — 规则包和分阶段模型契约。
- [世界剧本格式](../game-design/script-format.md) — schema v5 严格运行目录。
- [参考世界工程](../../worlds/README.md) — 作者工程目录。
