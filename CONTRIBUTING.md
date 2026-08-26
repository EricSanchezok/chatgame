# Contributing

感谢你考虑为本项目做贡献。本仓库是 agent-native 的：期待人类与 AI 贡献者遵循同一个治理循环。

## 治理循环

1. 改动前阅读 [AGENTS.md](AGENTS.md) 与 [docs/AGENTS.md](docs/AGENTS.md)。
2. 任何非平凡改动，在 [docs/decisions/](docs/decisions/README.md) 新增或更新一条决策记录（使用 `repo-decisions` skill）。
3. 每完成一个可独立验证的工作单元，按触碰表面运行对应检查并立即本地提交；不要把多个已完成单元长期堆积在工作树。pre-commit hook 强制执行治理门禁：
   ```sh
   node scripts/verify-decisions.mjs
   node scripts/verify-doc-links.mjs
   node scripts/verify-placeholders.mjs
   node scripts/verify-manifest.mjs
   ```
4. 在同一改动内写或更新测试；没有回归测试的修复只是传闻。
5. 如果改动修复了一个到达用户的 bug，在 [docs/postmortems/](docs/postmortems/README.md) 添加 postmortem。

每个 commit 只包含当前任务的相关改动。无法与用户或其他任务的未提交修改安全分离时，先说明冲突；push 仍需明确授权。

## 决策记录

每个决策——架构或流程——都是 [docs/decisions/](docs/decisions/README.md) 中的 MADR 记录。遵循 `repo-decisions` skill 与 [.repo-seed/update-strategy.md](.repo-seed/update-strategy.md) 的格式。superseded 记录绝不重写；新记录 supersede 它。

## 拉取请求

使用 PR 模板。确保验证清单完整。评审者：使用 `repo-review` skill。

## 行为准则

尊重、建设性、默认善意。
