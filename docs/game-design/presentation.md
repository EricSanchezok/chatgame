# 沉浸会话壳与流式 API

## 浏览器安全边界

浏览器只使用 `src/shared/world-api.ts`。会话列表是含标题、世界摘要、更新时间、步数和 queued/running run 的 `PublicSessionSummary`；详情拆成 `{ summary, state, runs }`。公开状态包含 world ID、world hash、manifest version、revision、step、elapsedSeconds、玩家知识和当前目标；不包含 canonical truth、bindings、Agent belief、隐藏检定或完整审计 delta。

## HTTP 资源

| 方法与路径 | 语义 |
|---|---|
| `GET /api/worlds` | 列出已安装 schema v6 世界 |
| `POST /api/worlds/import` | multipart 上传一个世界 ZIP；安装使用 `replace=false`，目标明确的更新同时提供 `replace=true` 与 `expectedWorldId` |
| `DELETE /api/worlds/:id` | 仅在不存在关联存档时卸载世界目录项和无引用版本 |
| `GET /api/sessions` | 按更新时间列出持久 Session 摘要 |
| `POST /api/sessions` | 以 `worldId` 和可选 uint32 seed 创建 Session，返回详情 |
| `GET /api/sessions/:id` | 读取精确寻址的 Session 详情 |
| `PATCH /api/sessions/:id` | 在无 queued/running run 时以 `{ title }` 重命名存档 |
| `DELETE /api/sessions/:id` | 在无 queued/running run 时删除该存档 |
| `POST /api/sessions/:id/runs` | 提交 1–4000 字符任意自然语言目标，返回 202 与精确形状 `{ runId }` |
| `GET /api/sessions/:id/runs/:runId` | 返回 `{ run, state }` 公开组合快照 |
| `POST /api/sessions/:id/runs/:runId` | 继续 step_limit 或重试 `retriable=true` 的 failed run，返回 `{ run, state }` |
| `POST /api/sessions/:id/runs/:runId/inputs` | 以幂等 `{ id, text }` 向 awaiting_player run 追加 clarification 并恢复同一 run |
| `DELETE /api/sessions/:id/runs/:runId` | 取消 queued/running，或放弃 awaiting_player/failed/step_limit 目标；保留最后已提交步骤并返回 `{ run, state }` |
| `GET /api/sessions/:id/runs/:runId/events` | 从 `Last-Event-ID` 或 `after` 游标重放并订阅 SSE |

## SSE 事件

事件有单调 `sequence`、`type`、时间与 payload。`player.input` 记录 goal/clarification；`run.execution_started` 记录 initial/player_input/retry 执行边界；其余类型包括 `check.resolved`、`player.outcome`、`player.observation`、`step.committed` 以及各流边界状态。每个 committed step 的检定、结果、玩家观察与提交事件由 canonical history 的单一 helper 精确投影，持久校验要求内容、数量和顺序完全一致。公开检定使用宿主生成的不透明 ID；公共 outcome 只包含 status 与从本步玩家 outcome Observation 按提交顺序汇总的 summary，不包含内部替代方向。边界状态在发送同名末事件后关闭；落后游标重放到遇到的首个边界，已位于边界尾部返回 204，非法游标返回 400，超过尾部返回 409。断线重放不重新运行世界步骤。

## 运行状态

run 状态为 queued、running、awaiting_player、completed、goal_failed、step_limit、cancelled 或 failed。只有 queued/running 正在执行；awaiting_player/completed/goal_failed/step_limit/cancelled/failed 是流边界；queued/running/awaiting_player/step_limit/failed 可以拥有 active intent。一个 active intent 必须精确属于一个 run，新目标在完成或明确放弃前拒绝。`run.failed.payload.retriable` 决定失败能否重试，内部异常只保存在服务端记录；awaiting_player 通过新输入继续，step_limit 通过继续运行恢复，三种未完成边界都能放弃。

## 浏览器路由与消息投影

`/` 是只含“世界包”和“设置”的游戏外入口。设置是当前主菜单上的模态任务，打开后 URL 保持 `/`，关闭后焦点回到触发按钮；不存在独立 `/settings`。`/worlds` 与 `/worlds/:worldId` 共同组成世界包工作台：桌面左侧列出世界，右侧以存档列表为首屏主体，新游戏位于列表标题的相邻工具位且主文案必须继承主操作前景色；版本和内容标识在列表之后以无卡片的紧凑单行元数据呈现，更新和卸载属于同一区域的管理动作；窄屏以两个可寻址页面逐级进入。不存在独立 `/saves` 和当前存档浏览器指针。

