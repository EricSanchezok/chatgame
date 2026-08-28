# 按实际 Profile 激活模型供应商凭据

## Status

Superseded by [0076](0076-resolve-models-from-audited-capability-snapshots.md)
Class: architecture

## Context and Problem Statement

模型目录同时承担可选供应商能力注册与世界运行 Profile 定义。把目录中出现的每个 provider 都视为当前部署的强制依赖，会让只使用 DeepSeek 的世界因为缺少 OpenAI 或 xAI 密钥而无法列出世界、导入内容或创建宿主；维护裁剪目录又会复制调度与 Profile 配置。目录能力全集和某个世界的实际执行依赖需要分离，同时保持缺少已选供应商凭据时响亮失败。

## Decision Drivers

- 未被世界、现有 Agent 或动态 Agent 选中的 provider 不得阻塞宿主与其他供应商。
- 实际引用的每个 Profile 必须在使用它产生模型费用前确认可执行；会话创建、动态 Agent 提交或恢复写入前必须整体预检。
- 动态 Agent 不得看到未部署的 Profile，也不能通过语义修复或 fallback 绕过凭据缺失。
- 模型目录 hash、严格角色校验、原生 Adapter、调用审计与公平调度保持单一权威链路。

## Considered Options

- 服务启动时继续要求目录中全部 provider 的密钥。
- 每种部署维护一份裁剪后的完整模型目录。
- 启动时扫描所有已安装世界并要求其引用的全部密钥。
- 目录注册能力，按实际 Profile 激活 provider，并在会话与动态 Agent 边界预检——所选路线。

## Decision Outcome

`ModelCatalog` 在首次初始化 WorldHost 时继续严格读取、校验、冻结并计算完整目录 hash。`ModelGateway` 只为启动时具有非空凭据或显式注入 Adapter 的 provider 构造 Adapter；目录与凭据变更仍需重启。未构造 Adapter 的 provider 保留在目录中，但不出现在 Truth Engine 可用于动态 Agent 的 Profile 摘要里。

世界导入和世界列表只校验目录引用与角色兼容，不要求部署凭据。创建会话以及从持久化文档加载会话时，WorldHost 在 Agent bootstrap、引擎构造或恢复写入前预检五个 Truth Profile 和全部现有 Agent 的 bootstrap、mind、reaction Profile。动态 `create_agent` 在候选 transition 提交前预检其三个 Profile；每次 `generateStructured` 仍执行同一 Adapter 可用性检查作为最终防线。

缺少实际引用 provider 的凭据抛出 `ModelConfigurationError`，不进入 Truth 语义修复，不切换模型或供应商。该决策承接 [0036](0036-multi-provider-model-gateway-and-fair-scheduler.md) 的严格结构化输出、供应商原生参数、审计、重试与公平调度契约，只取代其全目录强制凭据规则。

### Consequences

- 一个多供应商目录可以服务只部署其中一家的世界，无需复制目录。
- 世界列表与导入不再因闲置 provider 缺少密钥而失败。
- 打开或创建实际依赖缺失凭据的会话会在任何模型请求或状态写入前失败。
- 增加环境密钥需要重启，运行中不会热激活新的 provider。

## Pros and Cons of the Options

### 全目录强制凭据

- 好：启动时一次发现全部目录凭据缺失。
- 坏：把未使用能力变成部署依赖，单供应商世界无法独立运行。

### 维护裁剪目录

- 好：每份目录的依赖直观。
- 坏：复制 scheduler、provider 与 Profile 事实，容易漂移并增加部署组合。

### 扫描全部已安装世界

- 好：能在启动时发现已安装内容的凭据缺失。
- 坏：闲置世界仍会阻塞宿主，且无法表达运行中动态 Agent 的实际激活时点。

### 按实际 Profile 激活并分层预检

- 好：依赖范围与正在运行的世界一致，失败发生在副作用前，仍无 fallback。
- 坏：凭据问题从进程启动错误变成相关会话的配置错误，需要每个激活边界保留预检。

## Links

- [0036](0036-multi-provider-model-gateway-and-fair-scheduler.md) — 被取代的全目录强制凭据契约及继续承接的 Gateway 设计。
- [0042](0042-causal-assurance-and-staged-model-profiles.md) — 世界与 Agent 的精确分阶段 Profile。
- [模型目录与 Gateway 规格](../game-design/model-gateway.md) — 当前运行契约。
- [事故复盘 0015](../postmortems/0015-unused-provider-credentials-blocked-runtime.md) — 该边界缺失如何逃逸到真实体验。
