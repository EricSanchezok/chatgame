import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolutionObservations, type WorldExecutionAlgorithm } from "../execution";
import {
  createMindRepairFallback,
  EagerReferenceAlgorithm,
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

describe("eager reference safeguards", () => {
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
          sharedResourceClaims: [],
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
            continuationAssertions: [],
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
    expect(result.committed.resolutionReceipts).toEqual([
      expect.objectContaining({ settled: false, operations: [] }),
    ]);
    expect(result.committed.mechanicInvocations.some((invocation) =>
      invocation.packageId === "core-resolution" && invocation.ruleId === "apply-receipt"))
      .toBe(false);
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
    expect(second.committed.resolutionReceipts).toEqual([
      expect.objectContaining({ settled: true }),
    ]);
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

  it("rejects a candidate that relabels an authored due boundary as an arbitrary horizon", async () => {
    const provider = new ScriptedModelProvider(({ profileId, context }) =>
      deterministicModelOutput(profileId, context));
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const delegate = new EagerReferenceAlgorithm(provider);
    const forgingAlgorithm: WorldExecutionAlgorithm = {
      manifest: delegate.manifest,
      bootstrap: (input, context) => delegate.bootstrap(input, context),
      prepareStep: (input, context) => delegate.prepareStep(input, context),
      completeStep: async (input, preparation, reactions, context) => {
        const candidate = await delegate.completeStep(input, preparation, reactions, context);
        candidate.temporalBoundary.reasons = [{ kind: "safety_horizon" }];
        candidate.temporalBoundary.dueActivityIds = [];
        return candidate;
      },
    };
    const engine = new SimulationEngine(definition, forgingAlgorithm);
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const before = contentHash(source);

    await expect(engine.step({
      player: { kind: "external", agentId: "player", participantId: "participant-player" },
      keeper: { kind: "idle", agentId: "keeper", reason: "explicit" },
    }, {
      expectedRevision: source.revision,
      trigger: "participant_action",
      externalActions: [{
        submissionId: "boundary-forgery",
        agentId: "player",
        rawText: "挥剑一次",
        goal: "挥剑",
        means: null,
        targetIds: [],
      }],
    })).rejects.toThrow("earliest trusted temporal boundary");
    expect(contentHash(engine.snapshot)).toBe(before);
  });

  it("records continuation assertions before and after an affected boundary", async () => {
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "temporal-planner") {
        const action = (context as { temporalAction: AgentActionProposal }).temporalAction;
        return {
          profileId: "brief-action",
          basis: { kind: "profile" },
          description: action.rawText,
          continuationAssertions: [{
            kind: "elapsed_seconds_compare",
            operator: "lte",
            value: 1,
          }],
          causes: [{ kind: "action", id: action.id }],
        };
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const profile = definition.initialState.truth.mechanics.temporalProfiles["brief-action"];
    if (!profile || profile.kind !== "fixed") throw new Error("fixture brief profile is missing");
    profile.durationSeconds = 10;
    profile.checkpointSeconds = 10;
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
        submissionId: "assertion-boundary",
        agentId: "player",
        rawText: "坚持当前动作",
        goal: "保持动作",
        means: null,
        targetIds: [],
      }],
    });

    expect(result.committed.temporalBoundary).toMatchObject({
      deltaSeconds: 2,
      reasons: [expect.objectContaining({ kind: "activity_assertion" })],
    });
    expect(result.committed.activityDispositions).toContainEqual(expect.objectContaining({
      actorId: "player",
      kind: "block",
      reason: "continuation_assertion_failed",
      assertionResults: [
        expect.objectContaining({ phase: "pre_transition", passed: true }),
        expect.objectContaining({ phase: "post_transition", passed: false }),
      ],
    }));
  });

  it("settles a due Condition through a context-only interaction boundary", async () => {
    const provider = new ScriptedModelProvider(({ profileId, context }) =>
      deterministicModelOutput(profileId, context));
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    definition.initialState.truth.conditions.alert = {
      id: "alert",
      subjectId: definition.initialState.agents.player!.entityId,
      label: "短暂警觉",
      description: "在下一个世界秒到期。",
      magnitude: "minor",
      durationProfileId: "brief",
      conditionProfileId: null,
      stackingKey: null,
      remainingUses: null,
      expiresAtElapsedSeconds: 1,
      access: { kind: "public" },
      provenance: [{ kind: "law", id: definition.laws[0]!.id }],
    };
    definition.historyBaseHash = historyReplayBaseHash(definition.initialState);
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;

    const result = await engine.step({
      player: { kind: "idle", agentId: "player", reason: "explicit" },
      keeper: { kind: "idle", agentId: "keeper", reason: "explicit" },
    }, {
      expectedRevision: source.revision,
      trigger: "manual",
      externalActions: [],
    });

    expect(result.committed.actions).toEqual([]);
    expect(result.committed.temporalBoundary).toMatchObject({
      deltaSeconds: 1,
      dueConditionIds: ["alert"],
    });
    expect(result.committed.mechanicInvocations).toContainEqual(expect.objectContaining({
      packageId: "core-resolution",
      ruleId: "advance-conditions",
    }));
    expect(result.state.truth.conditions.alert).toBeUndefined();
  });

  it("rejects a candidate whose dependency evidence does not cover final actions", async () => {
    const provider = new ScriptedModelProvider(({ profileId, context }) =>
      deterministicModelOutput(profileId, context));
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const delegate = new EagerReferenceAlgorithm(provider);
    const forgingAlgorithm: WorldExecutionAlgorithm = {
      manifest: delegate.manifest,
      bootstrap: (input, context) => delegate.bootstrap(input, context),
      prepareStep: (input, context) => delegate.prepareStep(input, context),
      completeStep: async (input, preparation, reactions, context) => {
        const candidate = await delegate.completeStep(input, preparation, reactions, context);
        candidate.interactionDependencies = candidate.interactionDependencies.slice(1);
        return candidate;
      },
    };
    const engine = new SimulationEngine(definition, forgingAlgorithm);
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const before = contentHash(source);
    const roster = Object.fromEntries(Object.values(source.agents).map((agent) => [agent.id, {
      kind: "model" as const,
      agentId: agent.id,
      profiles: structuredClone(agent.modelProfiles),
    }]));

    await expect(engine.step(roster, {
      expectedRevision: source.revision,
      trigger: "manual",
      externalActions: [],
    })).rejects.toThrow("action dependencies must cover every final action exactly once");
    expect(contentHash(engine.snapshot)).toBe(before);
  });

  it("rejects dependency component diagnostics that disagree with the final dependency graph", async () => {
    const provider = new ScriptedModelProvider(({ profileId, context }) =>
      deterministicModelOutput(profileId, context));
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 48,
      modelCatalog: provider.catalog,
    });
    const delegate = new EagerReferenceAlgorithm(provider);
    const forgingAlgorithm: WorldExecutionAlgorithm = {
      manifest: delegate.manifest,
      bootstrap: (input, context) => delegate.bootstrap(input, context),
      prepareStep: (input, context) => delegate.prepareStep(input, context),
      completeStep: async (input, preparation, reactions, context) => {
        const candidate = await delegate.completeStep(input, preparation, reactions, context);
        const dependency = candidate.interactionDependencies[0]!;
        dependency.reads = [{ kind: "global", id: "world" }];
        dependency.writes = [{ kind: "global", id: "world" }];
        dependency.globalFallback = true;
        candidate.diagnostics.dependencyComponents = candidate.interactionDependencies
          .map((entry) => [entry.id]);
        candidate.diagnostics.globalReadjudication = false;
        return candidate;
      },
    };
    const engine = new SimulationEngine(definition, forgingAlgorithm);
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const before = contentHash(source);
    const roster = Object.fromEntries(Object.values(source.agents).map((agent) => [agent.id, {
      kind: "model" as const,
      agentId: agent.id,
      profiles: structuredClone(agent.modelProfiles),
    }]));

    await expect(engine.step(roster, {
      expectedRevision: source.revision,
      trigger: "manual",
      externalActions: [],
    })).rejects.toThrow("do not match the final interaction dependency graph");
    expect(contentHash(engine.snapshot)).toBe(before);
  });

  it("jointly commits an authored Timer with every activity due at the same instant", async () => {
    const provider = new ScriptedModelProvider(({ profileId, context }) =>
      deterministicModelOutput(profileId, context));
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    definition.initialState.truth.timers["gate-deadline"] = {
      id: "gate-deadline",
      description: "石门值守截止。",
      createdAtSeconds: 0,
      dueAtSeconds: 1,
      status: "scheduled",
      wakeAgentIds: ["keeper"],
      causes: [{ kind: "law", id: "time-passes" }],
      assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: 1 }],
    };
    definition.historyBaseHash = historyReplayBaseHash(definition.initialState);
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const roster = Object.fromEntries(Object.values(source.agents).map((agent) => [agent.id, {
      kind: "model" as const,
      agentId: agent.id,
      profiles: structuredClone(agent.modelProfiles),
    }]));

    const result = await engine.step(roster, {
      expectedRevision: source.revision,
      trigger: "manual",
      externalActions: [],
    });

    expect(result.committed.temporalBoundary).toMatchObject({
      deltaSeconds: 1,
      dueTimerIds: ["gate-deadline"],
    });
    expect(result.committed.temporalBoundary.dueActivityIds).toHaveLength(2);
    expect(result.state.truth.timers["gate-deadline"]!.status).toBe("fired");
    expect(result.committed.decisionPoints).toContainEqual({
      agentId: "keeper",
      reason: "timer",
      activityId: null,
      timerId: "gate-deadline",
    });
    expect(contentHash(replaySimulationState(result.state).truth)).toBe(contentHash(result.state.truth));
  });

  it("adjudicates a Timer trigger without prematurely settling a longer new Activity", async () => {
    const provider = new ScriptedModelProvider(({ profileId, context }) =>
      deterministicModelOutput(profileId, context));
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const brief = definition.initialState.truth.mechanics.temporalProfiles["brief-action"];
    if (!brief || brief.kind !== "fixed") throw new Error("fixture brief profile is missing");
    brief.durationSeconds = 10;
    brief.checkpointSeconds = 10;
    definition.initialState.truth.timers["gate-deadline"] = {
      id: "gate-deadline",
      description: "石门值守截止。",
      createdAtSeconds: 0,
      dueAtSeconds: 1,
      status: "scheduled",
      wakeAgentIds: ["keeper"],
      causes: [{ kind: "law", id: "time-passes" }],
      assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: 1 }],
    };
    definition.historyBaseHash = historyReplayBaseHash(definition.initialState);
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const roster = Object.fromEntries(Object.values(source.agents).map((agent) => [agent.id, {
      kind: "model" as const,
      agentId: agent.id,
      profiles: structuredClone(agent.modelProfiles),
    }]));

    const result = await engine.step(roster, {
      expectedRevision: source.revision,
      trigger: "manual",
      externalActions: [],
    });

    const keeperActivity = Object.values(result.state.truth.activities)
      .find((activity) => activity.actorId === "keeper")!;
    expect(result.committed.temporalBoundary).toMatchObject({ deltaSeconds: 1, dueActivityIds: [] });
    expect(result.committed.actions).toContainEqual(expect.objectContaining({
      actorId: "keeper",
      rawText: expect.stringContaining("石门值守截止"),
    }));
    expect(result.committed.actions.map((action) => action.id)).not.toContain(keeperActivity.sourceActionId);
    expect(keeperActivity).toMatchObject({ status: "paused", nextBoundaryAtSeconds: null });
    expect(result.committed.decisionPoints).toContainEqual(expect.objectContaining({
      agentId: "keeper",
      reason: "timer",
    }));
  });

  it("creates a decision point when another action produces an authorized relevant observation", async () => {
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
            description: "持续前往远方",
            continuationAssertions: [],
            causes: [{ kind: "action", id: action.id }],
          };
        }
      }
      if (role === "action-grounding") {
        const action = (context as { action: AgentActionProposal }).action;
        return {
          reads: [],
          writes: [{ kind: "entity", id: action.actorId }],
          audienceAgentIds: action.actorId === "keeper" ? ["keeper", "player"] : [action.actorId],
          sharedResourceClaims: [],
          globalFallback: false,
        };
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    definition.runtimeDefaults.maxAutonomousSpanSeconds = 100_000;
    const travel = definition.initialState.truth.mechanics.temporalProfiles["measured-travel"];
    if (!travel || travel.kind !== "rate") throw new Error("fixture travel profile is missing");
    travel.checkpointUnits = 25;
    definition.initialState.truth.facts = {};
    definition.initialState.truth.placements[definition.initialState.agents.keeper!.entityId] = "gate";
    definition.historyBaseHash = historyReplayBaseHash(definition.initialState);
    const delegate = new EagerReferenceAlgorithm(provider);
    let latestCandidate: import("../execution").WorldStepCandidate | undefined;
    const algorithm: WorldExecutionAlgorithm = {
      manifest: delegate.manifest,
      bootstrap: (input, context) => delegate.bootstrap(input, context),
      prepareStep: (input, context) => delegate.prepareStep(input, context),
      completeStep: async (input, preparation, reactions, context) => {
        latestCandidate = await delegate.completeStep(input, preparation, reactions, context);
        return latestCandidate;
      },
    };
    const engine = new SimulationEngine(definition, algorithm);
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const first = await engine.step({
      player: { kind: "external", agentId: "player", participantId: "participant-player" },
      keeper: { kind: "idle", agentId: "keeper", reason: "explicit" },
    }, {
      expectedRevision: source.revision,
      trigger: "participant_action",
      externalActions: [{
        submissionId: "travel-for-interruption",
        agentId: "player",
        rawText: "沿道路走到100公里外的城镇",
        goal: "抵达远方城镇",
        means: "步行",
        targetIds: [],
      }],
    });
    const activity = Object.values(first.state.truth.activities)
      .find((candidate) => candidate.actorId === "player")!;
    expect(activity).toMatchObject({ status: "active", progress: { current: 25, target: 100 } });

    const second = await engine.step({
      player: {
        kind: "model",
        agentId: "player",
        profiles: structuredClone(first.state.agents.player.modelProfiles),
      },
      keeper: {
        kind: "model",
        agentId: "keeper",
        profiles: structuredClone(first.state.agents.keeper.modelProfiles),
      },
    }, {
      expectedRevision: first.state.revision,
      trigger: "batch",
      externalActions: [],
    });

    const interrupted = Object.values(second.state.truth.activities)
      .find((candidate) => candidate.id === activity.id)!;
    expect(interrupted).toMatchObject({ status: "paused", progress: { target: 100 } });
    if (interrupted.status !== "paused") throw new Error("interrupted Activity did not remain scheduled");
    expect(interrupted.progress!.current).toBeGreaterThan(25);
    expect(interrupted.progress!.current).toBeLessThan(26);
    expect(latestCandidate?.interactionDependencies).toContainEqual(expect.objectContaining({
      actorId: "keeper",
      audienceAgentIds: ["keeper", "player"],
    }));
    expect(latestCandidate && resolutionObservations(latestCandidate.resolution)
      .map((observation) => observation.observerId)).toContain("player");
    expect(latestCandidate && "observations" in latestCandidate).toBe(false);
    expect(latestCandidate && "modelAudits" in latestCandidate.resolution).toBe(false);
    expect(latestCandidate && "reactionModelAudits" in latestCandidate.resolution).toBe(false);
    expect(second.committed.decisionPoints).toContainEqual({
      agentId: "player",
      reason: "activity_interrupted",
      activityId: activity.id,
      timerId: null,
    });
    expect(second.committed.beliefPatches).toContainEqual(expect.objectContaining({ agentId: "player" }));
  });

  it("re-grounds an Agent action that is replaced during the reaction window", async () => {
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "action-grounding") {
        return {
          reads: [{ kind: "global", id: "world" }],
          writes: [{ kind: "global", id: "world" }],
          audienceAgentIds: ["keeper", "player"],
          sharedResourceClaims: [],
          globalFallback: true,
        };
      }
      if (role === "truth-perception") {
        const playerAction = (context as { jointActions: AgentActionProposal[] }).jointActions
          .find((action) => action.actorId === "player")!;
        return {
          kind: "request_reactions",
          requests: [{
            agentId: "keeper",
            sourceActionId: playerAction.id,
            stimulus: {
              summary: "旅人突然有所动作。",
              introductions: [],
              apparentClaims: [],
            },
            basis: [{ kind: "shared_placement", placementId: "courtyard" }],
          }],
        };
      }
      if (role === "agent-reaction") {
        return {
          kind: "replace",
          replacementAction: {
            rawText: "抓起庭院沙土戒备",
            goal: "利用现场沙土做好防备",
            means: "庭院地面的沙土",
            targetIds: [],
          },
        };
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
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

    const replacement = result.committed.actions.find((action) => action.actorId === "keeper")!;
    expect(replacement.rawText).toBe("抓起庭院沙土戒备");
    const replacementPlan = result.committed.temporalPlans
      .find((plan) => plan.actorId === "keeper")!;
    expect(replacementPlan.actionId).toBe(replacement.id);
    const replacementActivity = Object.values(result.state.truth.activities)
      .find((activity) => activity.status !== "queued" && activity.status !== "ready" &&
        activity.plan.id === replacementPlan.id)!;
    expect(replacementActivity).toMatchObject({
      sourceActionId: replacement.id,
      sourceAction: { id: replacement.id, rawText: "抓起庭院沙土戒备" },
      plan: { actionId: replacement.id },
    });
    expect(contentHash(replaySimulationState(result.state).truth)).toBe(contentHash(result.state.truth));
    expect(provider.requests.filter((request) => request.role === "action-grounding"))
      .toHaveLength(4);
    expect(provider.requests.filter((request) => request.role === "temporal-planner"))
      .toHaveLength(4);
    expect(provider.requests.filter((request) => request.role === "action-grounding")
      .map((request) => (request.context as { action: AgentActionProposal }).action.rawText))
      .toContain("抓起庭院沙土戒备");
  });

  it.each([
    { replacementSeconds: 1, expectedBoundary: 1 },
    { replacementSeconds: 5, expectedBoundary: 2 },
  ])("reselects the temporal boundary for a $replacementSeconds-second onset replacement", async ({
    replacementSeconds,
    expectedBoundary,
  }) => {
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "temporal-planner") {
        const action = (context as { temporalAction: AgentActionProposal }).temporalAction;
        if (action.rawText === `进行${replacementSeconds}秒的紧急戒备`) {
          return {
            profileId: "explicit-duration",
            basis: {
              kind: "explicit_duration",
              seconds: replacementSeconds,
              sourceText: `${replacementSeconds}秒`,
            },
            description: `进行${replacementSeconds}秒的紧急戒备`,
            continuationAssertions: [],
            causes: [{ kind: "action", id: action.id }],
          };
        }
      }
      if (role === "action-grounding") {
        return {
          reads: [{ kind: "global", id: "world" }],
          writes: [{ kind: "global", id: "world" }],
          audienceAgentIds: ["keeper", "player"],
          sharedResourceClaims: [],
          globalFallback: true,
        };
      }
      if (role === "agent-reaction") {
        return {
          kind: "replace",
          replacementAction: {
            rawText: `进行${replacementSeconds}秒的紧急戒备`,
            goal: "立即戒备",
            means: null,
            targetIds: [],
          },
        };
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const brief = definition.initialState.truth.mechanics.temporalProfiles["brief-action"];
    if (!brief || brief.kind !== "fixed") throw new Error("fixture brief profile is missing");
    brief.durationSeconds = 2;
    brief.checkpointSeconds = 2;
    definition.historyBaseHash = historyReplayBaseHash(definition.initialState);
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const state = engine.snapshot;
    const roster = {
      player: { kind: "external" as const, agentId: "player", participantId: "participant-player" },
      keeper: {
        kind: "model" as const,
        agentId: "keeper",
        profiles: structuredClone(state.agents.keeper!.modelProfiles),
      },
    };

    const request = {
      expectedRevision: state.revision,
      trigger: "participant_action" as const,
      externalActions: [{
        submissionId: `trigger-${replacementSeconds}`,
        agentId: "player",
        rawText: "向前走一步",
        goal: "向前移动",
        means: null,
        targetIds: [],
      }],
    };
    const preparation = await engine.prepareStep(roster, request);
    const result = await engine.completePreparedStep(roster, request, preparation,
      preparation.pendingReactionRequests.map((reaction) => ({
        submissionId: `keep-${reaction.id}`,
        requestId: reaction.id,
        agentId: reaction.agentId,
        kind: "keep" as const,
      })));
    expect(result.committed.temporalBoundary).toMatchObject({
      fromElapsedSeconds: 0,
      toElapsedSeconds: expectedBoundary,
      deltaSeconds: expectedBoundary,
    });
    expect(result.committed.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ rawText: `进行${replacementSeconds}秒的紧急戒备` }),
      expect.objectContaining({ rawText: "向前走一步" }),
    ]));
    const playerActivity = Object.values(result.state.truth.activities)
      .find((activity) => activity.actorId === "player" && activity.sourceAction.rawText === "向前走一步")!;
    expect(playerActivity.status).toBe(replacementSeconds === 1 ? "active" : "completed");
  });

  it("opens an onset reaction only after a committed perception check succeeds", async () => {
    let perceptionRounds = 0;
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "action-grounding") {
        return {
          reads: [{ kind: "global", id: "world" }],
          writes: [{ kind: "global", id: "world" }],
          audienceAgentIds: ["keeper", "player"],
          sharedResourceClaims: [],
          globalFallback: true,
        };
      }
      if (role === "truth-perception") {
        perceptionRounds += 1;
        if (perceptionRounds > 1) return { kind: "done" };
        const playerAction = (context as { jointActions: AgentActionProposal[] }).jointActions
          .find((action) => action.actorId === "player")!;
        return {
          kind: "request_checks",
          requests: [{
            id: "notice-player-action",
            actorId: "keeper",
            targetId: "player",
            ratingId: null,
            modifier: 0,
            modifierSources: [],
            dc: 0,
            mode: "normal",
            stakes: "守门人是否察觉远处旅人的行动开始",
            visibility: "full",
            causes: [
              { kind: "action", id: playerAction.id },
              { kind: "law", id: "time-passes" },
            ],
          }],
        };
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const brief = definition.initialState.truth.mechanics.temporalProfiles["brief-action"];
    if (!brief || brief.kind !== "fixed") throw new Error("fixture brief profile is missing");
    brief.durationSeconds = 2;
    brief.checkpointSeconds = 2;
    definition.initialState.truth.facts = {};
    definition.initialState.truth.placements[definition.initialState.agents.keeper!.entityId] = "gate";
    definition.historyBaseHash = historyReplayBaseHash(definition.initialState);
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const roster = Object.fromEntries(Object.values(source.agents).map((agent) => [agent.id, {
      kind: "model" as const,
      agentId: agent.id,
      profiles: structuredClone(agent.modelProfiles),
    }]));

    const result = await engine.step(roster, {
      expectedRevision: source.revision,
      trigger: "manual",
      externalActions: [],
    });

    expect(perceptionRounds).toBe(2);
    expect(result.committed.reactionRequests).toContainEqual(expect.objectContaining({
      agentId: "keeper",
      basis: [expect.objectContaining({ kind: "perception_check" })],
    }));
    const checkId = result.committed.reactionRequests
      .find((request) => request.agentId === "keeper")!.basis
      .find((basis) => basis.kind === "perception_check")!.checkId;
    expect(result.committed.checkRequests).toContainEqual(expect.objectContaining({
      id: checkId,
      actorId: "keeper",
      phase: "perception",
    }));
    expect(result.committed.checks).toContainEqual(expect.objectContaining({
      requestId: checkId,
      succeeded: true,
    }));
    expect(result.committed.commitmentRounds[0]).toEqual({
      kind: "check",
      phase: "perception",
      requestIds: [checkId],
    });
    expect(contentHash(replaySimulationState(result.state).truth)).toBe(contentHash(result.state.truth));
  });

  it.each([
    { mode: "imperceptible" as const, interruptible: true },
    { mode: "non-interruptible" as const, interruptible: false },
  ])("does not open a reaction round for a $mode action onset", async ({ mode, interruptible }) => {
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "action-grounding") {
        return {
          reads: [{ kind: "global", id: "world" }],
          writes: [{ kind: "global", id: "world" }],
          audienceAgentIds: ["keeper", "player"],
          sharedResourceClaims: [],
          globalFallback: true,
        };
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const brief = definition.initialState.truth.mechanics.temporalProfiles["brief-action"];
    if (!brief || brief.kind !== "fixed") throw new Error("fixture brief profile is missing");
    brief.durationSeconds = 2;
    brief.checkpointSeconds = 2;
    brief.interruptible = interruptible;
    if (mode === "imperceptible") {
      definition.initialState.truth.facts = {};
      definition.initialState.truth.placements[definition.initialState.agents.keeper!.entityId] = "gate";
    }
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

    expect(result.committed.reactionRequests).toEqual([]);
    expect(result.committed.temporalBoundary.deltaSeconds).toBe(2);
    expect(provider.requests.filter((request) => request.role === "agent-reaction")).toEqual([]);
    for (const point of result.committed.decisionPoints) {
      expect(Object.values(result.state.truth.activities).some((activity) =>
        activity.status === "active" && activity.participantAgentIds.includes(point.agentId))).toBe(false);
    }
  });
});
