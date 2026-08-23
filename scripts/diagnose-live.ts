import path from "node:path";
import { AgentMind } from "../src/engine/agent-mind";
import { loadModelCatalog } from "../src/engine/model-catalog";
import { createModelGateway } from "../src/engine/model-gateway";
import { summarizeModelExecutionAudit } from "../src/engine/model-provider";
import { RecordingRuntimeObserver } from "../src/engine/observability";
import { SimulationEngine } from "../src/engine/simulation";
import { TruthEngine } from "../src/engine/truth-engine";
import { loadWorldScript } from "../src/script/world-loader";
import { parseDiagnosticMatrix } from "./runtime-diagnostic-core";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument === "--agents" || argument.startsWith("--agents="))) {
    throw new Error("diagnose:live does not accept --agents");
  }
  const { steps } = parseDiagnosticMatrix(args, { agents: [1], steps: [3] });
  if (steps.length !== 1) throw new Error("diagnose:live accepts exactly one --steps value");
  const observer = new RecordingRuntimeObserver({ mode: "metrics" });
  const catalog = loadModelCatalog(path.resolve(
    process.env.LIVINGWORLD_MODEL_CATALOG_PATH ?? "config/models.yaml",
  ));
  const provider = createModelGateway(catalog, process.env, { observer });
  const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
    seed: 20260823,
    modelCatalog: catalog,
  });
  const engine = new SimulationEngine(
    definition,
    new TruthEngine(provider),
    new AgentMind(provider),
  );
  let sequence = 0;
  const write = (event: string, fields: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, sequence: ++sequence, event, ...fields })}\n`);
  };
  const sessionId = "diagnostic-live";
  await engine.bootstrapAgents({
    workloadId: sessionId,
    batchId: `bootstrap:${sessionId}`,
    correlation: { sessionId, revision: 0, step: 0 },
    observer,
  });
  const rows: Array<{ step: number; calls: number; input: number; output: number; latencyMs: number }> = [];
  for (let index = 0; index < steps[0]; index += 1) {
    engine.beginPlayerIntent(`真实模型诊断步骤 ${index + 1}：观察周围并等待一秒。`);
    const base = engine.snapshot;
    const startedAt = performance.now();
    const result = await engine.step({
      workloadId: sessionId,
      batchId: "diagnostic-live-run",
      correlation: {
        sessionId,
        runId: "diagnostic-live-run",
        runAttempt: 1,
        stepAttemptId: `diagnostic-live-run:1:${base.revision + 1}`,
        revision: base.revision,
        step: base.step + 1,
      },
      observer,
    });
    const summaries = result.committed.modelAudits.map(summarizeModelExecutionAudit);
    const row = {
      step: result.state.step,
      calls: summaries.reduce((sum, summary) => sum + summary.invocations, 0),
      input: summaries.reduce((sum, summary) => sum + (summary.tokenUsage.input ?? 0), 0),
      output: summaries.reduce((sum, summary) => sum + (summary.tokenUsage.output ?? 0), 0),
      latencyMs: Number((performance.now() - startedAt).toFixed(3)),
    };
    rows.push(row);
    write("diagnostic.live.step", {
      ...row,
      audits: result.committed.modelAudits.map((audit) => ({
        role: audit.role,
        subjectId: audit.subjectId,
        invocations: audit.invocations.map((invocation) => ({
          id: invocation.id,
          contextUtf8Bytes: invocation.context.utf8Bytes,
          tokenUsage: invocation.tokenUsage,
          transports: invocation.transports,
          finishReason: invocation.finishReason,
          providerRequestId: invocation.providerRequestId,
        })),
      })),
    });
  }
  write("diagnostic.summary", {
    kind: "live-model",
    steps: rows,
    runtimeEvents: observer.events.length,
  });
  process.stderr.write("step calls input-tokens output-tokens latency-ms\n");
  for (const row of rows) {
    process.stderr.write(`${row.step} ${row.calls} ${row.input} ${row.output} ${row.latencyMs}\n`);
  }
}

void main().catch((error) => {
  process.stderr.write(`live diagnostic failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
