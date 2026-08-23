# 会话世界身份随目录替换漂移

## Executive summary

会话只保存可变 world ID，恢复时重新读取目录当前版本；同 ID 世界被替换后，旧会话会在原状态上使用新法则和规则包。初始 Fact 同时把第一条 Law 当作统一 provenance，使审计错误声称任意世界设定都由该法则导致。两者的共同根因是缺少不可变世界种子身份：系统把目录别名和运行时因果当成了内容来源。护栏是规范内容哈希、会话内嵌运行时契约、独立 `world_seed` 引用，以及“替换后重启恢复旧会话”的集成测试。

## Summary

世界目录允许以相同 ID 覆盖，但会话文档没有保存精确世界版本或完整裁决契约。宿主重建引擎时用 session 的 world ID 调用 repository，因而恢复语义由当时的 catalog 决定。loader 为满足 Fact provenance 必填约束，统一选择 laws 数组第一项，导致与该 Law 无因果关系的初始事实获得虚假来源。

## Timeline

1. WorldRun 持久化保存 SimulationState 和 world ID，世界定义继续由文件仓库提供。
2. 世界导入支持显式替换同 ID 目录，未建立会话到不可变内容版本的关系。
3. schema 要求每个 Fact 有 provenance，loader 用第一条 Law 填充所有初始 Fact。
4. 架构审计把“替换世界后恢复旧会话”和“第一条法则并非世界生成原因”组合成可复现反例。
5. 状态与会话升级为 schema v4，世界内容哈希、嵌入契约和 `world_seed` 一起交付。

## Root cause

设计把 world ID 同时当作用户可替换的 catalog key 和会话确定性身份，没有区分“当前别名”与“不可变版本”。测试只覆盖同一目录内容下的保存/恢复，没有在两次读取之间替换世界。provenance 测试只验证引用能解析，没有验证来源的语义类型，因此第一条合法 Law 通过了结构校验。

## Guardrails

- [决策 0038](../decisions/0038-pinned-world-runtime-contract.md) 定义规范 hash、会话嵌入契约和 `world_seed`。
- [`open-world-loader.test.ts`](../../src/script/__tests__/open-world-loader.test.ts) 证明实体文件重命名不改变 hash，初始 Fact 精确引用本世界 hash。
- [`world-import.test.ts`](../../src/server/__tests__/world-import.test.ts) 在替换同 ID 世界并重建宿主后，证明旧会话仍恢复旧 hash/version，新会话使用新版本。
- [`world-session-store.ts`](../../src/server/world-session-store.ts) 拒绝 state 与嵌入 contract 的 world ID、hash 或 laws 不一致。
