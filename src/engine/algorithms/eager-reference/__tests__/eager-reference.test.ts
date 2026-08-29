import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolutionObservations,
  type WorldExecutionAlgorithm,
} from "../../../runtime/execution";
import {
  EagerReferenceAlgorithm,
} from "../eager-reference";
import { historyReplayBaseHash } from "../../../runtime/history-replay";
import { replaySimulationState } from "../../../runtime/transaction";
import type { AgentActionProposal, SimulationState } from "../../../contracts/model";
import { contentHash } from "../../../models/model-audit";
import { ModelSemanticRepairError } from "../../../models/model-provider";
import { SimulationEngine } from "../../../runtime/simulation";
import { CanonicalCommitter } from "../../../runtime/canonical-committer";
import {
  DeterministicModelProvider,
  deterministicActionCompilationBatch,
  deterministicAgentMindBatch,
  deterministicModelOutput,
  ScriptedModelProvider,
} from "../../../testing/model-provider";
import {
  normalizeObservationLocalReferences,
  normalizeObservationSourceEventIds,
} from "../../../cognition/observation-renderer";
import { AgentMind } from "../agent-mind";
import { normalizeOutcomeAlternativeEvidence } from "../../../mechanics/truth-engine";
import { loadWorldScript } from "../../../../script/world-loader";

