import path from "node:path";
import { AgentMind } from "../src/engine/agent-mind";
import { createStructuredModelProvider } from "../src/engine/model-provider";
import { SimulationEngine } from "../src/engine/simulation";
import { TruthEngine } from "../src/engine/truth-engine";
import { loadWorldScript } from "../src/script/world-loader";

const apiKey = process.env.DEEPSEEK_API_KEY
  ?? process.env.DEEPSEEKAPIKEY
  ?? process.env.deepseekapikey;

async function main(): Promise<void> {
  if (!apiKey) {
    process.stderr.write("DeepSeek smoke test requires DEEPSEEK_API_KEY, DEEPSEEKAPIKEY, or deepseekapikey.\n");
    process.exitCode = 2;
    return;
  }
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const provider = createStructuredModelProvider({
    ...process.env,
    CHATGAME_LLM_PROVIDER: "vercel",
    CHATGAME_LLM_API_KEY: apiKey,
    CHATGAME_LLM_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
    CHATGAME_LLM_MODEL: model,
    CHATGAME_TRUTH_MODEL: model,
    CHATGAME_AGENT_MODEL: model,
  });
  const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), 20260823);
  const engine = new SimulationEngine(
    definition,
    new TruthEngine(provider),
    new AgentMind(provider),
  );

  try {
    await engine.bootstrapAgents();
    engine.beginPlayerIntent("观察石门和庭院，然后在原地等待一秒，不尝试改变任何物品或人物。只依据可观察信息反馈。");
    const result = await engine.step();
    const truthAudit = result.committed.modelAudits.find((audit) => audit.role === "truth-engine");
    const mindAudits = result.committed.modelAudits.filter((audit) => audit.role === "agent-mind");
    if (!truthAudit || mindAudits.length !== Object.keys(result.state.agents).length) {
      throw new Error("committed step is missing model audit coverage");
    }
    process.stdout.write([
      "DeepSeek full-engine smoke passed",
      `revision=${result.state.revision}`,
      `step=${result.state.step}`,
      `provider=${truthAudit.providerId}`,
      `model=${truthAudit.modelId}`,
      `truthAttempts=${truthAudit.attempts}`,
      `agentAudits=${mindAudits.length}`,
      `contentHash=${result.committed.contentHash}`,
    ].join(" ") + "\n");
  } catch (error) {
    process.stderr.write(`DeepSeek full-engine smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
