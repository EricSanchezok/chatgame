import { describe, expect, it } from "vitest";
import {
  ScriptedModelProvider,
  createTestModelCatalog,
} from "../../testing/model-provider";
import {
  ContextLimitExceededError,
  type StructuredModelRequest,
} from "../../models/model-provider";
import { resolutionDirectiveSchema } from "../../contracts/llm-schemas";
import { TruthBatchCoordinator } from "../truth-batch-provider";

function request(
  subjectId: string,
  context: Record<string, unknown>,
): StructuredModelRequest<unknown> {
  return {
    profileId: "truth-engine",
    workloadId: "instance",
    batchId: "advance",
    role: "truth-resolution",
    subjectId,
    promptVersion: "truth-v1",
    schemaName: "truth_resolution_directive",
    system: "system",
    userPrompt: "resolve",
    context,
    schema: resolutionDirectiveSchema,
    runtimeIdentity: { worldHash: `sha256:${"a".repeat(64)}`, revision: 0 },
  };
}

describe("TruthBatchCoordinator", () => {
  it("shares common context and preserves independent slot results", async () => {
    const provider = new ScriptedModelProvider(
      (input) => {
        const context = input.context as { slots?: Array<{ slot: number }> };
        if (input.schemaName === "truth_resolution_batch") {
          return {
            slots: (context.slots ?? []).map((slot) => ({
              slot: slot.slot,
              result: { kind: "done" },
            })),
          };
        }
        return { kind: "done" };
      },
      createTestModelCatalog(),
      false,
    );
    const batched = new TruthBatchCoordinator(provider, 12);
    const results = await Promise.all([
      batched.generateStructured(
        request("component-a", {
          contractVersion: 13,
          state: { canonicalTruth: { entities: { a: 1 } }, actionSet: { assigned: [{ actionRef: "a" }] } },
          task: { assignment: { targetHandles: [], availableHandles: [], allowedProposalKinds: [] }, constraints: [] },
        }),
      ),
      batched.generateStructured(
        request("component-b", {
          contractVersion: 13,
          state: { canonicalTruth: { entities: { a: 1 } }, actionSet: { assigned: [{ actionRef: "b" }] } },
          task: { assignment: { targetHandles: [], availableHandles: [], allowedProposalKinds: [] }, constraints: [] },
        }),
      ),
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.value)).toBe(true);
    expect(results[0]!.audit).not.toBe(results[1]!.audit);
    expect(results[0]!.audit.invocations[0]!.id).toBe(results[1]!.audit.invocations[0]!.id);
    expect(provider.requests).toHaveLength(1);
    const envelope = provider.requests[0]!.context as {
      sharedContext: Record<string, unknown>;
      slots: Array<{ slot: number; context: Record<string, unknown> }>;
    };
    expect(envelope.slots.every((slot) => (slot.context.state as { canonicalTruth: unknown }).canonicalTruth)).toBe(true);
    expect(envelope.slots.map((slot) => (slot.context.state as { actionSet: unknown }).actionSet)).toEqual([
      { assigned: [{ actionRef: "a" }] },
      { assigned: [{ actionRef: "b" }] },
    ]);
  });

  it("keeps a tail singleton on the original provider path", async () => {
    const provider = new ScriptedModelProvider(
      (input) => input.schemaName === "truth_resolution_directive"
        ? { kind: "done" }
        : { kind: "done" },
      createTestModelCatalog(),
      false,
    );
    const batched = new TruthBatchCoordinator(provider, 2);
    await Promise.all([
      batched.generateStructured(request("component-a", { value: "a" })),
      batched.generateStructured(request("component-b", { value: "b" })),
      batched.generateStructured(request("component-c", { value: "c" })),
    ]);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests.filter((entry) => entry.schemaName === "truth_resolution_batch")).toHaveLength(1);
    expect(provider.requests.filter((entry) => entry.schemaName === "truth_resolution_directive")).toHaveLength(1);
  });

  it("fails directly on a complete batch context overflow", async () => {
    const provider = new ScriptedModelProvider(
      () => ({ kind: "done" }),
      createTestModelCatalog(undefined, {
        maxInputBytes: 100,
      }),
      false,
    );
    const batched = new TruthBatchCoordinator(provider, 12);
    await expect(
      Promise.all([
        batched.generateStructured(
          request("component-a", { payload: "x".repeat(500) }),
        ),
        batched.generateStructured(
          request("component-b", { payload: "y".repeat(500) }),
        ),
      ]),
    ).rejects.toBeInstanceOf(ContextLimitExceededError);
    expect(provider.requests).toHaveLength(0);
  });

  it("retries structural output and then deterministically bisects", async () => {
    let slotCalls = 0;
    const provider = new ScriptedModelProvider(
      (input) => {
        if (input.schemaName === "truth_resolution_directive") {
          slotCalls += 1;
          return slotCalls <= 6 ? { kind: "invalid" } : { kind: "done" };
        }
        return { kind: "done" };
      },
      createTestModelCatalog(),
      false,
    );
    const batched = new TruthBatchCoordinator(provider, 12);
    await Promise.all([
      batched.generateStructured(request("component-a", { value: "a" })),
      batched.generateStructured(request("component-b", { value: "b" })),
    ]);
    expect(slotCalls).toBe(8);
    expect(provider.requests).toHaveLength(5);
  });
});
