import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DeterministicModelProvider } from "../testing/model-provider";
import { WorldExecutionAlgorithmRegistry } from "../runtime/execution";
import { defineAlgorithmRef, type AlgorithmRef, type AlgorithmRole } from "./composition";
import { DEFAULT_ALGORITHM_REF, registerBuiltinAlgorithms } from "./registry";
import { EagerReferenceAlgorithm } from "./eager-reference/eager-reference";

function replaceChild<R extends AlgorithmRole>(
  ref: AlgorithmRef<R>,
  slot: string,
  child: AlgorithmRef,
): AlgorithmRef<R> {
  return defineAlgorithmRef({
    role: ref.role,
    id: ref.id,
    version: ref.version,
    contractVersion: ref.contractVersion,
    config: ref.config,
    children: { ...ref.children, [slot]: child },
  });
}

describe("built-in algorithm registry", () => {
  it("resolves every node in the default Composition", () => {
    const registry = registerBuiltinAlgorithms(new WorldExecutionAlgorithmRegistry());
    expect(registry.has(DEFAULT_ALGORITHM_REF)).toBe(true);
    expect(registry.catalog().map((entry) => `${entry.role}/${entry.id}@${entry.version}`)).toEqual([
      "action-compilation/model-action-compilation@1",
      "agent-cognition/model-agent-cognition@1",
      "candidate-selection/full-catalog@1",
      "candidate-selection/graph-hybrid-e5@1",
      "interaction-grounding/model-interaction-grounding@1",
      "observation-rendering/model-observation-rendering@1",
      "onset-perception/model-onset-perception@1",
      "output-recovery/localized-repair-bisect@1",
      "reaction-decision/model-reaction-decision@1",
      "reaction-resolution/onset-reaction@1",
      "symbol-repair/bounded-symbol-repair@1",
      "truth-resolution/model-truth-resolution@1",
      "work-batching/bounded-slot-batching@1",
      "work-scheduling/bounded-concurrency@1",
      "world-execution/eager-reference@16",
    ]);
  });

  it("accepts a substitutable candidate-selection implementation through its Role contract", () => {
    const registry = registerBuiltinAlgorithms(new WorldExecutionAlgorithmRegistry());
    registry.registerAlgorithmDefinition({
      role: "candidate-selection",
      id: "test-full-catalog",
      version: "1",
      contractVersion: 1,
      maturity: "diagnostic",
      configSchema: z.strictObject({}),
      children: [],
      create: ({ ref, children }) => ({
        algorithmIdentity: {
          role: "candidate-selection",
          id: "test-full-catalog",
          version: "1",
          contractVersion: 1,
        },
        config: ref.config,
        children,
        runtime: undefined,
      }),
    });
    const replacement = defineAlgorithmRef({
      role: "candidate-selection",
      id: "test-full-catalog",
      version: "1",
      contractVersion: 1,
      config: {},
    });
    const actionCompilation = replaceChild(
      DEFAULT_ALGORITHM_REF.children.actionCompilation!,
      "candidateSelection",
      replacement,
    );
    const composition = replaceChild(DEFAULT_ALGORITHM_REF, "actionCompilation", actionCompilation);
    const algorithm = registry.create(composition, { provider: new DeterministicModelProvider() });

    expect(algorithm.manifest.hash).toBe(composition.manifestHash);
    expect(algorithm.manifest.children.actionCompilation?.children.candidateSelection?.id).toBe("test-full-catalog");
  });

  it("consumes typed batching capabilities instead of implementation-specific config fields", () => {
    const registry = registerBuiltinAlgorithms(new WorldExecutionAlgorithmRegistry());
    registry.registerAlgorithmDefinition({
      role: "work-batching",
      id: "fixed-small-batches",
      version: "1",
      contractVersion: 1,
      maturity: "candidate",
      configSchema: z.strictObject({ profile: z.literal("small") }),
      children: [],
      create: ({ ref, children }) => ({
        algorithmIdentity: {
          role: "work-batching",
          id: "fixed-small-batches",
          version: "1",
          contractVersion: 1,
        },
        config: ref.config,
        children,
        maxSlots: 3,
      }),
    });
    const batching = defineAlgorithmRef({
      role: "work-batching",
      id: "fixed-small-batches",
      version: "1",
      contractVersion: 1,
      config: { profile: "small" },
    });
    const actionCompilation = replaceChild(
      DEFAULT_ALGORITHM_REF.children.actionCompilation!,
      "batching",
      batching,
    );
    const composition = replaceChild(DEFAULT_ALGORITHM_REF, "actionCompilation", actionCompilation);
    const algorithm = registry.create(composition, { provider: new DeterministicModelProvider() });

    expect(algorithm).toBeInstanceOf(EagerReferenceAlgorithm);
    expect((algorithm as EagerReferenceAlgorithm).config.actionCompilationMaxSlots).toBe(3);
  });
});
