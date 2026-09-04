import { describe, expect, it } from "vitest";
import type {
  ActionCompilationReferenceDataset,
  CandidateRetriever,
} from "./stabilized-behavior";
import {
  evaluateActionCompilationRetrieval,
  evaluateFullCatalogControl,
} from "./retrieval-experiment";

function dataset(options: {
  required?: string[];
  secondRequired?: string[];
} = {}): ActionCompilationReferenceDataset {
  const candidates = [
    { candidateKey: "candidate_000000000001", kind: "action", label: "行动", meaning: "行动", allowedUses: ["cause"], scope: { kind: "shared" } },
    { candidateKey: "candidate_000000000002", kind: "agent", label: "艾达", meaning: "角色", allowedUses: ["target"], scope: { kind: "shared" } },
    { candidateKey: "candidate_000000000003", kind: "entity", label: "沼泽", meaning: "地点", allowedUses: ["target"], scope: { kind: "shared" } },
    { candidateKey: "candidate_000000000004", kind: "fact", label: "沼泽很危险", meaning: "事实", allowedUses: ["assertion"] , scope: { kind: "shared" } },
    { candidateKey: "candidate_000000000006", kind: "meter", label: "vitality:艾达", meaning: "状态", allowedUses: ["modifier"], scope: { kind: "shared" } },
    { candidateKey: "candidate_000000000005", kind: "entity", label: "私有对象", meaning: "对象", allowedUses: ["target"], scope: { kind: "slot", slot: 1 } },
  ];
  const context = {
    referenceCatalog: { hash: "catalog-test", candidates },
    task: {
      slots: [{
        slot: 0,
        action: { rawText: "艾达行动" },
        actionReferences: {
          actionCandidateKey: "candidate_000000000001",
          actor: { status: "unique", agentCandidateKey: "candidate_000000000002" },
          targets: [{ status: "unique", candidateKeys: ["candidate_000000000003"] }],
        },
      }],
    },
  };
  const contextHash = "a".repeat(64);
  const required = options.required ?? ["candidate_000000000001", "candidate_000000000002"];
  const secondRequired = options.secondRequired ?? required;
  return {
    root: ".",
    manifest: { datasetId: "action-compilation/fullcatalog-stabilized", version: 1 } as ActionCompilationReferenceDataset["manifest"],
    contexts: new Map([[contextHash, { contextHash, context }]]),
    cases: [
      { caseId: "ac-c3-v1-000001", contextHash, slotIndex: 0, batchSize: 1, requiredCandidateKeys: [...required].sort(), source: { catalogHash: "catalog-test", worldHash: "world", algorithmManifestHash: "algorithm" } },
      { caseId: "ac-c3-v1-000002", contextHash, slotIndex: 0, batchSize: 1, requiredCandidateKeys: [...secondRequired].sort(), source: { catalogHash: "catalog-test", worldHash: "world", algorithmManifestHash: "algorithm" } },
    ],
  };
}

describe("Action Compilation retrieval experiment evaluator", () => {
  it("keeps FullCatalog as a 100% recall control while reporting compression gate failure", () => {
    const report = evaluateFullCatalogControl(dataset());
    expect(report.microRecall).toBe(1);
    expect(report.macroRecall).toBe(1);
    expect(report.invalidOutputKeys).toBe(0);
    expect(report.hardGate).toBe(false);
  });

  it("reports missing keys by kind/use and rejects invalid or private output", () => {
    const retriever: CandidateRetriever = () => ["candidate_000000000001", "candidate_000000000005", "candidate_missing"];
    const report = evaluateActionCompilationRetrieval(dataset({ required: ["candidate_000000000001", "candidate_000000000004"] }), retriever, "fixture");
    expect(report.microRecall).toBe(0.5);
    expect(report.invalidOutputKeys).toBe(4);
    expect(report.caseResults[0]?.missingByKind).toEqual({ fact: 1 });
    expect(report.caseResults[0]?.missingByUse).toEqual({ assertion: 1 });
    expect(report.caseResults[0]?.privateKeys).toEqual(["candidate_000000000005"]);
  });

  it("uses strict compression gates at exactly 80 percent", () => {
    const base = dataset({ required: [], secondRequired: [] });
    const retriever: CandidateRetriever = () => ["candidate_000000000001"];
    const report = evaluateActionCompilationRetrieval(base, retriever, "ratio");
    expect(report.averageCompression).toBeGreaterThanOrEqual(0.8);
    expect(report.averageCompression).not.toBeGreaterThan(0.8);
    expect(report.p95ShortlistRatio).toBeGreaterThanOrEqual(0.2);
    expect(report.hardGate).toBe(false);
  });

  it("records budget violations without silently expanding the budget", () => {
    const report = evaluateActionCompilationRetrieval(dataset(), () => [
      "candidate_000000000001",
      "candidate_000000000002",
      "candidate_000000000003",
      "candidate_000000000004",
    ], "over-budget");
    expect(report.budgetExceededCases).toBe(2);
    expect(report.hardGate).toBe(false);
  });

  it("reports kind/use strata and the union of slot shortlists", () => {
    const data = dataset({ required: ["candidate_000000000001", "candidate_000000000002"] });
    const report = evaluateActionCompilationRetrieval(data, () => [
      "candidate_000000000001",
      "candidate_000000000002",
    ], "strata");
    expect(report.byKind.action).toMatchObject({ cases: 2, requiredKeys: 2, recalledKeys: 2, recall: 1 });
    expect(report.byKind.agent).toMatchObject({ cases: 2, requiredKeys: 2, recalledKeys: 2, recall: 1 });
    expect(report.byUse.cause).toMatchObject({ cases: 2, requiredKeys: 2, recalledKeys: 2, recall: 1 });
    expect(report.byUse.target).toMatchObject({ cases: 2, requiredKeys: 2, recalledKeys: 2, recall: 1 });
    expect(report.byBatchSize["1"]).toMatchObject({ cases: 2, requiredKeys: 4, recalledKeys: 4, recall: 1 });
    expect(report.byBatchUnion).toHaveLength(1);
    expect(report.byBatchUnion[0]).toMatchObject({ slots: 2, requiredKeys: 2, recalledKeys: 2, recall: 1 });
  });
});
