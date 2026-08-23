# 项目改名 Living World Engine（活世界引擎）

## Status

Accepted
Class: architecture

## Context and Problem Statement

项目原名 `chatgame` 已不能表达其真实定位：它不只是一个"聊天游戏"框架，而是一个剧本驱动的开放世界 AI 游戏引擎——维护单一客观世界、多个有限认知主体与唯一联合裁判（Truth Engine），并计划扩展到超大世界（时间稀疏调度、交互图分解裁决、宏观/微观多分辨率仿真）。经调研（详见 [docs/research](../research/README.md) 与 Scholens Project），"世界模拟器"等既有术语不足以承载"世界持续运转、Agent 在其中生活"的定位，决定采用 **Living World Engine（活世界引擎）**。

## Decision Drivers

- 项目已超出"chatgame"名称所指的范畴，需要与"聊天游戏"脱钩。
- 名称需准确传达"持续运转的世界环境 + 大规模 Agent + 确定性裁决"的定位。
- 标识符（包名、环境变量、数据目录）应跟随新名，避免显示名与契约名双轨。
- 历史决策与调研记录是事实快照，不得改写；只新增记录本决策。

## Considered Options

- 保留 `chatgame` 名称，只改品牌文案。
- 采用 `world simulator`（世界模拟器）类命名。
- 采用 `Living World Engine` 并全量替换标识符——所选路线。
- 物理目录与 worktree 路径同步改名。

## Decision Outcome

项目更名为 **Living World Engine（活世界引擎）**。标识符映射：

| 旧 | 新 |
|---|---|
| npm 包名 / GitHub 仓库名 `chatgame` | `living-world-engine` |
| 环境变量前缀 `CHATGAME_` | `LIVINGWORLD_` |
| 数据目录 `.chatgame/` | `.livingworld/` |
| 导入暂存前缀 `.chatgame-world-import-` | `.livingworld-world-import-` |
| 测试临时前缀 `chatgame-*` | `livingworld-*` |

`docs/decisions/*` 与 `docs/research/*` 中的历史 `chatgame` 指称与技术标识符（`CHATGAME_*`、`.chatgame/`、`@chatgame/ui`）作为历史事实保留，不改写。物理目录 `/Users/eric/projects/chatgame` 与 worktree 路径不变（git worktree 按绝对路径注册，移动会破坏并行工作区）。治理层 seeded 文件（AGENTS.md、LICENSE）同步改名并更新 `.repo-seed/manifest.json` 哈希。

### Consequences

- 所有公共契约（包名、环境变量、数据目录）一次性切换，不保留 `CHATGAME_*` 兼容别名（干净单一）。
- 旧 `.chatgame/` 运行数据不迁移（敏捷开发，不做向后兼容）。
- 既有 worktree 的 origin remote 仍指向旧 URL，GitHub 对改名仓库提供重定向；后续可在各 worktree 同步 `git remote set-url`（可选）。
- 后续调研与文献统一归入 Scholens Project **Living World Engine / 活世界引擎**（ID `26668cf0-6489-4657-9b33-c1aba2b14a1b`），AGENTS.md 已加入 Research 关联。

## Pros and Cons of the Options

### 保留 `chatgame` 名称

- 好：零成本，无需改动契约。
- 坏：名称与产品定位持续错位，无法传达"世界环境 + 大规模 Agent + 确定性裁决"。

### 采用 `world simulator` 命名

- 好：贴合业界热词。
- 坏：该词先例是 Sora 技术报告（视频生成），首因联想与"Agent 承载 + 确定性裁决"错位；大厂均避免以它命名旗舰产品。

### Living World Engine 全量替换

- 好：名称准确传达"世界持续运转、Agent 在其中生活"；标识符统一；与学术谱系（artificial society / generative agent-based modeling）一致。
- 坏：公共契约破坏性变更（环境变量、数据目录），需要一次性切换所有部署与文档。

### 物理目录与 worktree 同步改名

- 好：路径与新名完全一致。
- 坏：24 个 worktree 绝对路径注册全部失效，并行工作区集体破坏，收益不成比例。

## Links

- [docs/architecture.md](../architecture.md) — 系统架构（"扩展到超大世界"演化方向）。
- [docs/research/README.md](../research/README.md) — 调研证据与命名谱系。
- [0031](0031-epistemic-multi-agent-truth-engine.md) — Truth Engine 联合裁决（历史指称保留）。
- Scholens Project **Living World Engine / 活世界引擎**：`26668cf0-6489-4657-9b33-c1aba2b14a1b`。
