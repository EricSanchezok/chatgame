import { describe, expect, it } from "vitest";
import { AgentMind } from "../agent-mind";
import { historyReplayBaseHash } from "../history-replay";
import { applyCharacterPatch } from "../character";
import { validatePublicInformationBoundary } from "../information-boundary";
import { contentHash } from "../model-audit";
import type {
  AgentActionProposal,
  AgentBeliefState,
  CharacterImpact,
  CharacterPatch,
  ObservationPacket,
  SimulationState,
  TransitionProposalDraft,
  WorldEvent,
} from "../model";
import { createTestModelAudit, ScriptedModelProvider } from "../testing/model-provider";
import { TEST_WORLD_HASH } from "../testing/world";
import { createSeededRng } from "../random";
import { projectAgentSelfState } from "../self-state";
import { SimulationEngine } from "../simulation";
import { createEmptyCharacter, validateSimulationState } from "../transaction";
import { TruthEngine } from "../truth-engine";
import type { WorldDefinition } from "../world-definition";
import { quantityId, runtimeId } from "../runtime-id";

function characterBasis(impact: CharacterImpact = "ordinary") {
  const belief: AgentBeliefState = {
    localEntities: {
      self: { id: "self", name: "我", description: "我自己", status: "observed" },
      traveler: { id: "traveler", name: "旅人", description: "面前的旅人", status: "observed" },
    },
    claims: {},
    evidence: {
      "evidence:now": {
        id: "evidence:now",
        kind: "observation",
        description: "本步骤的亲身经历",
        sourceId: "observation:now",
        step: 1,
      },
    },
  };
  const observation: ObservationPacket = {
    id: "observation:now",
    observerId: "keeper",
    step: 1,
    kind: "outcome",
    summary: "发生了一件足以影响我的事。",
    introductions: [],
    apparentClaims: [],
    sourceEventIds: ["event:now"],
  };
  const event: WorldEvent = {
    id: "event:now",
    step: 1,
    description: "角色经历了世界事件。",
    impact,
    causes: [{ kind: "law", id: "time" }],
    assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
  };
  const character = createEmptyCharacter("谨慎的守门人", "说话简短");
  character.traits.cautious = {
    id: "cautious",
    description: "做事谨慎",
    strength: 0.5,
    status: "active",
    createdAtStep: 0,
    updatedAtStep: 0,
    evidenceIds: [],
  };
  character.goals.guard = {
    id: "guard",
    description: "守住入口",
    priority: 0.8,
    progress: 0,
    targetIds: [],
    motivatedByIds: ["cautious"],
    status: "active",
    createdAtStep: 0,
    updatedAtStep: 0,
    evidenceIds: [],
  };
  character.commitments.promise = {
    id: "promise",
    description: "答应守到天亮",
    priority: 0.7,
    subjectIds: ["traveler"],
    status: "active",
    createdAtStep: 0,
    updatedAtStep: 0,
    evidenceIds: [],
  };
  return { belief, observation, event, character };
}

function characterPatch(operation: CharacterPatch["operations"][number]): CharacterPatch {
  return { agentId: "keeper", baseRevision: 1, operations: [operation] };
}

const source = {
  sourceObservationIds: ["observation:now"],
  evidenceIds: ["evidence:now"],
};

