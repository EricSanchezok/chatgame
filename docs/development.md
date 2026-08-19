# 开发指南

本仓库的工作语言是中文（文档与决策记录）；代码标识符与注释用英文。本文覆盖贡献者设置、日常工作流与关键命令。命令住在根 [AGENTS.md](../AGENTS.md)；决策理由住在 [docs/decisions/](decisions/README.md)。

## 前置条件

- Git
- Node.js >= 22（AI SDK v7 要求；本仓库 `package.json` `engines` 字段锁定）

## 日常工作流

1. 按仓库分支约定拉取、建分支或堆叠（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。
2. 做改动；文档、决策记录与测试在同一改动内更新。
3. 运行相关门禁：
   ```sh
   node scripts/verify-decisions.mjs
   node scripts/verify-doc-links.mjs
   node scripts/verify-placeholders.mjs
   node scripts/verify-manifest.mjs
   ```
   pre-commit hook 会在 commit 时强制执行；提前运行避免意外。
4. 运行测试命令：`npm test`
5. 运行 lint 命令：`npm run lint`
6. 以陈述"为什么"的 commit message 提交；决策记录变化时附上引用。

## 工作树

治理文件（AGENTS.md、CLAUDE.md、docs/、scripts/、.agents/skills/repo-review、.agents/skills/repo-decisions、.github/、CONTRIBUTING.md、LICENSE、.editorconfig、.gitattributes、.repo-seed/）由 repo-seed skill 的 manifest 所有。有意手改可以，但 manifest 记录其哈希，更新模式会保留你的编辑。

## 编辑文档

遵循 [docs/AGENTS.md](AGENTS.md)：每个事实只有一个家、教程 vs 参考、卫生清单。
