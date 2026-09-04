import { describe, expect, it } from "vitest";
import type { ActionCompilationReferenceDataset } from "../stabilized-behavior";
import {
  createActionCompilationAdvancedRetriever,
  clearAdvancedRetrieverCaches,
  type LocalEncoderRuntime,
} from "./advanced";

function fixtureDataset(): ActionCompilationReferenceDataset {
  const candidates = [
    { candidateKey: "candidate_000000000001", kind: "action", label: "侦察沼泽", meaning: "行动", allowedUses: ["cause"], scope: { kind: "shared" } },
    { candidateKey: "candidate_000000000002", kind: "agent", label: "ada", meaning: "角色", allowedUses: ["target"], scope: { kind: "shared" }, details: { entityRef: "candidate_000000000003" } },
    { candidateKey: "candidate_000000000003", kind: "entity", label: "艾达", meaning: "角色实体", allowedUses: ["subject"], scope: { kind: "shared" } },
    { candidateKey: "candidate_000000000004", kind: "meter", label: "vitality:ada", meaning: "生命", allowedUses: ["modifier"], scope: { kind: "shared" }, details: { entityRef: "candidate_000000000003", definitionId: "vitality" } },
    { candidateKey: "candidate_000000000005", kind: "rating", label: "force:ada", meaning: "力量", allowedUses: ["modifier"], scope: { kind: "shared" }, details: { entityRef: "candidate_000000000003", definitionId: "force" } },
    { candidateKey: "candidate_000000000006", kind: "placement", label: "沼泽", meaning: "位置", allowedUses: ["modifier"], scope: { kind: "shared" }, details: { containerRef: "candidate_000000000003" } },
    { candidateKey: "candidate_000000000007", kind: "fact", label: "沼泽危险", meaning: "事实", allowedUses: ["assertion"], scope: { kind: "shared" }, details: { subjectRef: "candidate_000000000003" } },
    { candidateKey: "candidate_000000000008", kind: "local_entity", label: "私有", meaning: "私有", allowedUses: ["target"], scope: { kind: "slot", slot: 1 } },
  ];
  const context = {
    referenceCatalog: { hash: "advanced-fixture", candidates },
    task: { slots: [{ slot: 0, action: { rawText: "艾达侦察沼泽" }, actionReferences: { actionCandidateKey: "candidate_000000000001", actor: { status: "unique", agentCandidateKey: "candidate_000000000002", boundEntityCandidateKey: "candidate_000000000003" }, targets: [{ status: "unique", candidateKeys: ["candidate_000000000003"] }] } }] },
  };
  const contextHash = "b".repeat(64);
  return {
    root: ".",
    manifest: { datasetId: "action-compilation/fullcatalog-stabilized", version: 1 } as ActionCompilationReferenceDataset["manifest"],
    contexts: new Map([[contextHash, { contextHash, context }]]),
    cases: [{ caseId: "ac-c3-v1-000001", contextHash, slotIndex: 0, batchSize: 1, requiredCandidateKeys: ["candidate_000000000001", "candidate_000000000004", "candidate_000000000005", "candidate_000000000006", "candidate_000000000007"], source: { catalogHash: "advanced-fixture", worldHash: "world", algorithmManifestHash: "algorithm" } }],
  };
}

const fakeEncoder: LocalEncoderRuntime = {
  modelId: "fixture",
  modelHash: "sha256:fixture",
  dimensions: 2,
  async encodeBatch(texts) {
    return texts.map((text) => text.includes("query") || text.includes("侦察") ? [1, 0] : [0, 1]);
  },
};

describe("advanced Action Compilation retrievers", () => {
  it("expands actor/entity state, placement, and fact references deterministically", async () => {
    clearAdvancedRetrieverCaches();
    const data = fixtureDataset();
    const retriever = await createActionCompilationAdvancedRetriever("structure-closure", data, { budgetRatio: 0.2, closureDepth: 3 });
    const context = data.contexts.values().next().value!.context;
    const first = retriever({ context: structuredClone(context), slotIndex: 0 });
    const second = retriever({ context: structuredClone(context), slotIndex: 0 });
    expect(first).toEqual(second);
    expect(first).toEqual(expect.arrayContaining([
      "candidate_000000000001",
      "candidate_000000000002",
      "candidate_000000000003",
      "candidate_000000000004",
      "candidate_000000000005",
      "candidate_000000000006",
      "candidate_000000000007",
    ]));
    expect(first).not.toContain("candidate_000000000008");
  });

  it("requires an encoder for encoder strategies and accepts a local runtime", async () => {
    const data = fixtureDataset();
    await expect(createActionCompilationAdvancedRetriever("encoder-anchor", data)).rejects.toThrow(/local encoder runtime/u);
    const retriever = await createActionCompilationAdvancedRetriever("encoder-anchor", data, { encoder: fakeEncoder });
    const context = data.contexts.values().next().value!.context;
    const result = retriever({ context: structuredClone(context), slotIndex: 0 });
    expect(result).toContain("candidate_000000000001");
  });
});