describe("Agent character evolution", () => {
  it("enforces impact-scaled numeric limits and engine-owned timestamps", () => {
    const ordinary = characterBasis("ordinary");
    const changed = applyCharacterPatch(
      ordinary.character,
      ordinary.belief,
      characterPatch({ ...source, kind: "update_trait", id: "cautious", description: null, strength: 0.55 }),
      1,
      [ordinary.observation],
      [ordinary.event],
    );
    expect(changed.traits.cautious).toMatchObject({ strength: 0.55, createdAtStep: 0, updatedAtStep: 1 });
    expect(() => applyCharacterPatch(
      ordinary.character,
      ordinary.belief,
      characterPatch({ ...source, kind: "update_trait", id: "cautious", description: null, strength: 0.551 }),
      1,
      [ordinary.observation],
      [ordinary.event],
    )).toThrow("more than 0.05");
    expect(() => applyCharacterPatch(
      ordinary.character,
      ordinary.belief,
      characterPatch({
        ...source,
        kind: "update_goal",
        id: "guard",
        description: "放弃守门，转而环游世界",
        priority: null,
        progress: null,
        targetIds: null,
        parentGoal: { kind: "unchanged" },
        motivatedByIds: null,
      }),
      1,
      [ordinary.observation],
      [ordinary.event],
    )).toThrow("goal meaning requires a significant event");

    const significant = characterBasis("significant");
    expect(applyCharacterPatch(
      significant.character,
      significant.belief,
      characterPatch({
        ...source,
        kind: "create_value",
        facet: { id: "mercy", description: "开始重视宽恕", strength: 0.25 },
      }),
      1,
      [significant.observation],
      [significant.event],
    ).values.mercy.createdAtStep).toBe(1);
    expect(() => applyCharacterPatch(
      significant.character,
      significant.belief,
      characterPatch({
        ...source,
        kind: "create_value",
        facet: { id: "mercy", description: "突然极端重视宽恕", strength: 0.26 },
      }),
      1,
      [significant.observation],
      [significant.event],
    )).toThrow("more than 0.25");
    expect(() => applyCharacterPatch(
      significant.character,
      significant.belief,
      characterPatch({ ...source, kind: "retire_trait", id: "cautious" }),
      1,
      [significant.observation],
      [significant.event],
    )).toThrow("more than 0.25");
  });

  it("allows persona replacement only for transformative events", () => {
    const significant = characterBasis("significant");
    const replace = characterPatch({
      ...source,
      kind: "replace_persona",
      summary: "不再相信旧秩序的流浪者",
      voice: "坦率而激烈",
    });
    expect(() => applyCharacterPatch(
      significant.character,
      significant.belief,
      replace,
      1,
      [significant.observation],
      [significant.event],
    )).toThrow("transformative");

    const transformative = characterBasis("transformative");
    expect(applyCharacterPatch(
      transformative.character,
      transformative.belief,
      replace,
      1,
      [transformative.observation],
      [transformative.event],
    ).persona).toEqual({
      summary: "不再相信旧秩序的流浪者",
      voice: "坦率而激烈",
      updatedAtStep: 1,
      evidenceIds: ["evidence:now"],
    });
  });

  it("requires significant terminal transitions and never reopens goals or commitments", () => {
    const basis = characterBasis("significant");
    const completed = applyCharacterPatch(
      basis.character,
      basis.belief,
      characterPatch({ ...source, kind: "set_goal_status", id: "guard", status: "completed" }),
      1,
      [basis.observation],
      [basis.event],
    );
    expect(completed.goals.guard.status).toBe("completed");
    expect(() => applyCharacterPatch(
      completed,
      basis.belief,
      characterPatch({ ...source, kind: "set_goal_status", id: "guard", status: "active" }),
      1,
      [basis.observation],
      [basis.event],
    )).toThrow("cannot reopen terminal goal");

    const fulfilled = applyCharacterPatch(
      basis.character,
      basis.belief,
      characterPatch({ ...source, kind: "set_commitment_status", id: "promise", status: "fulfilled" }),
      1,
      [basis.observation],
      [basis.event],
    );
    expect(() => applyCharacterPatch(
      fulfilled,
      basis.belief,
      characterPatch({ ...source, kind: "set_commitment_status", id: "promise", status: "active" }),
      1,
      [basis.observation],
      [basis.event],
    )).toThrow("cannot reopen terminal commitment");
  });

  it("rejects character evolution without a current private observation and evidence", () => {
    const basis = characterBasis("transformative");
    expect(() => applyCharacterPatch(
      basis.character,
      basis.belief,
      characterPatch({
        sourceObservationIds: ["observation:other"],
        evidenceIds: ["evidence:now"],
        kind: "replace_persona",
        summary: "无依据的新人格",
        voice: "",
      }),
      1,
      [basis.observation],
      [basis.event],
    )).toThrow("unavailable observation");
    expect(() => applyCharacterPatch(
      basis.character,
      basis.belief,
      characterPatch({
        sourceObservationIds: ["observation:now"],
        evidenceIds: ["missing"],
        kind: "replace_persona",
        summary: "无证据的新人格",
        voice: "",
      }),
      1,
      [basis.observation],
      [basis.event],
    )).toThrow("unknown evidence missing");
  });
});

function reactionState(agentIds = ["keeper"], remote = false): SimulationState {
  const entities: SimulationState["truth"]["entities"] = {
    player: { id: "player", kind: "person", name: "旅人", description: "玩家角色", lifecycle: "active", createdAtStep: 0 },
    room: { id: "room", kind: "location", name: "门厅", description: "可以当面交谈的门厅", lifecycle: "active", createdAtStep: 0 },
    tower: { id: "tower", kind: "location", name: "远塔", description: "相距遥远的塔楼", lifecycle: "active", createdAtStep: 0 },
  };
  const placements: SimulationState["truth"]["placements"] = {
    player: "room",
    room: null,
    tower: null,
  };
  const agents: SimulationState["agents"] = {};
  for (const id of agentIds) {
    entities[id] = { id, kind: "person", name: id, description: `${id} 的身体`, lifecycle: "active", createdAtStep: 0 };
    placements[id] = remote ? "tower" : "room";
    agents[id] = {
      id,
      entityId: id,
      modelProfiles: { bootstrap: "agent-default", mind: "agent-default", reaction: "agent-default" },
      character: createEmptyCharacter(`${id} 的人格`),
      belief: {
        localEntities: { self: { id: "self", name: "我", description: `${id} 自己`, status: "observed" } },
        claims: {},
        evidence: {},
      },
      bindings: { self: { localEntityId: "self", canonicalEntityIds: [id] } },
      nextAction: {
        id: runtimeId({
          worldHash: TEST_WORLD_HASH, revision: 0, kind: "action", stage: "prepared",
          owner: id, round: 0, ordinal: 0,
        }),
        actorId: id,
        baseRevision: 0,
        rawText: "继续站岗",
        goal: "履行原计划",
        means: null,
        targetIds: [],
      },
    };
  }
  return {
    schemaVersion: 8,
    worldId: "reaction-world",
    worldHash: TEST_WORLD_HASH,
    lawIds: ["time"],
    revision: 0,
    step: 0,
    truth: {
      elapsedSeconds: 0,
      rng: createSeededRng(9),
      events: [],
      entities,
      placements,
      facts: {},
      factTombstones: [],
      mechanics: {
        meters: { health: { id: "health", name: "生命", min: 0, max: 20, thresholds: [] } },
        quantities: {
          arrows: { id: "arrows", name: "箭", unit: "支", productionLawIds: [], consumptionLawIds: ["time"] },
        },
        ratings: { reflex: { id: "reflex", name: "反应", min: -5, max: 10 } },
      },
      meters: Object.fromEntries(agentIds.map((id) => [`health:${id}`, {
        id: `health:${id}`, definitionId: "health", entityId: id, current: 13, firedThresholdIds: [],
      }])),
      quantities: Object.fromEntries(agentIds.map((id) => [quantityId(TEST_WORLD_HASH, "arrows", id), {
        id: quantityId(TEST_WORLD_HASH, "arrows", id), definitionId: "arrows", holderId: id, amount: 4,
      }])),
      ratings: Object.fromEntries(agentIds.map((id) => [`reflex:${id}`, {
        id: `reflex:${id}`, definitionId: "reflex", entityId: id, value: 3,
      }])),
    },
    agents,
    player: {
      entityId: "player",
      knowledge: { localEntities: {}, claims: {}, evidence: {}, observationIds: [] },
      bindings: {},
    },
    history: [],
    bootstrapAgentCommits: agentIds.map((id) => ({
      agentId: id,
      beliefPatch: { agentId: id, baseRevision: 0, operations: [] },
      characterPatch: { agentId: id, baseRevision: 0, operations: [] },
      nextAction: structuredClone(agents[id].nextAction!),
    })),
    bootstrapModelAudits: agentIds.map((id) =>
      createTestModelAudit("agent-bootstrap", id, TEST_WORLD_HASH)),
  };
}

