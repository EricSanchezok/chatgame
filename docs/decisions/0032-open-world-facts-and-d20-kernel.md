# 开放事实世界与通用 d20 内核

## Status
Proposed
Class: architecture

## Context and Problem Statement

固定 stats、skills、needs、inventory、relations、reputation、status 与 action effects 把世界压进一组预设游戏类型；完全依靠自然语言又无法可靠表达生命阈值、资源守恒、时间和随机检定。通用世界需要同时容纳开放描述和少量可执行数值，而不把任意题材重新塑造成同一套属性表。

## Decision Drivers

- 剧本必须能声明任意事实、能力、资源和量表。
- 生命、数量、阈值、时间和概率必须保持精确且可验证。
- 检定难度必须在随机结果产生前承诺。
- 世界规则应主要由自然语言法典表达，硬内核只拥有通用不变量。
- 数值原语不能绑定 D&D 六维属性或任何单一题材。

## Considered Options

- 保留固定 mechanics schema 并增加更多可选字段。
- 完全使用自然语言描述状态和裁决。
- 把完整 SRD 规则硬编码为所有剧本的核心。
- 开放事实图 + 剧本定义数值 + 通用 d20 协议——所选路线。

## Decision Outcome

canonical truth 以稳定实体和开放 `WorldFact` 图表达。位置、包含、归属和生命周期使用结构化关系；其他性质由剧本命名的 predicate 与描述表达。背包是 containment 与 quantity，不再是独立机制；关系、状态和能力也不再拥有并行状态源。

引擎提供 `Meter`、`Quantity`、`Rating`、`Rank`、`DiceExpression` 与声明式 threshold。剧本定义生命、灵力、理智、修为、货币或其他数值的名称、范围、适用实体及阈值后果。硬内核执行范围、唯一包含、转移守恒以及带法则和 provenance 的生产、消耗。

不确定行动使用通用 d20 检定：Truth Engine 在看到随机值前提交相关 rating、修正、熟练、DC、优势/劣势、风险和可见性；注入式种子随机源生成结果；Truth Engine 再按自然语言世界法典结算。连续依赖检定可以分阶段请求，但每一阶段都必须先承诺后掷骰。

首期只实现 d20 内核和规则包接口，不捆绑完整 SRD 内容。剧本格式包含世界法典、初始实体、开放事实、数值目录和 Agent profile，不包含 actions.yaml、effect 白名单或自定义 action handler。

### Consequences

- 题材可以选择精确 HP，也可以用伤势等级或其他量表，但凡涉及阈值的规则必须结构化。
- Truth Engine 决定语义相关性和因果，硬内核不尝试用代码穷举所有魔法、社会和叙事规则。
- 剧本作者需要为希望严格执行的数量、阈值与随机规则提供声明；未声明的描述只参与 LLM 语义。
- 旧剧本和旧存档不能兼容新契约。

## Pros and Cons of the Options

### 扩展固定 mechanics schema

- 好：沿用现有 UI 和纯函数模块。
- 坏：每个新题材继续向核心添加专用字段，最终形成无法组合的机制清单。

### 完全自然语言状态

- 好：契约最小，作者自由。
- 坏：生命与死亡、数量守恒、公平概率和回放都缺少可靠依据。

### 固定完整 SRD

- 好：立即得到成熟战斗与角色规则。
- 坏：修仙、科幻和社会模拟被迫采用 D&D 本体模型，规则数据也拖累内核重构。

### 开放事实与通用数值原语

- 好：描述自由与精确机制共存，d20 提供统一但可选的可玩性骨架。
- 坏：Truth Engine prompt、delta validator 和剧本校验都需要理解开放 schema。

## Links

- [0005](0005-script-format-v1.md) — 被本记录取代的剧本格式。
- [0006](0006-engine-mechanics-modules.md) — 被通用数值与事实图取代的 mechanics 模块。
- [0021](0021-gameplay-and-engine-extension-v2.md) — 被开放事实和自由行动取代的扩展契约。
- [0031](0031-epistemic-multi-agent-truth-engine.md) — 消费本状态模型的 Truth Engine。
- [剧本格式规格](../game-design/script-format.md) — 当前剧本参考。
