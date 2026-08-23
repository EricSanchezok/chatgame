# 世界导入

## 入口

- 浏览器：`POST /api/worlds/import`，multipart 字段 `file`，可选 `replace=true`。
- CLI：`npm run world:import -- <world.zip> [--replace]`。
- 目录预检：`npm run world:validate -- <world-directory>`。

## 安全限制

ZIP 本体最多 50 MiB、最多 5000 条目、展开数据最多 100 MiB。条目名拒绝反斜杠、NUL、绝对路径和 `..` 穿越。展开后的世界还要通过严格目录和 schema v3 校验，因此旧文件、可执行代码、符号链接与额外资产不会被静默忽略。

## 原子安装

导入解压到系统临时目录，只在完整 `loadWorldScript` 成功后安装到 `<scriptsRoot>/<manifest.id>`。目标存在而未显式 replace 时返回 409。替换时先把旧目录 rename 为备份，再把已验证目录 rename 到目标；第二步失败会恢复备份。成功后删除备份，所有结果都会清理 staging。

导入不会迁移旧世界或存档，也不会安装依赖或执行世界内代码。
