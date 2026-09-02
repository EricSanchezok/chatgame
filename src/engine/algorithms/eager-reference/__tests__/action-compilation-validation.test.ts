import { describe, expect, it } from "vitest";
import { normalizeActionCompilationContextCauses, materializeActionCompilationCandidateKeys } from "../action-compilation-validation";
import { createActionCompilationReferenceResolver, createReferenceResolver, referenceHandleFor } from "../../../contracts/model-context";

describe("Action Compilation structural normalization", () => {
  it("drops context-only causes when the exact action cause remains", () => {
    const result = normalizeActionCompilationContextCauses({
      expectedActionRef: "ref:action:a-1",
      value: {
        slot: 0,
        temporalPlan: {
          causes: [
            { kind: "action", ref: "ref:action:a-1" },
            { kind: "entity", ref: "ref:entity:target" },
            { kind: "placement", ref: "ref:placement:gate" },
          ],
        },
      },
    });

    expect(result.removedCount).toBe(2);
    expect(result.value).toMatchObject({
      temporalPlan: { causes: [{ kind: "action", ref: "ref:action:a-1" }] },
    });
  });

  it("does not hide an invalid cause when the exact action cause is absent", () => {
    const value = {
      slot: 0,
      temporalPlan: { causes: [{ kind: "entity", ref: "ref:entity:target" }] },
    };

    expect(normalizeActionCompilationContextCauses({
      expectedActionRef: "ref:action:a-1",
      value,
    })).toEqual({ value, removedCount: 0 });
  });

  it("keeps unknown cause kinds for schema rejection", () => {
    const value = {
      slot: 0,
      temporalPlan: {
        causes: [
          { kind: "action", ref: "ref:action:a-1" },
          { kind: "mystery", ref: "ref:entity:target" },
        ],
      },
    };

    expect(normalizeActionCompilationContextCauses({
      expectedActionRef: "ref:action:a-1",
      value,
    })).toEqual({ value, removedCount: 0 });
  });

  it("materializes candidate keys only within the current slot scope", () => {
    const shared = createReferenceResolver([
      { kind: "temporal_profile", engineId: "brief", label: "Brief", meaning: "fixed", allowedUses: ["profile"] },
      { kind: "action", engineId: "a", label: "A", meaning: "action", allowedUses: ["cause"], slot: 0, visibility: "slot" },
      { kind: "action", engineId: "b", label: "B", meaning: "action", allowedUses: ["cause"], slot: 1, visibility: "slot" },
    ]);
    const resolver = createActionCompilationReferenceResolver(shared).scopedToSlot(0);
    const profileKey = resolver.catalog.candidates.find((candidate) => candidate.kind === "temporal_profile")!.candidateKey;
    const actionKey = resolver.catalog.candidates.find((candidate) => candidate.kind === "action")!.candidateKey;
    const materialized = materializeActionCompilationCandidateKeys({
      resolver,
      value: {
        temporalPlan: {
          profileRef: profileKey,
          basis: { kind: "profile" },
          description: "A",
          continuationAssertions: [],
          causes: [{ kind: "action", ref: actionKey }],
        },
        interactionDependency: {
          stateDependencies: { requiredExistingCandidateKeys: [], potentiallyAffectedCandidateKeys: [] },
          audienceAgentCandidateKeys: [],
          sharedResourceClaims: [],
        },
      },
    });
    expect(materialized.draft.temporalPlan.profileRef).toBe(referenceHandleFor("temporal_profile", "brief"));
    expect(materialized.resolvedCandidateCount).toBe(2);
  });

  it("rejects a candidate key belonging to another slot", () => {
    const shared = createReferenceResolver([
      { kind: "temporal_profile", engineId: "brief", label: "Brief", meaning: "fixed", allowedUses: ["profile"] },
      { kind: "action", engineId: "a", label: "A", meaning: "action", allowedUses: ["cause"], slot: 0, visibility: "slot" },
      { kind: "action", engineId: "b", label: "B", meaning: "action", allowedUses: ["cause"], slot: 1, visibility: "slot" },
    ]);
    const resolver = createActionCompilationReferenceResolver(shared).scopedToSlot(0);
    const otherKey = createActionCompilationReferenceResolver(shared).catalog.candidates.find((candidate) =>
      candidate.kind === "action" && candidate.scope.kind === "slot" && candidate.scope.slot === 1)!.candidateKey;
    expect(() => resolver.handleForCandidateKey(otherKey, "cause")).toThrow(/slot/i);
  });
});
