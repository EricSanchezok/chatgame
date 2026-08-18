<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

chatgame 是剧本驱动的 AI 聊天游戏框架。设计的第一性原理见 [游戏第一性原理 Agent Note](.agents/notes/implemented/game-design/2026-08-18-game-first-principles.md)；改架构前先读 [docs/architecture.md](docs/architecture.md)。

## 仓库布局

```
src/          应用与引擎：app/（Next.js UI）、script/（剧本契约层）、engine/（引擎运行时）
docs/         参考文档：architecture、game-design（剧本格式/引擎运行时）、research（调研证据）
.agents/notes/ 决策记录（Agent Notes）：{生命周期}/{分类}/YYYY-MM-DD-主题.md
scripts/      门禁与演示脚本（validate-script / play-emberfall）
```

## 命令

```sh
npm run dev      # 开发服务器
npm run build    # 生产构建
npm run lint     # ESLint
npm run play     # 引擎 demo CLI（默认 Mock LLM）
npm test         # vitest 测试
```

## 约定

- **剧本驱动**：世界观/人物/机制由剧本定义，框架保持通用。禁止为单个游戏写死逻辑而绕过剧本。
- **引擎管规则，LLM 管叙事**：状态（时间/背包/血量/记忆）是引擎管理的真实数据，绝不放进对话文本。
- **每个非平凡改动必须附 Agent Note**（同一改动内完成）；决策记录格式见 [.agents/notes/README.md](.agents/notes/README.md)。
- **每个事实只有一个家**：决策 → notes；规格 → docs/game-design；指令 → 本文件；别处只放链接。
- 文档只写当前状态，不写变更历史；交叉引用用相对 Markdown 链接。
- 文档与决策记录用中文；代码标识符与注释用英文。
