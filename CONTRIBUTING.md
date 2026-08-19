# Contributing

感谢你考虑为本项目做贡献。本仓库是 agent-native 的：期待人类与 AI 贡献者遵循同一个治理循环。

## 治理循环

1. 改动前阅读 [AGENTS.md](AGENTS.md) 与 [docs/AGENTS.md](docs/AGENTS.md)。
2. 任何非平凡改动，在 [docs/decisions/](docs/decisions/README.md) 新增或更新一条决策记录（使用 `repo-decisions` skill）。
3. 提交前运行门禁；pre-commit hook 强制执行：
   ```sh
   node scripts/verify-decisions.mjs
   node scripts/verify-doc-links.mjs
   node scripts/verify-placeholders.mjs
   node scripts/verify-manifest.mjs
   ```
4. 在同一改动内写或更新测试；没有回归测试的修复只是传闻。
5. 如果改动修复了一个到达用户的 bug，在 [docs/postmortems/](docs/postmortems/README.md) 添加 postmortem。

## 决策记录

每个决策——架构或流程——都是 [docs/decisions/](docs/decisions/README.md) 中的 MADR 记录。遵循 `repo-decisions` skill 与 [.repo-seed/update-strategy.md](.repo-seed/update-strategy.md) 的格式。superseded 记录绝不重写；新记录 supersede 它。

## 拉取请求

使用 PR 模板。确保验证清单完整。评审者：使用 `repo-review` skill。

## 行为准则

尊重、建设性、默认善意。
