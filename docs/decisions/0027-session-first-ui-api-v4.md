# 会话优先 UI API v4

## Status
Superseded by [0029](0029-reui-app-shell-and-ui-api-v5.md)
Class: architecture

## Context and Problem Statement

UI API v3 允许剧本完整替换游戏壳，却没有给任务追踪、NPC 公开资料与消息内物品揭示稳定的语义契约。两个内置剧本借此各自实现永久三栏、固定场景图和第二套滚动结构，宿主虽仍掌管会话，却不能保证聊天游戏的主要内容以同一种可读方式呈现。

## Decision Drivers

- 对话流、媒体线索、行动与任务必须来自同一权威会话快照。
- 剧本可以表达独特气质，但不能为内置内容复制会话、滚动、网络或焦点逻辑。
- NPC 资料与任务目标只暴露玩家已知的公开字段。
- 任务追踪是按存档隔离的浏览器偏好，不改变世界规则。
- 第三方剧本仍可在宿主边界内完整覆盖体验。

## Considered Options

- 保持 UI API v3，由每个剧本自行解释任务、NPC 与媒体。
- 禁止所有 `game-shell` 覆盖，只允许主题与消息卡。
- 升级为 UI API v4，补齐语义 view-model、追踪能力与媒体类型，同时保留受约束的完整覆盖。

## Decision Outcome

客户端安全入口仍是 `@chatgame/ui`，版本直接升级为 4，不保留 v3 兼容路径。公开单例槽位为 `launcher`、`game-shell`、`scene`、`hud`、`objective-tracker`、`toolbar`、`composer`、`pause-menu`，并保留 `panel:*`、`bubble:*`、`message-card:*` 与 `settings:*`。`game-shell` 的 regions 增加 `tracker` renderer；剧本可重排 renderer，但宿主继续持有会话、网络、存档、portal、焦点、错误隔离和无障碍边界。

`BubbleSlotProps` 提供公开 `speaker` 与 `isFirstAppearance`；speaker 只包含 id、姓名、公开简介、职业和玩家可见关系。`PanelSlotProps` 提供 `trackedTaskId` 与 `trackTask`；任务 catalog 提供玩家可读摘要、当前目标和数量上限。追踪选择写入 `PlayerUiSettings v3`，以 `scriptId:runId` 为键隔离，不进入 `WorldState`，不会触发或完成任务。

`MediaCue` 由服务端从状态差确定性生成 `npc_speech`、`location_enter`、`event` 与 `item_reveal`。`assets.yaml` 的 `illustrations` 以 event id 索引本地插画或受控 prompt fallback；客户端不得自行猜测何时展示剧情图，导入仍拒绝远程热链。NPC 发言、地点切换、事件插画、物品获得、主题与环境音属于同一已提交会话快照。

第三方剧本仍可覆盖完整 `game-shell`、`scene`、消息、composer 和 panels，但只获得只读 view-model 与 capability。内置剧本统一使用宿主的会话主结构，只覆盖 HUD、tracker、composer 与内容面板。

## Pros and Cons of the Options

### 保持 v3

- 好：没有契约破坏。
- 坏：公开信息继续散落在剧本私有状态，内置体验会再次分叉。

### 禁止完整覆盖

- 好：宿主一致性最强。
- 坏：第三方剧本无法实现真正不同的叙事结构，违背剧本驱动边界。

### UI API v4

- 好：常用 RPG 信息拥有安全、可测试的公共语义，同时保留深度扩展。
- 坏：所有 UI bundle、夹具和存储版本必须同步升级。

## Links

- [0022](0022-ui-host-and-script-extension-v3.md) — 被本记录完整取代的 UI API v3。
- [0028](0028-conversation-first-game-layout.md) — v4 的默认玩家布局。
- [0021](0021-gameplay-and-engine-extension-v2.md) — 权威动作预检与媒体状态来源。
- [0024](0024-frontend-workbench-and-ci.md) — UI 契约与真实入口测试。
