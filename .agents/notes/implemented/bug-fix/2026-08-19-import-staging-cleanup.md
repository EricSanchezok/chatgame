# Agent Note: 导入暂存目录清理

Status: implemented

## Problem

脚本导入（zip 与目录两条路径）把内容暂存到 `.chatgame/import-tmp/<zip|dir>-<ts>-<rand>`，`finally` 只删除每次唯一的暂存子目录。结果是每次导入（无论成功还是失败）之后，空的父目录 `.chatgame/import-tmp` 都会残留，评审实测后留下了这个空目录。

## Decision

在 `src/server/script-import.ts` 中新增 `pruneEmptyStagingRoot()`：用 `rmdirSync` 尽力删除暂存根目录。`rmdirSync` 只在目录为空时成功；目录不存在或仍有并发导入的子目录时会抛错，被 catch 静默吞掉。`importScriptFromZip` 与 `importScriptFromDir` 的 `finally` 在 `rmSync(staging, …)` 之后调用它。

- 仅删除空目录，绝不递归删除——不会误伤并发导入正在使用的暂存目录。
- 失败的导入路径同样经过 `finally`，因此失败也清理。

## Alternatives considered

- `rmSync(stagingRoot(), { recursive: true })`：简单，但会连同并发导入正在写入的暂存子目录一起删除，破坏并发安全，落选。
- 每次导入前统一清空暂存根：并发时同样互相踩踏，且失败后依旧残留，落选。
- 不做根因修复、只删一次残留：下一次导入立刻重现，落选。

## Consequences

- 每次导入结束后，`.chatgame/import-tmp` 不再留下空目录；导入失败路径同样干净。
- 并发导入安全：`rmdirSync` 在根目录非空时自动失败，不影响其他导入的暂存数据。
- 验证：dir 导入失败（非法 script.yaml）与 zip 导入失败（无 script.yaml）两条路径冒烟后，`import-tmp` 均不存在；lint 干净，446 测试全绿。
