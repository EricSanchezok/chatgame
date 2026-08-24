# 世界导入

## 入口

- 浏览器：`POST /api/worlds/import`，multipart 字段 `file`，可选 `replace=true`。
- CLI：`npm run world:import -- <world.zip> [--replace]`。
- 目录预检：`npm run world:validate -- <world-directory>`。

## 安全限制

ZIP 本体最多 50 MiB、最多 5000 条目、展开数据最多 100 MiB。条目名拒绝反斜杠、NUL、绝对路径、`..` 穿越以及经 Unicode NFC 和大小写折叠后冲突的名称。展开后的世界还要通过严格目录、schema v6 与当前模型目录校验，因此旧文件、未知 Profile、可执行代码、符号链接与额外资产不会被静默忽略。

## 原子安装

导入只在系统临时目录解压并规范化；完整 world layout、schema、模型 Profile 与规则包验证成功后，按规范内容计算 `sha256`。`mechanics.yaml` 的离散随机分布以有序 steps 和原始 outcome 槽位进入规范世界契约，重复槽位不会被去重，分布也不会被期望值或抽样结果替代。SQLite 事务写入包含该完整契约的不可变 `world_versions` 记录并切换 `world_catalog` 当前指针；目标存在而未显式 replace 时返回 409。验证失败不开始写事务，数据库失败不改变当前版本，所有结果都会清理 staging。

归档文件本身不作为运行时文件树安装；数据库只保存运行所需的规范化世界内容。导入不会迁移旧世界或存档，也不会安装依赖或执行世界内代码。
