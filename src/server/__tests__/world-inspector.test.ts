import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SimulationState } from "../../engine/model";
import { MonolithicCurrentAlgorithm } from "../../engine/monolithic-current";
import { RecordingRuntimeObserver } from "../../engine/observability";
import {
  createTestModelCatalog,
  DeterministicModelProvider,
} from "../../engine/testing/model-provider";
import { SimulationEngine } from "../../engine/simulation";
import { replayCommittedHistory } from "../../engine/transaction";
import { toWorldRuntimeContract } from "../../engine/world-definition";
import { loadWorldScript } from "../../script/world-loader";
import type { WorldInspectorStateSnapshot } from "../../shared/world-inspector-api";
import {
  buildWorldInspectorAttemptDetail,
  buildWorldInspectorCommittedProjection,
  buildWorldInspectorCommittedStepDetail,
  buildWorldInspectorRuntimeEventDetail,
  modelAuditsForStep,
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
  it("binds committed model audits to the canonical execution instead of an earlier retry", () => {
    const observer = new RecordingRuntimeObserver({ mode: "full" });
    observer.emit({
      event: "execution.candidate.persisted",
      attributes: { phase: "step" },
      correlation: { step: 1, executionId: "failed-execution" },
      payload: { modelAudits: [{ subjectId: "failed" }] },
    });
    observer.emit({
      event: "execution.candidate.persisted",
      attributes: { phase: "step" },
      correlation: { step: 1, executionId: "committed-execution" },
      payload: { modelAudits: [{ subjectId: "committed" }] },
    });

    expect(modelAuditsForStep(observer.events, 1, "committed-execution"))
      .toEqual([{ subjectId: "committed" }]);
    expect(modelAuditsForStep(observer.events, 1)).toEqual([{ subjectId: "committed" }]);
  });

  it("cuts failed attempts at the rollback boundary and derives structured diagnostics", () => {
    let timestamp = Date.parse("2026-08-25T01:00:00.000Z");
    const observer = new RecordingRuntimeObserver({
      mode: "full",
      now: () => new Date(timestamp += 1_000),
    });
    const correlation = {
      sessionId: "session-failed",
      runId: "run-failed",
      stepAttemptId: "attempt-failed",
      revision: 0,
      step: 1,
    };
    observer.emit({ event: "step.started", correlation, hashes: { state: "stable-hash" } });
    observer.emit({
      event: "step.joint_actions.generated",
      correlation,
      payload: {
        actions: [
          { id: "player-action", actorId: "player", baseRevision: 0, rawText: "观察", goal: "观察", means: null, targetIds: [] },
          { id: "agent-action", actorId: "archon-devers", baseRevision: 0, rawText: "守望", goal: "守望", means: null, targetIds: [] },
        ],
      },
    });
    const modelCorrelation = {
      ...correlation,
      modelInvocationId: "invocation-rejected",
      modelRole: "truth-reaction-routing",
      modelSubject: "archon-devers",
      modelInvocation: 1,
    };
    observer.emit({ event: "model.invocation.started", correlation: modelCorrelation });
    observer.emit({
      event: "model.structured_output.parsed",
      correlation: modelCorrelation,
      payload: { reactionRequests: [{ agentId: "archon-devers", sourceActionId: "player-action" }] },
    });
    observer.emit({
      event: "model.semantic.rejected",
      level: "warn",
      correlation: modelCorrelation,
      error: { name: "Error", message: "reaction routing was invalid" },
    });
    const rollback = observer.emit({
      event: "step.rolled_back",
      level: "error",
      correlation,
      hashes: { state: "stable-hash" },
      error: { name: "Error", message: "routing failed after repairs" },
    });
    observer.emit({
      event: "persistence.snapshot.loaded",
      correlation,
      payload: { mustNotAppearInAttempt: true },
    });

    const summary = summarizeRuntimeAttempts(observer.events)[0]!;
    expect(summary).toMatchObject({
      actorIds: ["archon-devers", "player"],
      eventCount: 6,
      failureStage: "truth-reaction-routing",
      failureStageLabel: "反应路由",
      latestEvent: "step.rolled_back",
      rejectionCount: 1,
      repairCount: 0,
      relatedActorIds: ["archon-devers"],
      rollbackVerified: true,
      status: "rolled_back",
      terminalAt: rollback.timestamp,
    });
    expect(summary.durationMs).toBe(5_000);

    const detail = buildWorldInspectorAttemptDetail("attempt-failed", observer, observer.events)!;
    expect(detail.events).toHaveLength(6);
    expect(detail.events.every((event) => !("payload" in event))).toBe(true);
    expect(detail.events.find((event) => event.event === "step.joint_actions.generated")).toMatchObject({
      hasPayload: true,
      id: expect.stringMatching(/^runtime-[a-f0-9]{64}$/),
    });
    expect(detail.attemptedActions.map((action) => action.actorId)).toEqual(["player", "archon-devers"]);
    expect(detail.stages).toContainEqual(expect.objectContaining({
      label: "反应路由",
      rejectionCount: 1,
      status: "failed",
    }));
    const payloadEvent = detail.events.find((event) => event.hasPayload)!;
    expect(buildWorldInspectorRuntimeEventDetail(payloadEvent.id, observer.events)?.event.payload).toEqual({
      actions: expect.any(Array),
    });
    expect(buildWorldInspectorRuntimeEventDetail("runtime-missing", observer.events)).toBeUndefined();
  });

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

  it("attributes a model transport failure to its structured model stage", () => {
    const observer = new RecordingRuntimeObserver({ mode: "full" });
    const correlation = {
      sessionId: "session-transport-failure",
      runId: "run-transport-failure",
      stepAttemptId: "attempt-transport-failure",
      revision: 0,
      step: 1,
    };
    observer.emit({ event: "step.started", correlation });
    observer.emit({
      event: "model.transport.failed",
      level: "error",
      correlation: {
        ...correlation,
        modelInvocationId: "invocation-transport-failure",
        modelRole: "truth-perception",
        modelSubject: "world-transport-failure",
        modelInvocation: 1,
      },
      error: { name: "Error", message: "provider unavailable" },
    });
    observer.emit({
      event: "step.rolled_back",
      level: "error",
      correlation,
      error: { name: "Error", message: "truth perception failed" },
    });

    expect(summarizeRuntimeAttempts(observer.events)[0]).toMatchObject({
      failureStage: "truth-perception",
      failureStageLabel: "感知裁决",
    });
  });

  it("matches transaction replay at every revision and exposes each Agent evolution", async () => {
    const provider = new DeterministicModelProvider();
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 71,
      modelCatalog: provider.catalog,
    });
    const engine = new SimulationEngine(definition, new MonolithicCurrentAlgorithm(provider));
    await engine.bootstrapAgents();
    for (const goal of ["观察石门", "询问守门人", "继续前进"]) {
      engine.beginPlayerIntent(goal);
      await engine.step();
    }
    const state = engine.snapshot;
    const document: WorldSessionDocument = {
      schemaVersion: 10,
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
      schemaVersion: 10,
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
