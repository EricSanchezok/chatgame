import { describe, expect, it } from "vitest";
import {
  boundedDamerauLevenshtein,
  repairSymbol,
} from "../symbol-repair";

const context = {
  domain: "candidate-key" as const,
  path: ["temporalPlan", "causes", 0, "ref"],
  catalogHash: "catalog-test",
};

function candidate(value: string) {
  return [{ value }];
}

describe("deterministic symbol repair", () => {
  it("computes insertion, deletion, substitution, and adjacent transposition", () => {
    expect(boundedDamerauLevenshtein("abc", "ab", 2)).toBe(1);
    expect(boundedDamerauLevenshtein("abc", "abdc", 2)).toBe(1);
    expect(boundedDamerauLevenshtein("abc", "axc", 2)).toBe(1);
    expect(boundedDamerauLevenshtein("abcd", "abdc", 2)).toBe(1);
  });

  it("keeps repeated-character insertion and deletion symmetric", () => {
    expect(boundedDamerauLevenshtein("a", "aa", 2)).toBe(1);
    expect(boundedDamerauLevenshtein("aa", "a", 2)).toBe(1);
    expect(boundedDamerauLevenshtein("abc", "abbc", 2)).toBe(1);
    expect(boundedDamerauLevenshtein("abbc", "abc", 2)).toBe(1);
  });

  it("repairs the recorded missing suffix character", () => {
    const expected = "candidate_f3f5a5fd148df91d";
    const result = repairSymbol({
      value: "candidate_f3f5a5fd148df91",
      candidates: candidate(expected),
      context,
    });
    expect(result).toMatchObject({
      status: "repaired",
      correctedValue: expected,
      bestDistance: 1,
      method: "bounded-damerau",
    });
  });

  it("reports NFC normalization only for the human-readable reference domain", () => {
    const decomposed = "ref:entity:e\u0301clair";
    const normalized = decomposed.normalize("NFC");
    const result = repairSymbol({
      value: decomposed,
      candidates: [{ value: normalized, kind: "entity", allowedUses: ["target"] }],
      context: { ...context, domain: "reference-handle", kind: "entity", use: "target" },
    });
    expect(result.status).toBe("normalized");
    expect(result.method).toBe("nfc");
    expect(result.correctedValue).toBe(normalized);
  });

  it("rejects ties and candidates outside the distance threshold", () => {
    const ambiguous = repairSymbol({
      value: "candidate_abcdefgh",
      candidates: candidate("candidate_abcdefgi").concat(candidate("candidate_abcdefgj")),
      context,
    });
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.correctedValue).toBeNull();

    const unmatched = repairSymbol({
      value: "candidate_abcdefgh",
      candidates: candidate("candidate_zzzzzzzz"),
      context,
    });
    expect(unmatched.status).toBe("unmatched");
    expect(unmatched.correctedValue).toBeNull();

    const distanceFour = repairSymbol({
      value: "candidate_abcdefgh",
      candidates: candidate("candidate_abcxyzhh"),
      context,
    });
    expect(distanceFour.status).toBe("unmatched");
    expect(distanceFour.bestDistance).toBe(4);
  });

  it("protects protocol prefixes and disables fuzzy repair for opaque domains", () => {
    const wrongPrefix = repairSymbol({
      value: "candidte_abcdefgh",
      candidates: candidate("candidate_abcdefgh"),
      context,
    });
    expect(wrongPrefix.status).toBe("unmatched");

    const opaque = repairSymbol({
      value: "proposal_abcdefgh",
      candidates: candidate("proposal_abcdefgi"),
      context: { ...context, domain: "proposal-key" },
    });
    expect(opaque.status).toBe("unmatched");
    expect(opaque.reason).toBe("domain is exact-only");
  });

  it("filters candidates by kind, use, and slot before matching", () => {
    const result = repairSymbol({
      value: "ref:entity:abcdefgh",
      candidates: [
        { value: "ref:entity:abcdefgi", kind: "entity", allowedUses: ["target"], slot: 1 },
        { value: "ref:entity:abcdefgj", kind: "entity", allowedUses: ["target"], slot: 2 },
        { value: "ref:agent:abcdefgh", kind: "agent", allowedUses: ["target"], slot: 1 },
      ],
      context: {
        domain: "reference-handle",
        path: ["target"],
        kind: "entity",
        use: "target",
        slot: 1,
        catalogHash: "catalog-test",
      },
    });
    expect(result.status).toBe("repaired");
    expect(result.correctedValue).toBe("ref:entity:abcdefgi");
  });

  it("does not treat an exact value from the wrong semantic kind as a match", () => {
    const result = repairSymbol({
      value: "ref:agent:abcdefgh",
      candidates: [{ value: "ref:agent:abcdefgh", kind: "entity", allowedUses: ["target"], slot: 1 }],
      context: {
        domain: "reference-handle",
        path: ["target"],
        kind: "agent",
        use: "target",
        slot: 1,
        catalogHash: "catalog-test",
      },
    });
    expect(result.status).toBe("unmatched");
    expect(result.reason).toBe("no eligible candidates");
  });

  it("requires a sufficiently long payload for fuzzy repair and never mutates input", () => {
    const input = { value: "candidate_abc", nested: { value: "candidate_abc" } };
    const before = structuredClone(input);
    const result = repairSymbol({
      value: input.value,
      candidates: candidate("candidate_abd"),
      context,
    });
    expect(result.status).toBe("unmatched");
    expect(result.reason).toBe("symbol payload is shorter than the repair minimum");
    expect(input).toEqual(before);
  });

  it("accepts a unique distance-two candidate with stable audit ordering", () => {
    const result = repairSymbol({
      value: "candidate_abcdefgh",
      candidates: candidate("candidate_abxyefgh").concat(candidate("candidate_zzzzzzzz")),
      context,
    });
    expect(result.status).toBe("repaired");
    expect(result.bestDistance).toBe(2);
    expect(result.candidates[0]).toEqual({ value: "candidate_abxyefgh", distance: 2 });
  });
});
