<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

Living World Engine 是剧本驱动的开放世界 AI 游戏框架。设计的第一性原理见 [决策记录 0004](docs/decisions/0004-game-first-principles.md)；改架构前先读 [docs/architecture.md](docs/architecture.md)。

## Repository layout

```
src/          应用与引擎：app/（Next.js UI + Route Handlers）、script/（世界契约层）、engine/（Truth Engine 运行时）、server/（WorldHost + WorldRun 持久化/导入）
docs/         参考文档：architecture、game-design（剧本格式/引擎运行时/表现层）、decisions（决策日志）、research（调研证据）
.agents/      内嵌 skill：repo-review（评审政策）、repo-decisions（决策记录流程）
scripts/      门禁与世界工具（verify-* / validate-world / import-world）
```

## Commands

```sh
npm run dev      # 开发服务器（开放世界工作台）
npm run build    # 生产构建
npm run lint     # ESLint
npm test         # vitest 测试
npm run world:validate -- <世界目录>       # schema v2 世界校验
npm run world:import -- <zip> [--replace] # 世界导入 CLI（与 web 共用导入核心）
```

Gates（pre-commit hook 强制执行，也可手动运行）：

```sh
node scripts/verify-decisions.mjs && node scripts/verify-doc-links.mjs && node scripts/verify-placeholders.mjs && node scripts/verify-manifest.mjs
```

按触碰的表面运行对应检查，不要默认跑全套；穷举矩阵由 CI 或 pre-commit hook 负责。

## Governance loop (hard rules)

1. 每完成一个可独立验证的工作单元，按触碰表面运行对应检查，并立即创建本地 commit；pre-commit hook 强制执行治理门禁。不要把多个已经完成的工作单元长期堆积在工作树中。
2. commit 只包含当前获准任务的相关改动；不得顺带暂存用户或其他任务的修改。改动无法安全分离时，停止提交并说明冲突。
3. 每个非平凡改动必须在同一改动内新增或更新 [docs/decisions/](docs/decisions/README.md) 决策记录（见 `repo-decisions` skill）。
4. 一个 bug 到达了真实用户、合并的 PR 或发布，必须写 [docs/postmortems/](docs/postmortems/README.md) postmortem。
5. 治理层（seeded 文件）的唯一升级通道是重跑 repo-seed skill；绝不手改 seeded 文件去"对齐上游"。

## Security rules

- 用户授权修改或构建即包含在工作单元完成且门禁通过后创建本地 commit 的授权；用户明确要求不 commit、只评审或只诊断时除外。未完成或门禁失败的改动不得提交。
- 未经用户明确请求，绝不 git push。commit 是本地防丢与回滚检查点，不等于发布或共享。
- 未经询问，绝不修改 seeded 路径（AGENTS.md、CLAUDE.md、docs/、scripts/、.agents/skills/repo-review、.agents/skills/repo-decisions、.github/、CONTRIBUTING.md、LICENSE、.editorconfig、.gitattributes、.repo-seed/）以外的文件。
- 绝不读 `.env` 文件或其他 secrets。

## 约定

- **剧本驱动**：世界观/人物/机制由剧本定义，框架保持通用。禁止为单个游戏写死逻辑而绕过剧本。
- **开放语义、严格提交**：玩家与 Agent 可提出任意自然语言行动；Truth Engine 负责联合语义裁决，事务内核负责 schema、引用、数值、守恒、随机承诺、因果与原子性。玩家文本永远不是状态 delta。
- **认知隔离**：canonical truth、每个 Agent belief 与玩家知识是独立状态；AgentMind 与普通游戏客户端不得收到 canonical identity binding 或其他主体的隐藏认知，唯一例外是 [0055](docs/decisions/0055-trusted-world-evolution-inspector.md) 定义的本地受信任只读 inspector 路由。
- **引擎只在服务端运行**：fs/YAML/API key 决定引擎不能进浏览器；客户端只通过 `src/app/api/**/route.ts` 访问，任何"引擎搬客户端"方案禁止。
- **敏捷开发，不做向后兼容**：处于快速迭代期，任何破坏性变更（状态模型、存档 schema、行为语义）直接落地；旧存档、旧测试数据、旧兼容路径一律删除，不写迁移与兼容层。
- **干净单一**：逻辑只有一个实现，拒绝冗余路径与屎山；旧路径被替代即删除，不留双轨。
- **每个事实只有一个家**：决策 → docs/decisions；规格 → docs/game-design；指令 → 本文件；别处只放链接。
- 文档只写当前状态，不写变更历史；交叉引用用相对 Markdown 链接。
- 文档与决策记录用中文；代码标识符与注释用英文。
- **前端硬编码颜色零容忍**：组件只消费 `--cg-*` CSS 变量；token 在根主题声明，禁止在组件规则中硬编码色值。

## Documentation

遵循 [docs/AGENTS.md](docs/AGENTS.md)：每个事实只有一个家、教程 vs 参考、卫生清单。

## Research

论文与文献调研通过 Scholens 管理：Project **Living World Engine / 活世界引擎**（ID `26668cf0-6489-4657-9b33-c1aba2b14a1b`，资源 `scholens://projects/26668cf0-6489-4657-9b33-c1aba2b14a1b`）。新增调研成果与论文入库到该 Project，检索既有文献用 `search_scholens_knowledge`（scope `{"kind": "project", "project_id": "26668cf0-6489-4657-9b33-c1aba2b14a1b"}`）。

## Decisions

每个决策——架构或流程——都是 [docs/decisions/](docs/decisions/README.md) 中的 MADR 记录。状态流 Proposed → Accepted → Superseded by NNNN。superseded 记录绝不改写成相反决策；新记录 supersede 它。

## Testing

遵循 [docs/testing.md](docs/testing.md)：测试真实入口路径；验证世界而非自述；只 mock 昂贵或非确定性的边界。

## Skills

- [`.agents/skills/repo-review`](.agents/skills/repo-review/SKILL.md) — 合并前的语义评审政策（按本项目实例化）。
- [`.agents/skills/repo-decisions`](.agents/skills/repo-decisions/SKILL.md) — 如何撰写与更新决策记录。
