# 跨平台视觉基线漂移

## Executive summary

会话入口在 macOS 上通过完整视觉门禁后，合并到 `main` 的 Linux CI 仍有三项截图失败。一个原因是中文字体在两套系统上的栅格化不同；另一个原因是横向溢出网格中的百分比隐式列宽在两平台产生了不同卡片宽度。单一平台基线无法区分这两类问题。持久修复是先用确定性 flex basis 消除几何差异，再以严格阈值维护分平台截图基线。

## Summary

Fast gates、行为 E2E 与无障碍测试通过，视觉测试稳定报告约百分之二像素差异。身份选择卡片存在可见宽度变化，Observer 与 Inspector 截图主要表现为文字边缘差异。重试不能改变结果，说明问题来自渲染环境而非异步稳定性。

## Timeline

1. macOS 工作树运行 `npm run check:all`，所有门禁通过并生成视觉基线。
2. 变更 fast-forward 合并到 `main` 并触发 Linux GitHub Actions。
3. Linux Fast gates 通过，三项视觉测试在三次尝试中产生相同差分。
4. 下载 CI expected、actual 与 diff 后，将卡片几何差异和全局文字栅格差异分离。
5. 卡片轨道改为确定性 flex basis；Playwright 快照加入平台身份并继续采用原严格阈值。

## Root cause

快照路径没有包含平台，隐含假设 Chromium 在不同操作系统上产生像素一致的中文文本。该假设不成立。与此同时，横向滚动容器使用百分比 `grid-auto-columns` 定义隐式轨道，百分比在内容尺寸与溢出组合中的解析没有建立足够确定的几何约束。

本地门禁只验证了 macOS 基线，无法提前证明 Linux 像素等价。CI 保存了诊断产物，但测试策略没有规定哪些差异应修改布局、哪些差异应隔离到平台基线。

## Guardrails

- [决策 0065](../decisions/0065-platform-visual-baselines-and-deterministic-layout.md)规定严格的分平台视觉基线和几何优先审计。
- [测试规格](../testing.md)明确平台基线不能吸收布局、内容或溢出差异。
- 身份卡轨道使用确定性 flex basis，移动端仍以固定视口比例展示下一张卡片提示。
- CI 持续上传 Playwright expected、actual、diff 与 trace，视觉失败必须先审阅诊断产物。
