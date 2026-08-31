import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadModelCatalog } from "../../models/model-catalog";
import { loadWorldScript } from "../../../script/world-loader";
import {
  ACTION_COMPILATION_CONTEXT_VARIANTS,
  actionCompilationCandidateNamespace,
  actionCompilationProjectionMetrics,
  dynamicEnumExperiment,
  projectActionCompilationContext,
} from "./context-variants";
import {
  evaluateGoldDetailRecall,
  evaluateTemporalGold,
  parseActionCompilationCorpus,
  runTemporalEvidencePropertyCases,
  type ActionCompilationGold,
} from "./gold-evaluator";

const fixtureRoot = path.resolve("test/fixtures/action-compilation");

function fixture() {
  const corpus = parseActionCompilationCorpus(readFileSync(path.join(fixtureRoot, "corpus.jsonl"), "utf8"));
  const gold = JSON.parse(readFileSync(path.join(fixtureRoot, "gold.json"), "utf8")) as ActionCompilationGold;
  return { corpus, gold };
}

function syntheticRecordedContext() {
  const shared = [
    { handle: "ref:entity:actor", kind: "entity", label: "Actor", meaning: "actor entity", allowedUses: ["target", "conflict"], visibility: "role" },
    { handle: "ref:entity:gate", kind: "entity", label: "Stone Gate", meaning: "gate", allowedUses: ["target", "conflict"], visibility: "role" },
    { handle: "ref:entity:unused", kind: "entity", label: "Unused", meaning: "unrelated", allowedUses: ["target", "conflict"], visibility: "role" },
    { handle: "ref:placement:actor", kind: "placement", label: "Actor", meaning: "placement", allowedUses: ["conflict"], visibility: "role" },
    { handle: "ref:placement:gate", kind: "placement", label: "Stone Gate", meaning: "placement", allowedUses: ["conflict"], visibility: "role" },
    { handle: "ref:temporal_profile:brief", kind: "temporal_profile", label: "Brief", meaning: "profile", allowedUses: ["profile"], visibility: "role" },
    { handle: "ref:world:world", kind: "world", label: "world", meaning: "world", allowedUses: ["conflict"], visibility: "role" },
  ];
  const slotPrivate = [
    { handle: "ref:action:a", kind: "action", label: "Open Stone Gate", meaning: "action", allowedUses: ["cause"], visibility: "slot" },
    { handle: "ref:agent:a", kind: "agent", label: "Actor", meaning: "agent", allowedUses: ["audience"], visibility: "slot" },
  ];
  const catalog = (slot: number) => ({ version: 1, hash: String(slot), candidates: [...shared, ...slotPrivate] });
  return {
    contractVersion: 13,
    task: { assignment: { availableHandles: shared.map((entry) => entry.handle) }, slots: [] },
    state: {
      currentElapsedSeconds: 7,
      actors: [{ ref: "ref:agent:a", entityRef: "ref:entity:actor" }],
      canonicalTruth: {
        entities: [
          { ref: "ref:entity:actor", name: "Actor", placementRef: "ref:placement:actor" },
          { ref: "ref:entity:gate", name: "Stone Gate", placementRef: "ref:placement:gate" },
          { ref: "ref:entity:unused", name: "Unused", placementRef: null },
        ],
        placements: [
          { entityRef: "ref:placement:actor", containerRef: "ref:entity:room" },
          { entityRef: "ref:placement:gate", containerRef: "ref:entity:room" },
        ],
      },
      temporalProfiles: [{ profileRef: "ref:temporal_profile:brief", name: "Brief", kind: "fixed" }],
      temporalCalibrations: [{ profileRef: "ref:temporal_profile:brief", situation: "short", explanation: "short" }],
      slots: [{
        slot: 0,
        action: {
          actionRef: "ref:action:a",
          actorRef: "ref:agent:a",
          targetRefs: ["ref:entity:gate"],
          rawText: "Open Stone Gate",
          goal: "Open the gate",
          means: "Push it",
        },
        existingActivities: [],
      }],
    },
    referenceCatalog: { version: 1, hash: "empty", candidates: [] },
    referenceCatalogs: [{ slot: 0, catalog: catalog(0) }],
    repair: null,
  };
}

describe("Action Compilation context experiment", () => {
  it("keeps one complete candidate namespace across C1-C5", () => {
    const source = syntheticRecordedContext();
    const expected = actionCompilationCandidateNamespace(source);
    for (const variant of ACTION_COMPILATION_CONTEXT_VARIANTS.slice(1)) {
      const projected = projectActionCompilationContext(source, variant);
      expect(actionCompilationCandidateNamespace(projected), variant).toEqual(expected);
      expect(projected).not.toHaveProperty("referenceCatalogs");
      expect(JSON.stringify(projected)).not.toContain("availableHandles");
    }
  });

  it("slices only details and bounds typed expansion to eight known handles", () => {
    const source = syntheticRecordedContext();
    const complete = projectActionCompilationContext(source, "C2");
    const sliced = projectActionCompilationContext(source, "C3");
    expect(actionCompilationProjectionMetrics(sliced).detailedCandidates)
      .toBeLessThan(actionCompilationProjectionMetrics(complete).detailedCandidates);
    const expanded = projectActionCompilationContext(source, "C4", { expansionHandles: ["ref:entity:unused"] });
    expect((expanded.referenceCatalog as { candidates: Array<{ handle: string; details: unknown }> }).candidates)
      .toContainEqual(expect.objectContaining({ handle: "ref:entity:unused", details: expect.any(Object) }));
    expect(() => projectActionCompilationContext(source, "C4", { expansionHandles: ["ref:missing"] }))
      .toThrow("unknown handle");
  });

  it("limits E1 dynamic enums to small profile, audience, and pool fields", () => {
    const context = projectActionCompilationContext(syntheticRecordedContext(), "C2");
    expect(dynamicEnumExperiment(context, "E0")).toEqual({ mode: "E0", schemaBytes: 0, enumFields: 0 });
    const e1 = dynamicEnumExperiment(context, "E1");
    expect(e1.enumFields).toBe(2);
    expect(e1.schemaBytes).toBeGreaterThan(0);
    expect(e1.schemaBytes).toBeLessThan(actionCompilationProjectionMetrics(context).bytes * 0.1);
  });

  it("passes the 48-case temporal and detail gold corpus", () => {
    const { corpus, gold } = fixture();
    const categories = new Map<string, number>();
    corpus.forEach((record) => categories.set(record.category, (categories.get(record.category) ?? 0) + 1));
    expect(corpus).toHaveLength(48);
    expect([...categories.values()]).toEqual(Array.from({ length: 8 }, () => 6));
    const world = loadWorldScript(path.resolve("worlds/blackmarsh/world"), {
      seed: 47,
      modelCatalog: loadModelCatalog(),
    });
    const temporal = evaluateTemporalGold(corpus, gold, world.initialState.truth.mechanics.temporalProfiles);
    expect(temporal.failures).toEqual([]);
    const detail = evaluateGoldDetailRecall(corpus, gold);
    expect(detail.failures).toEqual([]);
    expect(detail.recall).toBe(1);
  });

  it("grounds at least one thousand generated numeric/unit cases", () => {
    const world = loadWorldScript(path.resolve("worlds/blackmarsh/world"), {
      seed: 47,
      modelCatalog: loadModelCatalog(),
    });
    const result = runTemporalEvidencePropertyCases(world.initialState.truth.mechanics.temporalProfiles, 1_000);
    expect(result.cases).toBe(1_000);
    expect(result.failures).toEqual([]);
  });
});
