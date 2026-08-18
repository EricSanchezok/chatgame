# TS/JS LLM 集成库生态调研：为 chatgame 引擎选型

- 调研日期：2026-08-18
- 调研范围：TypeScript/JavaScript 生态中成熟的 LLM 集成开源包——Vercel AI SDK（ai）、LangChain.js（langchain）、OpenAI Node SDK（openai）、Anthropic TS SDK（@anthropic-ai/sdk）、ModelFusion、Google gen-ai（@google/genai）、LiteLLM JS、promptfoo
- 信息来源：以官方文档（ai-sdk.dev、js.langchain.com→docs.langchain.com、OpenAI/Anthropic 官方 README）与 GitHub 源码/npm registry 元数据为主；全部为公开资料
- 时效说明：本领域迭代极快（AI SDK 一年内从 v5 到 v7），文中所有版本号、许可、Node 版本要求均于 2026-08-18 通过 npm registry 与官方文档核实；不确定信息标注"待核实"
- 阅读对象：chatgame（剧本驱动的 AI 聊天游戏框架，引擎管状态、LLM 管叙事）的 LLM 接入层选型

**结论先行：主选 Vercel AI SDK v7（`ai@7.x` + `@ai-sdk/openai` 等 provider 包），备选 OpenAI Node SDK（`openai@7.x` + `zodResponseFormat`）。** 理由见第五节。

---

## 一、chatgame 的约束与需求

- 运行时：Next.js 16.3.1（App Router）、Node v23.11.0（本机）、`"type"` 未设（默认 CJS，但 Next.js 生态内部走 ESM）
- 已有依赖：**zod ^4.4.3（Zod v4）**、vitest ^3.2.7、TypeScript ^5
- 引擎模式：状态（时间/背包/属性/NPC 记忆）由引擎管理，LLM 只做叙事与角色行为 → 核心调用模式是「状态 → prompt → 结构化 JSON（zod schema）→ 校验」，流式可选
- 硬性要求：provider 无关（至少 OpenAI/Anthropic/Google/本地 Ollama）、zod schema 结构化输出、流式可选、维护活跃、许可宽松（MIT/Apache-2.0）
- 相关性标注：高 = 直接影响选型；中 = 有参考价值但非首选；低 = 仅背景

---

## 二、候选包逐一评估

### 1. Vercel AI SDK（`ai`）—— 相关性：高 ✅ 主选

| 维度 | 现状（2026-08-18 核实） |
|---|---|
| 当前版本 | **v7.0.66**（latest dist-tag；另有 ai-v5=5.0.238、ai-v6=6.0.257 旧线） |
| 许可 | **Apache-2.0**（GitHub LICENSE + package.json `license: "Apache-2.0"`） |
| 维护状态 | 极活跃：7,986 commits、26.3k stars；Vercel 官方团队维护，与 Next.js 同源 |
| Node 要求 | **>=22**（engines 字段）；文档注明 Node 22 于 2026-04-30 结束维护，生产建议 Node 24 LTS/26。本机 Node 23 满足下限 |
| ESM | v7 起 **ESM-only**（移除 CommonJS 支持） |
| zod | peerDependency `zod: ^3.25.76 || ^4.1.8` → **兼容项目现有 Zod v4** ✅ |

**多 provider**：官方提供 20+ provider 包（`@ai-sdk/openai`、`@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/amazon-bedrock`、`@ai-sdk/mistral`、`@ai-sdk/deepseek`、`@ai-sdk/groq` 等）；本地/自托管模型走 `ollama-ai-provider`（社区）或 OpenAI-compatible provider（LM Studio 等）；v7 默认可用 Vercel AI Gateway（传 `"anthropic/claude-opus-4.6"` 这类字符串即可，无需 provider 包），也可以直连各 provider SDK。

**结构化输出**：`generateText` / `streamText` 上用 `output: Output.object({ schema: z.object({...}) })`；schema 同时用于**生成与校验**。v7 还有 `Output.array()`（流式时 `elementStream` 逐个元素已校验）、`Output.choice()`（枚举强制）、`Output.json()`（仅 JSON 语法校验）。也支持 Valibot / JSON Schema。校验失败抛 `AI_NoObjectGeneratedError`（保留 text/response/usage/cause 便于排查）；`result.output` 是 getter，取不到时抛 `AI_NoOutputGeneratedError`。v7 中独立 `generateObject` 已并入 `generateText`+`Output`（Reference 只列 `Output`），README 示例即用 `Output.object`——API 已换代但稳定。

