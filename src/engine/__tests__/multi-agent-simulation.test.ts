import { describe, expect, it } from "vitest";
import { AgentMind } from "../agent-mind";
import type { AgentState, SimulationState, TransitionProposal } from "../model";
import { ScriptedModelProvider } from "../model-provider";
import { createSeededRng } from "../random";
import { SimulationEngine } from "../simulation";
import { TruthEngine } from "../truth-engine";
import { createEmptyCharacter } from "../transaction";
import type { WorldDefinition } from "../world-definition";

function agent(id: string): AgentState {
  return {
    id,
    entityId: id,
    modelProfileId: "agent-default",
    character: createEmptyCharacter(`${id} 的人格`),
    belief: {
      localEntities: {
        self: { id: "self", name: "我", description: `${id} 自己`, status: "observed" },
      },
      claims: {},
      evidence: {},
    },
    bindings: { self: { localEntityId: "self", canonicalEntityIds: [id] } },
    nextAction: {
      id: `action:${id}:0`,
      actorId: id,
      baseRevision: 0,
      rawText: `${id} 自由地观察周围`,
      goal: "理解环境",
      targetIds: [],
    },
  };
}

function state(agentIds = ["agent-a", "agent-b"]): SimulationState {
  const entities: SimulationState["truth"]["entities"] = {
    player: {
      id: "player",
      kind: "person",
      name: "玩家",
      description: "玩家角色",
      lifecycle: "active",
      createdAtStep: 0,
    },
  };
  const placements: SimulationState["truth"]["placements"] = { player: null };
  const agents: SimulationState["agents"] = {};
  for (const id of agentIds) {
    entities[id] = {
      id,
      kind: "person",
      name: id,
      description: `${id} 的真实描述`,
      lifecycle: "active",
      createdAtStep: 0,
    };
    placements[id] = null;
    agents[id] = agent(id);
  }
  return {
    schemaVersion: 2,
    worldId: "simulation",
    lawIds: ["time-passes"],
    revision: 0,
    step: 0,
    truth: {
      elapsedSeconds: 0,
      rng: createSeededRng(123),
      events: [],
      entities,
      placements,
      facts: {},
      mechanics: {
        meters: {},
        quantities: {},
        ratings: {
          resolve: { id: "resolve", name: "决心", min: -5, max: 10 },
        },
      },
      meters: {},
      quantities: {},
      ratings: {
        "resolve:player": {
          id: "resolve:player",
          definitionId: "resolve",
          entityId: "player",
          value: 2,
        },
      },
    },
    agents,
    player: {
      entityId: "player",
      knowledge: { localEntities: {}, claims: {}, evidence: {}, observationIds: [] },
      bindings: {},
    },
    history: [],
    bootstrapModelAudits: [],
  };
}

function definition(initialState = state()): WorldDefinition {
  return {
    id: "simulation",
    name: "联合仿真",
    description: "验证多 Agent 同时行动的测试世界。",
    laws: [{ id: "time-passes", text: "每个世界步骤必须推进时间。", severity: "hard" }],
    disclosure: { defaultCheckVisibility: "full" },
    rulePackages: [{
      id: "core-d20",
      version: "1.0.0",
      config: { opposedChecks: true, damageUsesMeters: true },
    }],
    initialState,
  };
}

function observations(agentIds: string[], step: number, eventId: string) {
  return ["player", ...agentIds].map((observerId) => ({
    id: `observation:${observerId}:${step}`,
    observerId,
    step,
    kind: "outcome" as const,
    summary: observerId === "player" ? "你感知到时间流逝。" : `${observerId} 感知到时间流逝。`,
    introductions: [],
    apparentClaims: [],
    sourceEventIds: [eventId],
  }));
}

