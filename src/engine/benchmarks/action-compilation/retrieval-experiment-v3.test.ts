import { describe, expect, it } from "vitest";
import type { ActionCompilationReferenceDataset } from "./stabilized-behavior";
import { evaluateActionCompilationRetrievalV3, evaluateFullCatalogControlV3 } from "./retrieval-experiment-v3";

function fixture(): ActionCompilationReferenceDataset {
  const contextHash = "d".repeat(64);
  const candidates = [
    { candidateKey: "candidate_000000000001", kind: "action", label: "行动", meaning: "行动", allowedUses: ["cause"], scope: { kind: "shared" } },
    { candidateKey: "candidate_000000000002", kind: "entity", label: "目标", meaning: "目标", allowedUses: ["target"], scope: { kind: "shared" } },
    { candidateKey: "candidate_000000000003", kind: "fact", label: "事实", meaning: "事实", allowedUses: ["assertion"], scope: { kind: "shared" } },
    { candidateKey: "candidate_000000000004", kind: "entity", label: "私有", meaning: "私有", allowedUses: ["target"], scope: { kind: "slot", slot: 1 } },
  ];
  return {
    root: ".",
    manifest: { datasetId: "action-compilation/fullcatalog-stabilized", version: 1 } as ActionCompilationReferenceDataset["manifest"],
    contexts: new Map([[contextHash, { contextHash, context: { referenceCatalog: { hash: "v3-fixture", candidates }, task: { slots: [{ slot: 0, action: { rawText: "行动" }, actionReferences: { actionCandidateKey: "candidate_000000000001", targets: [{ status: "unique", candidateKeys: ["candidate_000000000002"] }] } }] } } }]]),
    cases: [{ caseId: "v3-fixture-1", contextHash, slotIndex: 0, batchSize: 1, requiredCandidateKeys: ["candidate_000000000001", "candidate_000000000002"], source: { catalogHash: "v3-fixture", worldHash: "world", algorithmManifestHash: "algorithm" } }],
  };
}

describe("v3 retrieval experiment layer", () => {
  it("keeps the FullCatalog control at 100% and adds confidence intervals", () => {
    const report = evaluateFullCatalogControlV3(fixture(), undefined, { bootstrapSamples: 20 });
    expect(report.microRecall).toBe(1);
    expect(report.macroRecall).toBe(1);
    expect(report.confidenceIntervals.microRecall?.samples).toBe(20);
    expect(report.graphDiagnostics.missingKeys).toBe(0);
  });

  it("records path diagnostics for a missing required key", () => {
    const data = fixture();
    const report = evaluateActionCompilationRetrievalV3(data, () => ["candidate_000000000001"], "fixture", undefined, { bootstrapSamples: 10 });
    expect(report.caseResults[0]?.missingKeys).toEqual(["candidate_000000000002"]);
    expect(report.graphDiagnostics.missingKeys).toBe(1);
  });
});