**流式**：`streamText` 原生支持文本与结构化输出流（`partialOutputStream` 流式 partial object、`elementStream` 流式已校验元素）；`fullStream` 在 v7 改名 `stream`（旧名保留为 deprecated alias）。错误在流中通过 `onError` 回调暴露，不炸流。

**tool 调用**：`tool({ description, inputSchema, execute })` 与 `generateText`/`streamText` 组合，结构化输出与工具调用可在同一次请求内共存（注意：结构化输出也算一个 step，配 `stopWhen: isStepCount(n)` 时要把这个 step 计入）。v7 还提供 `ToolLoopAgent` 等 agent 层，但 chatgame 引擎只需 Core 层。

**对 chatgame 的适配度**：高——「状态 → prompt → `Output.object` → 校验」正好是它的第一等公民用法；provider 无关满足剧本可配置任意模型；测试工具（见第六节）可直接验证 prompt 组装与输出解析而不调真实 API。**风险点**：v7 迭代快、ESM-only、每个大版本都有 breaking changes（v6→v7 有完整 codemod 列表），选型后应锁定版本并跟随迁移指南。

### 2. LangChain.js（`langchain`）—— 相关性：中

| 维度 | 现状（2026-08-18 核实） |
|---|---|
| 当前版本 | **1.5.9**（`langchain` 主包；`@langchain/core` ^1.2.8、`@langchain/langgraph` ^1.4.8 为依赖） |
| 许可 | **MIT** |
| 维护状态 | 活跃（LangChain 官方团队）；但 2026 年文档重心转向 `create_agent`/LangGraph/Deep Agents 体系 |
| Node 要求 | >=20 |
| zod | 依赖 `zod: ^3.25.76 || ^4`（兼容 v4） |

**结构化输出**：文档体系已重构（js.langchain.com 重定向到 docs.langchain.com，`/how_to/structured_output` 页面已不在索引中）。当前推荐写法是 `createAgent` + `tool(schema)`（zod schema 直接描述工具参数）；官方文档中不再强调旧的 `withStructuredOutput`，`chat_models/universal` 等模块仍在。**结论：结构化输出能力存在，但文档重心已转向 agent 编排而非"轻量结构化生成"。**

**多 provider**：标准模型接口 + `@langchain/openai`、`@langchain/anthropic`、`@langchain/google-genai`、`@langchain/ollama` 等集成；`create_agent` 甚至可直接传模型字符串（`"gpt-5.5"`、`"claude-sonnet-4-6"`、`"ollama:devstral-2"`）。

**包体积/复杂度**：主包 unpacked 约 3.2MB（dist），依赖链含 langgraph、langsmith 等；概念层（Chain/LangGraph/Agent/Harness）多，**对"引擎管状态、只要一层 LLM 适配"的 chatgame 明显偏重**。若未来 chatgame 需要 RAG/长链编排，可再引入，但作为核心接入层属于杀鸡用牛刀。

**对 chatgame 的适配度**：中——能力齐全但抽象层多、体积大；结构化输出 API 不如 AI SDK 直观（当前文档以 agent/tool 为中心，而非"给个 schema 拿回对象"）。

### 3. OpenAI Node SDK（`openai`）—— 相关性：高（备选）

| 维度 | 现状（2026-08-18 核实） |
|---|---|
| 当前版本 | **7.5.0**（Node >=22，Apache-2.0） |
| 许可 | Apache-2.0 |
| 维护状态 | OpenAI 官方，活跃 |
| zod | peerDependencies 含可选 `zod: ^3.25 || ^4.0` ✅ |

**结构化输出**：源码（`src/helpers/zod.ts`）确认提供 `zodResponseFormat(schema, name)`（Chat Completions）、`zodTextFormat`（Responses API）、`zodFunction` / `zodResponsesFunction`（工具参数）；内部把 zod v3/v4/v4-mini schema 转 strict JSON Schema，`response_format: zodResponseFormat(...)` 时结果带 `.parsed` 字段（自动 parse 校验）。**zod v4 原生支持已确认**（源码同时处理 `zod/v3` 与 `zod/v4`）。

**多 provider**：**锁定 OpenAI**（Azure/Bedrock 是专用入口，不解决"换家"问题）——这是它相对 AI SDK 的最大劣势。

**流式**：原生 streaming（`stream` / `toReadableStream` 等）。

