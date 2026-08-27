import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ActionGrounding } from "../execution";
import {
  conflictComponents,
  createMindRepairFallback,
  EagerReferenceAlgorithm,
  normalizeGrounding,
} from "../eager-reference";
import { historyReplayBaseHash } from "../history-replay";
import { replaySimulationState } from "../transaction";
import type { AgentActionProposal, SimulationState } from "../model";
import { contentHash } from "../model-audit";
import { SimulationEngine } from "../simulation";
import {
  createTestModelAudit,
  deterministicModelOutput,
  ScriptedModelProvider,
} from "../testing/model-provider";
import {
  normalizeObservationLocalReferences,
  normalizeObservationSourceEventIds,
} from "../observation-renderer";
import { normalizeOutcomeAlternativeEvidence } from "../truth-engine";
import { loadWorldScript } from "../../script/world-loader";

function grounding(
  actorId: string,
  reads: ActionGrounding["reads"],
  writes: ActionGrounding["writes"],
  audienceAgentIds: string[] = [],
  globalFallback = false,
): ActionGrounding {
  return { actionId: `action-${actorId}`, actorId, reads, writes, audienceAgentIds, globalFallback };
}

describe("eager reference dependency components", () => {
  it("keeps independent footprints separate and joins read/write or audience dependencies", () => {
    expect(conflictComponents([
      grounding("a", [], [{ kind: "entity", id: "entity-a" }]),
      grounding("b", [], [{ kind: "entity", id: "entity-b" }]),
    ])).toEqual([["a"], ["b"]]);

    expect(conflictComponents([
      grounding("a", [], [{ kind: "entity", id: "shared" }]),
      grounding("b", [{ kind: "entity", id: "shared" }], []),
    ])).toEqual([["a", "b"]]);

    expect(conflictComponents([
      grounding("a", [], [{ kind: "entity", id: "entity-a" }], ["b"]),
      grounding("b", [], [{ kind: "entity", id: "entity-b" }]),
    ])).toEqual([["a", "b"]]);
  });

  it("puts every action in one component when any footprint requires global fallback", () => {
    expect(conflictComponents([
      grounding("a", [{ kind: "global", id: "world" }], [{ kind: "global", id: "world" }], [], true),
      grounding("b", [], [{ kind: "entity", id: "entity-b" }]),
      grounding("c", [], [{ kind: "entity", id: "entity-c" }]),
    ])).toEqual([["a", "b", "c"]]);
  });

  it("turns unknown dependency hints into a conservative global footprint", () => {
    const state = {
      agents: { a: { id: "a", entityId: "entity-a" } },
      truth: {
        entities: { "entity-a": { id: "entity-a" } },
        facts: {},
        meters: {},
        quantities: {},
        ratings: {},
      },
    } as unknown as SimulationState;
    const action = { id: "action-a", actorId: "a" } as AgentActionProposal;
    const normalized = normalizeGrounding(state, action, grounding(
      "a",
      [{ kind: "entity", id: "weather" }],
      [],
      ["unknown-group"],
    ));

    expect(normalized.grounding).toEqual({
      actionId: "action-a",
      actorId: "a",
      reads: [{ kind: "global", id: "world" }],
      writes: [{ kind: "global", id: "world" }],
      audienceAgentIds: [],
      globalFallback: true,
    });
    expect(normalized.fallbackReasons).toEqual(["unknown_audience_agent", "unknown_entity"]);
  });

  it("drops invalid or duplicate observation event references without changing narration", () => {
    const normalized = normalizeObservationSourceEventIds([{
      summary: "钟声从港口传来。",
      introductions: [],
      apparentClaims: [],
      sourceEventIds: ["event-valid", "action-invalid", "event-valid"],
    }], new Set(["event-valid"]));

    expect(normalized).toEqual({
      drafts: [{
        summary: "钟声从港口传来。",
        introductions: [],
        apparentClaims: [],
        sourceEventIds: ["event-valid"],
      }],
      droppedReferences: 2,
    });
  });

  it("keeps only observation claims grounded in the observer local entity graph", () => {
    const state = {
      agents: {
        a: {
          belief: { localEntities: { self: { id: "self" } } },
          bindings: { self: { localEntityId: "self", canonicalEntityIds: ["entity-a"] } },
        },
      },
      truth: { entities: { "entity-a": { id: "entity-a" }, place: { id: "place" } } },
    } as unknown as SimulationState;
    const normalized = normalizeObservationLocalReferences(state, ["a"], [{
      summary: "港口仍在下雨。",
      introductions: [
        {
          localEntity: { id: "harbor", name: "港口", description: "雨中的港口", status: "observed" },
          canonicalEntityId: "place",
        },
        {
          localEntity: { id: "self", name: "我", description: "重复引入", status: "observed" },
          canonicalEntityId: "entity-a",
        },
      ],
      apparentClaims: [
        { subjectId: "harbor", predicate: "weather", value: { kind: "text", value: "rain" }, description: "下雨" },
        { subjectId: "city-orders", predicate: "status", value: { kind: "text", value: "unknown" }, description: "无局部主体" },
      ],
      sourceEventIds: [],
    }]);

    expect(normalized.drafts[0].introductions.map((entry) => entry.localEntity.id)).toEqual(["harbor"]);
    expect(normalized.drafts[0].apparentClaims.map((claim) => claim.subjectId)).toEqual(["harbor"]);
    expect(normalized).toMatchObject({ droppedClaims: 1, droppedIntroductions: 1, clearedCanonicalBindings: 0 });
  });

  it("turns AgentMind semantic repair exhaustion into an explicit empty commit and idle action", () => {
    const state = { worldHash: `sha256:${contentHash("world")}`, revision: 7 } as SimulationState;
    const agent = { id: "agent-a" } as SimulationState["agents"][string];
    const fallback = createMindRepairFallback(
      state,
      agent,
      createTestModelAudit("agent-mind", agent.id, state.worldHash, state.revision),
      "mind",
    );

    expect(fallback.beliefPatch).toEqual({ agentId: agent.id, baseRevision: 7, operations: [] });
    expect(fallback.characterPatch).toEqual({ agentId: agent.id, baseRevision: 7, operations: [] });
    expect(fallback.nextAction).toMatchObject({
      actorId: agent.id,
      baseRevision: 7,
      rawText: "观察并等待",
      targetIds: [],
    });
    expect(fallback.fallback).toBe(true);
  });

  it("keeps outcome alternatives only when their evidence belongs to the acting Agent", () => {
    const state = {
      agents: {
        a: { belief: { evidence: { "seen-rain": { id: "seen-rain" } } } },
      },
    } as unknown as SimulationState;
    const action = { id: "action-a", actorId: "a" } as AgentActionProposal;
    const proposal = {
      outcomes: [{
        proposalId: action.id,
        knownAlternatives: [
          {
            description: "可以去避雨。",
            basis: { kind: "knowledge", evidenceIds: ["seen-rain", "weather-fact", "seen-rain"] },
          },
          {
            description: "可以遵守未知命令。",
            basis: { kind: "knowledge", evidenceIds: ["ochre-expedition-command"] },
          },
        ],
      }],
    } as unknown as import("../model").TransitionProposal;

    const normalized = normalizeOutcomeAlternativeEvidence(state, [action], proposal);

    expect(normalized.proposal.outcomes[0].knownAlternatives).toEqual([{
      description: "可以去避雨。",
      basis: { kind: "knowledge", evidenceIds: ["seen-rain"] },
    }]);
    expect(normalized).toMatchObject({ droppedReferences: 3, droppedAlternatives: 1 });
  });

  it("projects the merged candidate to every Agent after independent components resolve", async () => {
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "action-grounding") {
        const action = (context as { action: AgentActionProposal }).action;
        return {
          reads: [],
          writes: [{ kind: "entity", id: action.actorId }],
          audienceAgentIds: [action.actorId],
          globalFallback: false,
        };
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    definition.initialState.truth.placements.keeper = "gate";
    definition.historyBaseHash = historyReplayBaseHash(definition.initialState);
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const state = engine.snapshot;
    const roster = Object.fromEntries(Object.values(state.agents).map((agent) => [agent.id, {
      kind: "model" as const,
      agentId: agent.id,
      profiles: structuredClone(agent.modelProfiles),
    }]));

    const result = await engine.step(roster, {
      expectedRevision: state.revision,
      trigger: "manual",
      externalActions: [],
    });

    expect(result.committed.observations.map((observation) => observation.observerId).sort())
      .toEqual(["keeper", "player"]);
    const globalProjection = provider.requests.find((request) =>
      request.role === "observation-renderer" && request.subjectId.startsWith("step-global-observation"));
    expect((globalProjection?.context as { observationSlots?: unknown[] }).observationSlots).toHaveLength(2);
  });

  it("uses the earliest authored activity checkpoint instead of a fixed step duration", async () => {
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "temporal-planner") {
        const action = (context as { temporalAction: AgentActionProposal }).temporalAction;
        if (action.rawText.includes("100公里")) {
          return {
            profileId: "measured-travel",
            basis: {
              kind: "explicit_quantity",
              amount: 100,
              unit: "公里",
              sourceText: "100公里",
            },
            description: "沿道路逐段前往一百公里外的地点",
            conditionAssertions: [],
            causes: [{ kind: "action", id: action.id }],
          };
        }
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    definition.runtimeDefaults.maxAutonomousSpanSeconds = 100_000;
    const travelProfile = definition.initialState.truth.mechanics.temporalProfiles["measured-travel"];
    if (!travelProfile || travelProfile.kind !== "rate") throw new Error("fixture travel profile is missing");
    travelProfile.checkpointUnits = 50;
    definition.historyBaseHash = historyReplayBaseHash(definition.initialState);
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const result = await engine.step({
      player: { kind: "external", agentId: "player", participantId: "participant-player" },
      keeper: { kind: "idle", agentId: "keeper", reason: "explicit" },
    }, {
      expectedRevision: source.revision,
      trigger: "participant_action",
      externalActions: [{
        submissionId: "travel-100km",
        agentId: "player",
        rawText: "沿道路走到100公里外的城镇",
        goal: "抵达一百公里外的城镇",
        means: "步行",
        targetIds: [],
      }],
    });

    expect(result.committed.temporalBoundary.deltaSeconds).toBe(36_000);
    expect(result.state.truth.elapsedSeconds).toBe(36_000);
    const activity = Object.values(result.state.truth.activities)[0]!;
    expect(activity).toMatchObject({ status: "active", progress: { current: 50, target: 100, unit: "km" } });
    expect(result.committed.outcomes).toHaveLength(1);
    expect(result.committed.outcomes[0]!.status).toBe("continuing");
    expect(result.committed.decisionPoints).toEqual([]);
    expect(result.committed.beliefPatches).toEqual([]);

    const second = await engine.step({
      player: {
        kind: "model",
        agentId: "player",
        profiles: structuredClone(result.state.agents.player.modelProfiles),
      },
      keeper: { kind: "idle", agentId: "keeper", reason: "explicit" },
    }, {
      expectedRevision: result.state.revision,
      trigger: "batch",
      externalActions: [],
    });
    expect(second.committed.temporalPlans).toEqual([]);
    expect(second.committed.temporalBoundary.deltaSeconds).toBe(36_000);
    expect(second.state.truth.elapsedSeconds).toBe(72_000);
    expect(Object.values(second.state.truth.activities)[0]).toMatchObject({
      status: "completed",
      progress: { current: 100, target: 100, unit: "km" },
    });
    expect(second.committed.decisionPoints).toEqual([{
      agentId: "player",
      reason: "activity_completed",
      activityId: activity.id,
      timerId: null,
    }]);
    expect(second.committed.beliefPatches).toHaveLength(1);
    expect(provider.requests.filter((request) => request.role === "temporal-planner")).toHaveLength(1);
    const finalMind = provider.requests.filter((request) =>
      request.role === "agent-mind" && request.subjectId === "player").at(-1);
    expect((finalMind?.context as { observations?: unknown[] }).observations).toHaveLength(2);
    expect(second.state.agents.player.observationCursorStep).toBe(2);

    const replayed = replaySimulationState(second.state);
    expect(contentHash(replayed.truth)).toBe(contentHash(second.state.truth));
    expect(contentHash(replayed.agents)).toBe(contentHash(second.state.agents));

    const overrideEngine = new SimulationEngine(
      definition,
      new EagerReferenceAlgorithm(provider),
      result.state,
    );
    const overridden = await overrideEngine.step({
      player: { kind: "external", agentId: "player", participantId: "participant-player" },
      keeper: { kind: "idle", agentId: "keeper", reason: "explicit" },
    }, {
      expectedRevision: result.state.revision,
      trigger: "participant_action",
      externalActions: [{
        submissionId: "stop-travel",
        agentId: "player",
        rawText: "停止赶路，留在原地观察",
        goal: "停止当前活动",
        means: null,
        targetIds: [],
      }],
    });
    expect(overridden.committed.temporalBoundary.deltaSeconds).toBe(1);
    expect(overridden.state.truth.activities[activity.id]!.status).toBe("cancelled");
    expect(overridden.committed.activityTransitions).toContainEqual(expect.objectContaining({
      activityId: activity.id,
      kind: "cancelled",
    }));
  });
});
