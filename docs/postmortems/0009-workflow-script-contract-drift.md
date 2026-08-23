# CI workflow 与 npm script 契约漂移

## Executive summary

开放世界重构后的本地完整门禁全部通过，合并到 `main` 的 GitHub Actions 却在浏览器 job 启动测试前失败，因为 workflow 继续调用已从 `package.json` 删除的 `check:ui`。重构同时把 `check:all` 改成直接串联 E2E 与无障碍命令，因此本地验证绕开了 CI 的真实入口。持久教训是 workflow 中的命令名属于受测接口：聚合命令必须只有一个定义，并由快速门禁静态验证所有 workflow 引用都能解析。

## Summary

GitHub Actions 的 Fast gates job 成功，Browser, accessibility, and visual gates job 在执行 `npm run check:ui` 时以 “Missing script” 退出，Playwright 没有开始运行。应用代码、单元测试、生产构建、E2E 与 axe 本身没有失败；失败来自 CI 编排与 `package.json` 的命令表不一致。

## Timeline

1. 开放世界重构删除 Storybook、视觉快照和旧内置剧本浏览器矩阵，并把 `check:all` 改为直接运行新的 E2E 与无障碍命令。
2. `.github/workflows/frontend-workbench.yml` 保留对 `check:ui` 的调用。
3. 本地执行 `check:all`，新测试矩阵全部通过，因为该命令没有经过 `check:ui`。
4. 变更合并到 `main` 后，GitHub Actions 的快速 job 通过，UI job 在解析 npm script 时立即失败。
5. `check:ui` 恢复为当前浏览器矩阵的唯一聚合入口，`check:all` 改为复用它，快速门禁增加 workflow script 引用校验。

## Root cause

直接原因是删除旧测试栈时把 `check:ui` 当成旧 Storybook/视觉实现的一部分，而 CI 把它当作稳定入口。命令实现与命令接口没有分开管理，重构只搜索并验证了新脚本的调用链，没有把 workflow 当作 `package.json` scripts 的消费者。

现有安全网漏过问题有两个原因。第一，本地 `check:all` 重复展开 `test:e2e` 和 `test:a11y`，能证明测试内容，却不能证明 CI 调用的聚合名称存在。第二，fast 与 UI job 并行，快速 job 没有静态验证 workflow 引用，所以即使它成功也无法提前暴露编排漂移。

## Guardrails

- [`package.json`](../../package.json) 定义 `check:ui` 为当前 E2E 与无障碍测试的唯一浏览器聚合入口，`check:all` 只组合 `check:fast` 与 `check:ui`。
- [`verify-workflow-scripts.mjs`](../../scripts/verify-workflow-scripts.mjs) 扫描所有 GitHub Actions workflow 的静态 `npm run` 引用；缺少对应 package script 时由 `check:fast` 立即失败。
- [决策 0034](../decisions/0034-truth-engine-verification-matrix.md) 记录当前命令分层和 workflow 引用契约。
