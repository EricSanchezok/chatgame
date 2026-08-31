import { describe, expect, it } from "vitest";
import {
  createReferenceResolver,
  existingReferenceHandleSchema,
  isProposalReference,
  modelReferenceSchema,
  ModelReferenceError,
  normalizeModelOutput,
  proposalKeySchema,
} from "../model-context";

describe("model semantic references", () => {
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
      engineId: "guard",
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
});
