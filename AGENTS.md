<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

chatgame 是剧本驱动的 AI 聊天游戏框架。设计的第一性原理见 [决策记录 0004](docs/decisions/0004-game-first-principles.md)；改架构前先读 [docs/architecture.md](docs/architecture.md)。

## Repository layout

```
src/          应用与引擎：app/（Next.js UI + Route Handlers）、script/（剧本契约层）、engine/（引擎运行时）、server/（EngineHost 会话托管 + 剧本导入）
docs/         参考文档：architecture、game-design（剧本格式/引擎运行时/表现层）、decisions（决策日志）、research（调研证据）
.agents/      内嵌 skill：repo-review（评审政策）、repo-decisions（决策记录流程）
scripts/      门禁与演示脚本（verify-* / validate-script / play-emberfall / import-script）
```

## Commands

```sh
npm run dev      # 开发服务器（启动器 + 游戏 UI）
npm run build    # 生产构建
npm run lint     # ESLint
npm run play     # 引擎 demo CLI（默认 Mock LLM）
npm test         # vitest 测试
npm run script:validate -- <剧本目录>   # 剧本校验
npm run import-script -- <zip|目录>      # 剧本导入 CLI（与 web 共用导入核心）
```

Gates（pre-commit hook 强制执行，也可手动运行）：

```sh
node scripts/verify-decisions.mjs && node scripts/verify-doc-links.mjs && node scripts/verify-placeholders.mjs && node scripts/verify-manifest.mjs
```

按触碰的表面运行对应检查，不要默认跑全套；穷举矩阵由 CI 或 pre-commit hook 负责。

## Governance loop (hard rules)

1. 每次 commit 前运行门禁；pre-commit hook 强制执行。
2. 每个非平凡改动必须在同一改动内新增或更新 [docs/decisions/](docs/decisions/README.md) 决策记录（见 `repo-decisions` skill）。
3. 一个 bug 到达了真实用户、合并的 PR 或发布，必须写 [docs/postmortems/](docs/postmortems/README.md) postmortem。
4. 治理层（seeded 文件）的唯一升级通道是重跑 repo-seed skill；绝不手改 seeded 文件去"对齐上游"。

## Security rules

- 未经用户明确请求，绝不 git commit 或 git push。
- 未经询问，绝不修改 seeded 路径（AGENTS.md、CLAUDE.md、docs/、scripts/、.agents/skills/repo-review、.agents/skills/repo-decisions、.github/、CONTRIBUTING.md、LICENSE、.editorconfig、.gitattributes、.repo-seed/）以外的文件。
- 绝不读 `.env` 文件或其他 secrets。

## 约定

- **剧本驱动**：世界观/人物/机制由剧本定义，框架保持通用。禁止为单个游戏写死逻辑而绕过剧本。
- **引擎管规则，LLM 管叙事**：状态（时间/背包/血量/记忆）是引擎管理的真实数据，绝不放进对话文本。媒体线索同理：`MediaCue` 由引擎从状态差确定性推导，LLM 不参与媒体决策。
- **引擎只在服务端运行**：fs/YAML/API key 决定引擎不能进浏览器；客户端只通过 `src/app/api/**/route.ts` 访问，任何"引擎搬客户端"方案禁止。
- **敏捷开发，不做向后兼容**：处于快速迭代期，任何破坏性变更（状态模型、存档 schema、行为语义）直接落地；旧存档、旧测试数据、旧兼容路径一律删除，不写迁移与兼容层。
- **干净单一**：逻辑只有一个实现，拒绝冗余路径与屎山；旧路径被替代即删除，不留双轨。
- **每个事实只有一个家**：决策 → docs/decisions；规格 → docs/game-design；指令 → 本文件；别处只放链接。
- 文档只写当前状态，不写变更历史；交叉引用用相对 Markdown 链接。
- 文档与决策记录用中文；代码标识符与注释用英文。
- **前端硬编码颜色零容忍**：UI 只消费 `--cg-*` CSS 变量（主题由 `src/app/lib/theme.ts` 应用），禁止硬编码色值。

## Documentation

遵循 [docs/AGENTS.md](docs/AGENTS.md)：每个事实只有一个家、教程 vs 参考、卫生清单。

## Decisions

每个决策——架构或流程——都是 [docs/decisions/](docs/decisions/README.md) 中的 MADR 记录。状态流 Proposed → Accepted → Superseded by NNNN。superseded 记录绝不改写成相反决策；新记录 supersede 它。

## Testing

遵循 [docs/testing.md](docs/testing.md)：测试真实入口路径；验证世界而非自述；只 mock 昂贵或非确定性的边界。

## Skills

- [`.agents/skills/repo-review`](.agents/skills/repo-review/SKILL.md) — 合并前的语义评审政策（按本项目实例化）。
- [`.agents/skills/repo-decisions`](.agents/skills/repo-decisions/SKILL.md) — 如何撰写与更新决策记录。