describe("eager reference safeguards", () => {
  it("adjudicates a unique resource with its incumbent and commits only a capacity-legal winner", async () => {
    let poolId = "";
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "action-compilation") {
        return deterministicActionCompilationBatch(profileId, context, (compilation, { action }) => {
          compilation.temporalPlan = {
            profileId: "ongoing-action",
            basis: { kind: "profile" },
            description: action.rawText,
            continuationAssertions: [],
            causes: [{ kind: "action", id: action.id }],
          };
          compilation.interactionDependency = {
            reads: [{ kind: "shared_resource_pool", id: poolId }],
            writes: [{ kind: "shared_resource_pool", id: poolId }],
            audienceAgentIds: ["keeper", "player"],
            sharedResourceClaims: [{ poolId, basis: { kind: "default" } }],
            globalFallback: false,
          };
        });
      }
      if (role === "truth-resolution") {
        const input = context as {
          committedResolutionPlans?: unknown[];
          jointActions: AgentActionProposal[];
          actors: Record<string, { entityId: string }>;
          world: { disclosure: { defaultCheckVisibility: "full" | "result_only" | "hidden" } };
        };
        if (input.committedResolutionPlans?.length) return { kind: "done" };
        return {
          kind: "commit_plans",
          plans: input.jointActions.map((action, index) => ({
            id: `resource-plan-${index}`,
            actionId: action.id,
            actorId: input.actors[action.actorId]!.entityId,
            targetIds: [input.actors[action.actorId]!.entityId],
            goal: action.goal,
            means: [],
            mode: action.actorId === "keeper" ? "blocked" : "automatic",
            difficulty: null,
            actorRatingId: null,
            factors: [],
            risk: "safe",
            baseEffect: "none",
            primaryEffect: null,
            secondaryEffect: null,
            threatenedEffect: null,
            visibility: input.world.disclosure.defaultCheckVisibility,
            causes: [{ kind: "action", id: action.id }],
          })),
        };
      }
      const output = deterministicModelOutput(profileId, context);
      if (role === "truth-transition") {
        const transition = structuredClone(output) as {
          proposal: { outcomes: Array<{ proposalId: string; status: string; summary: string }> };
        };
        const actions = (context as { jointActions: AgentActionProposal[] }).jointActions;
        const contender = actions.find((action) => action.actorId === "keeper");
        const outcome = contender && transition.proposal.outcomes.find((entry) => entry.proposalId === contender.id);
        if (outcome) {
          outcome.status = "blocked";
          outcome.summary = "现有持有者保住了唯一资源。";
        }
        return transition;
      }
      return output;
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const sharedDefinition = definition.initialState.truth.mechanics.sharedActivityResources["fixture-workbench"]!;
    sharedDefinition.contention = "adjudicate";
    sharedDefinition.pausedRetention = "retain";
    poolId = Object.values(definition.initialState.truth.sharedActivityResourcePools)[0]!.id;
    definition.historyBaseHash = historyReplayBaseHash(definition.initialState);
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const held = await engine.step({
      player: { kind: "external", agentId: "player", participantId: "player-participant" },
      keeper: { kind: "idle", agentId: "keeper", reason: "explicit" },
    }, {
      expectedRevision: source.revision,
      trigger: "participant_action",
      externalActions: [{
        submissionId: "hold-unique-resource",
        agentId: "player",
        rawText: "持续占用唯一工作台",
        goal: "占用工作台",
        means: "工作台",
        targetIds: [],
      }],
    });
    const holder = Object.values(held.state.truth.activities).find((activity) => activity.actorId === "player")!;
    const contested = await engine.step({
      player: { kind: "idle", agentId: "player", reason: "explicit" },
      keeper: { kind: "external", agentId: "keeper", participantId: "keeper-participant" },
    }, {
      expectedRevision: held.state.revision,
      trigger: "participant_action",
      externalActions: [{
        submissionId: "contest-unique-resource",
        agentId: "keeper",
        rawText: "争夺唯一工作台并持续使用",
        goal: "取得工作台",
        means: "争夺",
        targetIds: [],
      }],
    });
    const contender = Object.values(contested.state.truth.activities).find((activity) => activity.actorId === "keeper")!;
    expect(contested.committed.sharedResourceAdmissions).toContainEqual(expect.objectContaining({
      kind: "adjudicate",
      activityId: contender.id,
      competingActivityIds: [holder.id],
    }));
    expect(contested.committed.actions.map((action) => action.id)).toEqual(expect.arrayContaining([
      holder.sourceActionId,
      contender.sourceActionId,
    ]));
    expect(contested.state.truth.activities[holder.id]?.status).toBe("active");
    expect(contested.state.truth.activities[contender.id]?.status).toBe("blocked");
    expect(provider.requests.filter((request) => request.role === "action-compilation")).toHaveLength(2);
    expect(() => replaySimulationState(contested.state)).not.toThrow();
  });

  it("commits a capacity-safe FIFO queue without sending the blocked contender to Truth", async () => {
    let workbenchPoolId = "";
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "action-compilation") {
        return deterministicActionCompilationBatch(profileId, context, (compilation, { action }) => {
          const claims = action.rawText.includes("工作台")
            ? [{ poolId: workbenchPoolId, basis: { kind: "default" as const } }]
            : [];
          if (action.rawText.includes("工作台")) {
            compilation.temporalPlan = {
              profileId: "ongoing-action",
              basis: { kind: "profile" },
              description: action.rawText,
              continuationAssertions: [],
              causes: [{ kind: "action", id: action.id }],
            };
          }
          compilation.interactionDependency = {
            reads: claims.map((claim) => ({ kind: "shared_resource_pool" as const, id: claim.poolId })),
            writes: claims.map((claim) => ({ kind: "shared_resource_pool" as const, id: claim.poolId })),
            audienceAgentIds: [action.actorId],
            sharedResourceClaims: claims,
            globalFallback: false,
          };
        });
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    workbenchPoolId = Object.values(definition.initialState.truth.sharedActivityResourcePools)[0]!.id;
    const delegate = new EagerReferenceAlgorithm(provider);
    let latestCandidate: import("../../../runtime/execution").WorldStepCandidate | undefined;
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
      player: { kind: "external", agentId: "player", participantId: "player-participant" },
      keeper: { kind: "idle", agentId: "keeper", reason: "explicit" },
    }, {
      expectedRevision: source.revision,
      trigger: "participant_action",
      externalActions: [{
        submissionId: "take-workbench",
        agentId: "player",
        rawText: "持续使用工作台修理工具",
        goal: "修理工具",
        means: "工作台",
        targetIds: [],
      }],
    });
    const holder = Object.values(first.state.truth.activities).find((activity) => activity.actorId === "player")!;
    expect(holder).toMatchObject({ status: "active", sharedResourceClaims: [{ poolId: workbenchPoolId, amount: 1 }] });

    const secondRoster = {
      player: { kind: "idle", agentId: "player", reason: "explicit" },
      keeper: { kind: "external", agentId: "keeper", participantId: "keeper-participant" },
    } as const;
    const second = await engine.step(secondRoster, {
      expectedRevision: first.state.revision,
      trigger: "participant_action",
      externalActions: [{
        submissionId: "queue-workbench",
        agentId: "keeper",
        rawText: "持续使用工作台打磨零件",
        goal: "打磨零件",
        means: "工作台",
        targetIds: [],
      }],
    });

    const queued = Object.values(second.state.truth.activities).find((activity) => activity.actorId === "keeper")!;
    expect(queued).toMatchObject({ status: "queued", enqueuedAtSeconds: first.state.truth.elapsedSeconds });
    expect(second.committed.sharedResourceAdmissions).toContainEqual(expect.objectContaining({
      kind: "queue",
      activityId: queued.id,
      shortagePoolIds: [workbenchPoolId],
    }));
    expect(second.committed.outcomes).toContainEqual(expect.objectContaining({
      proposalId: queued.sourceActionId,
      status: "continuing",
      summary: "等待共享资源：庭院工作台",
    }));
    expect(second.committed.resolutionPlans.some((plan) => plan.actionId === queued.sourceActionId)).toBe(false);
    expect(() => replaySimulationState(second.state)).not.toThrow();
    if (!latestCandidate) throw new Error("test algorithm did not capture its candidate");
    const forged = structuredClone(latestCandidate);
    const queueAdmission = forged.sharedResourceAdmissions.find((admission) => admission.activityId === queued.id)!;
    if (queueAdmission.kind !== "queue") throw new Error("test candidate did not queue its contender");
    forged.sharedResourceAdmissions = forged.sharedResourceAdmissions.map((admission) =>
      admission.activityId === queued.id
        ? { kind: "reject" as const, activityId: admission.activityId, shortagePoolIds: queueAdmission.shortagePoolIds }
        : admission);
    expect(() => new CanonicalCommitter().step(
      first.state,
      forged,
      secondRoster,
      definition.runtimeDefaults.maxAutonomousSpanSeconds,
    )).toThrow("admissions do not match trusted capacity allocation");

    const released = await engine.step({
      player: { kind: "external", agentId: "player", participantId: "player-participant" },
      keeper: { kind: "idle", agentId: "keeper", reason: "explicit" },
    }, {
      expectedRevision: second.state.revision,
      trigger: "participant_action",
      externalActions: [{
        submissionId: "release-workbench",
        agentId: "player",
        rawText: "停止修理并在一旁休息",
        goal: "结束修理",
        means: null,
        targetIds: [],
      }],
    });
    const ready = released.state.truth.activities[queued.id]!;
    expect(ready).toMatchObject({ status: "ready", reservedAtSeconds: released.state.truth.elapsedSeconds });
    expect(released.committed.activityTransitions.map((transition) => transition.kind)).toContain("reserved");

    const started = await engine.step({
      player: { kind: "idle", agentId: "player", reason: "explicit" },
      keeper: { kind: "idle", agentId: "keeper", reason: "explicit" },
    }, {
      expectedRevision: released.state.revision,
      trigger: "manual",
      externalActions: [],
    });
    const resumed = started.state.truth.activities[queued.id]!;
    expect(resumed).toMatchObject({ status: "active", startedAtSeconds: released.state.truth.elapsedSeconds });
    expect(started.committed.temporalPlans).toContainEqual(expect.objectContaining({
      actionId: queued.sourceActionId,
      startsAtSeconds: released.state.truth.elapsedSeconds,
    }));
    expect(resumed.updatedAtSeconds).toBeGreaterThan(released.state.truth.elapsedSeconds);
    expect(() => replaySimulationState(started.state)).not.toThrow();
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

  it("keeps deterministic canonical semantics identical for singleton and larger slot limits", async () => {
    const execute = async (actionCompilationMaxSlots: number, agentMindMaxSlots: number) => {
      const provider = new DeterministicModelProvider();
      const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
        seed: 47,
        modelCatalog: provider.catalog,
      });
      const engine = new SimulationEngine(
        definition,
        new EagerReferenceAlgorithm(provider, undefined, { actionCompilationMaxSlots, agentMindMaxSlots }),
      );
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
      return { provider, result };
    };

    const [singleton, batched] = await Promise.all([execute(1, 1), execute(12, 8)]);
    expect(singleton.result.committed.semanticHash).toBe(batched.result.committed.semanticHash);
    expect(contentHash(singleton.result.state.truth)).toBe(contentHash(batched.result.state.truth));
    expect(singleton.provider.requests.filter((request) => request.role === "action-compilation")).toHaveLength(2);
    expect(batched.provider.requests.filter((request) => request.role === "action-compilation")).toHaveLength(1);
    expect(singleton.provider.requests.filter((request) => request.role === "agent-mind")).toHaveLength(2);
    expect(batched.provider.requests.filter((request) => request.role === "agent-mind")).toHaveLength(1);
  });

  it("retains valid AgentMind slots and retries only the invalid Agent", async () => {
    let rejectedKeeper = false;
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "agent-mind") {
        return deterministicAgentMindBatch(context, (output, slot) => {
          if (!rejectedKeeper && slot.perspective.agentId === "keeper") {
            output.nextAction.targetIds = ["unknown-local-target"];
            rejectedKeeper = true;
          }
        });
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
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

    const requests = provider.requests.filter((request) => request.role === "agent-mind");
    expect(requests).toHaveLength(2);
    expect(requests.map((request) =>
      (request.context as { slots: Array<{ perspective: { agentId: string } }> }).slots
        .map((slot) => slot.perspective.agentId))).toEqual([
      ["keeper", "player"],
      ["keeper"],
    ]);
    const audits = result.modelAudits.filter((audit) => audit.role === "agent-mind");
    expect(audits).toHaveLength(2);
    expect(new Set(audits.flatMap((audit) => audit.invocations.map((invocation) => invocation.id))).size).toBe(2);
  });

  it("isolates all three AgentMind purposes and model profiles", async () => {
    const provider = new ScriptedModelProvider(({ profileId, context }) =>
      deterministicModelOutput(profileId, context));
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const state = structuredClone(definition.initialState);
    state.agents.keeper!.modelProfiles.bootstrap = "agent-openai";
    state.agents.keeper!.modelProfiles.mind = "agent-xai";
    const mind = new AgentMind(provider);
    const inputs = Object.values(state.agents).map((agent) => ({
      agent,
      observations: [],
      currentResolution: { action: null, outcome: null },
      events: [],
    }));
    const scope = {
      workloadId: "purpose-profile-test",
      batchId: "purpose-profile-test",
      runtimeIdentity: { worldHash: state.worldHash, revision: state.revision },
    };

    await mind.thinkBatch(state, inputs, scope, "bootstrap", 8);
    await mind.thinkBatch(state, inputs, scope, "resume", 8);
    await mind.thinkBatch(state, inputs, scope, "mind", 8);

    const requests = provider.requests.filter((request) =>
      request.role === "agent-bootstrap" || request.role === "agent-mind");
    expect(requests).toHaveLength(6);
    expect(requests.map((request) => {
      const context = request.context as {
        purpose: "bootstrap" | "resume" | "mind";
        slots: Array<{ perspective: { agentId: string } }>;
      };
      return {
        purpose: context.purpose,
        profileId: request.profileId,
        agents: context.slots.map((slot) => slot.perspective.agentId),
      };
    })).toEqual([
      { purpose: "bootstrap", profileId: "agent-deepseek", agents: ["player"] },
      { purpose: "bootstrap", profileId: "agent-openai", agents: ["keeper"] },
      { purpose: "resume", profileId: "agent-deepseek", agents: ["player"] },
      { purpose: "resume", profileId: "agent-xai", agents: ["keeper"] },
      { purpose: "mind", profileId: "agent-deepseek", agents: ["player"] },
      { purpose: "mind", profileId: "agent-xai", agents: ["keeper"] },
    ]);
  });

  it("retains valid Action Compilation slots and retries only the invalid action", async () => {
    let rejectedKeeper = false;
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "action-compilation") {
        return deterministicActionCompilationBatch(profileId, context, (compilation, { action }) => {
          if (!rejectedKeeper && action.actorId === "keeper") {
            compilation.temporalPlan.profileId = "missing-temporal-profile";
            rejectedKeeper = true;
          }
        });
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const roster = Object.fromEntries(Object.values(source.agents).map((agent) => [agent.id, {
      kind: "model" as const,
      agentId: agent.id,
      profiles: structuredClone(agent.modelProfiles),
    }]));

    await engine.step(roster, {
      expectedRevision: source.revision,
      trigger: "manual",
      externalActions: [],
    });

    const requests = provider.requests.filter((request) => request.role === "action-compilation");
    expect(requests).toHaveLength(2);
    expect(requests.map((request) =>
      (request.context as { slots: Array<{ action: AgentActionProposal }> }).slots
        .map((slot) => slot.action.actorId))).toEqual([
      ["keeper", "player"],
      ["keeper"],
    ]);
  });

  it("repairs a structural resource-pool error with compact catalog guidance", async () => {
    let firstCompilation = true;
    let repairedIssues: string[][] = [];
    const provider = new ScriptedModelProvider(({ role, profileId, context, system }) => {
      if (role === "action-compilation") {
        expect(system).toContain("目录为空或没有明确匹配，sharedResourceClaims 必须输出 []");
        const output = deterministicActionCompilationBatch(profileId, context);
        if (firstCompilation) {
          firstCompilation = false;
          output.slots[0]!.interactionDependency.sharedResourceClaims = [{
            poolId: "default",
            basis: { kind: "default" },
          }];
        } else {
          repairedIssues = (context as { slots: Array<{ validationIssues: string[] }> }).slots
            .map((slot) => slot.validationIssues);
        }
        return output;
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const roster = Object.fromEntries(Object.values(source.agents).map((agent) => [agent.id, {
      kind: "model" as const,
      agentId: agent.id,
      profiles: structuredClone(agent.modelProfiles),
    }]));

    await engine.step(roster, {
      expectedRevision: source.revision,
      trigger: "manual",
      externalActions: [],
    });

    expect(provider.requests.filter((request) => request.role === "action-compilation")).toHaveLength(2);
    expect(repairedIssues).toEqual([
      [expect.stringMatching(/^sharedResourceClaims\.poolId .*canonicalCatalog/)],
      [expect.stringMatching(/^sharedResourceClaims\.poolId .*canonicalCatalog/)],
    ]);
    expect(repairedIssues.flat().every((issue) => issue.length < 250)).toBe(true);
  });

  it("rolls back when an Action Compilation singleton exhausts semantic repair", async () => {
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "action-compilation") {
        return deterministicActionCompilationBatch(profileId, context, (compilation, { action }) => {
          if (action.actorId === "keeper") compilation.temporalPlan.profileId = "missing-temporal-profile";
        });
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const roster = Object.fromEntries(Object.values(source.agents).map((agent) => [agent.id, {
      kind: "model" as const,
      agentId: agent.id,
      profiles: structuredClone(agent.modelProfiles),
    }]));

    await expect(engine.step(roster, {
      expectedRevision: source.revision,
      trigger: "manual",
      externalActions: [],
    })).rejects.toBeInstanceOf(ModelSemanticRepairError);

    expect(contentHash(engine.snapshot)).toBe(contentHash(source));
    expect(provider.requests.filter((request) => request.role === "action-compilation")).toHaveLength(3);
  });

  it("rolls back when an AgentMind singleton exhausts semantic repair", async () => {
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "agent-mind") {
        return deterministicAgentMindBatch(context, (output, slot) => {
          if (slot.perspective.agentId === "keeper") output.nextAction.targetIds = ["unknown-local-target"];
        });
      }
      return deterministicModelOutput(profileId, context);
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const roster = Object.fromEntries(Object.values(source.agents).map((agent) => [agent.id, {
      kind: "model" as const,
      agentId: agent.id,
      profiles: structuredClone(agent.modelProfiles),
    }]));

    await expect(engine.step(roster, {
      expectedRevision: source.revision,
      trigger: "manual",
      externalActions: [],
    })).rejects.toBeInstanceOf(ModelSemanticRepairError);
    expect(contentHash(engine.snapshot)).toBe(contentHash(source));
    expect(provider.requests.filter((request) => request.role === "agent-mind")).toHaveLength(3);
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
    } as unknown as import("../../../contracts/model").TransitionProposal;

    const normalized = normalizeOutcomeAlternativeEvidence(state, [action], proposal);

    expect(normalized.proposal.outcomes[0].knownAlternatives).toEqual([{
      description: "可以去避雨。",
      basis: { kind: "knowledge", evidenceIds: ["seen-rain"] },
    }]);
    expect(normalized).toMatchObject({ droppedReferences: 3, droppedAlternatives: 1 });
  });

  it("projects the merged candidate to every Agent after independent components resolve", async () => {
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "action-compilation") {
        return deterministicActionCompilationBatch(profileId, context, (compilation, { action }) => {
          compilation.interactionDependency = {
            reads: [],
            writes: [{ kind: "entity", id: action.actorId }],
            audienceAgentIds: [action.actorId],
            sharedResourceClaims: [],
            globalFallback: false,
          };
        });
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

  it("creates and bootstraps multiple dynamic Agents with a cohort profile", async () => {
    const summoned = ["skeleton-1", "skeleton-2", "skeleton-3"];
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role !== "truth-transition") return deterministicModelOutput(profileId, context);
      const input = context as { jointActions: AgentActionProposal[] };
      const action = input.jointActions[0];
      if (!action) throw new Error("cohort test expected one action");
      const draftAgent = (index: number) => ({
        id: `skeleton-agent-${index + 1}`,
        entityId: summoned[index],
        character: {
          persona: { summary: "受召唤者命令的骷髅。", voice: "", evidenceIds: [] },
          traits: {}, values: {}, emotions: {}, attitudes: {}, goals: {}, commitments: {},
        },
        belief: {
          localEntities: {
            self: { id: "self", name: "我", description: "骷髅自己", status: "observed" },
          },
          claims: {}, evidence: {},
        },
        bindings: { self: { localEntityId: "self", canonicalEntityIds: [summoned[index]] } },
      });
      return {
        outcomes: [{
          proposalId: action.id,
          status: "succeeded",
          summary: "召唤行动完成。",
          causeRefs: [{ kind: "action", id: action.id }],
          assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
          knownAlternatives: [],
        }],
        mechanicInvocations: [{
          id: "summon-cohort",
          packageId: "core-resolution",
          ruleId: "instantiate-entity-cohort",
          input: { entityIds: summoned, profileId: "wanderer" },
          causes: [{ kind: "action", id: action.id }],
          assertions: summoned.map((entityId) => ({ kind: "entity_absent", entityId })),
        }],
        operations: [
          ...summoned.map((entityId) => ({
            kind: "create_entity" as const,
            entity: { id: entityId, kind: "undead", name: entityId, description: "刚被召唤的骷髅。" },
            placementId: "courtyard",
            causes: [{ kind: "action" as const, id: action.id }],
            assertions: [{ kind: "entity_absent" as const, entityId }],
          })),
          ...summoned.map((_entityId, index) => ({
            kind: "create_agent" as const,
            agent: draftAgent(index),
            causes: [{ kind: "action" as const, id: action.id }],
            assertions: [{ kind: "entity_lifecycle" as const, entityId: summoned[index], expected: "active" as const }],
          })),
        ],
        events: [{
          id: "summon-event",
          description: "三个骷髅在庭院中出现。",
          impact: "significant",
          causes: [{ kind: "action", id: action.id }],
          assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
        }],
        decisionRequests: [],
      };
    });
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    definition.historyBaseHash = historyReplayBaseHash(definition.initialState);
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const result = await engine.step({
      player: { kind: "external", agentId: "player", participantId: "summoner" },
      keeper: { kind: "idle", agentId: "keeper", reason: "explicit" },
    }, {
      expectedRevision: source.revision,
      trigger: "participant_action",
      externalActions: [{
        submissionId: "summon-three",
        agentId: "player",
        rawText: "死灵法师召唤三个骷髅守卫庭院。",
        goal: "召唤三个骷髅",
        means: "死灵法术",
        targetIds: [],
      }],
    });

    for (const [index, entityId] of summoned.entries()) {
      const agentId = `skeleton-agent-${index + 1}`;
      expect(result.state.truth.entities[entityId]).toMatchObject({ kind: "undead", lifecycle: "active" });
      expect(result.state.agents[agentId]).toMatchObject({ entityId, nextAction: expect.any(Object) });
      expect(result.state.truth.meters[`${entityId}-health`]?.current).toBe(20);
      expect(result.committed.nextActions).toContainEqual(expect.objectContaining({ actorId: agentId }));
    }
    expect(result.committed.observations.map((observation) => observation.observerId))
      .toEqual(expect.arrayContaining(summoned.map((_entityId, index) => `skeleton-agent-${index + 1}`)));
    expect(result.committed.mechanicInvocations).toContainEqual(expect.objectContaining({
      ruleId: "instantiate-entity-cohort",
      input: { entityIds: summoned, profileId: "wanderer" },
    }));
    expect(result.committed.temporalBoundary.deltaSeconds).toBeGreaterThan(0);
    expect(contentHash(replaySimulationState(result.state).truth)).toBe(contentHash(result.state.truth));
  });

  it("uses the earliest authored activity checkpoint instead of a fixed step duration", async () => {
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "action-compilation") {
        return deterministicActionCompilationBatch(profileId, context, (compilation, { action }) => {
          if (action.rawText.includes("100公里")) {
            compilation.temporalPlan = {
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
        });
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
    expect(provider.requests.filter((request) => request.role === "action-compilation")).toHaveLength(1);
    const finalMind = provider.requests.filter((request) => request.role === "agent-mind").at(-1);
    const playerSlot = (finalMind?.context as {
      slots?: Array<{ perspective: { agentId: string }; observations: unknown[] }>;
    }).slots?.find((slot) => slot.perspective.agentId === "player");
    expect(playerSlot?.observations).toHaveLength(2);
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
      if (role === "action-compilation") {
        return deterministicActionCompilationBatch(profileId, context, (compilation, { action }) => {
          compilation.temporalPlan = {
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
        });
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
      if (role === "action-compilation") {
        return deterministicActionCompilationBatch(profileId, context, (compilation, { action }) => {
          if (action.rawText.includes("100公里")) {
            compilation.temporalPlan = {
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
          compilation.interactionDependency = {
            reads: [],
            writes: [{ kind: "entity", id: action.actorId }],
            audienceAgentIds: action.actorId === "keeper" ? ["keeper", "player"] : [action.actorId],
            sharedResourceClaims: [],
            globalFallback: false,
          };
        });
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
    let latestCandidate: import("../../../runtime/execution").WorldStepCandidate | undefined;
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
      if (role === "action-compilation") {
        return deterministicActionCompilationBatch(profileId, context, (compilation) => {
          compilation.interactionDependency = {
            reads: [{ kind: "global", id: "world" }],
            writes: [{ kind: "global", id: "world" }],
            audienceAgentIds: ["keeper", "player"],
            sharedResourceClaims: [],
            globalFallback: true,
          };
        });
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
    expect(provider.requests.filter((request) => request.role === "action-compilation"))
      .toHaveLength(2);
    expect(provider.requests.filter((request) => request.role === "action-compilation")
      .flatMap((request) => (request.context as { slots: Array<{ action: AgentActionProposal }> }).slots)
      .map((slot) => slot.action.rawText))
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
      if (role === "action-compilation") {
        return deterministicActionCompilationBatch(profileId, context, (compilation, { action }) => {
          if (action.rawText === `进行${replacementSeconds}秒的紧急戒备`) {
            compilation.temporalPlan = {
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
          compilation.interactionDependency = {
            reads: [{ kind: "global", id: "world" }],
            writes: [{ kind: "global", id: "world" }],
            audienceAgentIds: ["keeper", "player"],
            sharedResourceClaims: [],
            globalFallback: true,
          };
        });
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
      if (role === "action-compilation") {
        return deterministicActionCompilationBatch(profileId, context, (compilation) => {
          compilation.interactionDependency = {
            reads: [{ kind: "global", id: "world" }],
            writes: [{ kind: "global", id: "world" }],
            audienceAgentIds: ["keeper", "player"],
            sharedResourceClaims: [],
            globalFallback: true,
          };
        });
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
      if (role === "agent-reaction") {
        return { kind: "keep" };
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
      if (role === "action-compilation") {
        return deterministicActionCompilationBatch(profileId, context, (compilation) => {
          compilation.interactionDependency = {
            reads: [{ kind: "global", id: "world" }],
            writes: [{ kind: "global", id: "world" }],
            audienceAgentIds: ["keeper", "player"],
            sharedResourceClaims: [],
            globalFallback: true,
          };
        });
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