**对 chatgame 的适配度**：中——作为"官方 SDK + zod helper"质量很高、最贴近 OpenAI 原始能力；但 provider 锁定。适合作为**默认 provider 的底层实现**，或当 chatgame 只服务 OpenAI 时的简化路径；作为通用接入层则需自行再包一层 provider 抽象（等于重造 AI SDK 的 Provider 层）。

### 4. Anthropic TS SDK（`@anthropic-ai/sdk`）—— 相关性：中

| 维度 | 现状（2026-08-18 核实） |
|---|---|
| 当前版本 | 0.117.1（MIT；注意：仍为 0.x，官方未承诺 1.0 API 稳定） |
| 许可 | MIT |
| zod | peerDependencies 可选 `zod: ^3.25.0 || ^4.0.0` |

**结构化输出**：源码（`src/helpers/zod.ts`）确认 `zodOutputFormat(zodSchema)` → 传 `.parse()` 时响应带 `.parsed_output`；内部用 `zod/v4` 的 `toJSONSchema` 转 schema 并 `safeParse` 校验（失败抛带 issue 明细的 `AnthropicError`）。**zod v4 支持已确认**。

**多 provider**：**锁定 Anthropic**。维护活跃但版本长期 0.x（约 0.117），API 变动风险高于 1.x 库。

**对 chatgame 的适配度**：中——与 OpenAI SDK 同理，是优秀 provider 级 SDK，但 provider 锁定 + 0.x 版本号，不适合做引擎的通用接入层。

### 5. ModelFusion（`modelfusion`）—— 相关性：低（已归档，直接排除）

- npm 最新 **0.137.0**（2024-02 发布，MIT，Node >=18，锁定 zod 3.22.4——不兼容 Zod v4）
- **GitHub 仓库 `vercel/modelfusion` 已于 2026-06-03 由 owner 归档（read-only）**；README 明确："ModelFusion has joined Vercel and is being integrated into the Vercel AI SDK"，作者 Lars Grammel 转投 AI SDK
- **结论：已停止开发，其"结构化对象生成"理念已被 AI SDK 吸收（`Output.object` 即其延续）。chatgame 不应采用，仅作背景记录。**

### 6. 其他候选

| 包 | 现状（2026-08-18 核实） | 对 chatgame 相关性 |
|---|---|---|
| **`@google/genai`**（Google 官方，v2.17.1，Apache-2.0，Node >=20） | 能力齐全（含 zod schema 的结构化输出），但**锁定 Google Gemini/Vertex**；打包体积大（unpacked ~17MB）；不是通用 provider 层 | 中（若未来只跑 Gemini 可作 provider 层替代；作为主选不满足 provider 无关） |
| **`litellm`**（LiteLLM JS，v0.12.0，ISC，Node >=18） | 名义上"多 provider"，但**2024-01 后无发布**（一年半未更新）、依赖很旧的 `openai@^4.11.1`/`@anthropic-ai/sdk@^0.6.2`；维护停滞 | 低（不可选） |
| **promptfoo**（v0.122.0，MIT，Node >=22.22） | **LLM 评测/测试工具**，不是接入层；内部依赖 `ai@^6.0.190` 与 zod v4，印证 AI SDK 是行业事实标准 | 中（用于 prompt/剧本输出评测，见第六节） |
| **Langfuse**（`@langfuse/client` v5.x） | 可观测/追踪平台（开源 core），不做 prompt→结构化输出；集成 AI SDK/OpenAI SDK 皆易 | 中（若上可观测，选它做 LLM 追踪，不影响本选型） |

---

## 三、横向对比表

