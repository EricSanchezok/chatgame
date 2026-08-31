import { describe, expect, it } from "vitest";
import {
  createReferenceResolver,
  existingReferenceHandleSchema,
  isProposalReference,
  modelReferenceSchema,
  ModelReferenceError,
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
});
