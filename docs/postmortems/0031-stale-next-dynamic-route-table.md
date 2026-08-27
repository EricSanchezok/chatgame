# 旧 Next dev 路由表使 World Instance 跳转到 404

## Executive summary

Blackmarsh 实例成功创建并持久化后，浏览器跳转到 `/play/:instanceId` 却得到 404。开发服务器在路由重构前已经启动，同时缓存了已删除的 `/play/[sessionId]` 与新增的 `/play/[instanceId]`；Next 检测到同一动态路径使用不同参数名后拒绝注册新页面。生产构建和 E2E 都在全新进程中运行，因此没有覆盖长寿命开发进程的路由表。重启开发服务器后实例页面与 API 均恢复为 200。

## Summary

实例创建 API 返回成功，SQLite 中也存在对应 `WorldInstanceDocument`，故障只发生在页面路由。开发日志明确记录 `You cannot use different slug names for the same dynamic path ('instanceId' !== 'sessionId')`。启动检查发现 3000 端口已有同一 worktree 的旧进程后直接复用了它，没有把动态路由目录的删除与新增视为必须重启的边界。

## Timeline

1. 会话路由 `/play/[sessionId]` 被 World Instance 路由 `/play/[instanceId]` 取代。
2. 生产构建与全新 Playwright 服务进程成功识别新路由。
3. 本地 3000 端口仍运行变更前启动的 `next dev`，热更新过程中同时保留两个动态参数名。
4. Blackmarsh 导入与实例创建均成功，客户端跳转后收到 Next 404。
5. 开发日志定位动态 slug 冲突；终止旧进程并重新启动后，已有实例页面与 API 均返回 200。

## Root cause

Next 的开发路由表不能在同一动态路径的参数目录被删除并以另一名称重建时可靠热切换。验收只检查了端口 3000 返回 200，没有请求本次改动新增的真实动态页面；这个健康检查只能证明某个 Next 进程存活，不能证明它已经加载当前路由拓扑。生产构建和 E2E 的干净进程隔离反而掩盖了本地长寿命进程特有的失败模式。

## Guardrails

- [开发指南](../development.md)要求动态路由目录新增、删除或改名后重启开发服务器，并请求一个真实动态 URL验证 200。
- 启动本地验收时若 `next dev` 报告已有进程，不再仅凭根路径健康检查复用；先核对本次变更是否触及路由拓扑。
- E2E 继续通过生产构建创建实例并进入 `/play/:instanceId`，保证全新进程的公开入口可用。
