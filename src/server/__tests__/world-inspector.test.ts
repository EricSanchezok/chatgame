import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentMind } from "../../engine/agent-mind";
import type { SimulationState } from "../../engine/model";
import { RecordingRuntimeObserver } from "../../engine/observability";
import {
  createTestModelCatalog,
  DeterministicModelProvider,
} from "../../engine/testing/model-provider";
import { SimulationEngine } from "../../engine/simulation";
import { replayCommittedHistory } from "../../engine/transaction";
import { TruthEngine } from "../../engine/truth-engine";
import { toWorldRuntimeContract } from "../../engine/world-definition";
import { loadWorldScript } from "../../script/world-loader";
import type { WorldInspectorStateSnapshot } from "../../shared/world-inspector-api";
import {
  buildWorldInspectorCommittedProjection,
  buildWorldInspectorCommittedStepDetail,
  summarizeRuntimeAttempts,
} from "../world-inspector";
import type { WorldSessionDocument } from "../world-run-types";
import { settleBlackmarshOpeningDeadlines } from "./blackmarsh-test-support";

function snapshot(state: Readonly<SimulationState>): WorldInspectorStateSnapshot {
  return {
    revision: state.revision,
    step: state.step,
    truth: structuredClone(state.truth),
    agents: structuredClone(state.agents),
    player: structuredClone(state.player),
  };
}

describe("world inspector committed projection", () => {
  it("keeps a persistence rollback as an uncommitted branch even after candidate commit", () => {
    const observer = new RecordingRuntimeObserver({ mode: "full" });
    const correlation = {
      sessionId: "session-rollback",
      runId: "run-rollback",
      stepAttemptId: "attempt-rollback",
      revision: 0,
      step: 1,
    };
    observer.emit({ event: "step.started", correlation });
    observer.emit({ event: "step.committed", correlation });
    observer.emit({ event: "step.persistence_rolled_back", level: "error", correlation });

    expect(summarizeRuntimeAttempts(observer.events)).toEqual([
      expect.objectContaining({ id: "attempt-rollback", status: "rolled_back" }),
    ]);
  });

  it("matches transaction replay at every revision and exposes each Agent evolution", async () => {
    const provider = new DeterministicModelProvider();
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 71,
      modelCatalog: provider.catalog,
    });
    const engine = new SimulationEngine(definition, new TruthEngine(provider), new AgentMind(provider));
    await engine.bootstrapAgents();
    for (const goal of ["观察石门", "询问守门人", "继续前进"]) {
      engine.beginPlayerIntent(goal);
      await engine.step();
    }
    const state = engine.snapshot;
    const document: WorldSessionDocument = {
      schemaVersion: 9,
      id: "inspector-replay-session",
      world: toWorldRuntimeContract(definition),
      title: definition.name,
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:03.000Z",
      state,
      runs: {},
    };
    const expected = new Map<number, WorldInspectorStateSnapshot>();
    let base: WorldInspectorStateSnapshot | undefined;
    replayCommittedHistory(state, {
      base(replayed) { base = snapshot(replayed); },
      commit(replayed, committed) { expected.set(committed.revision, snapshot(replayed)); },
    });

    const projection = buildWorldInspectorCommittedProjection(document, { limit: 24 });
    expect(projection.steps.map((step) => step.revision)).toEqual([1, 2, 3]);
    for (const revision of [1, 2, 3]) {
      const detail = buildWorldInspectorCommittedStepDetail(document, revision);
      expect(detail?.before).toEqual(revision === 1 ? base : expected.get(revision - 1));
      expect(detail?.after).toEqual(expected.get(revision));
    }
    expect(expected.get(3)).toEqual(snapshot(state));

    const agentId = Object.keys(state.agents)[0];
    const latest = buildWorldInspectorCommittedStepDetail(document, 3)!;
    const agentActionIds = latest.committed.actions
      .filter((action) => action.actorId === agentId)
      .map((action) => action.id);
    expect(agentActionIds.length).toBeGreaterThan(0);
    expect(latest.committed.outcomes.some((outcome) => agentActionIds.includes(outcome.proposalId))).toBe(true);
    expect(latest.committed.observations.some((observation) => observation.observerId === agentId)).toBe(true);
    expect(latest.committed.beliefPatches.some((patch) => patch.agentId === agentId)).toBe(true);
    expect(latest.committed.characterPatches.some((patch) => patch.agentId === agentId)).toBe(true);
    expect(latest.committed.nextActions.some((action) => action.actorId === agentId)).toBe(true);
    expect(projection.nodes.some((node) => node.laneId === agentId && node.kind === "mind")).toBe(true);

    const page = buildWorldInspectorCommittedProjection(document, { limit: 2 });
    const pageNodeIds = new Set(page.nodes.map((node) => node.id));
    expect(page.steps.map((step) => step.revision)).toEqual([2, 3]);
    expect(page.edges.every((edge) =>
      pageNodeIds.has(edge.source) && pageNodeIds.has(edge.target))).toBe(true);
    expect(page.edges.some((edge) => edge.source === "commit:1")).toBe(false);
  });

  it("connects causes to reference nodes declared later in the committed step", async () => {
    const catalog = createTestModelCatalog(["truth-deepseek", "agent-deepseek"]);
    const definition = loadWorldScript(path.resolve("worlds/blackmarsh/world"), {
      seed: 47,
      modelCatalog: catalog,
    });
    const { state } = await settleBlackmarshOpeningDeadlines(definition, catalog);
    const document: WorldSessionDocument = {
      schemaVersion: 9,
      id: "inspector-causal-session",
      world: toWorldRuntimeContract(definition),
      title: definition.name,
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:01.000Z",
      state,
      runs: {},
    };

    const projection = buildWorldInspectorCommittedProjection(document, { limit: 24 });
    const eventCauses = state.history.flatMap((committed) => committed.outcomes.flatMap((outcome) =>
      outcome.causeRefs
        .filter((cause) => cause.kind === "event")
        .map((cause) => ({ source: `event:${cause.id}`, target: `action:${outcome.proposalId}` }))));

    expect(eventCauses.length).toBeGreaterThan(0);
    for (const cause of eventCauses) {
      expect(projection.edges).toContainEqual(expect.objectContaining({
        ...cause,
        kind: "causal",
      }));
    }
  });
});
