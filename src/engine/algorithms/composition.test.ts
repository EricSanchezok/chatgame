import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AlgorithmRegistry,
  defineAlgorithmRef,
  validateAlgorithmRef,
  type AlgorithmIdentity,
  type AlgorithmImplementation,
  type AlgorithmRef,
  type AlgorithmRole,
} from "./composition";

class ProbeAlgorithm<R extends AlgorithmRole> implements AlgorithmImplementation<R> {
  constructor(readonly algorithmIdentity: AlgorithmIdentity<R>) {}
}

function identity<R extends AlgorithmRole>(role: R, id: string): AlgorithmIdentity<R> {
  return { role, id, version: "1", contractVersion: 1 };
}

function leaf<R extends AlgorithmRole>(role: R, id: string, config = {}): AlgorithmRef<R> {
  return defineAlgorithmRef({ ...identity(role, id), config });
}

describe("hierarchical algorithm composition", () => {
  it("hashes complete child identity independent of object insertion order", () => {
    const cognition = leaf("agent-cognition", "mind");
    const selection = leaf("candidate-selection", "full-catalog");
    const left = defineAlgorithmRef({
      ...identity("world-execution", "root"),
      config: {},
      children: { cognition, selection },
    });
    const right = defineAlgorithmRef({
      ...identity("world-execution", "root"),
      config: {},
      children: { selection, cognition },
    });
    const changed = defineAlgorithmRef({
      ...identity("world-execution", "root"),
      config: {},
      children: { cognition, selection: leaf("candidate-selection", "full-catalog", { revision: 2 }) },
    });

    expect(right.manifestHash).toBe(left.manifestHash);
    expect(changed.manifestHash).not.toBe(left.manifestHash);
    expect(Object.isFrozen(left.children)).toBe(true);
  });

  it("rejects hash drift, extra fields, cycles, and invalid child slots", () => {
    const valid = leaf("candidate-selection", "full-catalog");
    expect(() => validateAlgorithmRef({ ...valid, manifestHash: "invalid" })).toThrow("hash mismatch");
    expect(() => validateAlgorithmRef({ ...valid, unexpected: true } as never)).toThrow("fields must be exactly");
    const cyclic = structuredClone(valid) as unknown as Record<string, unknown>;
    (cyclic.children as Record<string, unknown>).loop = cyclic;
    expect(() => validateAlgorithmRef(cyclic as unknown as AlgorithmRef)).toThrow("cycles");
    expect(() => defineAlgorithmRef({
      ...identity("world-execution", "root"),
      config: {},
      children: { "not-a-slot": valid },
    })).toThrow("child slot is invalid");
    expect(() => leaf("candidate-selection", "Not-Kebab")).toThrow("id must be kebab-case");
    expect(() => defineAlgorithmRef({
      role: "candidate-selection",
      id: "full-catalog",
      version: "1/preview",
      contractVersion: 1,
      config: {},
    })).toThrow("version contains unsupported characters");
  });

  it("validates exact roles, configurations, and child schemas before factories run", () => {
    const registry = new AlgorithmRegistry<{ marker: string }>();
    let factoryCalls = 0;
    registry.register({
      ...identity("candidate-selection", "full-catalog"),
      maturity: "reference",
      configSchema: z.strictObject({}),
      children: [],
      create: () => {
        factoryCalls += 1;
        return new ProbeAlgorithm(identity("candidate-selection", "full-catalog"));
      },
    });
    registry.register({
      ...identity("action-compilation", "compiler"),
      maturity: "reference",
      configSchema: z.strictObject({ maxSlots: z.number().int().positive() }),
      children: [{ name: "candidateSelection", role: "candidate-selection" }],
      create: () => {
        factoryCalls += 1;
        return new ProbeAlgorithm(identity("action-compilation", "compiler"));
      },
    });
    const candidateSelection = leaf("candidate-selection", "full-catalog");
    const valid = defineAlgorithmRef({
      ...identity("action-compilation", "compiler"),
      config: { maxSlots: 12 },
      children: { candidateSelection },
    });

    expect(registry.has(valid)).toBe(true);
    expect(registry.has(defineAlgorithmRef({
      ...identity("action-compilation", "compiler"),
      config: { maxSlots: 12, unknown: true },
      children: { candidateSelection },
    }))).toBe(false);
    expect(registry.has(defineAlgorithmRef({
      ...identity("action-compilation", "compiler"),
      config: { maxSlots: 12 },
      children: {},
    }))).toBe(false);
    expect(registry.has(defineAlgorithmRef({
      ...identity("action-compilation", "compiler"),
      config: { maxSlots: 12 },
      children: { candidateSelection: leaf("symbol-repair", "repair") },
    }))).toBe(false);
    expect(factoryCalls).toBe(0);

    const resolved = registry.resolve(valid, { marker: "host" });
    expect(resolved.path).toBe("root");
    expect(resolved.children.candidateSelection.path).toBe("root.candidateSelection");
    expect(factoryCalls).toBe(2);
  });

  it("rejects transformed defaults, wrong factory identities, and reused instances", () => {
    const defaulting = new AlgorithmRegistry();
    defaulting.register({
      ...identity("work-batching", "bounded"),
      maturity: "reference",
      configSchema: z.strictObject({ maxSlots: z.number().default(8) }),
      children: [],
      create: () => new ProbeAlgorithm(identity("work-batching", "bounded")),
    });
    expect(() => defaulting.validateTree(leaf("work-batching", "bounded")))
      .toThrow("must be explicit and canonical");

    const wrong = new AlgorithmRegistry();
    wrong.register({
      ...identity("symbol-repair", "bounded"),
      maturity: "reference",
      configSchema: z.strictObject({}),
      children: [],
      create: () => new ProbeAlgorithm(identity("candidate-selection", "full-catalog")),
    });
    expect(() => wrong.resolve(leaf("symbol-repair", "bounded"), {})).toThrow("wrong identity");

    const reused = new AlgorithmRegistry();
    const singleton = new ProbeAlgorithm(identity("output-recovery", "localized"));
    reused.register({
      ...identity("output-recovery", "localized"),
      maturity: "reference",
      configSchema: z.strictObject({}),
      children: [],
      create: () => singleton,
    });
    const ref = leaf("output-recovery", "localized");
    reused.resolve(ref, {});
    expect(() => reused.resolve(ref, {})).toThrow("reused an implementation");
  });

  it("snapshots definitions and enforces maturity across the complete tree", () => {
    const registry = new AlgorithmRegistry();
    const diagnostic = {
      ...identity("candidate-selection" as const, "experimental-selector"),
      maturity: "diagnostic" as const,
      configSchema: z.strictObject({}),
      children: [] as Array<{ name: string; role: AlgorithmRole }>,
      create: () => new ProbeAlgorithm(identity("candidate-selection", "experimental-selector")),
    };
    registry.register(diagnostic);
    registry.register({
      ...identity("world-execution", "root"),
      maturity: "reference",
      configSchema: z.strictObject({}),
      children: [{ name: "selection", role: "candidate-selection" }],
      create: () => new ProbeAlgorithm(identity("world-execution", "root")),
    });
    const composition = defineAlgorithmRef({
      ...identity("world-execution", "root"),
      config: {},
      children: { selection: leaf("candidate-selection", "experimental-selector") },
    });

    diagnostic.id = "mutated-selector";
    diagnostic.children.push({ name: "unexpected", role: "symbol-repair" });
    expect(registry.list().some((entry) => entry.id === "experimental-selector")).toBe(true);
    expect(registry.validateTree(composition)).toBeUndefined();
    expect(() => registry.validateTreeMaturity(composition, ["reference", "candidate"]))
      .toThrow("root.selection algorithm maturity is not allowed");
    expect(registry.validateTreeMaturity(composition, ["reference", "diagnostic"])).toBeUndefined();
  });
});
