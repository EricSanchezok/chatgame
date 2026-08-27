# 文件宿主缺少跨实例并发边界

## Executive summary

WorldHost 用进程内 Map 串行运行，但世界和会话分别落在文件系统；第二个进程或宿主实例不共享 Map，可以同时驱动同一会话，跨文件的 run 状态与步骤也没有统一事务。根因是把单对象实现细节误当成部署级所有权协议。产品采用纯本地部署，因此护栏不是引入分布式基础设施，而是统一 SQLite、generation compare-and-swap、写事务和带心跳的单实例租约。

## Summary

文件 session store 的原子 rename 只能保证一个文件替换完整，不能保证读到的 generation 仍是最新，也不能把世界 catalog 切换、run 状态和世界步骤放进同一事务。WorldHost 的内存队列只对创建它的进程有效；另一个实例能够从同一快照开始执行，后写者可能覆盖先写者。

## Timeline

1. 会话以 JSON 文件持久化，活跃 session/run 和订阅者由单个 WorldHost 内存结构管理。
2. 世界导入通过目录 rename 切换，世界与会话拥有不同持久化路径。
3. 代码在单进程开发服务器测试中保持串行，没有第二宿主实例竞争同一数据目录的门禁。
4. 部署边界审计确认进程内 Map 不能构成跨实例锁，且文件后端缺少 compare-and-swap。
5. 本地持久化统一为 SQLite，写入增加 generation CAS 与单实例租约，内存降为执行信号和 SSE 唤醒缓存。

## Root cause

架构没有明确声明支持的部署拓扑，也没有把“谁可以推进世界”建模为持久化所有权。恢复测试只关闭并重开一个 store，没有在首个实例仍持有数据时尝试第二次打开；并发测试也没有强制两个写者从相同 generation 竞争。

## Guardrails

- [决策 0041](../decisions/0041-local-sqlite-runtime.md) 把部署契约限定为纯本地单实例 SQLite。
- [`local-database.ts`](../../src/server/local-database.ts) 启用事务、WAL/FULL、generation CAS 和写前租约核验。
- [`world-instance-host.test.ts`](../../src/server/__tests__/world-instance-host.test.ts)覆盖 generation CAS、ActionWindow 并发和过期 scheduler callback 不提交。
- [`execution-ledger.test.ts`](../../src/server/__tests__/execution-ledger.test.ts)覆盖 SQLite 原子 terminal record 与实例提交。
