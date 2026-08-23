import path from "node:path";
import { AgentMind } from "../src/engine/agent-mind";
import { loadModelCatalog } from "../src/engine/model-catalog";
import { createModelGateway } from "../src/engine/model-gateway";
import { SimulationEngine } from "../src/engine/simulation";
import { TruthEngine } from "../src/engine/truth-engine";
import { summarizeModelExecutionAudit } from "../src/engine/model-provider";
import { loadWorldScript } from "../src/script/world-loader";

async function main(): Promise<void> {
  const catalog = loadModelCatalog(path.resolve(process.env.LIVINGWORLD_MODEL_CATALOG_PATH ?? "config/models.yaml"));
  const provider = createModelGateway(catalog);
  const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
    seed: 20260823,
    modelCatalog: catalog,
  });
  const engine = new SimulationEngine(
    definition,
    new TruthEngine(provider),
    new AgentMind(provider),
  );

  try {
    await engine.bootstrapAgents();
    engine.beginPlayerIntent("观察石门和庭院，然后在原地等待一秒，不尝试改变任何物品或人物。只依据可观察信息反馈。");
    const result = await engine.step();
    const truthAudit = result.committed.modelAudits.find((audit) => audit.role === "truth-transition");
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
      `truthAttempts=${summarizeModelExecutionAudit(truthAudit).invocations}`,
      `agentAudits=${mindAudits.length}`,
      `contentHash=${result.committed.contentHash}`,
    ].join(" ") + "\n");
  } catch (error) {
    process.stderr.write(`DeepSeek full-engine smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
