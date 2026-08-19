# 会话持久化、刷新恢复与 meta 链路

## Status
Accepted
Class: feature

## Context and Problem Statement

后端存在五类缺陷，破坏"会话/存档/跨局进度"闭环：

1. **会话全内存**：`EngineHost.sessions` 是内存 Map，刷新页面即丢（内存回收后无法恢复）。
2. **存档非原子写**：`writeSave` 直接 `writeFileSync` 覆写目标文件，断电/中断会写坏存档且旧档不可恢复。
3. **advance 竞态**：`advance` 不走 per-session 串行队列，直接操作 `record.engine.advance(hours)`；异步 `turn` 在 await LLM 间隙被 advance 改 state，存在状态竞争。
4. **advance 无死亡策略**：`Engine.advance` 纯 `stepWorld`，不跑 `applyDeathPolicy`；离线快进可能把玩家推进 hp 归零/soft_failure 状态而不触发后果。
5. **meta-progression 死链路**：`applyUnlocks`/`metaProgressionSnapshot` 已实现但无处落盘，出身解锁无法跨局持久化，launcher 展示全部出身（含未解锁）。

另有边界缺失：`turn` input 无长度上限、`advance` hours 无上限；`saveSummaries` 对每个存档 `JSON.parse` 全文件取 updatedAt，低效。

## Decision Drivers

- 磁盘为权威，内存 Map 仅作缓存（保留 MAX_SESSIONS=20 / 30 分钟回收）。
- 存档原子性：temp + rename 替换，杜绝写坏旧档。
- advance 与 turn 并发安全：全部入 per-session 串行队列。
- 恢复路径复用既有 `createSession({ loadRunId })`，不新增并行端点。
- 未来 Vercel 部署：文件存储同样不可行，今天投资点是接口抽象（SaveStore）而非选库。

## Considered Options

- 上 SQLite/Postgres/KV：当前规模（单写者、每回合一次写入、≤20 存档、无查询需求）文件足够；Vercel 上文件与 SQLite 同样不可行；提前选库只付复杂度税。落选——未来上云时替换 SaveStore 云实现即可。
- 删除冗余路由（load/saves）与 `api.state` 封装：用户决策"死契约接口不要删除"，保留并接线。落选。
- 定时/防抖自动存档：保存成本毫秒级、回合是天然合并点，每回合一次即够。落选。
- 每回合生成独立存档文件：文件堆积；固定 `autosave.json` 槽 + 手动时间戳档清晰。落选。
- localStorage 直接持久化 sessionId 恢复内存：内存 Map 会回收，磁盘才是权威；走存档重建。落选。
- SaveStore 抽象 + 原子写 + 每回合 autosave + localStorage 恢复 + meta 聚合文件——所选路线。

## Decision Outcome

**`src/engine/save-store.ts`（新）**：`SaveStore` 接口（`write/read/list/delete?`）+ `createFsSaveStore(root)` 原子写实现（`{runId}.tmp` → `renameSync`）+ `assertSafeRunId` 路径校验 + `metaPathForScript`。`SaveStore.root` 暴露数据根，`createDataStore()` 支持 `CHATGAME_DATA_ROOT` 环境变量重定位（测试隔离/部署）。

**`src/engine/save.ts`**：`writeSave/readSave/listSaves/saveSummaries` 改为默认注入 `fsSaveStore`；文件路径与格式不变（`.chatgame/saves/<scriptId>/<runId>.json`）。

**`src/engine/index.ts`**：`Engine` 接受 `saveStore` 注入；`advance` 补死亡策略（`stepWorld` 后 `applyDeathPolicy`，`firedMode` 有值时 append system transcript，与 `playerTurn` 第 6 步一致）。

**`src/server/engine-host.ts`**：`advance`/`save` 改为 `enqueue` 串行；`turn` 成功后 `engine.save("autosave")` + `writeMeta`；`writeMeta` 与既有 `.chatgame/meta/<scriptId>.json` 求并集原子写回（损坏容错为空集）；`readMeta` 返回 `{unlockedOrigins, lockableOrigins, updatedAt}`；`saveSummaries` 走 `SaveStore.list`（mtime，不再逐文件 JSON.parse）。

**路由**：`turn/route.ts` input > 2000 → 400；`advance/route.ts` hours 非整数/超 1000 → 400 且 `await`；新增 `GET /api/scripts/[scriptId]/meta`。

**客户端**：`api.scriptMeta()`；`state.tsx` 新增 `readLastRun/writeLastRun/clearLastRun/hasLastRun/resumeLast`（`chatgame:last-run` key）；`launcher.tsx` 有 last-run 时显示"继续上次游戏"卡片，出身选择器按 `lockableOrigins − unlockedOrigins` 置灰 + "未解锁"提示。

**剧本修正**：`scripts/emberfall/run.yaml` 的 `unlocks[].grant` 从 `[miner, apprentice, scholar]` 改为 `[apprentice, scholar]`——`miner` 是初始基础出身，不应列入可解锁集合（否则初始 meta 为空时新游戏无出身可选）。

**存档版本**：本决策不改 WorldState schema（格式与版本 4 由 [0014](0014-llm-context-management.md)/[0015](0015-memory-strength-retrieval-supersede.md)/[0016](0016-dead-contract-wiring-and-ui-consumption.md) 共同决定）；`host.save()`/`host.advance()` 变为返回 Promise（入队异步），route 与调用方需 `await`——破坏性 API 变更，符合敏捷约定直接落地。

## Pros and Cons of the Options

- 所选路线：刷新页面可恢复最近进度（autosave 槽）；断电不损坏旧档（temp+rename）；advance 与 turn 并发安全；死亡/通关后新出身在 launcher 解锁；SaveStore 为未来云后端预留接口；`CHATGAME_DATA_ROOT` 让数据根可配置。代价：`host.save()/host.advance()` 签名变异步（破坏性，敏捷落地）；每回合一次 autosave + meta 写入成本毫秒级（规模内可接受）。
- SQLite/Postgres/KV：为当前规模付复杂度税，且不解决 Vercel 无持久盘问题。落选。
- 定时/防抖存档：回合是天然合并点，防抖无收益。落选。

## Links

- [0014](0014-llm-context-management.md)（contextSummary 与存档版本 4）
- [0015](0015-memory-strength-retrieval-supersede.md)（MemoryEntry 与存档版本 4）
- [0016](0016-dead-contract-wiring-and-ui-consumption.md)（advance 路由与 zip 加固）
- [0007](0007-engine-runtime.md)（引擎运行时与 PDVA 管线）
