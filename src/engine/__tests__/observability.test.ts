import { describe, expect, it } from "vitest";
import path from "node:path";
import { canonicalize, measureModelContext } from "../model-audit";
import { RecordingRuntimeObserver, serializeRuntimeError, type RuntimeObserver } from "../observability";
import { DeterministicModelProvider } from "../testing/model-provider";
import { loadWorldScript } from "../../script/world-loader";
import { EagerReferenceAlgorithm } from "../eager-reference";
import { SimulationEngine } from "../simulation";

describe("model context measurements", () => {
  it("preserves AggregateError members for terminal diagnostics", () => {
    const error = serializeRuntimeError(new AggregateError([
      new Error("first transport failed"),
      new Error("second transport failed"),
    ], "grounding batch failed"));
    expect(error).toMatchObject({
      name: "AggregateError",
      message: "grounding batch failed",
      errors: [
        { name: "Error", message: "first transport failed" },
        { name: "Error", message: "second transport failed" },
      ],
    });
  });

  it("uses canonical pretty JSON UTF-8 bytes and reports top-level sections and state counts", () => {
    const context = {
      zeta: "你好",
      semanticHistory: [{ events: [{ id: "event-1" }] }],
      agentEpistemics: {
        agentA: {
          belief: {
            localEntities: { self: { id: "self" } },
            claims: { claim: { id: "claim" } },
            evidence: { evidenceA: { id: "evidence" } },
          },
        },
      },
      canonicalTruth: {
        entities: { player: { id: "player" } },
        facts: { fact: { id: "fact" } },
        events: [{ id: "event-2" }],
      },
      observations: [{ id: "observation-1" }],
    };
    const canonical = canonicalize(context);
    const json = JSON.stringify(canonical, null, 2);
    const measured = measureModelContext(context, json);

    expect(measured.utf8Bytes).toBe(Buffer.byteLength(json, "utf8"));
    expect(measured.sections.zeta.utf8Bytes)
      .toBe(Buffer.byteLength(JSON.stringify("你好", null, 2), "utf8"));
    expect(Object.keys(measured.sections)).toEqual([
      "agentEpistemics",
      "canonicalTruth",
      "observations",
      "semanticHistory",
      "zeta",
    ]);
    expect(measured.counts).toMatchObject({
      history: 1,
      events: 2,
      agents: 1,
      entities: 2,
      facts: 1,
      beliefs: 1,
      evidence: 1,
      observations: 1,
    });
  });

  it("does not change truth, belief, history, or public semantics across logging modes", async () => {
    const run = async (observer?: RuntimeObserver) => {
      const provider = new DeterministicModelProvider();
      const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
        seed: 91,
        modelCatalog: provider.catalog,
      });
      const engine = new SimulationEngine(
        definition,
        new EagerReferenceAlgorithm(provider),
      );
      const scope = {
        workloadId: "semantic-equivalence",
        batchId: "semantic-equivalence-run",
        correlation: { instanceId: "semantic-equivalence", revision: 0, step: 0 },
        observer,
      };
      await engine.bootstrapAgents(scope);
      const state = engine.snapshot;
      const roster = Object.fromEntries(Object.values(state.agents).map((agent) => [agent.id, {
        kind: "model" as const,
        agentId: agent.id,
        profiles: agent.modelProfiles,
      }]));
      await engine.step(roster, {
        expectedRevision: state.revision,
        trigger: "manual",
        simulatedSeconds: 1,
        externalActions: [],
      }, {
        ...scope,
        correlation: {
          ...scope.correlation,
          advanceId: "semantic-equivalence-run",
          advanceAttempt: 1,
          step: 1,
        },
      });
      return engine.snapshot;
    };

    const off = await run();
    const metrics = await run(new RecordingRuntimeObserver({ mode: "metrics" }));
    const full = await run(new RecordingRuntimeObserver({ mode: "full" }));
    expect(metrics).toEqual(off);
    expect(full).toEqual(off);
  });
});