`/play/:sessionId` 的持久布局拥有 `GameSession`、assistant-ui runtime、SSE 和 Thread。`/play/:sessionId/manage/saves` 与 `/play/:sessionId/manage/settings` 在同一布局上方渲染模态大型管理层，背景 inert、焦点受约束且关闭后回到控制球；嵌套管理路由变化不得卸载会话。每个模态表面只有右上角一个视觉关闭动作，可滚动内容使用透明轨道与窄拇指。游戏内只列出当前世界存档，不创建游戏或切换世界；当前存档只通过不参与盒模型的背景和“当前游戏”标签高亮，正文与操作区必须和其他存档保持同一对齐线。设置中的减少动态效果使用可由点击、Enter 和 Space 操作并公开开关状态的 switch，所有尾部设置控件在固定宽度列中共享水平中心线。运行中切换存档或返回主菜单只确认旧存档将在后台继续，不取消 WorldRun。开发与生产启动默认只监听 loopback。

游戏页使用 `@assistant-ui/react` 0.15.16 External Store，并固定官方 `ThreadPrimitive.Root → flex Viewport → 44rem message group → ThreadPrimitive.ViewportFooter` 单轴结构。空会话在轴中间只显示“你想做什么？”和圆角 composer；出现消息后 footer 以 `mt-auto + sticky bottom-0` 固定到底部并适配安全区，消息数量、等待或失败状态不能改变底部锚点。玩家消息是右侧低对比气泡：先按短句 max-content 内在宽度收缩，再以会话轴 85% 或 34rem 为上限，空间充足时短中文不得逐字换行；世界消息是平铺正文，检定、运行状态和恢复动作属于从属 footer。ActionBar 只提供真实可用的复制；复制文本由同一 WorldRun 的公开叙事、可见检定和人类可读状态纯投影，不序列化 data part、客户端状态或内部 JSON。

消息不是另一份存储：每个 WorldRun 按 `player.input` 边界投影玩家/世界消息段，clarification 继续同一 run；世界 data part 只展示公开 observation、observation 派生的 outcome、检定与边界状态。SSE 增量合并后再从 `PublicSessionDetail` 重建；刷新、重连和存档恢复不会产生第二条消息路径。客户端只为 queued/running 建立带 epoch/identity 的连接，另以请求序号和卸载状态隔离旧 refresh。start/continue/retry/cancel/abandon 的成功与响应不确定分支、页面重新聚焦和跨标签页变化都调用同一 reconcile-and-observe 路径，使 EventSource 只跟随服务端当前 executing run；状态合并后再决定连接，旧快照不能关闭新 run 的 source。若 start 响应在返回 `runId` 前丢失，客户端以提交前 run 集合、规范化 goal 和本次 attempt 匹配服务端新 run，在两次跨越确认窗口的权威“确实不存在”之前保持操作锁，避免重复创建。网络错误以及 408、429、5xx 和其他不能证明请求未提交的 HTTP 响应都进入这条不确定恢复；只有明确的永久 400、401、403、404、422 直接失败。取消或放弃的 API/reconcile 错误与 SSE 终态无论谁先到，服务端已确认的终态都撤销该操作的失效错误；旧终态不能清除后来独立操作的错误。运行中可安全中断，awaiting_player 可补充信息，可重试失败/step_limit 可继续，所有未完成边界都可明确放弃。提交尚未确认出 run 时输入保持锁定并显示确认状态，不提供实际无法执行的停止动作。

桌面控制球是 56px 状态表盘，接收世界名、存档名、step、elapsedSeconds 与 running/confirming/saved。拖动以 Pointer Events、`requestAnimationFrame` 和 `translate3d` 跟随指针，松手吸附最近左右边缘；位置以 `{ edge, y }` 写入 `livingworld:control-position:v2`，`y` 是归一化坐标，视口变化后限制在安全区和 composer 排除区。桌面点击向页面内侧展开存档、设置、主菜单三个动作和状态卡；三个动作中心位于同一个 84px 半径上，并在可用四分之一圆弧或中部圆弧内等角分布，方位按边缘及上下空间镜像。状态卡从当前方位的完整按钮包络向页面内侧再让出 32px，任何按钮实体都不能与卡片相交。键盘支持 Enter/Space、Escape、Alt+方向键和 Alt+Home。小于 48rem 时点击打开当前页面内具备焦点约束、Escape/遮罩关闭和安全区适配的底部 Sheet。

全产品以 next-themes 保存 `system | light | dark`，默认跟随系统并通过根节点 `.dark` 切换。assistant-ui 明暗 OKLCH 色映射为 `--cg-*` 语义 token，组件和 Tailwind 都只能间接消费这些 token；正文统一使用 Inter、IBM Plex Mono 与中文系统字体回退。普通非文本控件仅在 `:focus-visible` 使用主题蓝色 `--cg-ring` 绘制非包围式底部标记；composer 普通主题不绘制附加焦点线且静态边框与外部阴影不变化，编辑位置由文本插入光标表达；forced-colors 改用系统 `Highlight` 完整 outline。主要控件至少 44px。错误使用 alert，加载和连接状态使用会话轴内 live region，并支持 320px、200% 字体、减少动效、forced colors 与安全区。
