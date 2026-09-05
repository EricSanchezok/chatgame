import { describe, expect, it } from "vitest";
import { contentHash } from "../../../models/model-audit";
import { createRuntimeGraphSlotRetriever } from "./graph-aware";
import type { PassageEmbeddingEncoder } from "./embedding-cache";
import type { LocalEncoderRuntime } from "./local-encoder";
import { createActionCompilationRetrievalRuntime } from "./runtime";

function context(): Record<string, unknown> {
  return {
    referenceCatalog: {
      hash: "runtime-fixture",
      candidates: Array.from({ length: 20 }, (_, index) => ({
        candidateKey: `candidate_${(index + 1).toString(16).padStart(12, "0")}`,
        kind: index === 0 ? "action" : "entity",
        label: `candidate ${index + 1}`,
        allowedUses: index === 0 ? ["cause"] : ["target"],
        scope: index === 19 ? { kind: "slot", slot: 1 } : { kind: "shared" },
        ...(index === 0 ? { details: { targetRef: "candidate_000000000002", hiddenRef: "candidate_000000000014" } } : {}),
      })),
    },
    task: {
      slots: [
        { slot: 0, actionReferences: { actionCandidateKey: "candidate_000000000001", targets: [{ status: "unique", candidateKeys: ["candidate_000000000002"] }] } },
        { slot: 1, actionReferences: { actionCandidateKey: "candidate_000000000003", targets: [{ status: "unique", candidateKeys: ["candidate_000000000004"] }] } },
      ],
    },
  };
}

describe("Action Compilation retrieval runtime", () => {
  it("enforces one physical batch budget and preserves per-slot membership", async () => {
    const full = context();
    const before = contentHash(full);
    const runtime = createActionCompilationRetrievalRuntime({
      version: "retrieval-v4-test",
      retrieveSlot: async ({ slotIndex }) => ({
        candidates: slotIndex === 0
          ? [
              { candidateKey: "candidate_000000000001", score: 100 },
              { candidateKey: "candidate_000000000002", score: 90 },
              { candidateKey: "candidate_000000000005", score: 20 },
            ]
          : [
              { candidateKey: "candidate_000000000003", score: 100 },
              { candidateKey: "candidate_000000000004", score: 90 },
              { candidateKey: "candidate_000000000006", score: 30 },
            ],
      }),
    });
    await expect(runtime.retrieveBatch({ worldContentHash: `sha256:${"1".repeat(64)}`, fullContext: full, slotIndices: [0, 1] }))
      .rejects.toThrow(/mandatory set exceeds batch budget/u);

    const oneSlot = await runtime.retrieveBatch({ worldContentHash: `sha256:${"1".repeat(64)}`, fullContext: full, slotIndices: [0] });
    expect(contentHash(full)).toBe(before);
    expect(oneSlot.diagnostics.batchBudget).toBe(3);
    expect(oneSlot.diagnostics.batchShortlistRatio).toBeLessThan(0.2);
    expect(oneSlot.selectedKeysBySlot.get(0)).toEqual([
      "candidate_000000000001",
      "candidate_000000000002",
      "candidate_000000000005",
    ]);
    expect((oneSlot.modelContext.referenceCatalog as { candidates: unknown[] }).candidates).toHaveLength(3);
    expect(oneSlot.diagnostics.prunedReferenceCount).toBe(1);
  });

  it("rejects private, duplicate, invalid, and missing-anchor output", async () => {
    const invoke = (keys: readonly string[]) => createActionCompilationRetrievalRuntime({
      version: "test",
      retrieveSlot: async () => ({ candidates: keys.map((candidateKey, score) => ({ candidateKey, score })) }),
    }).retrieveBatch({ worldContentHash: `sha256:${"1".repeat(64)}`, fullContext: context(), slotIndices: [0] });
    await expect(invoke(["candidate_000000000001", "candidate_000000000014"])).rejects.toThrow(/private/u);
    await expect(invoke(["candidate_000000000001", "candidate_000000000001"])).rejects.toThrow(/duplicate/u);
    await expect(invoke(["candidate_000000000002"])).rejects.toThrow(/anchor missing/u);
  });

  it("uses persistent passages with a dynamic process-cached query", async () => {
    let queryCalls = 0;
    let passageCalls = 0;
    const encoder: LocalEncoderRuntime = {
      modelId: "fixture",
      modelHash: `sha256:${"2".repeat(64)}`,
      dimensions: 2,
      async encodeBatch(texts) {
        queryCalls += 1;
        return texts.map((text) => [text.includes("candidate") ? 1 : 0, 1]);
      },
    };
    const passageEncoder: PassageEmbeddingEncoder = {
      encoder,
      encoderFingerprint: `sha256:${"3".repeat(64)}`,
      async encodePassages(input) {
        passageCalls += 1;
        expect(input.allowWrite).toBe(false);
        return { vectors: input.passages.map(() => [1, 0]), hits: input.passages.length, misses: 0, written: 0 };
      },
      close() {},
    };
    const runtime = createActionCompilationRetrievalRuntime({
      version: "runtime-graph-test",
      retrieveSlot: createRuntimeGraphSlotRetriever({ strategy: "graph-hybrid", encoder, passageEncoder }),
    });
    const input = { worldContentHash: `sha256:${"4".repeat(64)}`, fullContext: context(), slotIndices: [0] };
    const first = await runtime.retrieveBatch(input);
    const second = await runtime.retrieveBatch(input);
    expect(first.diagnostics.cache.passageMisses).toBe(0);
    expect(first.diagnostics.cache.queryMisses).toBe(1);
    expect(second.diagnostics.cache.queryHits).toBe(1);
    expect(passageCalls).toBe(2);
    expect(queryCalls).toBe(1);
  });
});
