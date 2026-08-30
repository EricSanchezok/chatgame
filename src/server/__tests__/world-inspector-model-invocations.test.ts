import { describe, expect, it } from "vitest";
import type { RuntimeEvent, RuntimeEventInput } from "../../engine/runtime/observability";
import type { ExecutionRecord } from "../execution-ledger";
import {
  buildWorldInspectorModelInvocationDetail,
  queryWorldInspectorModelInvocations,
} from "../world-inspector";

const record: ExecutionRecord = {
  id: "execution-1",
  kind: "interactive",
  instanceId: "instance-1",
  step: 1,
  manifest: {
    kind: "engine-operation",
    contractVersion: 1,
    id: "test",
    version: "1",
    config: {},
    hash: "manifest-hash",
  },
  worldHash: "world-hash",
  codeRevision: "test",
  codeDirty: false,
  modelCatalogHash: "catalog-hash",
  seed: 1,
  runtimeConfig: {},
  startedAt: "2026-08-30T09:00:00.000Z",
  status: "failed",
  traceId: "trace-1",
  finishedAt: "2026-08-30T09:00:08.000Z",
};

function runtimeEvents(): RuntimeEvent[] {
  let sequence = 0;
  const at = (milliseconds: number) => new Date(Date.parse("2026-08-30T09:00:00.000Z") + milliseconds).toISOString();
  const event = (milliseconds: number, input: RuntimeEventInput): RuntimeEvent => ({
    schemaVersion: 2,
    sequence: ++sequence,
    timestamp: at(milliseconds),
    level: input.level ?? "info",
    ...input,
  });
  const correlation = {
    executionId: record.id,
    modelInvocationId: "invocation-action-1",
    modelRole: "action-compilation" as const,
    modelSubject: "batch:0",
    modelInvocation: 1,
  };
  const second = {
    executionId: record.id,
    modelInvocationId: "invocation-mind-1",
    modelRole: "agent-mind" as const,
    modelSubject: "curator",
    modelInvocation: 2,
  };
  return [
    event(0, {
      event: "model.context.serialized",
      correlation,
      durationMs: 4,
      measurements: { contextUtf8Bytes: 8_000, requestUtf8Bytes: 9_000 },
      hashes: { context: "context-hash", request: "request-hash" },
      payload: {
        context: {
          slots: [{
            slot: 0,
            actorPerspective: { agentId: "sigrun", self: { name: "Sigrun" } },
            action: { id: "action-1", actorId: "sigrun", rawText: "看看周围有什么吧" },
          }],
          canonicalCatalog: { entities: [{ id: "place-1" }] },
          temporalProfiles: [{ id: "profile-1" }],
          existingActivities: [],
          validationIssues: [{ code: "previous_issue" }],
        },
      },
    }),
    event(10, {
      event: "model.invocation.started",
      correlation,
      attributes: {
        providerId: "qwen",
        accountId: "local-qwen",
        profileId: "truth-qwen",
        modelId: "qwen-plus",
        promptVersion: "action-v3",
        schemaName: "action-compilation",
      },
    }),
    event(20, { event: "model.queue.completed", correlation: { ...correlation, transportAttempt: 1 }, durationMs: 20, measurements: { queueWaitMs: 20 } }),
    event(1_020, {
      event: "model.transport.failed",
      correlation: { ...correlation, transportAttempt: 1 },
      durationMs: 1_000,
      level: "warn",
      attributes: { status: "retryable_error" },
      error: { name: "ModelTransportError", message: "gateway timeout", status: 504 },
    }),
    event(1_320, { event: "model.transport.retry_wait", correlation: { ...correlation, transportAttempt: 1 }, durationMs: 300, measurements: { retryDelayMs: 300 } }),
    event(1_350, { event: "model.queue.completed", correlation: { ...correlation, transportAttempt: 2 }, durationMs: 30, measurements: { queueWaitMs: 30 } }),
    event(3_350, { event: "model.transport.completed", correlation: { ...correlation, transportAttempt: 2 }, durationMs: 2_000, attributes: { status: "succeeded" } }),
    event(3_360, {
      event: "model.structured_output.rejected",
      correlation,
      durationMs: 10,
      level: "warn",
      measurements: { inputTokens: 148_537, outputTokens: 1_900, reasoningTokens: 120, responseUtf8Bytes: 4_100 },
      hashes: { request: "request-hash", response: "response-hash" },
      payload: { issues: [{ code: "continuation_assertion" }], output: { assertions: [] } },
      error: { name: "SchemaValidationError", message: "continuation assertion failed" },
    }),
    event(4_000, {
      event: "model.context.serialized",
      correlation: second,
      durationMs: 2,
      measurements: { contextUtf8Bytes: 3_000, requestUtf8Bytes: 3_800 },
      payload: { context: { actorPerspective: { agentId: "curator" }, observations: [] } },
    }),
    event(4_010, {
      event: "model.invocation.started",
      correlation: second,
      attributes: { providerId: "qwen", profileId: "agent-qwen", modelId: "qwen-plus" },
    }),
    event(4_020, { event: "model.queue.completed", correlation: { ...second, transportAttempt: 1 }, durationMs: 10 }),
    event(5_020, { event: "model.transport.completed", correlation: { ...second, transportAttempt: 1 }, durationMs: 1_000 }),
    event(5_030, {
      event: "model.structured_output.parsed",
      correlation: second,
      durationMs: 10,
      measurements: { inputTokens: 10_000, outputTokens: 800, reasoningTokens: 0, responseUtf8Bytes: 1_500 },
      payload: { nextAction: null },
    }),
    event(5_040, { event: "model.semantic.accepted", correlation: second }),
  ];
}

