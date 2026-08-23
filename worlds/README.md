# 参考世界工程

`worlds/` 保存可审阅、可追溯且可由引擎严格校验的参考世界。每个子目录是作者工程；其中的 `world/` 才是可导入的 schema v5 运行目录。

作者工程可以包含 README、设计文档与许可说明。`world/` 仍只允许 `script.yaml`、`laws.yaml`、`mechanics.yaml`、`player.yaml` 和 `entities/*.yaml`，不会因为仓库内创作需要而放宽导入边界。

参考世界不会在应用启动时自动安装。校验并打包 `world/` 后，通过世界库导入入口安装。

## 世界目录

- [黑沼边境](blackmarsh/README.md)：由 Robert Conley 的开放沙盒设定 Blackmarsh 改编的多 Agent 奇幻边境。