function simpleTransition(
  jointActionIds: string[],
  agentIds: string[],
  options: {
    spawn?: boolean;
    intentStatus?: "active" | "completed";
    baseRevision?: number;
    step?: number;
  } = {},
): TransitionProposal {
  const baseRevision = options.baseRevision ?? 0;
  const nextStep = (options.step ?? 0) + 1;
  const eventId = `event:step:${nextStep}`;
  const operations: TransitionProposal["operations"] = [
    {
      kind: "advance_time",
      seconds: 6,
      causes: [{ kind: "law", id: "time-passes" }],
    },
  ];
  const targetAgentIds = [...agentIds];
  if (options.spawn) {
    operations.unshift(
      {
        kind: "create_entity",
        entity: {
          id: "newborn",
          kind: "person",
          name: "新生者",
          description: "在世界步骤中出生的自主实体。",
          lifecycle: "active",
          createdAtStep: nextStep,
        },
        placementId: null,
        causes: [{ kind: "event", id: eventId }],
      },
      {
        kind: "create_agent",
        agent: {
          id: "newborn",
          entityId: "newborn",
          modelProfileId: "agent-default",
          character: createEmptyCharacter("刚刚开始感知世界"),
          belief: {
            localEntities: {
              self: { id: "self", name: "我", description: "新生者自己", status: "observed" },
            },
            claims: {},
            evidence: {},
          },
          bindings: { self: { localEntityId: "self", canonicalEntityIds: ["newborn"] } },
        },
        causes: [{ kind: "event", id: eventId }],
      },
    );
    targetAgentIds.push("newborn");
  }
  return {
    baseRevision,
    outcomes: jointActionIds.map((proposalId) => ({
      proposalId,
      status: "succeeded",
      summary: "行动得到联合裁决。",
      causeRefs: [{ kind: "action", id: proposalId }],
      knownAlternatives: [],
    })),
    operations,
    events: [
      {
        id: eventId,
        step: nextStep,
        description: "世界共同向前推进。",
        impact: "ordinary",
        causes: [{ kind: "law", id: "time-passes" }],
      },
    ],
    observations: observations(targetAgentIds, nextStep, eventId),
    intentStatus: options.intentStatus ?? "completed",
    requiresPlayerDecision: false,
  };
}

function mindOutput(agentId: string, revision: number) {
  return {
    beliefPatch: { agentId, baseRevision: revision, operations: [] },
    characterPatch: { agentId, baseRevision: revision, operations: [] },
    nextAction: {
      id: `action:${agentId}:${revision}`,
      actorId: agentId,
      baseRevision: revision,
      rawText: `${agentId} 在新世界状态中继续自由行动`,
      goal: "持续理解世界",
      targetIds: [],
    },
  };
}

