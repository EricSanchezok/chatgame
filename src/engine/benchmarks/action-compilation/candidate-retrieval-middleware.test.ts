import { describe, expect, it } from "vitest";
import { contentHash } from "../../models/model-audit";
import { createCandidateRetrievalMiddleware, isDeterministicCanary } from "./candidate-retrieval-middleware";

function context(): Record<string, unknown> {
  return {
    referenceCatalog: {
      hash: "middleware-fixture",
      candidates: [
        { candidateKey: "candidate_000000000001", kind: "action", label: "行动", allowedUses: ["cause"], scope: { kind: "shared" }, details: { targetRef: "candidate_000000000002" } },
        { candidateKey: "candidate_000000000002", kind: "entity", label: "目标", allowedUses: ["target"], scope: { kind: "shared" } },
        { candidateKey: "candidate_000000000003", kind: "fact", label: "隐藏事实", allowedUses: ["assertion"], scope: { kind: "shared" } },
        { candidateKey: "candidate_000000000004", kind: "fact", label: "填充", allowedUses: ["assertion"], scope: { kind: "shared" } },
        { candidateKey: "candidate_000000000005", kind: "fact", label: "填充", allowedUses: ["assertion"], scope: { kind: "shared" } },
        { candidateKey: "candidate_000000000006", kind: "fact", label: "填充", allowedUses: ["assertion"], scope: { kind: "shared" } },
        { candidateKey: "candidate_000000000007", kind: "fact", label: "填充", allowedUses: ["assertion"], scope: { kind: "shared" } },
        { candidateKey: "candidate_000000000008", kind: "fact", label: "填充", allowedUses: ["assertion"], scope: { kind: "shared" } },
        { candidateKey: "candidate_000000000009", kind: "fact", label: "填充", allowedUses: ["assertion"], scope: { kind: "shared" } },
        { candidateKey: "candidate_00000000000a", kind: "fact", label: "填充", allowedUses: ["assertion"], scope: { kind: "shared" } },
        { candidateKey: "candidate_00000000000b", kind: "fact", label: "填充", allowedUses: ["assertion"], scope: { kind: "shared" } },
        { candidateKey: "candidate_00000000000c", kind: "fact", label: "填充", allowedUses: ["assertion"], scope: { kind: "shared" } },
      ],
    },
    task: {
      slots: [{ slot: 0, actionReferences: { actionCandidateKey: "candidate_000000000001", targets: [{ status: "unique", candidateKeys: ["candidate_000000000002"] }] } }],
    },
  };
}

describe("candidate retrieval middleware", () => {
  it("creates a model-facing shortlist without mutating the full context", () => {
    const full = context();
    const before = contentHash(full);
    const middleware = createCandidateRetrievalMiddleware({ version: "retrieval-v3-test", retriever: () => ["candidate_000000000001", "candidate_000000000002"] });
    const result = middleware.apply({ fullContext: full, slotIndices: [0] });
    expect(contentHash(full)).toBe(before);
    expect((result.modelContext.referenceCatalog as { candidates: unknown[] }).candidates).toHaveLength(2);
    expect(result.selectedKeysBySlot.get(0)).toEqual(["candidate_000000000001", "candidate_000000000002"]);
    expect(result.fullContextHash).toBe(before);
  });

  it("fails closed if a required anchor is omitted", () => {
    const middleware = createCandidateRetrievalMiddleware({ version: "retrieval-v3-test", retriever: () => ["candidate_000000000002"] });
    expect(() => middleware.apply({ fullContext: context(), slotIndices: [0] })).toThrow(/anchor missing/u);
  });

  it("assigns a stable deterministic canary bucket", () => {
    const first = isDeterministicCanary("instance-1", "algorithm-hash", 30);
    expect(isDeterministicCanary("instance-1", "algorithm-hash", 30)).toBe(first);
    expect(() => isDeterministicCanary("instance-1", "algorithm-hash", 101)).toThrow(/between/u);
  });
});
