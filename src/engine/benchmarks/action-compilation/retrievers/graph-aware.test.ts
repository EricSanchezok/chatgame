import { describe, expect, it } from "vitest";
import type { ActionCompilationReferenceDataset } from "../stabilized-behavior";
import {
  clearGraphAwareRetrieverCaches,
  createGraphAwareActionCompilationRetriever,
} from "./graph-aware";

function fixture(): ActionCompilationReferenceDataset {
  const candidates = [
    { candidateKey: "candidate_000000000001", kind: "action", label: "侦察", meaning: "行动", allowedUses: ["cause"], scope: { kind: "shared" } },
    { candidateKey: "candidate_000000000002", kind: "agent", label: "艾达", meaning: "角色", allowedUses: ["target"], scope: { kind: "shared" }, details: { entityRef: "candidate_000000000003" } },
    { candidateKey: "candidate_000000000003", kind: "entity", label: "沼泽", meaning: "地点", allowedUses: ["target", "subject"], scope: { kind: "shared" }, details: { placementRef: "candidate_000000000006" } },
    { candidateKey: "candidate_000000000004", kind: "fact", label: "沼泽危险", meaning: "事实", allowedUses: ["assertion", "target"], scope: { kind: "shared" }, details: { subjectRef: "candidate_000000000003" } },
    { candidateKey: "candidate_000000000005", kind: "temporal_profile", label: "立即", meaning: "时间", allowedUses: ["profile"], scope: { kind: "shared" } },
    { candidateKey: "candidate_000000000006", kind: "placement", label: "北部沼泽", meaning: "位置", allowedUses: ["target"], scope: { kind: "shared" }, details: { entityRef: "candidate_000000000003" } },
    { candidateKey: "candidate_000000000007", kind: "entity", label: "私有", meaning: "隐藏", allowedUses: ["target"], scope: { kind: "slot", slot: 1 } },
  ];
  const context = {
    referenceCatalog: { hash: "graph-fixture", candidates },
    task: {
      slots: [{
        slot: 0,
        action: { rawText: "艾达侦察沼泽" },
        actionReferences: {
          actionCandidateKey: "candidate_000000000001",
          actor: { status: "unique", agentCandidateKey: "candidate_000000000002", boundEntityCandidateKey: "candidate_000000000003" },
          targets: [{ status: "unique", candidateKeys: ["candidate_000000000003"] }],
        },
        temporalProfileEligibility: [
          { eligible: true, profileRef: "candidate_000000000005" },
        ],
      }],
    },
  };
  const contextHash = "c".repeat(64);
  return {
    root: ".",
    manifest: { datasetId: "action-compilation/fullcatalog-stabilized", version: 1 } as ActionCompilationReferenceDataset["manifest"],
    contexts: new Map([[contextHash, { contextHash, context }]]),
    cases: [{
      caseId: "ac-c3-v1-graph-000001",
      contextHash,
      slotIndex: 0,
      batchSize: 1,
      requiredCandidateKeys: [
        "candidate_000000000001",
        "candidate_000000000002",
        "candidate_000000000003",
        "candidate_000000000004",
        "candidate_000000000005",
        "candidate_000000000006",
      ],
      source: { catalogHash: "graph-fixture", worldHash: "world", algorithmManifestHash: "algorithm" },
    }],
  };
}

describe("graph-aware Action Compilation retriever", () => {
  it("keeps role anchors and follows typed relation closure without private leakage", async () => {
    clearGraphAwareRetrieverCaches();
    const data = fixture();
    const retriever = await createGraphAwareActionCompilationRetriever("graph-role", data, { budgetRatio: 0.2, maxPathDepth: 2 });
    const context = data.contexts.values().next().value!.context;
    const result = retriever({ context: structuredClone(context), slotIndex: 0 });
    expect(result).toEqual(expect.arrayContaining([
      "candidate_000000000001",
      "candidate_000000000002",
      "candidate_000000000003",
      "candidate_000000000005",
    ]));
    expect(result).not.toContain("candidate_000000000007");
    expect(result).toEqual([...result].sort());
  });

  it("fails closed when encoder strategies are constructed without a local encoder", async () => {
    await expect(createGraphAwareActionCompilationRetriever("graph-encoder", fixture()))
      .rejects.toThrow(/local encoder runtime/u);
  });
});
