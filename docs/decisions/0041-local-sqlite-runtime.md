# 纯本地单实例 SQLite 运行时

## Status
Accepted
Class: architecture

## Context and Problem Statement

文件目录分别保存世界与会话时，跨文件替换、run 状态和世界步骤无法共享事务；进程内 Map 锁只约束一个 `WorldHost` 对象，第二个进程或宿主实例可以同时读取旧 generation 并驱动同一会话。产品采用用户本地部署，不需要对象存储、PostgreSQL 或分布式多主能力。

## Decision Drivers

- 本地安装必须只有一个部署依赖和一个可备份数据文件。
- 世界替换、会话步骤与 run 终态必须具有事务边界和乐观并发控制。
- 崩溃恢复必须保留全部完整步骤并识别未完成执行。
- 不引入 S3、PostgreSQL、迁移兼容层或多主协调复杂度。

## Considered Options

- 继续使用 JSON/YAML 文件、rename 和进程内 Map。
- SQLite 保存会话，世界仍保留文件目录。
- SQLite 统一保存世界版本、目录指针和会话，并限制单实例——所选路线。
- PostgreSQL 加对象存储与分布式锁。

## Decision Outcome

`LocalDatabase` 同时实现 `WorldRepository`、`WorldSessionStore` 和世界导入边界。数据库位于 `LIVINGWORLD_DATA_ROOT/livingworld.sqlite`，启用 WAL、`synchronous=FULL`、foreign keys、busy timeout 和 strict tables。

世界以规范模板和内容 hash 写入不可变 `world_versions`，`world_catalog` 只保存每个 world ID 的当前 hash。导入在事务外完成 ZIP 安全检查和世界校验，在单个写事务内插入版本并切换目录指针。会话把完整文档保存为严格验证的 JSON，同时抽取 world ID/hash 供索引；每次更新使用 generation compare-and-swap，冲突不覆盖。

数据库维护带过期时间和心跳的单实例租约。活跃租约存在时，第二个宿主实例启动失败，每次写入再次核验所有权；`WorldHost` 在打开数据库前完成模型目录校验与已有供应商 Adapter 装配，避免无资源初始化失败遗留租约。实际引用 Profile 的凭据由 [0047](0047-on-demand-model-provider-credentials.md) 规定的会话激活边界预检。queued/running run 在进程恢复且没有本地 execution 时按 [0049](0049-world-run-failure-and-stream-boundaries.md) 处理：无取消请求转为可重试 failed，已有取消请求则从最后完整状态原子恢复为 cancelled。SQLite 是唯一权威状态，内存只保存正在执行的取消信号和 SSE 唤醒通道。

### Consequences

- 本地部署只需持久化一个数据库文件及其 SQLite WAL 辅助文件。
- 世界、会话和 run 的写入拥有明确事务与 CAS 语义。
- 第二个应用实例不能同时服务同一数据目录；租约过期后才能接管崩溃实例。
- 不提供网络共享文件系统、多主写入或水平扩展保证。
- 旧文件世界安装和旧会话文件不读取，也不提供迁移器。

## Pros and Cons of the Options

### 文件与进程内锁

- 好：实现直接，世界内容便于手工查看。
- 坏：跨文件没有事务，锁不跨进程，恢复和替换存在竞态。

### 分裂存储

- 好：会话获得事务，世界仍可直接编辑。
- 坏：保留两套持久化和原子安装路径，世界版本与会话仍需跨系统协调。

### 统一 SQLite 单实例

- 好：单文件、本地零服务依赖、事务和 CAS 足以覆盖产品部署模型。
- 坏：需要原生 SQLite 依赖，不能并行运行多个宿主实例。

### PostgreSQL 与对象存储

- 好：适合多实例、远程托管和大规模归档。
- 坏：明显超出纯本地部署范围，引入运维和分布式一致性成本。

## Links

- [0033](0033-persistent-streaming-world-runs.md) — 需要步骤级持久化的 WorldRun。
- [0039](0039-pinned-world-runtime-contract.md) — SQLite 保存的世界内容身份与会话契约。
- [0040](0040-resumable-player-intent.md) — 使用 CAS 的同 run 继续语义。
- [0047](0047-on-demand-model-provider-credentials.md) — 将凭据预检收窄到实际引用的 Profile，租约前的无资源目录校验不变。
- [0049](0049-world-run-failure-and-stream-boundaries.md) — 取消请求与进程中断的恢复事务。
- [事故复盘 0013](../postmortems/0013-file-host-concurrency-boundary.md) — 促成单实例租约和 SQLite 事务的失效机制。
- [事故复盘 0014](../postmortems/0014-world-host-bootstrap-lease-leak.md) — 宿主部分初始化失败不得遗留数据库租约。
