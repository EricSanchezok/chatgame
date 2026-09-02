import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentHash } from "../../engine/models/model-audit";
import { defineEngineOperationManifest } from "../../engine/runtime/execution";
import { LocalDatabase } from "../local-database";

const databases: LocalDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function database(): LocalDatabase {
  const root = mkdtempSync(path.join(tmpdir(), "lwe-debug-query-"));
  const database = new LocalDatabase(path.join(root, "livingworld.sqlite"), { heartbeat: false });
  databases.push(database);
  return database;
}

function execution(database: LocalDatabase): string {
  const trace = database.beginExecution({
    id: "debug-execution",
    kind: "diagnostic",
    instanceId: "debug-instance",
    advanceId: "debug-advance",
    step: 2,
    manifest: defineEngineOperationManifest({ id: "debug", version: "1", config: {} }),
    worldHash: contentHash("world"),
    codeRevision: "debug-code",
    codeDirty: false,
    modelCatalogHash: contentHash("catalog"),
    seed: 1,
    runtimeConfig: {},
  });
  trace.emit({
    event: "model.invocation.started",
    correlation: {
      requestId: "debug-request",
      instanceId: "debug-instance",
      modelInvocationId: "source-invocation",
      logicalInvocationId: "logical-invocation",
      modelRole: "agent-mind",
      modelSubject: "agent-1",
      component: "model",
      operation: "generate",
    },
    attributes: { providerId: "provider", profileId: "profile", modelId: "model" },
  });
  trace.emit({
    event: "model.structured_output.rejected",
    correlation: {
      requestId: "debug-request",
      instanceId: "debug-instance",
      modelInvocationId: "source-invocation",
      logicalInvocationId: "logical-invocation",
      modelRole: "agent-mind",
      modelSubject: "agent-1",
      component: "model",
      operation: "generate",
    },
    error: { name: "SchemaValidationError", code: "runtime.model.output", message: "invalid output" },
    payload: { issues: [{ code: "test.invalid_output", path: ["action"], reason: "invalid" }] },
  });
  database.finishExecution("debug-execution", { status: "failed", error: { name: "ExecutionError", message: "failed" } });
  return "debug-execution::source-invocation";
}

describe("local debug query projections", () => {
  it("resolves invocation, request, issue, lineage, and selected payloads", () => {
    const store = database();
    const id = execution(store);

    const invocation = store.debugQuery({ invocationId: id });
    expect(invocation.total).toBe(1);
    expect(invocation.invocations[0]).toMatchObject({
      id,
      executionId: "debug-execution",
      instanceId: "debug-instance",
      sourceInvocationId: "source-invocation",
      status: "rejected",
      issueCodes: expect.arrayContaining(["runtime.model.output", "test.invalid_output"]),
    });

    expect(store.debugQuery({ requestId: "debug-request" })).toMatchObject({
      total: 1,
      invocations: [{ id }],
      events: expect.arrayContaining([
        expect.objectContaining({ eventName: "model.invocation.started" }),
        expect.objectContaining({ eventName: "model.structured_output.rejected" }),
      ]),
    });
    expect(store.debugQuery({ diagnosticCode: "test.invalid_output" })).toMatchObject({
      total: 1,
      invocations: [{ id }],
      events: [expect.objectContaining({ eventName: "model.structured_output.rejected" })],
    });
    expect(store.debugQuery({}).events.length).toBeGreaterThan(0);

    const detail = store.debugInspect(id, true)!;
    expect(detail.events).toHaveLength(2);
    expect(detail.events.at(-1)?.payload).toMatchObject({ issues: [{ code: "test.invalid_output" }] });
    expect(detail.diagnostics.map((diagnostic) => diagnostic.code)).toContain("runtime.model.output");
  });

  it("reports and repairs projection drift without changing Ledger facts", () => {
    const store = database();
    execution(store);
    const before = store.executionEvents("debug-execution");
    expect(store.debugDoctor()).toMatchObject({ indexFresh: true, eventCount: 3, indexedEventCount: 3, indexedInvocationCount: 1 });

    store.debugRebuildIndex();

    expect(store.executionEvents("debug-execution")).toEqual(before);
    expect(store.debugDoctor()).toMatchObject({ indexFresh: true, eventCount: 3, indexedEventCount: 3, indexedInvocationCount: 1 });
  });
});
