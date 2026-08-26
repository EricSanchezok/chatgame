import path from "node:path";
import { z } from "zod";
import { loadModelCatalog } from "../src/engine/model-catalog";
import { createModelGateway } from "../src/engine/model-gateway";
import { SimulationEngine } from "../src/engine/simulation";
import { MonolithicCurrentAlgorithm } from "../src/engine/monolithic-current";
import { summarizeModelExecutionAudit } from "../src/engine/model-provider";
import { loadWorldScript } from "../src/script/world-loader";

function diagnosticLines(error: unknown, depth = 0): string[] {
  if (depth > 4) return ["cause depth limit reached"];
  if (error instanceof AggregateError) {
    return [
      `${error.name}: ${error.message}`,
      ...error.errors.slice(0, 8).flatMap((member, index) =>
        diagnosticLines(member, depth + 1).map((line) => `member[${index}]: ${line}`)),
    ];
  }
  if (error instanceof z.ZodError) {
    return error.issues.slice(0, 16).map((issue) =>
      `ZodError ${issue.path.join(".") || "<root>"} ${issue.code}`);
  }
  if (!(error instanceof Error)) return [`NonError: ${typeof error}`];
  const safeMessage = error.name === "ModelOutputError" || error.name === "ModelSemanticRepairError"
    ? "structured model output was rejected"
    : error.message;
  const lines = [`${error.name}: ${safeMessage}`];
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause !== undefined) {
    lines.push(...diagnosticLines(cause, depth + 1).map((line) => `cause: ${line}`));
  }
  return lines;
}

async function main(): Promise<void> {
  const catalog = loadModelCatalog(path.resolve(process.env.LIVINGWORLD_MODEL_CATALOG_PATH ?? "config/models.yaml"));
  const provider = createModelGateway(catalog);
  const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
    seed: 20260823,
    modelCatalog: catalog,
  });
  const engine = new SimulationEngine(
    definition,
    new MonolithicCurrentAlgorithm(provider),
  );

  try {
    await engine.bootstrapAgents();
    engine.beginPlayerIntent("观察石门和庭院，然后在原地等待一秒，不尝试改变任何物品或人物。只依据可观察信息反馈。");
    const result = await engine.step();
    const truthAudit = result.modelAudits.find((audit) => audit.role === "truth-transition");
    const mindAudits = result.modelAudits.filter((audit) => audit.role === "agent-mind");
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
    process.stderr.write(`DeepSeek full-engine smoke failed:\n${diagnosticLines(error)
      .map((line) => `- ${line}`)
      .join("\n")}\n`);
    process.exitCode = 1;
  }
}

void main();
