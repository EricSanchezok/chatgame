import { describe, expect, it } from "vitest";
import path from "node:path";
import { canonicalize, measureModelContext } from "../model-audit";
import { RecordingRuntimeObserver, type RuntimeObserver } from "../observability";
import { DeterministicModelProvider } from "../testing/model-provider";
import { loadWorldScript } from "../../script/world-loader";
import { SimulationEngine } from "../simulation";
import { TruthEngine } from "../truth-engine";
import { AgentMind } from "../agent-mind";

describe("model context measurements", () => {
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
        new TruthEngine(provider),
        new AgentMind(provider),
      );
      const scope = {
        workloadId: "semantic-equivalence",
        batchId: "semantic-equivalence-run",
        correlation: { sessionId: "semantic-equivalence", revision: 0, step: 0 },
        observer,
      };
      await engine.bootstrapAgents(scope);
      engine.beginPlayerIntent("观察世界并等待一秒");
      await engine.step({
        ...scope,
        correlation: {
          ...scope.correlation,
          runId: "semantic-equivalence-run",
          runAttempt: 1,
          stepAttemptId: "semantic-equivalence-run:1:1",
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