| 维度 | AI SDK v7 | LangChain.js 1.x | OpenAI SDK 7.x | Anthropic SDK 0.117 | ModelFusion | Google gen-ai |
|---|---|---|---|---|---|---|
| 版本 | 7.0.66 | 1.5.9 | 7.5.0 | 0.117.1 | 0.137.0（停更） | 2.17.1 |
| 许可 | Apache-2.0 | MIT | Apache-2.0 | MIT | MIT | Apache-2.0 |
| Node 要求 | >=22（ESM-only） | >=20 | >=22 | 未声明下限 | >=18 | >=20 |
| zod 支持 | ✅ v3/v4（peer） | ✅ v3/v4 | ✅ v3/v4/v4-mini | ✅ v3/v4 | ⚠️ 仅 zod 3.22 | ✅（zod v3 dev-dep，结构化为第一等） |
| 结构化输出 API | `output: Output.object({schema})` + 校验 | `tool(schema)` / 旧 `withStructuredOutput` | `zodResponseFormat` + `.parsed` | `zodOutputFormat` + `.parsed_output` | generateObject（已并入 AI SDK） | `responseSchema` 等 |
| 流式 | ✅ text/object/array 全支持 | ✅ | ✅ | ✅ | ✅ | ✅ |
| provider 无关 | ✅ 20+ 官方 provider + OpenAI-compatible + Ollama | ✅ 多集成 | ❌ 锁定 OpenAI | ❌ 锁定 Anthropic | ✅ 多 provider | ❌ 锁定 Gemini/Vertex |
| 维护状态 | 极活跃 | 活跃 | 活跃 | 活跃（0.x） | 已归档 2026-06 | 活跃 |
| 对 chatgame 适配度 | **高** | 中（偏重） | 中（锁定） | 中（锁定） | 低 | 中（锁定） |

---

## 四、版本与许可核实明细（证据）

- `ai`：npm dist-tags `latest: 7.0.66`；package.json `license: "Apache-2.0"`、`engines.node >=22`、`peerDependencies.zod ^3.25.76 || ^4.1.8`、`exports "./test"` 提供 `ai/test` 子路径；GitHub LICENSE 文件为 Apache-2.0
- `langchain`：npm `latest: 1.5.9`；`license: MIT`、`engines.node >=20`、依赖 `zod ^3.25.76 || ^4`、`@langchain/langgraph ^1.4.8`
- `openai`：npm `latest: 7.5.0`；`license: Apache-2.0`、`engines.node >=22.0.0`、可选 peer `zod ^3.25 || ^4.0`
- `@anthropic-ai/sdk`：npm `latest: 0.117.1`；`license: MIT`、可选 peer `zod ^3.25.0 || ^4.0.0`
- `modelfusion`：npm `latest: 0.137.0`（2024-02）；GitHub `vercel/modelfusion` archived（2026-06-03）
- `@google/genai`：npm `latest: 2.17.1`；`license: Apache-2.0`、`engines.node >=20.0.0`
- `litellm`：npm `latest: 0.12.0`（2024-01）；`license: ISC`
- `promptfoo`：npm `latest: 0.122.0`；`license: MIT`、`engines.node >=22.22.0`、内部依赖 `ai ^6.0.190` 与 `zod ^4.3.6`

---

## 五、推荐选型

### 主选：Vercel AI SDK v7（`ai@^7` + `@ai-sdk/openai` 等）

理由（按 chatgame 需求排序）：
1. **provider 无关是硬需求**：AI SDK 是唯一同时满足"官方维护 + 20+ provider + 本地 Ollama/LM Studio + OpenAI-compatible"的主流库；剧本可声明 `provider: 'openai' | 'anthropic' | 'ollama'`，引擎侧只写一份调用代码。
2. **结构化输出是天然匹配**：`output: Output.object({ schema })` 即"状态 → prompt → 结构化 JSON → 校验"，schema 同时驱动生成与校验，失败抛类型化错误（`AI_NoObjectGeneratedError` 带 `text/cause/usage`）——这正是游戏引擎把 LLM 输出安全落回状态机所需。
3. **流式可选**：`streamText` 对文本/对象/数组都支持流式，非流式用 `generateText` 即可，接口对称。
4. **zod v4 兼容**：peer 依赖 `^3.25.76 || ^4.1.8`，与项目现有 `zod@4.4.3` 直接兼容。
5. **测试生态最好**：`ai/test` 提供 `MockLanguageModelV4`、`mockValues`、`simulateReadableStream`，可在不调真实 API 的情况下端到端测"prompt 组装 → 输出解析 → schema 校验"（见第六节）。
6. **维护与生态**：Vercel 官方 + Next.js 同源（本项目 Next 16 正好匹配其生态）、npm 上被 promptfoo 等主流工具作为内部依赖，事实标准。

