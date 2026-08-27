import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { deriveExecutionWork, MetricDefinitionRegistry, EXECUTION_METRICS } from "../../engine/execution-metrics";
import { contentHash } from "../../engine/model-audit";
import { LocalDatabase } from "../local-database";
import { replayThroughAlgorithm } from "../../../scripts/execution-command";
import { runDeterministicExperiment } from "../../../scripts/experiment-core";

function database(): LocalDatabase {
  const root = mkdtempSync(path.join(tmpdir(), "lwe-execution-ledger-"));
  return new LocalDatabase(path.join(root, "livingworld.sqlite"), { heartbeat: false });
}

const manifestBody = {
  id: "test-algorithm",
  version: "1",
  config: {},
  components: [],
};
const manifest = { ...manifestBody, hash: contentHash(manifestBody) };

describe("Execution Ledger", () => {
  it("rejects an older database without migrating or deleting it", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lwe-old-database-"));
    const file = path.join(root, "livingworld.sqlite");
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations(version, applied_at) VALUES (5, '2026-08-27T00:00:00.000Z');
    `);
    legacy.close();

    expect(() => new LocalDatabase(file, { heartbeat: false }))
      .toThrow("use a new LIVINGWORLD_DATA_ROOT");
    const preserved = new Database(file, { readonly: true });
    expect(preserved.prepare("SELECT version FROM schema_migrations").pluck().get()).toBe(5);
    preserved.close();
  });

  it("buffers bounded trace writes until an explicit durability boundary", () => {
    const ledger = database();
    try {
      const delivered: string[] = [];
      ledger.subscribe((event) => delivered.push(event.event));
      const trace = ledger.beginExecution({
        id: "buffered-execution",
        kind: "diagnostic",
        manifest,
        worldHash: contentHash("world"),
        codeRevision: "test",
        codeDirty: false,
        modelCatalogHash: contentHash("catalog"),
        seed: 1,
        runtimeConfig: {},
      });
      trace.emit({ event: "buffered.first" });
      trace.emit({ event: "buffered.second" });
      expect(delivered).toEqual([]);

      trace.flush();

      expect(delivered).toEqual(["buffered.first", "buffered.second"]);
      expect(ledger.executionEvents("buffered-execution").map((event) => event.event))
        .toEqual(["buffered.first", "buffered.second"]);
      ledger.finishExecution("buffered-execution", { status: "succeeded" });
    } finally {
      ledger.close();
    }
  });

  it("persists full payloads as compressed content-addressed artifacts", () => {
    const ledger = database();
    try {
      const trace = ledger.beginExecution({
        id: "execution-1",
        kind: "diagnostic",
        instanceId: "instance-1",
        step: 1,
        manifest,
        worldHash: contentHash("world"),
        codeRevision: "test",
        codeDirty: false,
        modelCatalogHash: contentHash("catalog"),
        seed: 7,
        runtimeConfig: { deterministic: true },
      });
      const payload = { prompt: "完整输入", nested: { value: 42 } };
      trace.emit({
        event: "model.invocation.started",
        attributes: { providerId: "test", modelId: "deterministic" },
        measurements: { requestUtf8Bytes: 128 },
        payload,
      })!;
      trace.emit({
        event: "model.structured_output.parsed",
        measurements: { inputTokens: 11, outputTokens: 3 },
        payload: { result: "ok" },
      });
      const reference = ledger.finishExecution("execution-1", {
        status: "succeeded",
        semanticHash: contentHash("semantic"),
        stateHash: contentHash("state"),
        commitRevision: 1,
      });
      const emitted = ledger.executionEvents("execution-1")[0];

      expect(reference.terminalEventSequence).toBeGreaterThanOrEqual(emitted.sequence);
      expect(reference.traceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(ledger.execution("execution-1")).toMatchObject({
        status: "succeeded",
        instanceId: "instance-1",
        commitRevision: 1,
      });
      expect(ledger.executionEvents("execution-1").map((event) => event.payload)).toEqual([
        payload,
        { result: "ok" },
      ]);
      const hash = contentHash(payload);
      const artifact = ledger.artifact(hash)!;
      expect(artifact.value).toEqual(payload);
      expect(artifact.storedBytes).toBeLessThanOrEqual(artifact.rawBytes + 64);
      expect(() => ledger.putExecutionArtifact("execution-1", "late", { invalid: true }))
        .toThrow("already terminal");
    } finally {
      ledger.close();
    }
  });

  it("keeps failed executions queryable without a commit revision", () => {
    const ledger = database();
    try {
      ledger.beginExecution({
        id: "failed-execution",
        kind: "interactive",
        manifest,
        worldHash: contentHash("world"),
        codeRevision: "test",
        codeDirty: true,
        modelCatalogHash: contentHash("catalog"),
        seed: 1,
        runtimeConfig: {},
      }).emit({ event: "step.rolled_back", counts: { rollbacks: 1 }, payload: { reason: "invalid" } });
      ledger.finishExecution("failed-execution", { status: "failed", error: new Error("invalid") });
      expect(ledger.execution("failed-execution")).toMatchObject({ status: "failed" });
      expect(ledger.execution("failed-execution")?.commitRevision).toBeUndefined();
      expect(ledger.executionEvents("failed-execution")).toHaveLength(2);
      expect(ledger.executionEvents("failed-execution").at(-1)).toMatchObject({
        event: "execution.failed",
        error: { name: "Error", message: "invalid" },
      });
    } finally {
      ledger.close();
    }
  });

  it("marks executions left running by a prior database owner as failed", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lwe-interrupted-execution-"));
    const file = path.join(root, "livingworld.sqlite");
    const first = new LocalDatabase(file, { heartbeat: false });
    first.beginExecution({
      id: "interrupted-execution",
      kind: "interactive",
      manifest,
      worldHash: contentHash("world"),
      codeRevision: "test",
      codeDirty: false,
      modelCatalogHash: contentHash("catalog"),
      seed: 1,
      runtimeConfig: {},
    }).emit({ event: "step.started" });
    first.close();

    const recovered = new LocalDatabase(file, { heartbeat: false });
    try {
      expect(recovered.execution("interrupted-execution")).toMatchObject({ status: "failed" });
      expect(recovered.executionEvents("interrupted-execution")).toContainEqual(expect.objectContaining({
        event: "execution.recovered_as_failed",
        attributes: { reason: "process_interrupted" },
      }));
      expect(recovered.executionEvents("interrupted-execution").at(-1)).toMatchObject({
        event: "execution.failed",
        error: { name: "ExecutionInterruptedError" },
      });
    } finally {
      recovered.close();
    }
  });

  it("derives metrics from raw events and rejects high-cardinality dimensions", () => {
    const ledger = database();
    try {
      const trace = ledger.beginExecution({
        id: "metric-execution",
        kind: "benchmark",
        manifest,
        worldHash: contentHash("world"),
        codeRevision: "test",
        codeDirty: false,
        modelCatalogHash: contentHash("catalog"),
        seed: 1,
        runtimeConfig: {},
      });
      trace.emit({ event: "step.started", counts: { persistentAgents: 1000 } });
      trace.emit({
        event: "algorithm.activation.completed",
        attributes: { phase: "step", agentId: "must-stay-in-trace" },
        counts: { persistentAgents: 1000, activatedAgents: 1000 },
      });
      trace.emit({
        event: "algorithm.candidate.completed",
        attributes: { phase: "step" },
        counts: { updatedAgents: 1000, mindFallbacks: 2 },
      });
      trace.emit({
        event: "algorithm.outcome.alternative_evidence_normalized",
        attributes: { phase: "transition" },
        counts: { droppedOutcomeAlternativeEvidenceReferences: 3, droppedOutcomeAlternatives: 1 },
      });
      trace.emit({
        event: "instance.bootstrap.committed",
        counts: { activatedAgents: 1000, updatedAgents: 1000 },
      });
      const points = EXECUTION_METRICS.derive(ledger.executionEvents("metric-execution"));
      expect(points.filter((point) => point.name === "lwe.agent.persistent"))
        .toEqual([expect.objectContaining({ value: 1000 })]);
      expect(points.filter((point) => point.name === "lwe.agent.activated"))
        .toEqual([expect.objectContaining({ value: 1000 })]);
      expect(points.filter((point) => point.name === "lwe.agent.updated"))
        .toEqual([expect.objectContaining({ value: 1000 })]);
      expect(points.filter((point) => point.name === "lwe.agent.mind_fallbacks"))
        .toEqual([expect.objectContaining({ value: 2 })]);
      expect(points.filter((point) => point.name === "lwe.normalization.outcome_alternatives"))
        .toEqual([expect.objectContaining({ value: 1 })]);
      expect(points.some((point) => "agentId" in point.dimensions)).toBe(false);
      expect(deriveExecutionWork(ledger.executionEvents("metric-execution"))).toMatchObject({
        spanCount: 4,
        maxSpanDepth: 2,
      });
      const registry = new MetricDefinitionRegistry();
      expect(() => registry.register({
        name: "invalid",
        unit: "1",
        aggregation: "sum",
        source: { field: "counts", key: "agents" },
        allowedDimensions: ["agentId"],
      })).toThrow("high-cardinality");
    } finally {
      ledger.close();
    }
  });

  it("replays recorded model outputs through the algorithm without network access", async () => {
    const ledger = database();
    try {
      const experiment = await runDeterministicExperiment({ agents: [1], steps: [1], ledger });
      expect(experiment.scenarios[0]).toMatchObject({
        ledgerEventCount: expect.any(Number),
        ledgerArtifactRawBytes: expect.any(Number),
        ledgerArtifactStoredBytes: expect.any(Number),
        ledgerSqliteWriteMs: expect.any(Number),
      });
      expect(experiment.scenarios[0].ledgerEventCount).toBeGreaterThan(0);
      expect(experiment.scenarios[0].ledgerArtifactRawBytes).toBeGreaterThan(0);
      const original = ledger.executions({ kind: "benchmark" })
        .find((execution) => execution.manifest.id === "eager-reference");
      expect(original).toBeDefined();
      const replayed = await replayThroughAlgorithm(
        ledger,
        original!,
        ledger.executionEvents(original!.id),
      );
      expect(replayed).toMatchObject({
        semanticHash: original!.semanticHash,
        stateHash: original!.stateHash,
      });
      expect(ledger.execution(replayed.replayExecutionId)).toMatchObject({
        kind: "replay",
        parentExecutionId: original!.id,
        status: "succeeded",
      });
    } finally {
      ledger.close();
    }
  });
});