function reactionDefinition(initialState: SimulationState): WorldDefinition {
  return {
    id: "reaction-world",
    name: "反应窗口世界",
    manifestVersion: "test",
    description: "验证同一步感知与有限反应。",
    contentHash: TEST_WORLD_HASH,
    modelProfiles: {
      perception: "truth-engine",
      reactionRouting: "truth-engine",
      resolution: "truth-engine",
      transition: "truth-engine",
      causalVerifier: "truth-engine",
    },
    laws: [{ id: "time", text: "每步推进时间。", severity: "hard" }],
    disclosure: { defaultCheckVisibility: "full" },
    rulePackages: [{
      id: "core-d20",
      version: "1.1.0",
      config: { damageUsesMeters: true },
      adjudication: "使用 d20 检定。",
      rules: [{ id: "apply-meter-impact", description: "检定驱动 Meter 变化。" }],
    }],
    randomDistributions: [],
    historyBaseHash: historyReplayBaseHash(initialState),
    initialState,
  };
}

function outcomeTransition(context: {
  baseRevision: number;
  step: number;
  jointActions: AgentActionProposal[];
  agentEpistemics: Record<string, unknown>;
}): TransitionProposalDraft {
  const step = context.step + 1;
  const eventId = `event:${step}`;
  return {
    baseRevision: context.baseRevision,
    outcomes: context.jointActions.map((action) => ({
      proposalId: action.id,
      status: "succeeded",
      summary: "该行动已被联合裁决。",
      causeRefs: [{ kind: "action", id: action.id }],
      assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
      knownAlternatives: [],
    })),
    mechanicInvocations: [],
    operations: [{
      kind: "advance_time",
      seconds: 1,
      causes: [{ kind: "law", id: "time" }],
      assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
    }],
    events: [{
      id: eventId,
      step,
      description: "对话与其他行动被联合裁决。",
      impact: "ordinary",
      causes: [{ kind: "law", id: "time" }],
      assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
    }],
    observations: ["player", ...Object.keys(context.agentEpistemics)].map((observerId) => ({
      id: `outcome:${observerId}:${step}`,
      observerId,
      step,
      kind: "outcome" as const,
      summary: "你感知到联合行动的结果。",
      introductions: [],
      apparentClaims: [],
      sourceEventIds: [eventId],
    })),
    intentStatus: "completed",
    requiresPlayerDecision: false,
  };
}

function emptyMindOutput(_agentId: string, _revision: number) {
  void _agentId;
  void _revision;
  return {
    beliefPatch: { operations: [] },
    characterPatch: { operations: [] },
    nextAction: {
      rawText: "等待下一步",
      goal: "继续观察",
      means: null,
      targetIds: [],
    },
  };
}

function stimulus(agentId: string, sourceActionId: string) {
  return {
    id: `stimulus:${agentId}:1`,
    summary: "旅人正在对你说：请回答我。",
    introductions: [{
      localEntity: { id: "speaker", name: "说话的旅人", description: "正在和我说话的人", status: "observed" },
      canonicalEntityId: "player",
    }],
    apparentClaims: [{
      id: `claim:${agentId}:speech`,
      subjectId: "speaker",
      predicate: "utterance",
      value: { kind: "text", value: sourceActionId },
      description: "对方正在等待回答。",
    }],
  };
}