注意点（写进决策记录）：
- **锁版本**：`ai@^7` 定死 7.x，升级大版本前先读对应 migration guide（v6→v7 有 `npx @ai-sdk/codemod v7`）。
- **Node/ESM**：v7 要求 Node >=22、ESM-only。本机 Node 23 满足；若项目 `package.json` 后续要加 `"type": "module"` 需评估对现有 CJS 脚本的影响（Next.js 应用代码本身走 ESM 无碍）。
- **默认走 Vercel AI Gateway** 是 v7 新默认（传模型字符串时），若不想依赖 Vercel 云服务，用 provider 包直连（`import { openai } from '@ai-sdk/openai'`）即可，无强制。
- **API 仍在快速演进**：`generateObject`→`Output` 即一次大换代；选择后把核心调用收敛到引擎自己的薄适配层（如 `src/llm/` 内一个 `generateNarrative/parseAction` 门面），把 AI SDK 的变动隔离在适配层内。

### 备选：OpenAI Node SDK（`openai@^7` + `zodResponseFormat`）

适用场景：chatgame 首版只服务 OpenAI（或先跑通单 provider），或团队想尽量少依赖抽象层。优点：官方 SDK、zod v4 原生支持、`.parsed` 自动校验、流式齐全。缺点：**provider 锁定**；换 Anthropic/Google/Ollama 时要么写第二套代码，要么自包抽象层（等于重造 AI SDK 的 provider 层，且失去社区 provider 生态与 `ai/test` 测试工具）。

**对比结论**：两者 zod 结构化输出能力等价（都已确认 zod v4 支持）；决定性差异是 **provider 无关 + 测试工具 + 社区生态**。chatgame 的"剧本可配置任意模型"需求使 AI SDK 胜出；若未来证明只需要 OpenAI，可随时在适配层内把 `@ai-sdk/openai` 换成 `openai` 官方包（AI SDK 的 provider 层本来就是官方 SDK 的薄封装）。

### 明确排除

- **ModelFusion**：已归档（2026-06-03），且 zod 锁 3.22 不兼容 v4
- **LiteLLM JS（litellm）**：2024-01 后停更，依赖链陈旧
- **LangChain.js**：非不能用于结构化输出，但为"引擎管状态、只调 LLM"的架构引入 agent/RAG 全套抽象与 ~3MB 依赖，性价比低；若未来做 RAG/记忆检索再按需引入 `@langchain/*` 子包
- **@google/genai、Anthropic SDK**：provider 锁定，作为 provider 层可选（AI SDK 已有对应 provider 包），不作为主抽象

---

## 六、测试/模拟手段（不调真实 API 验证 prompt 组装与输出解析）

### 1. AI SDK 官方 mock（推荐，与主选配套）

`ai/test` 子路径（`import { MockLanguageModelV4 } from 'ai/test'`）提供：
- **`MockLanguageModelV4`**：`new MockLanguageModelV4({ doGenerate / doStream })` 返回你写死的文本/流；与 `generateText` / `streamText` + `Output.object` 组合时，**会真实走 schema 校验路径**——即测的是"prompt 组装是否正确 + 解析/校验是否通过"，而不是"模型有没有被调用"。
- **`mockValues`**：按调用依次返回预设值（数组耗尽后返回最后一个），用于多轮/多步测试。
- **`mockId`**：自增 ID。
- **`simulateReadableStream`**（从 `ai` 导入）：模拟带延迟的流，可测流式逻辑与 UI 消息流。

用法示例（官方 Testing 文档）：
```ts
import { generateText, Output } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

const result = await generateText({
  model: new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: '{"content":"Hello, world!"}' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 20, text: 20 } },
      warnings: [],
    }),
  }),
  output: Output.object({ schema: z.object({ content: z.string() }) }),
  prompt: 'Hello, test!',
});
```
（注：v7 中 mock 类名带 `V4` 后缀，对应 language model v4 规范；未来大版本可能改名，以 `ai/test` 文档为准。）

### 2. vitest mock（本项目已有 vitest ^3.2.7）

- **不用 AI SDK 时**：`vi.mock('ai', ...)` / `vi.fn()` 替换 `generateText`/`streamText` 返回预设 `{ output }`，只测引擎侧状态落盘逻辑——注意这**绕过了 schema 校验**，适合测"引擎收到结构化输出后怎么处理"。
- **测 prompt 组装**：spy 在调用参数上断言 `system`/`messages` 内容（AI SDK 的 `generateText` 参数即调用参数），可配合 `mockValues` 断言多轮 prompt 演进。
- **测解析/校验**：用 `MockLanguageModelV4` 喂非法 JSON，断言 `NoObjectGeneratedError` 被抛出（即"引擎对 LLM 坏输出有兜底"）。

### 3. 端到端替身

