import { describe, expect, it } from "vitest";
import { AgentMind } from "../agent-mind";
import type { AgentState, SimulationState, TransitionProposal } from "../model";
import { ScriptedModelProvider } from "../model-provider";
import { createSeededRng } from "../random";
import { SimulationEngine } from "../simulation";
import { TruthEngine } from "../truth-engine";
import type { WorldDefinition } from "../world-definition";

function agent(id: string): AgentState {
  return {
    id,
    entityId: id,
    modelProfileId: "agent-default",
    persona: `${id} 的人格`,
    goals: ["继续生活"],
    belief: { localEntities: {}, claims: {}, evidence: {} },
    bindings: {},
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
    schemaVersion: 1,
    worldId: "simulation",
    revision: 0,
    step: 0,
    truth: {
      elapsedSeconds: 0,
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
    rng: createSeededRng(123),
    events: [],
    history: [],
  };
}

function definition(initialState = state()): WorldDefinition {
  return {
    id: "simulation",
    name: "联合仿真",
    description: "验证多 Agent 同时行动的测试世界。",
    laws: [{ id: "time-passes", text: "每个世界步骤必须推进时间。", severity: "hard" }],
    disclosure: { defaultCheckVisibility: "full" },
    initialState,
  };
}

function observations(agentIds: string[], step: number, eventId: string) {
  return ["player", ...agentIds].map((observerId) => ({
    id: `observation:${observerId}:${step}`,
    observerId,
    step,
    summary: `${observerId} 感知到时间流逝。`,
    introductions: [],
    apparentClaims: [],
    sourceEventIds: [eventId],
  }));
}

function simpleTransition(
  jointActionIds: string[],
  agentIds: string[],
  options: { spawn?: boolean; intentStatus?: "active" | "completed" } = {},
): TransitionProposal {
  const eventId = "event:step:1";
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
          createdAtStep: 1,
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
          persona: "刚刚开始感知世界",
          goals: ["理解自身"],
          belief: { localEntities: {}, claims: {}, evidence: {} },
          bindings: {},
        },
        causes: [{ kind: "event", id: eventId }],
      },
    );
    targetAgentIds.push("newborn");
  }
  return {
    baseRevision: 0,
    outcomes: jointActionIds.map((actionId) => ({
      actionId,
      status: "succeeded",
      summary: "行动得到联合裁决。",
      causeRefs: [{ kind: "action", id: actionId }],
      knownAlternatives: [],
    })),
    operations,
    events: [
      {
        id: eventId,
        step: 1,
        description: "世界共同向前推进。",
        causes: [{ kind: "law", id: "time-passes" }],
      },
    ],
    observations: observations(targetAgentIds, 1, eventId),
    intentStatus: options.intentStatus ?? "completed",
    requiresPlayerDecision: false,
  };
}

function mindOutput(agentId: string, revision: number) {
  return {
    beliefPatch: { agentId, baseRevision: revision, operations: [] },
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
        jointActions?: Array<{ id: string }>;
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
        jointActions?: Array<{ id: string }>;
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
              modifierSourceIds: ["resolve:player"],
              dc: 15,
              mode: "normal",
              stakes: "成功则推进未知行动，失败则留下可观察后果",
              visibility: "full",
              causes: [{ kind: "action", id: context.jointActions![0].id }],
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
    expect(result.state.rng.draws).toBe(1);
  });

  it("initializes a dynamically created agent before committing the step", async () => {
    const calledAgents: string[] = [];
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        jointActions?: Array<{ id: string }>;
        revision?: number;
        agent?: { id: string };
      };
      if (profileId === "truth-engine") {
        return {
          kind: "transition",
          proposal: simpleTransition(
            context.jointActions!.map((action) => action.id),
            ["agent-a", "agent-b"],
            { spawn: true },
          ),
        };
      }
      calledAgents.push(context.agent!.id);
      return mindOutput(context.agent!.id, context.revision!);
    });
    const engine = new SimulationEngine(definition(), new TruthEngine(provider), new AgentMind(provider));
    engine.beginPlayerIntent("见证一个新生命诞生");

    const result = await engine.step();

    expect(calledAgents.sort()).toEqual(["agent-a", "agent-b", "newborn"]);
    expect(result.state.agents.newborn.nextAction?.baseRevision).toBe(1);
    expect(result.committed.beliefPatches).toHaveLength(3);
  });

  it("does not expose canonical identity bindings to AgentMind", async () => {
    const initial = state(["agent-a"]);
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
});