describe("Agent self state and reaction protocol", () => {
  it("treats private character and model profile text as protected player information", () => {
    const state = reactionState();
    const actions: AgentActionProposal[] = [
      {
        id: "player-action",
        actorId: "player",
        baseRevision: 0,
        rawText: "观察守门人",
        goal: "观察",
        means: null,
        targetIds: [],
      },
      state.agents.keeper.nextAction!,
    ];
    const proposal = outcomeTransition({
      baseRevision: 0,
      step: 0,
      jointActions: actions,
      agentEpistemics: { keeper: {} },
    });
    proposal.observations.find((observation) => observation.observerId === "player")!.summary =
      state.agents.keeper.character.persona.summary;

    expect(() => validatePublicInformationBoundary(state, actions, proposal))
      .toThrow("protected world information");
  });

  it("projects exact self mechanics and authorized facts without canonical state ids", () => {
    const state = reactionState();
    state.truth.facts.public = {
      id: "public",
      subjectId: "keeper",
      predicate: "condition",
      value: { kind: "text", value: "alert" },
      description: "正保持警戒。",
      access: { kind: "public" },
      provenance: [{ kind: "law", id: "time" }],
    };
    state.truth.facts.secret = {
      id: "secret",
      subjectId: "keeper",
      predicate: "secret",
      value: { kind: "text", value: "hidden" },
      description: "不应进入自身视图。",
      access: { kind: "private" },
      provenance: [{ kind: "law", id: "time" }],
    };
    state.truth.facts.authorized = {
      id: "authorized",
      subjectId: "keeper",
      predicate: "owner",
      value: { kind: "entity", entityId: "player" },
      description: "只有建立局部映射后才能投影实体值。",
      access: { kind: "agents", agentIds: ["keeper"] },
      provenance: [{ kind: "law", id: "time" }],
    };
    const viewBeforeBinding = projectAgentSelfState(state, state.agents.keeper);
    expect(viewBeforeBinding).toMatchObject({
      selfLocalEntityId: "self",
      lifecycle: "active",
      elapsedSeconds: 0,
      location: { name: "门厅", description: "可以当面交谈的门厅" },
      meters: [{ name: "生命", current: 13, min: 0, max: 20 }],
      quantities: [{ name: "箭", unit: "支", amount: 4 }],
      ratings: [{ name: "反应", value: 3, min: -5, max: 10 }],
    });
    expect(viewBeforeBinding.facts.map((fact) => fact.predicate)).toEqual(["condition"]);
    expect(JSON.stringify(viewBeforeBinding)).not.toContain("health:keeper");
    expect(JSON.stringify(viewBeforeBinding)).not.toContain("secret");

    state.agents.keeper.belief.localEntities.speaker = {
      id: "speaker", name: "旅人", description: "我认识的旅人", status: "observed",
    };
    state.agents.keeper.bindings.speaker = {
      localEntityId: "speaker", canonicalEntityIds: ["player"],
    };
    expect(projectAgentSelfState(state, state.agents.keeper).facts).toContainEqual({
      predicate: "owner",
      value: { kind: "local_entity", localEntityId: "speaker" },
      description: "只有建立局部映射后才能投影实体值。",
    });
  });

  it("lets multiple colocated Agents replace prepared actions with same-step replies", async () => {
    const initial = reactionState(["keeper", "scribe"]);
    let truthCalls = 0;
    let reactionCalls = 0;
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        revision: number;
        jointActions: AgentActionProposal[];
        agentEpistemics: Record<string, unknown>;
        checkResults: Array<{ requestId: string }>;
        agent: { id: string };
        originalAction?: AgentActionProposal;
      };
      if (profileId === "truth-engine") {
        truthCalls += 1;
        if (truthCalls === 1) {
          const playerAction = context.jointActions.find((action) => action.actorId === "player")!;
          return {
            kind: "request_reactions",
            requests: ["keeper", "scribe"].map((agentId) => ({
              agentId,
              stimulus: stimulus(agentId, playerAction.id),
              basis: [{ kind: "shared_placement", placementId: "room" }],
            })),
          };
        }
        if (truthCalls === 2) {
          const keeperAction = context.jointActions.find((action) => action.actorId === "keeper")!;
          return {
            kind: "request_checks",
            requests: [{
              id: "reply-resolution-check",
              actorId: "keeper",
              targetId: null,
              ratingId: "reflex:keeper",
              modifier: 3,
              modifierSources: [{ kind: "rating", id: "reflex:keeper", amount: 3 }],
              dc: 0,
              mode: "normal",
              stakes: "只允许最终替换行动支撑 resolution 检定。",
              visibility: "hidden",
              phase: "resolution",
              causes: [{ kind: "action", id: keeperAction.id }],
            }],
          };
        }
        return { kind: "transition", proposal: outcomeTransition(context) };
      }
      if (context.originalAction) {
        reactionCalls += 1;
        return {
          kind: "replace",
          replacementAction: {
            rawText: `${context.agent.id} 当场回答旅人`,
            goal: "回应刚刚听见的话",
            means: null,
            targetIds: ["speaker"],
          },
        };
      }
      return emptyMindOutput(context.agent.id, context.revision);
    });
    const engine = new SimulationEngine(
      reactionDefinition(initial),
      new TruthEngine(provider),
      new AgentMind(provider),
    );
    engine.beginPlayerIntent("请 keeper 和 scribe 回答我");

    const result = await engine.step();

    expect(reactionCalls).toBe(2);
    expect(result.committed.initialActions.filter((action) => action.actorId !== "player")
      .every((action) => action.id.startsWith("rt:action:"))).toBe(true);
    expect(result.committed.actions.filter((action) => action.actorId !== "player")
      .every((action) => action.id.startsWith("rt:action:") &&
        !result.committed.initialActions.some((initial) => initial.id === action.id))).toBe(true);
    expect(result.committed.reactionRequests).toHaveLength(2);
    expect(result.committed.modelAudits.filter((audit) => audit.role === "agent-reaction")).toHaveLength(2);
    expect(result.committed.observations.filter((packet) => packet.kind === "stimulus")).toHaveLength(2);
    expect(result.committed.outcomes.map((outcome) => outcome.proposalId))
      .toEqual(expect.arrayContaining(result.committed.actions.map((action) => action.id)));
    expect(result.committed.commitmentRounds).toEqual([{
      kind: "check",
      phase: "resolution",
      requestIds: [result.committed.checkRequests[0].id],
    }]);
    expect(result.state.agents.keeper.belief.localEntities.speaker).toBeDefined();
    validateSimulationState(result.state, true, true);

    const forgedAuditId = structuredClone(result.state);
    const forgedAuditStep = forgedAuditId.history[0];
    forgedAuditStep.modelAudits.find((audit) => audit.role === "agent-mind")!
      .invocations[0].id = `rt:model-audit:${"0".repeat(64)}`;
    forgedAuditStep.contentHash = contentHash(Object.fromEntries(
      Object.entries(forgedAuditStep).filter(([key]) => key !== "contentHash"),
    ));
    expect(() => validateSimulationState(forgedAuditId, true, true))
      .toThrow("invalid model invocation identity");

    const nextActionTampered = structuredClone(result.state);
    nextActionTampered.agents.keeper.nextAction!.rawText = "被篡改的下一行动";
    expect(() => validateSimulationState(nextActionTampered, true, true))
      .toThrow("does not match replayed committed cognition");

    const committedNextActionTampered = structuredClone(result.state);
    const committedNextStep = committedNextActionTampered.history[0];
    committedNextStep.nextActions.find((action) => action.actorId === "keeper")!.rawText = "伪造提交";
    committedNextStep.contentHash = contentHash(Object.fromEntries(
      Object.entries(committedNextStep).filter(([key]) => key !== "contentHash"),
    ));
    expect(() => validateSimulationState(committedNextActionTampered, true, true))
      .toThrow("does not match replayed committed cognition");

    const cognitionTampered = structuredClone(result.state);
    cognitionTampered.agents.keeper.character.persona.summary = "伪造人格";
    cognitionTampered.agents.keeper.belief.evidence.forged = {
      id: "forged",
      kind: "assumption",
      description: "没有进入提交账本的伪造证据。",
      sourceId: null,
      step: cognitionTampered.step,
    };
    cognitionTampered.agents.keeper.belief.claims.forged = {
      id: "forged",
      subjectId: "self",
      predicate: "forged_claim",
      value: { kind: "boolean", value: true },
      description: "没有进入提交账本的伪造认知。",
      stance: "believed",
      confidence: 1,
      evidenceIds: ["forged"],
    };
    expect(() => validateSimulationState(cognitionTampered, true, true))
      .toThrow("does not match replayed committed cognition");

    const playerInputTampered = structuredClone(result.state);
    playerInputTampered.player.intent!.goal = "伪造目标";
    playerInputTampered.player.intent!.inputs[0].text = "伪造目标";
    playerInputTampered.player.intent!.latestInput.text = "伪造目标";
    expect(() => validateSimulationState(playerInputTampered, true, true))
      .toThrow("does not match replayed committed cognition and input ledger");

    const initialActionDependent = structuredClone(result.state);
    const initialActionStep = initialActionDependent.history[0];
    initialActionStep.checkRequests[0].causes = [{
      kind: "action",
      id: initialActionStep.initialActions.find((action) => action.actorId === "keeper")!.id,
    }];
    const initialActionPayload = Object.fromEntries(
      Object.entries(initialActionStep).filter(([key]) => key !== "contentHash"),
    );
    initialActionStep.contentHash = contentHash(initialActionPayload);
    expect(() => validateSimulationState(initialActionDependent, true, true))
      .toThrow("references unknown action");

    const claimRebound = structuredClone(result.state);
    const apparent = claimRebound.history[0].reactionRequests[0].stimulus.apparentClaims[0];
    claimRebound.agents.keeper.belief.claims[apparent.id] = {
      id: apparent.id,
      subjectId: "self",
      predicate: "forged-binding",
      value: { kind: "text", value: "篡改" },
      description: "试图把历史 claim id 绑定到不同语义。",
      stance: "believed",
      confidence: 1,
      evidenceIds: [],
    };
    expect(() => validateSimulationState(claimRebound, true, true))
      .toThrow("does not match replayed committed cognition");

    const localIdentityReused = structuredClone(result.state);
    const localReuseStep = localIdentityReused.history[0];
    localReuseStep.observations.find((observation) =>
      observation.kind === "outcome" && observation.observerId === "keeper")!.introductions.push({
      localEntity: {
        id: "speaker",
        name: "重复说话者",
        description: "试图在同一历史中重新绑定已引入的局部身份。",
        status: "observed",
      },
      canonicalEntityId: "player",
    });
    const localReusePayload = Object.fromEntries(
      Object.entries(localReuseStep).filter(([key]) => key !== "contentHash"),
    );
    localReuseStep.contentHash = contentHash(localReusePayload);
    expect(() => validateSimulationState(localIdentityReused, true, true))
      .toThrow("reuses local identity speaker");
  });

  it("rejects remote shouting without a channel and makes no reaction model call", async () => {
    const initial = reactionState(["keeper"], true);
    let truthCalls = 0;
    let reactionCalls = 0;
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        revision: number;
        jointActions: AgentActionProposal[];
        agentEpistemics: Record<string, unknown>;
        validationIssues: Array<{ message: string }>;
        agent: { id: string };
        originalAction?: AgentActionProposal;
      };
      if (profileId !== "truth-engine") {
        if (context.originalAction) reactionCalls += 1;
        return emptyMindOutput(context.agent.id, context.revision);
      }
      truthCalls += 1;
      if (context.validationIssues.length === 0) {
        const playerAction = context.jointActions.find((action) => action.actorId === "player")!;
        return {
          kind: "request_reactions",
          requests: [{
            agentId: "keeper",
            stimulus: stimulus("keeper", playerAction.id),
            basis: [{ kind: "shared_placement", placementId: "room" }],
          }],
        };
      }
      expect(context.validationIssues[0].message).toContain("shared direct placement");
      return { kind: "transition", proposal: outcomeTransition(context) };
    });
    const engine = new SimulationEngine(
      reactionDefinition(initial), new TruthEngine(provider), new AgentMind(provider),
    );
    engine.beginPlayerIntent("隔着十万八千里直接喊 keeper");

    const result = await engine.step();

    expect(truthCalls).toBe(2);
    expect(reactionCalls).toBe(0);
    expect(result.committed.reactionRequests).toEqual([]);
    expect(result.committed.initialActions).toEqual(result.committed.actions);
  });

  it("opens a remote reaction only when an Agent-accessible communication fact exists", async () => {
    const initial = reactionState(["keeper"], true);
    initial.truth.facts["pigeon-channel"] = {
      id: "pigeon-channel",
      subjectId: "keeper",
      predicate: "communication_channel",
      value: { kind: "text", value: "carrier-pigeon-from-player" },
      description: "守门人能收到旅人的飞鸽传书。",
      access: { kind: "agents", agentIds: ["keeper"] },
      provenance: [{ kind: "law", id: "time" }],
    };
    let truthCalls = 0;
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        revision: number;
        jointActions: AgentActionProposal[];
        agentEpistemics: Record<string, unknown>;
        agent: { id: string };
        originalAction?: AgentActionProposal;
      };
      if (profileId === "truth-engine") {
        truthCalls += 1;
        if (truthCalls === 1) {
          const playerAction = context.jointActions.find((action) => action.actorId === "player")!;
          return {
            kind: "request_reactions",
            requests: [{
              agentId: "keeper",
              stimulus: stimulus("keeper", playerAction.id),
              basis: [{ kind: "fact", factId: "pigeon-channel" }],
            }],
          };
        }
        return { kind: "transition", proposal: outcomeTransition(context) };
      }
      if (context.originalAction) {
        return { kind: "keep" };
      }
      return emptyMindOutput(context.agent.id, context.revision);
    });
    const engine = new SimulationEngine(
      reactionDefinition(initial), new TruthEngine(provider), new AgentMind(provider),
    );
    engine.beginPlayerIntent("飞鸽传书给 keeper：请回信");

    const result = await engine.step();

    expect(result.committed.reactionRequests[0].basis).toEqual([{ kind: "fact", factId: "pigeon-channel" }]);
    expect(result.committed.reactionDecisions[0].kind).toBe("keep");
    expect(result.committed.actions.find((action) => action.actorId === "keeper")?.id)
      .toBe(result.committed.initialActions.find((action) => action.actorId === "keeper")?.id);
    const corrupted = structuredClone(result.state);
    corrupted.history[0].actions.find((action) => action.actorId === "keeper")!.rawText = "被篡改的 keep 行动";
    const payload = Object.fromEntries(
      Object.entries(corrupted.history[0]).filter(([key]) => key !== "contentHash"),
    );
    corrupted.history[0].contentHash = contentHash(payload);
    expect(() => validateSimulationState(corrupted, true, true)).toThrow("invalid reaction decision");
  });

  it("rejects an accessible public fact that is unrelated to either reaction participant", async () => {
    const initial = reactionState(["keeper"], true);
    initial.truth.facts.weather = {
      id: "weather",
      subjectId: "room",
      predicate: "weather",
      value: { kind: "text", value: "clear" },
      description: "庭院天气晴朗。",
      access: { kind: "public" },
      provenance: [{ kind: "law", id: "time" }],
    };
    let reactionCalls = 0;
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        revision: number;
        jointActions: AgentActionProposal[];
        agentEpistemics: Record<string, unknown>;
        validationIssues: Array<{ message: string }>;
        agent: { id: string };
        originalAction?: AgentActionProposal;
      };
      if (profileId !== "truth-engine") {
        if (context.originalAction) reactionCalls += 1;
        return emptyMindOutput(context.agent.id, context.revision);
      }
      if (context.validationIssues.length > 0) {
        expect(context.validationIssues[0].message).toContain("unrelated to either participant");
        return { kind: "transition", proposal: outcomeTransition(context) };
      }
      const playerAction = context.jointActions.find((action) => action.actorId === "player")!;
      return {
        kind: "request_reactions",
        requests: [{
          agentId: "keeper",
          stimulus: stimulus("keeper", playerAction.id),
          basis: [{ kind: "fact", factId: "weather" }],
        }],
      };
    });
    const engine = new SimulationEngine(
      reactionDefinition(initial), new TruthEngine(provider), new AgentMind(provider),
    );
    engine.beginPlayerIntent("把晴朗天气当成远程喊话渠道");

    const result = await engine.step();

    expect(reactionCalls).toBe(0);
    expect(result.committed.reactionRequests).toEqual([]);
  });

  it("never calls AgentMind.react when Truth Engine does not request a reaction", async () => {
    const initial = reactionState();
    let agentCalls = 0;
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        revision: number;
        jointActions: AgentActionProposal[];
        agentEpistemics: Record<string, unknown>;
        agent: { id: string };
        originalAction?: AgentActionProposal;
      };
      if (profileId === "truth-engine") return { kind: "transition", proposal: outcomeTransition(context) };
      agentCalls += 1;
      expect(context.originalAction).toBeUndefined();
      return emptyMindOutput(context.agent.id, context.revision);
    });
    const engine = new SimulationEngine(
      reactionDefinition(initial), new TruthEngine(provider), new AgentMind(provider),
    );
    engine.beginPlayerIntent("安静地等待");

    const result = await engine.step();

    expect(agentCalls).toBe(1);
    expect(result.committed.reactionRequests).toEqual([]);
  });

  it("uses a successful perception check as a remote reaction basis", async () => {
    const initial = reactionState(["keeper"], true);
    let truthCalls = 0;
    let reactionCalls = 0;
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        revision: number;
        jointActions: AgentActionProposal[];
        agentEpistemics: Record<string, unknown>;
        checkResults: Array<{ requestId: string; succeeded: boolean }>;
        agent: { id: string };
        originalAction?: AgentActionProposal;
      };
      if (profileId !== "truth-engine") {
        if (context.originalAction) {
          reactionCalls += 1;
          return {
            kind: "replace",
            replacementAction: {
              rawText: "守门人回应刚感知到的远方讯息",
              goal: "回应远方讯息",
              means: null,
              targetIds: [],
            },
          };
        }
        return emptyMindOutput(context.agent.id, context.revision);
      }
      truthCalls += 1;
      const playerAction = context.jointActions.find((action) => action.actorId === "player")!;
      if (truthCalls === 1) {
        return {
          kind: "request_checks",
          requests: [{
            id: "hear-distant-message",
            actorId: "keeper",
            targetId: null,
            ratingId: "reflex:keeper",
            modifier: 3,
            modifierSources: [{ kind: "rating", id: "reflex:keeper", amount: 3 }],
            dc: 0,
            mode: "normal",
            stakes: "成功则及时感知远方讯息。",
            visibility: "hidden",
            phase: "perception",
            causes: [
              { kind: "action", id: playerAction.id },
              { kind: "law", id: "time" },
            ],
          }],
        };
      }
      if (truthCalls === 2) {
        expect(context.checkResults[0].succeeded).toBe(true);
        return {
          kind: "request_reactions",
          requests: [{
            agentId: "keeper",
            stimulus: stimulus("keeper", playerAction.id),
            basis: [{ kind: "perception_check", checkId: context.checkResults[0].requestId }],
          }],
        };
      }
      return { kind: "transition", proposal: outcomeTransition(context) };
    });
    const engine = new SimulationEngine(
      reactionDefinition(initial), new TruthEngine(provider), new AgentMind(provider),
    );
    engine.beginPlayerIntent("使用世界允许的远距感知发送讯息");

    const result = await engine.step();

    expect(reactionCalls).toBe(1);
    expect(result.committed.checkRequests[0].phase).toBe("perception");
    expect(result.committed.reactionRequests[0].basis[0]).toEqual({
      kind: "perception_check", checkId: result.committed.checkRequests[0].id,
    });
    expect(result.committed.initialActions.find((action) => action.actorId === "keeper")?.id)
      .toMatch(/^rt:action:[a-f0-9]{64}$/);
    expect(result.committed.actions.find((action) => action.actorId === "keeper")?.id)
      .toMatch(/^rt:action:[a-f0-9]{64}$/);

    const finalActionDependent = structuredClone(result.state);
    const finalActionStep = finalActionDependent.history[0];
    finalActionStep.checkRequests[0].causes = [{
      kind: "action",
      id: finalActionStep.actions.find((action) => action.actorId === "keeper")!.id,
    }];
    const finalActionPayload = Object.fromEntries(
      Object.entries(finalActionStep).filter(([key]) => key !== "contentHash"),
    );
    finalActionStep.contentHash = contentHash(finalActionPayload);
    expect(() => validateSimulationState(finalActionDependent, true, true))
      .toThrow("references unknown action");
  });

  it("keeps the reaction window closed after resolution starts and forbids a second round", async () => {
    const roles: string[] = [];
    let routingCalls = 0;
    let reactionCalls = 0;
    const provider = new ScriptedModelProvider(({ role, prompt }) => {
      roles.push(role);
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        revision: number;
        jointActions: AgentActionProposal[];
        agentEpistemics: Record<string, unknown>;
        checkResults: unknown[];
        agent: { id: string };
        originalAction?: AgentActionProposal;
      };
      if (role === "truth-perception") return { kind: "done" };
      if (role === "truth-reaction-routing") {
        routingCalls += 1;
        const playerAction = context.jointActions.find((action) => action.actorId === "player")!;
        return {
          requests: [{
            agentId: "keeper",
            stimulus: stimulus("keeper", playerAction.id),
            basis: [{ kind: "shared_placement", placementId: "room" }],
          }],
        };
      }
      if (role === "truth-resolution") {
        if (context.checkResults.length > 0) return { kind: "done" };
        const playerAction = context.jointActions.find((action) => action.actorId === "player")!;
        return {
          kind: "request_checks",
          requests: [{
            id: "resolution-only",
            actorId: "player",
            targetId: null,
            ratingId: null,
            modifier: 0,
            modifierSources: [],
            dc: 0,
            mode: "normal",
            stakes: "反应阶段已经永久结束。",
            visibility: "hidden",
            phase: "resolution",
            causes: [{ kind: "action", id: playerAction.id }],
          }],
        };
      }
      if (role === "truth-transition") return outcomeTransition(context);
      if (role === "causal-verifier") return { verdict: "accept", findings: [] };
      if (role === "agent-reaction") {
        reactionCalls += 1;
        return { kind: "keep" };
      }
      return emptyMindOutput(context.agent.id, context.revision);
    }, undefined, false);
    const engine = new SimulationEngine(
      reactionDefinition(reactionState()), new TruthEngine(provider), new AgentMind(provider),
    );
    engine.beginPlayerIntent("测试反应窗口阶段门禁");
    const result = await engine.step();

    expect(routingCalls).toBe(1);
    expect(reactionCalls).toBe(1);
    expect(result.committed.reactionRequests).toHaveLength(1);
    expect(result.committed.checkRequests).toEqual([
      expect.objectContaining({ id: expect.stringMatching(/^rt:check:[a-f0-9]{64}$/), phase: "resolution" }),
    ]);
    expect(roles.indexOf("truth-reaction-routing")).toBeLessThan(roles.indexOf("truth-resolution"));
    expect(roles.filter((role) => role === "truth-reaction-routing")).toHaveLength(1);
  });

  it("rolls back state and RNG when a replacement action or CharacterPatch stays invalid", async () => {
    const invalidReplacementState = reactionState();
    const invalidReplacementProvider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        revision: number;
        jointActions: AgentActionProposal[];
        agentEpistemics: Record<string, unknown>;
        agent: { id: string };
        originalAction?: AgentActionProposal;
      };
      if (profileId === "truth-engine") {
        const playerAction = context.jointActions.find((action) => action.actorId === "player")!;
        return {
          kind: "request_reactions",
          requests: [{
            agentId: "keeper",
            stimulus: stimulus("keeper", playerAction.id),
            basis: [{ kind: "shared_placement", placementId: "room" }],
          }],
        };
      }
      if (context.originalAction) {
        return {
          kind: "replace",
          replacementAction: {
            rawText: "越权替玩家行动",
            goal: "非法替换",
            means: null,
            targetIds: ["unknown-target"],
          },
        };
      }
      return emptyMindOutput(context.agent.id, context.revision);
    });
    const replacementEngine = new SimulationEngine(
      reactionDefinition(invalidReplacementState),
      new TruthEngine(invalidReplacementProvider),
      new AgentMind(invalidReplacementProvider),
    );
    replacementEngine.beginPlayerIntent("触发非法 replacement");
    await expect(replacementEngine.step()).rejects.toThrow("reaction execution failed");
    expect(replacementEngine.snapshot).toMatchObject({ revision: 0, step: 0, truth: { rng: { draws: 0 } } });

    const invalidCharacterState = reactionState();
    invalidCharacterState.agents.keeper.character.traits.cautious = {
      id: "cautious",
      description: "谨慎",
      strength: 0.5,
      status: "active",
      createdAtStep: 0,
      updatedAtStep: 0,
      evidenceIds: [],
    };
    invalidCharacterState.agents.keeper.belief.evidence.existing = {
      id: "existing", kind: "observation", description: "旧证据", sourceId: null, step: 0,
    };
    const invalidCharacterProvider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        revision: number;
        jointActions: AgentActionProposal[];
        agentEpistemics: Record<string, unknown>;
        observations: ObservationPacket[];
        agent: { id: string };
      };
      if (profileId === "truth-engine") return { kind: "transition", proposal: outcomeTransition(context) };
      return {
        ...emptyMindOutput(context.agent.id, context.revision),
        characterPatch: {
          agentId: context.agent.id,
          baseRevision: context.revision,
          operations: [{
            kind: "update_trait",
            id: "cautious",
            strength: 0.9,
            sourceObservationIds: [context.observations[0].id],
            evidenceIds: ["existing"],
          }],
        },
      };
    });
    const characterEngine = new SimulationEngine(
      reactionDefinition(invalidCharacterState),
      new TruthEngine(invalidCharacterProvider),
      new AgentMind(invalidCharacterProvider),
    );
    characterEngine.beginPlayerIntent("触发非法 CharacterPatch");
    await expect(characterEngine.step()).rejects.toThrow("AgentMind");
    expect(characterEngine.snapshot).toMatchObject({ revision: 0, step: 0, truth: { rng: { draws: 0 } } });
    expect(characterEngine.snapshot.agents.keeper.character.traits.cautious.strength).toBe(0.5);
  });
});
