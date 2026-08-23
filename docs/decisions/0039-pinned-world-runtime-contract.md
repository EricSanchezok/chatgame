# 会话锁定世界运行时契约

## Status
Accepted
Class: bug-fix

## Context and Problem Statement

世界 ID 是可替换的目录别名，不是不可变内容身份。若会话恢复时按 ID 读取当前世界，同一存档会在世界替换后获得不同法则、规则包或模型 Profile；若初始 Fact 又借用任意 Law 作为 provenance，审计会把“来自世界种子”误报成“由该法则导致”。

## Decision Drivers

- 同一会话在进程重启和世界替换后必须保持相同语义。
- 世界身份必须由完整规范内容决定，而不是文件名、ZIP 顺序或可变目录指针决定。
- 初始事实与运行时因果必须在类型和校验上可区分。
- 会话恢复不能依赖当前世界目录仍保留旧版本。

## Considered Options

- 恢复时继续按 world ID 读取当前版本。
- 只在会话保存 manifest version。
- 会话保存 world hash，并按 hash 回查世界版本。
- 规范内容寻址，并把完整运行时契约嵌入会话——所选路线。

## Decision Outcome

loader 规范化 manifest、laws、mechanics、player 与按实体 ID 排序的 entities，再计算 `sha256` 内容身份。`WorldDefinition.contentHash`、`SimulationState.worldHash` 和公共会话 `worldHash` 必须一致；文件名和归档条目顺序不参与身份。

会话 schema v8 嵌入不可变 `WorldRuntimeContract`，包括世界元数据、分阶段 Truth profiles、完整法则、披露策略、已验证规则包裁决和离散随机分布。恢复只从会话状态和该契约构造引擎，并重新验证本地受信任规则包与模型目录，不读取当前 world catalog。

初始 Fact provenance 使用判别引用 `{ kind: "world_seed", id: worldHash }`。完整状态校验只接受与状态哈希精确相等的 seed 引用；运行时 `law`、`fact`、`action`、`check`、`random`、`event` 与 `mechanic` 来源继续要求解析到真实因果。

### Consequences

- 替换同 ID 世界只影响新会话，旧会话保持原版本。
- 会话文档比只保存状态更大，但具备独立恢复所需的语义。
- 运行时升级若不再支持会话锁定的规则包版本或模型 Profile，会响亮拒绝恢复。
- 旧版本会话直接拒绝，不提供迁移或双轨读取。

## Pros and Cons of the Options

### 按 ID 读取当前版本

- 好：会话最小，世界修正立即作用于全部存档。
- 坏：历史、随机重放和因果语义会随目录替换漂移。

### 只保存 manifest version

- 好：实现简单，界面可显示版本。
- 坏：版本字符串不保证内容唯一，也不能恢复已被覆盖的法则。

### 按 hash 回查版本

- 好：内容身份确定，会话无需重复契约。
- 坏：会话恢复仍依赖外部版本记录存在且完整。

### 嵌入运行时契约

- 好：会话自足、确定、可审计，当前目录替换不会改变历史。
- 坏：会话持久化重复保存小型世界契约，并需要运行时兼容性校验。

## Links

- [0032](0032-open-world-facts-and-d20-kernel.md) — 开放 Fact 与因果内核。
- [0041](0041-local-sqlite-runtime.md) — 保存世界版本和会话的本地数据库。
- [事故复盘 0010](../postmortems/0010-session-world-identity-drift.md) — 促成此护栏的失效机制。
