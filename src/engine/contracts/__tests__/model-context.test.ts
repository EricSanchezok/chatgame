import { describe, expect, it } from "vitest";
import {
  createReferenceResolver,
  actionCompilationCandidateKeySchema,
  existingReferenceHandleSchema,
  isProposalReference,
  modelReferenceSchema,
  ModelReferenceError,
  normalizeModelOutput,
  proposalKeySchema,
  withReferenceCandidateDetails,
} from "../model-context";

describe("model semantic references", () => {
  it("accepts only the v2 twelve-hex Action Compilation candidate-key shape", () => {
    expect(actionCompilationCandidateKeySchema.safeParse("candidate_0123456789ab").success).toBe(true);
    expect(actionCompilationCandidateKeySchema.safeParse("candidate_0123456789a").success).toBe(false);
    expect(actionCompilationCandidateKeySchema.safeParse("candidate_0123456789AB").success).toBe(false);
    expect(actionCompilationCandidateKeySchema.safeParse("candidate_0123456789abc").success).toBe(false);
  });

  it("creates deterministic request-local handles without exposing a second id field", () => {
    const inputs = [{
      kind: "fact" as const,
      engineId: "secret-fact-id",
      label: "钟声已经响起",
      meaning: "an existing canonical fact",
      allowedUses: ["cause" as const],
      visibility: "role" as const,
    }];
    const first = createReferenceResolver(inputs);
    const second = createReferenceResolver(inputs);

    expect(first.catalog).toEqual(second.catalog);
    expect(first.catalog.candidates[0]).not.toHaveProperty("engineId");
    expect(first.resolve(first.catalog.candidates[0]!.handle, "cause")).toMatchObject({
      kind: "fact",
      engineId: "secret-fact-id",
    });
  });

  it("rejects unknown and semantically disallowed handles without fuzzy repair", () => {
    const resolver = createReferenceResolver([{
      kind: "evidence",
      engineId: "heard-bell",
      label: "heard a bell",
      meaning: "private evidence",
      allowedUses: ["evidence"],
      visibility: "slot",
    }]);
    const handle = resolver.catalog.candidates[0]!.handle;

    expect(() => resolver.resolve(handle, "target")).toThrow(ModelReferenceError);
    expect(() => resolver.resolve("ref:evidence:almost-heard-bell", "evidence")).toThrow(ModelReferenceError);
  });

  it("keeps identically labelled candidates isolated by the catalog that issued them", () => {
    const left = createReferenceResolver([{
      kind: "local_entity",
      engineId: "left-guard",
      label: "守卫",
      meaning: "left slot's belief",
      allowedUses: ["target"],
      visibility: "slot",
    }]);
    const right = createReferenceResolver([{
      kind: "local_entity",
      engineId: "right-guard",
      label: "守卫",
      meaning: "right slot's belief",
      allowedUses: ["target"],
      visibility: "slot",
    }]);

    expect(() => left.resolve(right.catalog.candidates[0]!.handle, "target")).toThrow(ModelReferenceError);
    expect(() => right.resolve(left.catalog.candidates[0]!.handle, "target")).toThrow(ModelReferenceError);
  });

  it("keeps one batch catalog while enforcing slot-private resolution", () => {
    const resolver = createReferenceResolver([
      {
        kind: "world",
        engineId: "world",
        label: "world",
        meaning: "shared arbitration scope",
        allowedUses: ["target"],
        visibility: "role",
      },
      {
        kind: "action",
        engineId: "left-action",
        label: "left",
        meaning: "slot zero action",
        allowedUses: ["cause"],
        visibility: "slot",
        slot: 0,
      },
      {
        kind: "action",
        engineId: "right-action",
        label: "right",
        meaning: "slot one action",
        allowedUses: ["cause"],
        visibility: "slot",
        slot: 1,
      },
    ]);
    const left = resolver.scopedToSlot(0);
    const rightHandle = resolver.handleFor("action", "right-action");

    expect(resolver.catalog.version).toBe(2);
    expect(resolver.catalog.candidates.map((candidate) => candidate.slot)).toEqual([undefined, 0, 1]);
    expect(left.resolve(resolver.handleFor("world", "world"), "target")).toMatchObject({ kind: "world" });
    try {
      left.resolve(rightHandle, "cause");
      throw new Error("expected cross-slot resolution to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelReferenceError);
      expect((error as ModelReferenceError).code).toBe("reference.cross_slot");
    }
    expect(left.candidatesFor("cause").map((candidate) => candidate.slot)).toEqual([0]);
  });

  it("adds normalized candidate details without changing handles", () => {
    const resolver = createReferenceResolver([{
      kind: "fact",
      engineId: "door-open",
      label: "门已打开",
      meaning: "canonical fact",
      allowedUses: ["cause"],
      visibility: "role",
    }]);
    const detailed = withReferenceCandidateDetails(resolver, (resolution) => ({
      predicate: resolution.engineId,
      value: true,
    }));

    expect(detailed.catalog.candidates[0]).toMatchObject({
      handle: resolver.catalog.candidates[0]!.handle,
      details: { predicate: "door-open", value: true },
    });
    expect(detailed.catalog.hash).not.toBe(resolver.catalog.hash);
    expect(detailed.resolve(resolver.catalog.candidates[0]!.handle, "cause")).toMatchObject({
      engineId: "door-open",
    });
  });

  it("distinguishes existing handles from same-response proposal references", () => {
    const existing = existingReferenceHandleSchema.parse("ref:local_entity:guard");
    const proposed = modelReferenceSchema.parse({ proposalKey: "new-witness" });

    expect(isProposalReference(existing)).toBe(false);
    expect(isProposalReference(proposed)).toBe(true);
    expect(proposalKeySchema.safeParse(" new-witness ").success).toBe(false);
  });

  it("deduplicates candidate metadata and can narrow a shared catalog", () => {
    const resolver = createReferenceResolver([
      {
        kind: "event",
        engineId: "event-1",
        label: "",
        meaning: "",
        allowedUses: ["cause"],
        visibility: "role",
      },
      {
        kind: "event",
        engineId: "event-1",
        label: "门打开",
        meaning: "current transition event",
        allowedUses: ["source"],
        visibility: "role",
      },
      {
        kind: "event",
        engineId: "event-2",
        label: "钟声",
        meaning: "another event",
        allowedUses: ["cause"],
        visibility: "role",
      },
    ]);
    expect(resolver.catalog.candidates).toHaveLength(2);
    expect(resolver.catalog.candidates[0]).toMatchObject({
      label: "门打开",
      meaning: "current transition event",
      allowedUses: ["cause", "source"],
    });
    const narrowed = resolver.narrow((candidate) => candidate.engineId === "event-2");
    expect(narrowed.catalog.candidates).toHaveLength(1);
    expect(narrowed.catalog.candidates[0]!.handle).toBe(resolver.catalog.candidates[1]!.handle);
  });

  it("normalizes only deterministic list duplicates and reports exact proposal/reference failures", () => {
    const resolver = createReferenceResolver([{
      kind: "fact",
      engineId: "door-open",
      label: "门已打开",
      meaning: "an existing fact",
      allowedUses: ["cause"],
      visibility: "role",
    }]);
    const result = normalizeModelOutput({
      proposal: { proposalKey: "new-event", description: "门打开了" },
      causeRefs: [resolver.catalog.candidates[0]!.handle, resolver.catalog.candidates[0]!.handle],
      unsupportedRef: "ref:fact:not-in-catalog",
      proposalRef: { proposalKey: "not-declared" },
    }, { resolver, dedupeArrays: true });

    expect(result.deduplicatedCount).toBe(1);
    expect(result.proposalCount).toBe(1);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "reference.unknown_handle",
      "proposal.unknown_reference",
    ]));
    expect(result.value).toMatchObject({
      causeRefs: [resolver.catalog.candidates[0]!.handle],
    });
  });

  it("validates handle-named fields as references, including batch target handles", () => {
    const resolver = createReferenceResolver([{
      kind: "local_entity",
      engineId: "guard-alpha",
      label: "守卫",
      meaning: "an existing local entity",
      allowedUses: ["target"],
      visibility: "slot",
    }]);
    const result = normalizeModelOutput({
      targetHandles: [resolver.catalog.candidates[0]!.handle, "ref:local_entity:missing"],
    }, { resolver });

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "reference.unknown_handle", path: ["targetHandles", 1] }),
    ]));
    expect(result.resolvedReferenceCount).toBe(1);
  });

  it("repairs a request-local reference handle and preserves strict resolver validation", () => {
    const resolver = createReferenceResolver([{
      kind: "local_entity",
      engineId: "guard-alpha",
      label: "守卫",
      meaning: "an existing local entity",
      allowedUses: ["target"],
      visibility: "slot",
    }]);
    const handle = resolver.catalog.candidates[0]!.handle;
    const malformed = handle.slice(0, -1);
    const result = normalizeModelOutput({ targetRef: malformed }, { resolver });

    expect(result.value).toEqual({ targetRef: handle });
    expect(result.issues).toEqual([]);
    expect(result.symbolRepairs).toHaveLength(1);
    expect(result.symbolRepairs[0]).toMatchObject({
      domain: "reference-handle",
      status: "repaired",
      originalValue: malformed,
      correctedValue: handle,
      bestDistance: 1,
    });
  });

  it("keeps an ambiguous reference transcription rejected", () => {
    const resolver = createReferenceResolver([
      { kind: "local_entity", engineId: "guard-alpha", label: "A", meaning: "a", allowedUses: ["target"], visibility: "role" },
      { kind: "local_entity", engineId: "guard-alphb", label: "B", meaning: "b", allowedUses: ["target"], visibility: "role" },
    ]);
    const handles = resolver.catalog.candidates.map((candidate) => candidate.handle);
    const result = normalizeModelOutput({ targetRef: "ref:local_entity:guard-alph" }, { resolver });

    expect(result.value).toEqual({ targetRef: "ref:local_entity:guard-alph" });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "reference.unknown_handle", path: ["targetRef"] }),
    ]));
    expect(result.symbolRepairs).toHaveLength(1);
    expect(result.symbolRepairs[0]).toMatchObject({ status: "ambiguous", correctedValue: null });
    expect(handles).toHaveLength(2);
  });
});
