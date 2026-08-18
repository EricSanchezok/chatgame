# 文档体系

原则：**每个事实只有一个"家"**；决策可追溯；文档只写当前状态。

## 文档地图

| 位置 | 放什么 | 不放什么 |
|---|---|---|
| [AGENTS.md](../AGENTS.md) | 常驻指令：布局、命令、约定（一两行一条，链接各自的家） | 故事、详细流程、被链接内容的重述 |
| [.agents/notes/](../.agents/notes/README.md) | 决策记录：为什么、放弃了什么、后果（Agent Notes） | 迁移计划、待办清单 |
| [architecture.md](architecture.md) | 系统总览：剧本/引擎/机制/LLM/UI 如何组成 | 类型定义、决策理由（→ notes） |
| [game-design/](game-design/README.md) | 游戏设计参考：剧本格式（v1.0）、世界模型、机制规格 | 决策理由（→ notes） |
| postmortem/ | 事故复盘（首次需要时创建） | — |
| cookbook/ | 操作指南（首次需要时创建） | 设计理由（→ notes） |
| [README.md](../README.md)（根） | 产品简介 + 快速开始 | 详细参考 |
| [research/](research/README.md) | 调研记录：外部证据（理论/方法论/相似产品） | 决定（→ notes）、规格（→ game-design） |

## 写作规则

- 只写当前状态：不写"之前/现在/不再"、PR、commit 号；变更故事进 commit 与 Agent Note。
- 每个非平凡改动必须附 Agent Note（见 [.agents/notes/README.md](../.agents/notes/README.md)）。
- 交叉引用用相对 Markdown 链接，不用裸文件名。
- 文档用中文；代码标识符与注释用英文。
- 调研证据 → `docs/research/`；采纳时写成决策或规格并链接回研究记录。
