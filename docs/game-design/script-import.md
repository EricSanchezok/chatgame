# 剧本导入规格

> 本文是 Web 与 CLI 共用导入核心的当前参考。运行时表现边界见 [presentation.md](presentation.md)，剧本内容格式见 [script-format.md](script-format.md)。

## 安装所有权

`scripts/<id>/` 中没有 `.chatgame-source.json` 的目录属于应用，来源显示为“内置”，Web 与 CLI 都不得替换或删除。导入成功的目录写入包含来源标签和 opaque 安装代次的 receipt，来源显示上传文件名或目录名；每次安装或替换都生成新代次，只有带有效 receipt 的导入目录可以被替换或删除。EngineHost 在替换或删除前拒绝仍有活跃会话的 scriptId；Web commit、host zip 导入和 host 目录导入共用该权威检查。删除剧本目录和已构建 UI bundle，但保留存档。

## 两阶段 Web 协议

`POST /api/scripts/import/preview` 接收单个 multipart `file`，上传上限 20MB，解包总量上限 100MB。服务端拒绝绝对路径、反斜杠、空路径段和 `..`，把找到的剧本移动到 opaque UUID token 下的暂存目录，执行静态校验但不运行 engine 或 UI 代码。暂存 authority 有效期 15 分钟；过期、已确认或确认失败后的 token 都不可复用。

预检 DTO 返回 token、scriptId、name、sourceName、schemaVersion、host/engine/UI API 版本、静态 cover 元数据、opaque `coverUrl`、权限、代码风险、冲突、素材来源覆盖、errors 与 warnings。语义无效的剧本仍返回可展示的预检；`errors` 非空时服务端拒绝 commit。暂存封面只能通过 `/api/scripts/import/preview/:token/cover` 读取，必须位于暂存剧本内、使用白名单图片类型且不超过 5MB，响应为 private/no-store 并带 `nosniff`。

`POST /api/scripts/import/commit` JSON 必须显式包含 `{ "token": string, "replace": boolean }`。同 ID 不存在时 `replace` 必须为 `false`；同 ID 是导入剧本时，UI 单独取得替换确认后传 `true`；同 ID 是内置剧本时预检产生不可提交错误，commit 和底层安装核心也再次拒绝。token 绑定预检时目标目录的完整内容树 hash、安装代次、安装冲突与替换权限；commit 紧邻原子目录替换前同步重算并比较该身份，再由 EngineHost 检查该 scriptId 没有活跃会话。目标身份变化或活跃会话都会返回 409；失败消费 token，玩家结束相关会话后必须重新上传预检，旧 token 不得覆盖当前安装。代码信任确认与替换确认是两个独立用户决定，不能由冲突状态自动推导。

commit 先把校验通过的暂存内容复制到同一 scripts root 的 incoming 目录并写 receipt；替换时把旧导入目录改名为 backup，再原子改名 incoming，成功后删除 backup，失败时恢复旧目录。无论成功或失败都消费 token。存档不参与目录替换。

## 素材来源

只要 zip 中存在 `assets/` 下的本地文件，就必须包含 `assets/provenance.yaml`。`files` 是以剧本根为基准的映射，键固定写成 `assets/...` POSIX 路径；每个实际文件必须恰有记录，记录至少包含非空 `source` 与 `license`。缺清单、未覆盖文件、空来源或空许可是 error；指向不存在文件的多余记录是 warning，并在预检 DTO 的 `extraFiles` 中列出。

```yaml
version: 1
files:
  assets/backgrounds/town-square.svg:
    source: chatgame-team original illustration
    license: project-owned
  assets/fonts/example.woff2:
    source: Example Foundry
    license: OFL-1.1
```

`assets/provenance.yaml` 本身不需要自我记录。`assets.yaml`、`theme.yaml` 与 `themes/*.yaml` 的任意 `file` 字段不得是 `http://`、`https://` 或 protocol-relative URL；远程 URL 只能作为 provenance 元数据说明来源，不能作为运行时热链。预检 DTO 返回 `manifestPresent`、`coveredFiles`、`totalFiles`、`missingFiles`、`extraFiles` 与 `remoteReferences`，安装核心在 commit/CLI 路径再次执行同一门禁。

## CLI

目录和 zip CLI 复用相同 extraction、校验、provenance、receipt、内置保护和原子替换核心，但没有 Web 暂存 token。调用者必须显式提供 replace；CLI 不构成绕过内置源码保护的维护通道。

## 失败与恢复

非法 zip、zip bomb、路径穿越和找不到 `script.yaml` 在 preview 前失败并清理暂存目录。校验问题保留为 preview errors 供玩家查看。过期 token 返回 410，未知或已消费 token 返回 404，未确认的导入冲突返回 409，内置替换/删除返回 403，活跃会话替换/删除返回 409。活跃会话替换失败时，安装目录、receipt、该会话的行动预检与后续回合保持原版本；结束会话并重新 preview 后才可替换。失败不得留下 incoming/backup 目录，不得改变已安装剧本或存档。