describe("multi-agent simulation", () => {
  it("resolves every agent and the player from one shared snapshot", async () => {
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision?: number;
        jointActions?: Array<{ id: string; actorId: string }>;
        revision?: number;
        agent?: { id: string };
      };
      if (profileId === "truth-engine") {
        return {
          kind: "transition",
          proposal: simpleTransition(
            context.jointActions!.map((action) => action.id),
            ["agent-a", "agent-b"],
          ),
        };
      }
      return mindOutput(context.agent!.id, context.revision!);
    });
    const engine = new SimulationEngine(
      definition(),
      new TruthEngine(provider),
      new AgentMind(provider),
    );
    engine.beginPlayerIntent("我尝试做一件动作目录里从未配置过的事情");

    const result = await engine.step();

    expect(result.committed.actions).toHaveLength(3);
    expect(result.committed.actions.every((action) => action.baseRevision === 0)).toBe(true);
    expect(result.committed.outcomes).toHaveLength(3);
    expect(result.state.revision).toBe(1);
    expect(result.state.history).toHaveLength(1);
    expect(result.state.truth.elapsedSeconds).toBe(6);
    expect(result.state.agents["agent-a"].nextAction?.baseRevision).toBe(1);
  });

  it("commits a check only after its DC and stakes were requested", async () => {
    let truthCall = 0;
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        jointActions?: Array<{ id: string; actorId: string }>;
        checkResults?: Array<{ requestId: string; total: number }>;
        revision?: number;
        agent?: { id: string };
      };
      if (profileId !== "truth-engine") return mindOutput(context.agent!.id, context.revision!);
      truthCall += 1;
      if (truthCall === 1) {
        return {
          kind: "request_checks",
          requests: [
            {
              id: "unknown-action-check",
              actorId: "player",
              ratingId: "resolve:player",
              modifier: 2,
              modifierSources: [{ id: "resolve:player", amount: 2 }],
              dc: 15,
              mode: "normal",
              stakes: "成功则推进未知行动，失败则留下可观察后果",
              visibility: "full",
              phase: "resolution",
              causes: [{
                kind: "action",
                id: context.jointActions!.find((action) => action.actorId === "player")!.id,
              }],
            },
          ],
        };
      }
      expect(context.checkResults?.[0].requestId).toBe("unknown-action-check");
      const transition = simpleTransition(
        context.jointActions!.map((action) => action.id),
        ["agent-a", "agent-b"],
      );
      transition.outcomes[0].causeRefs.push({ kind: "check", id: "unknown-action-check" });
      return { kind: "transition", proposal: transition };
    });
    const engine = new SimulationEngine(definition(), new TruthEngine(provider), new AgentMind(provider));
    engine.beginPlayerIntent("尝试未知行动");

    const result = await engine.step();

    expect(truthCall).toBe(2);
    expect(result.committed.checks).toHaveLength(1);
    expect(result.committed.checks[0].dc).toBe(15);
    expect(result.state.truth.rng.draws).toBe(1);
  });

  it("repairs checks that exceed the world's maximum disclosure policy", async () => {
    let truthCall = 0;
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        jointActions?: Array<{ id: string; actorId: string }>;
        checkResults?: Array<{ requestId: string }>;
        revision?: number;
        agent?: { id: string };
      };
      if (profileId !== "truth-engine") return mindOutput(context.agent!.id, context.revision!);
      truthCall += 1;
      if (!context.checkResults?.length) {
        return {
          kind: "request_checks",
          requests: [{
            id: "disclosure-check",
            actorId: "player",
            ratingId: "resolve:player",
            modifier: 2,
            modifierSources: [{ id: "resolve:player", amount: 2 }],
            dc: 12,
            mode: "normal",
            stakes: "只公开检定结果。",
            visibility: truthCall === 1 ? "full" : "result_only",
            phase: "resolution",
            causes: [{
              kind: "action",
              id: context.jointActions!.find((action) => action.actorId === "player")!.id,
            }],
          }],
        };
      }
      return {
        kind: "transition",
        proposal: simpleTransition(context.jointActions!.map((action) => action.id), ["agent-a", "agent-b"]),
      };
    });
    const world = definition();
    world.disclosure.defaultCheckVisibility = "result_only";
    const engine = new SimulationEngine(world, new TruthEngine(provider), new AgentMind(provider));
    engine.beginPlayerIntent("进行只公开结果的检定");

    const result = await engine.step();

    expect(truthCall).toBe(3);
    expect(result.committed.checkRequests[0].visibility).toBe("result_only");
    expect(result.committed.modelAudits[0].repairAttempts).toBe(1);
  });

  it("rejects an invented law-based modifier and accepts only structured numeric sources", async () => {
    let truthCall = 0;
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        jointActions?: Array<{ id: string; actorId: string }>;
        checkResults?: Array<{ requestId: string }>;
        revision?: number;
        agent?: { id: string };
      };
      if (profileId !== "truth-engine") return mindOutput(context.agent!.id, context.revision!);
      truthCall += 1;
      if (!context.checkResults?.length) {
        const repaired = truthCall > 1;
        return {
          kind: "request_checks",
          requests: [{
            id: "verified-modifier-check",
            actorId: "player",
            ratingId: "resolve:player",
            modifier: repaired ? 2 : 99,
            modifierSources: repaired
              ? [{ id: "resolve:player", amount: 2 }]
              : [{ id: "time-passes", amount: 99 }],
            dc: 12,
            mode: "normal",
            stakes: "只有结构化数值可以影响结果。",
            visibility: "result_only",
            phase: "resolution",
            causes: [{
              kind: "action",
              id: context.jointActions!.find((action) => action.actorId === "player")!.id,
            }],
          }],
        };
      }
      return {
        kind: "transition",
        proposal: simpleTransition(context.jointActions!.map((action) => action.id), ["agent-a", "agent-b"]),
      };
    });
    const engine = new SimulationEngine(definition(), new TruthEngine(provider), new AgentMind(provider));
    engine.beginPlayerIntent("尝试夸大检定加值");

    const result = await engine.step();

    expect(truthCall).toBe(3);
    expect(result.committed.checkRequests[0].modifierSources).toEqual([{ id: "resolve:player", amount: 2 }]);
    expect(result.committed.modelAudits[0].repairAttempts).toBe(1);
  });

  it("initializes a dynamically created agent before committing the step", async () => {
    const calledAgents: string[] = [];
    const initial = state();
    initial.truth.entities["ordinary-item"] = {
      id: "ordinary-item",
      kind: "item",
      name: "普通物品",
      description: "没有自主心智的物品。",
      lifecycle: "active",
      createdAtStep: 0,
    };
    initial.truth.placements["ordinary-item"] = null;
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        jointActions?: Array<{ id: string }>;
        baseRevision?: number;
        step?: number;
        revision?: number;
        agent?: { id: string };
      };
      if (profileId === "truth-engine") {
        return {
          kind: "transition",
          proposal: simpleTransition(
            context.jointActions!.map((action) => action.id),
            context.baseRevision === 0 ? ["agent-a", "agent-b"] : ["agent-a", "agent-b", "newborn"],
            {
              spawn: context.baseRevision === 0,
              baseRevision: context.baseRevision,
              step: context.step,
            },
          ),
        };
      }
      calledAgents.push(context.agent!.id);
      return mindOutput(context.agent!.id, context.revision!);
    });
    const engine = new SimulationEngine(definition(initial), new TruthEngine(provider), new AgentMind(provider));
    engine.beginPlayerIntent("见证一个新生命诞生");

    const result = await engine.step();

    expect(calledAgents.sort()).toEqual(["agent-a", "agent-b", "newborn"]);
    expect(result.state.agents.newborn.nextAction?.baseRevision).toBe(1);
    expect(result.committed.beliefPatches).toHaveLength(3);
    expect(result.committed.actions.some((action) => action.actorId === "newborn")).toBe(false);

    engine.beginPlayerIntent("观察新生者下一步行动");
    const next = await engine.step();
    expect(next.committed.actions.some((action) => action.actorId === "newborn")).toBe(true);
    expect(calledAgents.filter((agentId) => agentId === "newborn")).toHaveLength(2);
    expect(calledAgents).not.toContain("ordinary-item");
  });

  it("does not expose canonical identity bindings to AgentMind", async () => {
    const initial = state(["agent-a"]);
    initial.agents["agent-a"].belief.localEntities.masked = {
      id: "masked",
      name: "陌生人",
      description: "身份未知的人。",
      status: "observed",
    };
    initial.agents["agent-a"].bindings.masked = {
      localEntityId: "masked",
      canonicalEntityIds: ["player"],
    };
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        jointActions?: Array<{ id: string }>;
        revision?: number;
        agent?: { id: string };
      };
      if (profileId === "truth-engine") {
        return {
          kind: "transition",
          proposal: simpleTransition(context.jointActions!.map((action) => action.id), ["agent-a"]),
        };
      }
      expect(prompt).not.toContain("canonicalEntityIds");
      return mindOutput(context.agent!.id, context.revision!);
    });
    const engine = new SimulationEngine(definition(initial), new TruthEngine(provider), new AgentMind(provider));
    engine.beginPlayerIntent("保持身份秘密");

    await engine.step();
  });

  it("gives Truth Engine each Agent belief alongside truth so it can resolve mistaken actions", async () => {
    const initial = state(["agent-a"]);
    initial.truth.facts["masked-truth"] = {
      id: "masked-truth",
      subjectId: "player",
      predicate: "identity",
      value: { kind: "text", value: "traveler" },
      description: "此人的真实身份是旅人。",
      access: { kind: "private" },
      provenance: [{ kind: "law", id: "time-passes" }],
    };
    initial.agents["agent-a"].belief.localEntities.masked = {
      id: "masked",
      name: "可疑者",
      description: "我认为这是潜入者。",
      status: "observed",
    };
    initial.agents["agent-a"].belief.claims["masked-identity"] = {
      id: "masked-identity",
      subjectId: "masked",
      predicate: "identity",
      value: { kind: "text", value: "infiltrator" },
      description: "我相信此人是潜入者。",
      stance: "believed",
      confidence: 0.9,
      evidenceIds: [],
    };
    initial.agents["agent-a"].bindings.masked = {
      localEntityId: "masked",
      canonicalEntityIds: ["player"],
    };
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        canonicalTruth?: { facts: Record<string, { value: { value: string } }> };
        agentEpistemics?: Record<string, { belief: { claims: Record<string, { value: { value: string } }> } }>;
        jointActions?: Array<{ id: string }>;
        revision?: number;
        agent?: { id: string };
      };
      if (profileId !== "truth-engine") return mindOutput(context.agent!.id, context.revision!);
      expect(context.canonicalTruth?.facts["masked-truth"].value.value).toBe("traveler");
      expect(context.agentEpistemics?.["agent-a"].belief.claims["masked-identity"].value.value)
        .toBe("infiltrator");
      return {
        kind: "transition",
        proposal: simpleTransition(context.jointActions!.map((action) => action.id), ["agent-a"]),
      };
    });
    const engine = new SimulationEngine(definition(initial), new TruthEngine(provider), new AgentMind(provider));
    engine.beginPlayerIntent("让误认继续影响行动");

    await engine.step();
  });

  it("rolls back the whole step when any AgentMind cannot produce a valid action", async () => {
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as { jointActions?: Array<{ id: string }> };
      if (profileId === "truth-engine") {
        return {
          kind: "transition",
          proposal: simpleTransition(
            context.jointActions!.map((action) => action.id),
            ["agent-a", "agent-b"],
          ),
        };
      }
      return { invalid: true };
    });
    const engine = new SimulationEngine(definition(), new TruthEngine(provider), new AgentMind(provider));
    engine.beginPlayerIntent("触发一次原子失败");

    await expect(engine.step()).rejects.toThrow("AgentMind");
    expect(engine.snapshot.revision).toBe(0);
    expect(engine.snapshot.truth.elapsedSeconds).toBe(0);
    expect(engine.snapshot.history).toHaveLength(0);
  });

  it("rejects circular or forward event causality instead of accepting a self-justifying world", async () => {
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        jointActions?: Array<{ id: string }>;
        revision?: number;
        agent?: { id: string };
      };
      if (profileId !== "truth-engine") return mindOutput(context.agent!.id, context.revision!);
      const transition = simpleTransition(
        context.jointActions!.map((action) => action.id),
        ["agent-a", "agent-b"],
      );
      transition.events = [
        {
          id: "event:first",
          step: 1,
          description: "第一个事件错误地依赖未来事件。",
          impact: "ordinary",
          causes: [{ kind: "event", id: "event:future" }],
        },
        {
          id: "event:future",
          step: 1,
          description: "未来事件。",
          impact: "ordinary",
          causes: [{ kind: "law", id: "time-passes" }],
        },
      ];
      transition.observations = transition.observations.map((observation) => ({
        ...observation,
        sourceEventIds: ["event:first"],
      }));
      return { kind: "transition", proposal: transition };
    });
    const engine = new SimulationEngine(definition(), new TruthEngine(provider), new AgentMind(provider));
    engine.beginPlayerIntent("制造循环因果");

    await expect(engine.step()).rejects.toThrow("unknown event event:future");
    expect(engine.snapshot).toMatchObject({ revision: 0, step: 0 });
  });
});
