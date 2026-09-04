import { describe, expect, it } from "vitest";
import type { CandidateRetrieverInput } from "./stabilized-behavior";
import {
  createActionCompilationRetriever,
  fullCatalogRetriever,
  typedFullRetriever,
} from "./retrievers/core";

function fixtureInput(slotIndex = 0): CandidateRetrieverInput {
  const candidates = [
    {
      candidateKey: "candidate_action00001",
      kind: "action",
      label: "穿过沼泽",
      meaning: "向沼泽深处前进",
      allowedUses: ["cause"],
      scope: { kind: "shared" },
      details: {},
    },
    {
      candidateKey: "candidate_agent00001",
      kind: "agent",
      label: "艾达",
      meaning: "正在行动的角色",
      allowedUses: ["target"],
      scope: { kind: "shared" },
      details: {},
    },
    {
      candidateKey: "candidate_entity00001",
      kind: "entity",
      label: "北方沼泽",
      meaning: "潮湿的危险地形",
      allowedUses: ["target"],
      scope: { kind: "shared" },
      details: {},
    },
    {
      candidateKey: "candidate_profile0001",
      kind: "temporal_profile",
      label: "短暂移动",
      meaning: "持续一个短时间窗口",
      allowedUses: ["profile"],
      scope: { kind: "shared" },
      details: {},
    },
    {
      candidateKey: "candidate_fact000001",
      kind: "fact",
      label: "沼泽很危险",
      meaning: "该区域存在危险",
      allowedUses: ["assertion"],
      scope: { kind: "shared" },
      details: {},
    },
    {
      candidateKey: "candidate_local00001",
      kind: "local_entity",
      label: "仅本槽位可见",
      meaning: "private object",
      allowedUses: ["target"],
      scope: { kind: "slot", slot: 0 },
      details: {},
    },
    {
      candidateKey: "candidate_world00001",
      kind: "world",
      label: "Blackmarsh",
      meaning: "世界对象",
      allowedUses: ["conflict"],
      scope: { kind: "shared" },
      details: {},
    },
    {
      candidateKey: "candidate_private0001",
      kind: "entity",
      label: "另一个槽位对象",
      meaning: "not visible here",
      allowedUses: ["target"],
      scope: { kind: "slot", slot: 1 },
      details: {},
    },
  ];
  return {
    slotIndex,
    context: {
      referenceCatalog: { candidates },
      task: {
        slots: [{
          slot: 0,
          action: { rawText: "艾达穿过北方沼泽", goal: "前进" },
          actionReferences: {
            actionCandidateKey: "candidate_action00001",
            actor: {
              status: "unique",
              agentCandidateKey: "candidate_agent00001",
              boundEntityCandidateKey: null,
            },
            targets: [{ status: "unique", candidateKeys: ["candidate_entity00001"] }],
          },
          temporalProfileEligibility: [{ eligible: true, profileRef: "candidate_profile0001" }],
        }],
      },
    },
  };
}

describe("Action Compilation candidate retrievers", () => {
  it("returns only visible candidates for FullCatalog and leaves input unchanged", () => {
    const input = fixtureInput();
    const before = JSON.stringify(input.context);
    expect(fullCatalogRetriever(input)).toEqual([
      "candidate_action00001",
      "candidate_agent00001",
      "candidate_entity00001",
      "candidate_profile0001",
      "candidate_fact000001",
      "candidate_local00001",
      "candidate_world00001",
    ]);
    expect(JSON.stringify(input.context)).toBe(before);
  });

  it("keeps typed FullCatalog within the registered Action Compilation domains", () => {
    const result = typedFullRetriever(fixtureInput());
    expect(result).not.toContain("candidate_local00001");
    expect(result).not.toContain("candidate_world00001");
    expect(result).toContain("candidate_fact000001");
  });

  it("retains explicit anchors even when the shortlist limit is smaller than the anchor set", () => {
    const retriever = createActionCompilationRetriever("anchor-plus-lexical", { maxCandidates: 1 });
    const result = retriever(fixtureInput());
    expect(result).toEqual([
      "candidate_action00001",
      "candidate_agent00001",
      "candidate_entity00001",
      "candidate_profile0001",
    ]);
  });

  it("is deterministic and bounds lexical and hybrid shortlists", () => {
    const input = fixtureInput();
    for (const strategy of ["lexical-topk", "anchor-plus-lexical", "hybrid-rrf", "adaptive-hybrid"] as const) {
      const retriever = createActionCompilationRetriever(strategy, { maxCandidates: 3 });
      const first = retriever(input);
      const second = retriever(input);
      expect(first).toEqual(second);
      expect(first.length).toBeLessThanOrEqual(strategy === "lexical-topk" ? 3 : 4);
      expect(new Set(first).size).toBe(first.length);
    }
  });

  it("rejects non-positive shortlist limits", () => {
    expect(() => createActionCompilationRetriever("lexical-topk", { maxCandidates: 0 })).toThrow(/positive integer/u);
    expect(() => createActionCompilationRetriever("lexical-topk", { maxCandidates: 1.5 })).toThrow(/positive integer/u);
  });
});