describe("world inspector model invocation projection", () => {
  it("separates logical invocations, transports, retries, tokens, and slot identity", () => {
    const result = queryWorldInspectorModelInvocations([record], runtimeEvents(), { sort: "retries" });

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.transportAttempts.length)).toEqual([2, 1]);
    expect(result.items[0]).toMatchObject({
      id: "invocation-action-1",
      status: "rejected",
      retryCount: 1,
      tokenUsage: { input: 148_537, output: 1_900, reasoning: 120 },
      requestUtf8Bytes: 9_000,
      contextUtf8Bytes: 8_000,
      responseUtf8Bytes: 4_100,
      slotRefs: [{ slot: 0, agentId: "sigrun", actionId: "action-1", label: "看看周围有什么吧" }],
      validationIssueCodes: ["ModelTransportError", "SchemaValidationError", "continuation_assertion"],
    });
    expect(result.items[0]?.transportAttempts[0]).toMatchObject({
      attempt: 1,
      status: "retryable_error",
      retryDelayMs: 300,
    });
    expect(result.items[0]?.contextSections.map((section) => section.key)).toEqual([
      "slots",
      "canonicalCatalog",
      "temporalProfiles",
      "existingActivities",
      "validationIssues",
    ]);
  });

  it("filters by persisted Agent/slot facts and paginates without returning payload bodies", () => {
    const events = runtimeEvents();
    const firstPage = queryWorldInspectorModelInvocations([record], events, {
      actorId: "sigrun",
      minInputTokens: 100_000,
      minRetries: 1,
      limit: 1,
    });

    expect(firstPage.total).toBe(1);
    expect(firstPage.items[0]?.id).toBe("invocation-action-1");
    expect(firstPage.items[0]).not.toHaveProperty("payload");

    const detail = buildWorldInspectorModelInvocationDetail(record.id, "invocation-action-1", record, events);
    expect(detail?.eventSummaries).toHaveLength(8);
    expect(detail?.eventSummaries.every((event) => !("payload" in event))).toBe(true);
    expect(detail?.payloadEventIds.context).toBeDefined();
    expect(detail?.payloadEventIds.output).toBeDefined();
    expect(detail?.artifactHashes).toMatchObject({ context: "context-hash", output: "response-hash" });
  });
});
