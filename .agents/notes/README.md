# Agent Notes（决策记录）

设计决策都记录在这里——代码和文档承载不了的"为什么"和"放弃了什么"。本文件定义：记录放哪里、什么时候写、用什么格式。

## 布局与命名

路径 = `{生命周期}/{分类}/YYYY-MM-DD-主题.md`，日期是主题首次提出的日期。

- `proposed/` — 提案，实现前评审；尚未构建（或只建了一部分）。
- `implemented/` — 已决定并落地。记录决定与放弃项，并与"实际交付"保持同步：代码改名/换位置时同步更新（只改事实，不改决定本身）。
- `rejected/` — 被否决的提案。仅当其理由能防止未来重蹈覆辙时保留，否则删除。
- `archived/` — 已归档的 implemented 记录，永久冻结，不再作为当前依据。

## 分类

| 分类 | 覆盖 |
|---|---|
| `game-design` | 游戏产品设计决策：世界模型、剧本格式、机制（时间/背包/战斗/角色记忆）设计 |
| `architecture` | 代码结构决策：模块如何划分、运行时词汇 |
| `feature` | 新的用户可见能力 |
| `bug-fix` | 修复缺陷 |
| `process` | 工具/流程/工作流决策（非运行时行为） |
| `testing` | 测试基础设施与策略 |

## 何时写

每个非平凡改动必须新增或更新至少一条 Agent Note（同一改动内完成）。非平凡 = 改变行为、架构、跨文件契约、流程、测试策略、存储/配置格式，或维护者可能重新审视的决策。纯机械/局部改动豁免。更新已有 note 即可满足规则时，不新建重复记录。

## 文件格式

前三行固定：

```markdown
# Agent Note: <标题>

Status: <状态>
```

状态三选一，且必须与所在生命周期文件夹一致：

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <一句话理由>`

骨架：

- `proposed/`：`## Problem` → `## Proposal` → `## Alternatives considered` → `## Acceptance criteria` → `## Risks`
- `implemented/`：`## Problem` → `## Decision` → `## Alternatives considered` → `## Consequences`

规则：

- `## Problem`：动机，脱离解决方案也能读懂。
- `## Decision`：现在时的已交付现实。
- `## Alternatives considered`：必须写。每个真实备选方案 + 为什么落选。没写"赢过了谁"的决定会被反复重提。
- `## Consequences`：这笔交易付出了什么、买到了什么。
- implemented 内禁用提案措辞（"应该""计划"、迁移步骤、验收清单）。

## 生命周期移动

`proposed/` → `implemented/`：把 `## Proposal` 改写为现在时 `## Decision`，把 `## Acceptance criteria` 与 `## Risks` 折叠进 `## Consequences`（或现在时的验证小节），更新 Status 行。
