import { describe, expect, it } from "vitest";
import {
  normalizeActionCompilationContextCauses,
  materializeActionCompilationCandidateKeys,
  preprocessActionCompilationSymbols,
  validateActionCompilationShortlistMembership,
} from "../action-compilation-validation";
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

  it("repairs a one-character candidateKey transcription error before materialization", () => {
    const shared = createReferenceResolver([
      { kind: "temporal_profile", engineId: "brief", label: "Brief", meaning: "fixed", allowedUses: ["profile"] },
    ]);
    const resolver = createActionCompilationReferenceResolver(shared);
    const profileKey = resolver.catalog.candidates[0]!.candidateKey;
    const malformed = profileKey.slice(0, -1);
    const result = preprocessActionCompilationSymbols({
      resolver,
      value: { slots: [{ temporalPlan: { profileRef: malformed } }] },
    });

    expect(result.value).toMatchObject({ slots: [{ temporalPlan: { profileRef: profileKey } }] });
    expect(result.symbolRepairs).toHaveLength(1);
    expect(result.symbolRepairs[0]).toMatchObject({
      status: "repaired",
      originalValue: malformed,
      correctedValue: profileKey,
      bestDistance: 1,
      domain: "candidate-key",
      path: ["slots", 0, "temporalPlan", "profileRef"],
    });
  });

  it("does not repair a malformed protected candidate prefix", () => {
    const shared = createReferenceResolver([
      { kind: "temporal_profile", engineId: "brief", label: "Brief", meaning: "fixed", allowedUses: ["profile"] },
    ]);
    const resolver = createActionCompilationReferenceResolver(shared);
    const profileKey = resolver.catalog.candidates[0]!.candidateKey;
    const result = preprocessActionCompilationSymbols({
      resolver,
      value: { slots: [{ temporalPlan: { profileRef: `candidste_${profileKey.slice("candidate_".length)}` } }] },
    });

    expect(result.value).toMatchObject({ slots: [{ temporalPlan: { profileRef: expect.stringContaining("candidste_") } }] });
    expect(result.symbolRepairs[0]).toMatchObject({ status: "unmatched", reason: "protected symbol prefix is invalid" });
  });

  it("limits symbol repair and materialization to the current slot shortlist", () => {
    const shared = createReferenceResolver([
      { kind: "temporal_profile", engineId: "brief", label: "Brief", meaning: "fixed", allowedUses: ["profile"] },
      { kind: "temporal_profile", engineId: "long", label: "Long", meaning: "fixed", allowedUses: ["profile"] },
    ]);
    const resolver = createActionCompilationReferenceResolver(shared);
    const [allowed, excluded] = resolver.catalog.candidates.map((candidate) => candidate.candidateKey);
    const malformedExcluded = excluded!.slice(0, -1);
    const result = preprocessActionCompilationSymbols({
      resolver,
      allowedCandidateKeysBySlot: new Map([[0, [allowed!]]]),
      value: { slots: [{ temporalPlan: { profileRef: malformedExcluded } }] },
    });
    expect(result.value).toMatchObject({ slots: [{ temporalPlan: { profileRef: malformedExcluded } }] });
    expect(result.symbolRepairs[0]?.correctedValue).not.toBe(excluded);

    try {
      validateActionCompilationShortlistMembership({
        value: { temporalPlan: { profileRef: excluded } },
        slot: 0,
        allowedCandidateKeys: [allowed!],
      });
      throw new Error("expected shortlist validation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        issues: [expect.objectContaining({ code: "reference.out_of_shortlist", originalValue: excluded })],
      });
    }
  });
});
