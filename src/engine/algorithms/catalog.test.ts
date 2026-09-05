import { describe, expect, it } from "vitest";
import { createEagerReferenceAlgorithmRef, DEFAULT_EAGER_REFERENCE_CONFIG } from "./eager-reference/eager-reference";
import { algorithmCatalogMarkdown, diffAlgorithmRefs, flattenAlgorithmRef } from "./catalog";
import { DEFAULT_ALGORITHM_REF, registerBuiltinAlgorithms } from "./registry";
import { WorldExecutionAlgorithmRegistry } from "../runtime/execution";

describe("algorithm catalog", () => {
  it("renders the registry and complete default Composition deterministically", () => {
    const registry = registerBuiltinAlgorithms(new WorldExecutionAlgorithmRegistry());
    const first = algorithmCatalogMarkdown(registry, DEFAULT_ALGORITHM_REF);
    const second = algorithmCatalogMarkdown(registry, DEFAULT_ALGORITHM_REF);
    expect(second).toBe(first);
    expect(first).toContain("`candidate-selection`");
    expect(first).toContain("`full-catalog@1`");
    expect(first).toContain("`root.actionCompilation.candidateSelection`");
    expect(flattenAlgorithmRef(DEFAULT_ALGORITHM_REF)).toHaveLength(23);
  });

  it("reports only behavior-changing nodes", () => {
    const tuned = createEagerReferenceAlgorithmRef({
      ...DEFAULT_EAGER_REFERENCE_CONFIG,
      actionCompilationMaxSlots: 3,
    });
    expect(diffAlgorithmRefs(DEFAULT_ALGORITHM_REF, DEFAULT_ALGORITHM_REF)).toEqual([]);
    expect(diffAlgorithmRefs(DEFAULT_ALGORITHM_REF, tuned)).toEqual([
      {
        path: "root.actionCompilation.batching",
        field: "config",
        left: { maxSlots: 12 },
        right: { maxSlots: 3 },
      },
    ]);
  });
});