- **自托管小模型**：Ollama 本地跑小模型（如 qwen/llama 3.x）做集成测试（真实网络路径，非断言性）。
- **promptfoo（v0.122.0）**：LLM 评测工具（MIT，Node >=22.22），用 `promptfoo eval` 对"prompt 模板 × 输出 schema"做批量评测与回归（支持断言输出符合 JSON Schema / zod 语义）；适合对剧本 prompt 做质量回归，**不适合**做引擎单元测试。
- **Langfuse**：若需观测真实调用的 prompt/输出/成本，接入 `@langfuse/client`（与 AI SDK/OpenAI SDK 都有官方集成）；不影响选型。

**建议组合**：单元测试用 `ai/test` 的 `MockLanguageModelV4`（主）+ vitest `vi.fn`（辅，测引擎层）；prompt 质量回归用 promptfoo；发布前冒烟用 Ollama 本地模型。

---

## 七、来源链接

**Vercel AI SDK**
- GitHub: https://github.com/vercel/ai （README、LICENSE、package.json、7,986 commits / 26.3k stars）
- 文档 - Structured Data: https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
- 文档 - Testing: https://ai-sdk.dev/docs/ai-sdk-core/testing
- 文档 - Providers and Models: https://ai-sdk.dev/docs/foundations/providers-and-models
- 文档 - Output 参考: https://ai-sdk.dev/docs/reference/ai-sdk-core/output
- 文档 - 迁移指南（v6→v7 / versioning）: https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0
- npm: https://registry.npmjs.org/-/package/ai/dist-tags 、https://registry.npmjs.org/ai/latest

**LangChain.js**
- 文档（新站）: https://docs.langchain.com/oss/javascript/ （索引 llms.txt；overview 含 `createAgent`/`tool(schema)` 示例）
- npm: https://registry.npmjs.org/langchain/latest

**OpenAI Node SDK**
- 源码（zod helper）: https://github.com/openai/openai-node/blob/main/src/helpers/zod.ts （`zodResponseFormat`/`zodTextFormat`/`zodFunction`/`zodResponsesFunction`，支持 zod v3/v4/v4-mini）
- npm: https://registry.npmjs.org/openai/latest

**Anthropic TS SDK**
- 源码（zod helper）: https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/helpers/zod.ts （`zodOutputFormat`，内部用 `zod/v4`）
- npm: https://registry.npmjs.org/@anthropic-ai/sdk/latest

**ModelFusion**
- GitHub（已归档）: https://github.com/vercel/modelfusion （"archived by the owner on Jun 3, 2026"）
- npm: https://registry.npmjs.org/modelfusion/latest

**其他**
- `@google/genai`: https://registry.npmjs.org/@google/genai/latest
- `litellm`: https://registry.npmjs.org/litellm/latest
- promptfoo: https://registry.npmjs.org/promptfoo/latest 、https://promptfoo.dev

---

## 八、未解决问题

1. **AI SDK v7 具体行为细节未逐一验证**（文档示例为主）：`Output.array` 的 `elementStream` 在部分 provider（如非工具型模型）上是否都可用、`stopWhen` 步数语义在多工具+结构化输出下的精确计数——建议选型落地后用一个最小 demo（Ollama + OpenAI 各一）跑通验证。
2. **Vercel AI Gateway 默认行为**：v7 传模型字符串时默认走 Gateway，其免费额度/鉴权/数据策略待核实；若 chatgame 面向本地部署，应明确走 provider 包直连路径。
3. **LangChain 1.x 的 `withStructuredOutput` 状态**：官方文档已重构，该 API 是否仍是推荐入口待核实（文档已转向 `create_agent` + tool schema）；因不选它，未深挖。
4. **zod v4 与各库的边界细节**：`zod@4.4.3` 与 AI SDK 要求的 `^4.1.8`、OpenAI 的 `^4.0` 均兼容，但 `zod/v4-mini` 变体只在 OpenAI SDK 中提及；chatgame 无需使用 v4-mini。
5. **Node 版本策略**：AI SDK v7 要求 Node >=22 且 ESM-only；若 CI/部署环境仍跑 Node 20，需升级到 22+（本机 Node 23 已满足）。AI SDK 文档建议生产用 Node 24 LTS/26。
6. **可观测性选型**：Langfuse 与 AI SDK 的 `telemetry` 集成细节未展开；属于后续工程决策，不影响本选型。

---

*本报告为调研记录，不是决策；结论被采纳时请写成 .agents/notes/ 决策记录并链接回本文件（见 docs/research/README.md 约定）。*
