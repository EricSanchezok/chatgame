# 参考世界工程

`worlds/` 保存可审阅、可追溯且可由引擎严格校验的参考世界。每个子目录是作者工程；其中的 `world/` 才是可导入的 schema v11 运行目录。

作者工程可以包含 README、设计文档与许可说明。`world/` 只允许必需 manifest、法则、机制、实体，以及可选 participation 配置和受限静态资源；完整边界见[世界剧本格式](../docs/game-design/script-format.md)。

参考世界不会在应用启动时自动安装。校验并打包 `world/` 后，通过世界库导入入口安装。

## 世界目录

- [黑沼边境](blackmarsh/README.md)：由 Robert Conley 的开放沙盒设定 Blackmarsh 改编的多 Agent 奇幻边境。
