import { describe, expect, it } from "vitest";
import { AgentMind } from "../agent-mind";
import type {
  AgentActionProposal,
  AgentState,
  KnownAlternative,
  SimulationState,
  TransitionProposal,
  WorldDeltaOperation,
} from "../model";
import { ScriptedModelProvider, type ScriptedModelHandler } from "../testing/model-provider";
import { createSeededRng } from "../random";
import { SimulationEngine } from "../simulation";
import { TruthEngine } from "../truth-engine";
import { createEmptyCharacter } from "../transaction";
import type { WorldDefinition } from "../world-definition";

const laws = [
  { id: "world-law", text: "物质、能力与因果必须来自世界状态。", severity: "hard" as const },
  { id: "time-passes", text: "每个世界步骤推进时间。", severity: "hard" as const },
  { id: "teleport-law", text: "传送消耗灵力且需要传送能力。", severity: "hard" as const },
];

function autonomousAgent(id: string): AgentState {
  return {
    id,
    entityId: id,
    modelProfileId: "agent-default",
    character: createEmptyCharacter("独立行动的世界居民"),
    belief: {
      localEntities: {
        self: { id: "self", name: "我", description: "我自己。", status: "observed" },
      },
      claims: {},
      evidence: {},
    },
    bindings: { self: { localEntityId: "self", canonicalEntityIds: [id] } },
    nextAction: {
      id: `proposal:${id}:0`,
      actorId: id,
      baseRevision: 0,
      rawText: "观察局势并继续自己的目标",
      goal: "自主生活",
      means: null,
      targetIds: [],
    },
  };
}

function acceptanceState(agentIds: string[] = []): SimulationState {
  const entities: SimulationState["truth"]["entities"] = {
    player: {
      id: "player",
      kind: "person",
      name: "旅人",
      description: "进入开放世界的旅人。",
      lifecycle: "active",
      createdAtStep: 0,
    },
    courtyard: {
      id: "courtyard",
      kind: "location",
      name: "庭院",
      description: "石门外的庭院。",
      lifecycle: "active",
      createdAtStep: 0,
    },
    destination: {
      id: "destination",
      kind: "location",
      name: "遥远大陆",
      description: "跨海的另一片大陆。",
      lifecycle: "active",
      createdAtStep: 0,
    },
    merchant: {
      id: "merchant",
      kind: "person",
      name: "云游商人",
      description: "昨日遇见的灵石商人。",
      lifecycle: "active",
      createdAtStep: 0,
    },
    gate: {
      id: "gate",
      kind: "door",
      name: "石门",
      description: "锁着的石门。",
      lifecycle: "active",
      createdAtStep: 0,
    },
    key: {
      id: "key",
      kind: "key",
      name: "铜钥匙",
      description: "外表普通的铜钥匙。",
      lifecycle: "active",
      createdAtStep: 0,
    },
    enemy: {
      id: "enemy",
      kind: "person",
      name: "拦路者",
      description: "挡住去路的敌人。",
      lifecycle: "active",
      createdAtStep: 0,
    },
    token: {
      id: "token",
      kind: "item",
      name: "争夺物",
      description: "两人同时想拿到的物品。",
      lifecycle: "active",
      createdAtStep: 0,
    },
  };
  const placements: SimulationState["truth"]["placements"] = {
    player: "courtyard",
    courtyard: null,
    destination: null,
    merchant: "courtyard",
    gate: "courtyard",
    key: "player",
    enemy: "courtyard",
    token: "courtyard",
  };
  const agents: SimulationState["agents"] = {};
  for (const id of agentIds) {
    entities[id] = {
      id,
      kind: "person",
      name: "世界居民",
      description: "拥有独立认知的居民。",
      lifecycle: "active",
      createdAtStep: 0,
    };
    placements[id] = "courtyard";
    agents[id] = autonomousAgent(id);
  }
  return {
    schemaVersion: 3,
    worldId: "acceptance-world",
    lawIds: laws.map((law) => law.id),
    revision: 0,
    step: 0,
    truth: {
      elapsedSeconds: 0,
      rng: createSeededRng(2026),
      events: [],
      entities,
      placements,
      facts: {
        "key-authenticity": {
          id: "key-authenticity",
          subjectId: "key",
          predicate: "authenticity",
          value: { kind: "text", value: "fake" },
          description: "铜钥匙其实是仿制品。",
          access: { kind: "private" },
          provenance: [{ kind: "law", id: "world-law" }],
        },
      },
      mechanics: {
        meters: {
          health: {
            id: "health",
            name: "生命",
            min: 0,
            max: 20,
            thresholds: [{
              id: "death-at-zero",
              when: { operator: "lte", value: 0 },
              effects: [{ kind: "set_lifecycle", lifecycle: "retired" }],
            }],
          },
        },
        quantities: {
          "spirit-stone": {
            id: "spirit-stone",
            name: "灵石",
            unit: "枚",
            allowProduction: false,
            allowConsumption: true,
          },
          mana: {
            id: "mana",
            name: "灵力",
            unit: "点",
            allowProduction: false,
            allowConsumption: true,
          },
        },
        ratings: {
          attack: { id: "attack", name: "攻击修为", min: -20, max: 20 },
        },
      },
      meters: {
        "health:enemy": {
          id: "health:enemy",
          definitionId: "health",
          entityId: "enemy",
          current: 10,
          firedThresholdIds: [],
        },
      },
      quantities: {
        "spirit-stone:player": {
          id: "spirit-stone:player",
          definitionId: "spirit-stone",
          holderId: "player",
          amount: 3,
        },
        "spirit-stone:merchant": {
          id: "spirit-stone:merchant",
          definitionId: "spirit-stone",
          holderId: "merchant",
          amount: 20_000,
        },
        "mana:player": {
          id: "mana:player",
          definitionId: "mana",
          holderId: "player",
          amount: 10,
        },
      },
      ratings: {
        "attack:player": {
          id: "attack:player",
          definitionId: "attack",
          entityId: "player",
          value: 20,
        },
      },
    },
    agents,
    player: {
      entityId: "player",
      knowledge: {
        localEntities: {
          self: { id: "self", name: "我", description: "旅人自己。", status: "observed" },
          "known-merchant": {
            id: "known-merchant",
            name: "云游商人",
            description: "昨日见过的商人。",
            status: "observed",
          },
          "copper-key": {
            id: "copper-key",
            name: "铜钥匙",
            description: "商人声称是真钥匙。",
            status: "reported",
          },
        },
        evidence: {
          "merchant-encounter": {
            id: "merchant-encounter",
            kind: "observation",
            description: "昨日遇见过出售灵石的商人。",
            sourceId: null,
            step: 0,
          },
          "merchant-key-claim": {
            id: "merchant-key-claim",
            kind: "testimony",
            description: "商人声称铜钥匙是真的。",
            sourceId: null,
            step: 0,
          },
        },
        claims: {
          "key-is-real": {
            id: "key-is-real",
            subjectId: "copper-key",
            predicate: "authenticity",
            value: { kind: "text", value: "real" },
            description: "铜钥匙应当是真的。",
            evidenceIds: ["merchant-key-claim"],
          },
        },
        observationIds: [],
      },
      bindings: {
        self: { localEntityId: "self", canonicalEntityIds: ["player"] },
        "known-merchant": { localEntityId: "known-merchant", canonicalEntityIds: ["merchant"] },
        "copper-key": { localEntityId: "copper-key", canonicalEntityIds: ["key"] },
      },
    },
    history: [],
    bootstrapModelAudits: [],
  };
}

function definition(initialState: SimulationState): WorldDefinition {
  return {
    id: "acceptance-world",
    name: "开放行动验收世界",
    description: "只用于验证通用引擎契约。",
    truthModelProfileId: "truth-engine",
    laws,
    disclosure: { defaultCheckVisibility: "full" },
    rulePackages: [{
      id: "core-d20",
      version: "1.0.0",
      config: { opposedChecks: true, damageUsesMeters: true },
      adjudication: "使用 d20 检定。",
    }],
    initialState,
  };
}

function mindOutput(agentId: string, revision: number) {
  return {
    beliefPatch: { agentId, baseRevision: revision, operations: [] },
    characterPatch: { agentId, baseRevision: revision, operations: [] },
    nextAction: {
      id: `proposal:${agentId}:${revision}`,
      actorId: agentId,
      baseRevision: revision,
      rawText: "依据自己的认知继续行动",
      goal: "继续自主生活",
      means: null,
      targetIds: [],
    },
  };
}

interface TruthContext {
  baseRevision: number;
  step: number;
  jointActions: AgentActionProposal[];
  agentEpistemics: Record<string, unknown>;
  checkResults?: Array<{ requestId: string; succeeded: boolean }>;
}

function jointTransition(
  context: TruthContext,
  options: {
    operations?: WorldDeltaOperation[];
    playerStatus?: TransitionProposal["outcomes"][number]["status"];
    playerSummary?: string;
    alternatives?: KnownAlternative[];
    intentStatus?: TransitionProposal["intentStatus"];
    playerObservation?: string;
    observerIds?: string[];
  } = {},
): TransitionProposal {
  const nextStep = context.step + 1;
  const eventId = `world-event:${nextStep}`;
  return {
    baseRevision: context.baseRevision,
    outcomes: context.jointActions.map((action) => ({
      proposalId: action.id,
      status: action.actorId === "player" ? options.playerStatus ?? "succeeded" : "continuing",
      summary: action.actorId === "player" ? options.playerSummary ?? "你的行动得到世界回应。" : "自主行动得到联合裁决。",
      causeRefs: [{ kind: "action", id: action.id }],
      knownAlternatives: action.actorId === "player" ? options.alternatives ?? [] : [],
    })),
    operations: [
      ...(options.operations ?? []),
      { kind: "advance_time", seconds: 1, causes: [{ kind: "law", id: "time-passes" }] },
    ],
    events: [{
      id: eventId,
      step: nextStep,
      description: "联合世界步骤已经发生。",
      impact: "ordinary",
      causes: [{ kind: "law", id: "time-passes" }],
    }],
    observations: ["player", ...(options.observerIds ?? Object.keys(context.agentEpistemics))].map((observerId) => ({
      id: `surface:${observerId}:${nextStep}`,
      observerId,
      step: nextStep,
      kind: "outcome" as const,
      summary: observerId === "player" ? options.playerObservation ?? "你观察到世界继续变化。" : "周围世界继续变化。",
      introductions: [],
      apparentClaims: [],
      sourceEventIds: [eventId],
    })),
    intentStatus: options.intentStatus ?? "completed",
    requiresPlayerDecision: false,
  };
}

function engineWith(initialState: SimulationState, handler: ScriptedModelHandler): SimulationEngine {
  const provider = new ScriptedModelProvider(handler);
  return new SimulationEngine(definition(initialState), new TruthEngine(provider), new AgentMind(provider));
}

describe("open action acceptance", () => {
  it("runs 50 autonomous Agents for consecutive shared-revision steps", async () => {
    const agentIds = Array.from({ length: 50 }, (_, index) => `resident-${index.toString().padStart(2, "0")}`);
    const mindCalls = new Map<number, Set<string>>();
    const engine = engineWith(acceptanceState(agentIds), ({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as TruthContext & { revision: number; agent: { id: string } };
      if (profileId === "truth-engine") {
        return {
          kind: "transition",
          proposal: jointTransition(context, { intentStatus: context.step >= 2 ? "completed" : "active" }),
        };
      }
      const calls = mindCalls.get(context.revision) ?? new Set<string>();
      calls.add(context.agent.id);
      mindCalls.set(context.revision, calls);
      return mindOutput(context.agent.id, context.revision);
    });
    engine.beginPlayerIntent("让世界连续运行三个步骤");

    const result = await engine.runUntilBoundary(5);

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(3);
    for (const [index, step] of result.steps.entries()) {
      expect(step.actions).toHaveLength(51);
      expect(step.actions.every((action) => action.baseRevision === index)).toBe(true);
      expect(new Set(step.actions.map((action) => action.actorId)).size).toBe(51);
      expect(step.modelAudits.filter((audit) => audit.role === "agent-mind")).toHaveLength(50);
      expect(mindCalls.get(index + 1)?.size).toBe(50);
    }
  });

  it.each(["同时争夺同一物品", "同时互相攻击", "同时逃跑与阻挡"])(
    "canonicalizes joint conflict order for %s",
    async (goal) => {
      const observedOrders: string[][] = [];
      const run = async (agentOrder: string[]) => {
        const engine = engineWith(acceptanceState(agentOrder), ({ profileId, prompt }) => {
          const context = JSON.parse(prompt) as TruthContext & { revision: number; agent: { id: string } };
          if (profileId !== "truth-engine") return mindOutput(context.agent.id, context.revision);
          observedOrders.push(context.jointActions.map((action) => action.actorId));
          const contender = context.jointActions.find((action) => action.actorId !== "player")!;
          return {
            kind: "transition",
            proposal: jointTransition(context, {
              operations: [{
                kind: "place_entity",
                entityId: "token",
                placementId: contender.actorId,
                causes: [{ kind: "action", id: contender.id }],
              }],
            }),
          };
        });
        engine.beginPlayerIntent(goal);
        return (await engine.step()).state.truth.placements.token;
      };

      expect(await run(["resident-b", "resident-a"])).toBe("resident-a");
      expect(await run(["resident-a", "resident-b"])).toBe("resident-a");
      expect(observedOrders[0]).toEqual(observedOrders[1]);
    },
  );

  it("blocks unsupported spirit-stone creation and cites only known merchant evidence", async () => {
    const engine = engineWith(acceptanceState(), ({ prompt }) => {
      const context = JSON.parse(prompt) as TruthContext;
      return {
        kind: "transition",
        proposal: jointTransition(context, {
          playerStatus: "blocked",
          playerSummary: "灵石不能凭空出现。",
          alternatives: [{
            description: "可以寻找昨日遇见的云游商人。",
            basis: { kind: "knowledge", evidenceIds: ["merchant-encounter"] },
          }],
        }),
      };
    });
    engine.beginPlayerIntent("我获得一万灵石");

    const result = await engine.step();

    expect(result.state.truth.quantities["spirit-stone:player"].amount).toBe(3);
    const outcome = result.committed.outcomes.find((candidate) =>
      candidate.proposalId === result.committed.actions.find((action) => action.actorId === "player")!.id)!;
    expect(outcome.status).toBe("blocked");
    expect(outcome.knownAlternatives[0].basis).toEqual({
      kind: "knowledge",
      evidenceIds: ["merchant-encounter"],
    });
  });

  it("rejects teleportation without ability and commits lawful teleportation with resource consumption", async () => {
    const failedState = acceptanceState();
    const failed = engineWith(failedState, ({ prompt }) => {
      const context = JSON.parse(prompt) as TruthContext;
      return {
        kind: "transition",
        proposal: jointTransition(context, {
          playerStatus: "blocked",
          playerSummary: "你尚未掌握跨大陆传送能力。",
        }),
      };
    });
    failed.beginPlayerIntent("我瞬移到遥远大陆");
    const failedResult = await failed.step();
    expect(failedResult.state.truth.placements.player).toBe("courtyard");
    expect(failedResult.state.truth.quantities["mana:player"].amount).toBe(10);

    const capableState = acceptanceState();
    capableState.truth.facts["teleport-capability"] = {
      id: "teleport-capability",
      subjectId: "player",
      predicate: "can-teleport",
      value: { kind: "boolean", value: true },
      description: "旅人掌握跨大陆传送。",
      access: { kind: "public" },
      provenance: [{ kind: "law", id: "teleport-law" }],
    };
    const capable = engineWith(capableState, ({ prompt }) => {
      const context = JSON.parse(prompt) as TruthContext;
      const playerAction = context.jointActions.find((action) => action.actorId === "player")!;
      return {
        kind: "transition",
        proposal: jointTransition(context, {
          operations: [
            {
              kind: "consume_quantity",
              definitionId: "mana",
              holderId: "player",
              amount: 4,
              lawId: "teleport-law",
              causes: [{ kind: "action", id: playerAction.id }, { kind: "law", id: "teleport-law" }],
            },
            {
              kind: "place_entity",
              entityId: "player",
              placementId: "destination",
              causes: [{ kind: "action", id: playerAction.id }, { kind: "law", id: "teleport-law" }],
            },
          ],
          playerSummary: "传送成功，灵力随之消耗。",
        }),
      };
    });
    capable.beginPlayerIntent("我瞬移到遥远大陆");
    const capableResult = await capable.step();
    expect(capableResult.state.truth.placements.player).toBe("destination");
    expect(capableResult.state.truth.quantities["mana:player"].amount).toBe(6);
  });

  it("resolves direct defeat through a precommitted d20 check, damage and death threshold", async () => {
    const state = acceptanceState(["enemy"]);
    let truthCalls = 0;
    const engine = engineWith(state, ({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as TruthContext & { revision: number; agent: { id: string } };
      if (profileId !== "truth-engine") return mindOutput(context.agent.id, context.revision);
      truthCalls += 1;
      const playerAction = context.jointActions.find((action) => action.actorId === "player")!;
      if (!context.checkResults?.length) {
        return {
          kind: "request_checks",
          requests: [{
            id: "decisive-attack",
            actorId: "player",
            targetId: "enemy",
            ratingId: "attack:player",
            modifier: 20,
            modifierSources: [{ id: "attack:player", amount: 20 }],
            dc: 15,
            mode: "normal",
            stakes: "成功则造成足以击败拦路者的伤害，失败则目标仍可行动。",
            visibility: "full",
            phase: "resolution",
            causes: [{ kind: "action", id: playerAction.id }],
          }],
        };
      }
      return {
        kind: "transition",
        proposal: jointTransition(context, {
          operations: [{
            kind: "adjust_meter",
            meterId: "health:enemy",
            amount: -10,
            causes: [{ kind: "check", id: "decisive-attack" }],
          }],
          playerSummary: "攻击命中，拦路者失去战斗能力。",
          playerObservation: "你看见拦路者倒下，不再阻挡去路。",
          observerIds: [],
        }),
      };
    });
    engine.beginPlayerIntent("直接击败拦路者");

    const result = await engine.step();

    expect(truthCalls).toBe(2);
    expect(result.committed.checkRequests[0]).toMatchObject({
      id: "decisive-attack",
      dc: 15,
      stakes: expect.stringContaining("伤害"),
    });
    expect(result.committed.checks[0].succeeded).toBe(true);
    expect(result.state.truth.meters["health:enemy"].current).toBe(0);
    expect(result.state.truth.entities.enemy.lifecycle).toBe("retired");
    expect(result.state.agents.enemy).toBeUndefined();
    expect(result.committed.modelAudits[0]).toMatchObject({ attempts: 2, repairAttempts: 0 });
  });

  it("produces identical committed checks, delta and hashes from identical seeded inputs", async () => {
    const handler: ScriptedModelHandler = ({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as TruthContext & { revision: number; agent: { id: string } };
      if (profileId !== "truth-engine") return mindOutput(context.agent.id, context.revision);
      const playerAction = context.jointActions.find((action) => action.actorId === "player")!;
      if (!context.checkResults?.length) {
        return {
          kind: "request_checks",
          requests: [{
            id: "repeatable-check",
            actorId: "player",
            targetId: null,
            ratingId: "attack:player",
            modifier: 20,
            modifierSources: [{ id: "attack:player", amount: 20 }],
            dc: 18,
            mode: "advantage",
            stakes: "验证可复现世界提交。",
            visibility: "result_only",
            phase: "resolution",
            causes: [{ kind: "action", id: playerAction.id }],
          }],
        };
      }
      return { kind: "transition", proposal: jointTransition(context) };
    };
    const first = engineWith(acceptanceState(), handler);
    const second = engineWith(acceptanceState(), handler);
    first.beginPlayerIntent("执行可复现行动");
    second.beginPlayerIntent("执行可复现行动");

    const [left, right] = await Promise.all([first.step(), second.step()]);

    expect(left.committed).toEqual(right.committed);
    expect(left.state.truth.rng).toEqual(right.state.truth.rng);
    expect(left.committed.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("repairs a secret-leaking false-key observation without rewriting player belief", async () => {
    let truthCalls = 0;
    const engine = engineWith(acceptanceState(), ({ prompt }) => {
      const context = JSON.parse(prompt) as TruthContext;
      truthCalls += 1;
      return {
        kind: "transition",
        proposal: jointTransition(context, {
          playerStatus: "failed",
          playerSummary: truthCalls === 1 ? "key-authenticity 表明铜钥匙是仿制品。" : "铜钥匙未能打开石门。",
          playerObservation: truthCalls === 1 ? "铜钥匙其实是仿制品。" : "锁芯没有转动，石门仍然关闭。",
        }),
      };
    });
    engine.beginPlayerIntent("用铜钥匙打开石门");

    const result = await engine.step();

    expect(truthCalls).toBe(2);
    expect(result.committed.modelAudits[0].repairAttempts).toBe(1);
    expect(result.state.player.knowledge.claims["key-is-real"].value).toEqual({ kind: "text", value: "real" });
    expect(JSON.stringify(result.committed.observations.filter((packet) => packet.observerId === "player")))
      .not.toContain("fake");
    expect(JSON.stringify(result.state.player.knowledge)).not.toContain("仿制品");
  });

  it("blocks hidden identity and behind-wall secrets from every player-facing string", async () => {
    const state = acceptanceState();
    state.truth.facts["masked-identity"] = {
      id: "masked-identity",
      subjectId: "enemy",
      predicate: "secret-identity",
      value: { kind: "text", value: "hidden-heir" },
      description: "蒙面人的真实身份是失踪王储。",
      access: { kind: "private" },
      provenance: [{ kind: "law", id: "world-law" }],
    };
    state.truth.facts["behind-wall-secret"] = {
      id: "behind-wall-secret",
      subjectId: "gate",
      predicate: "hidden-content",
      value: { kind: "text", value: "sealed-treasure" },
      description: "隔墙密室里封存着王室宝藏。",
      access: { kind: "private" },
      provenance: [{ kind: "law", id: "world-law" }],
    };
    let calls = 0;
    const engine = engineWith(state, ({ prompt }) => {
      const context = JSON.parse(prompt) as TruthContext;
      calls += 1;
      return {
        kind: "transition",
        proposal: jointTransition(context, {
          playerSummary: calls === 1 ? "hidden-heir 正守着 sealed-treasure。" : "你暂时没有发现新的线索。",
          playerObservation: calls === 1
            ? "蒙面人的真实身份是失踪王储，隔墙密室里封存着王室宝藏。"
            : "墙后没有传来足以辨认内容的动静。",
        }),
      };
    });
    engine.beginPlayerIntent("猜测蒙面人与墙后秘密");

    const result = await engine.step();

    expect(calls).toBe(2);
    const publicText = JSON.stringify([
      result.committed.outcomes.find((outcome) =>
        outcome.proposalId === result.committed.actions.find((action) => action.actorId === "player")!.id),
      ...result.committed.observations.filter((packet) => packet.observerId === "player"),
    ]);
    expect(publicText).not.toMatch(/hidden-heir|sealed-treasure|失踪王储|王室宝藏/);
  });

  it("keeps conflicting Agent beliefs and nonexistent subjective entities outside truth", async () => {
    const state = acceptanceState(["resident-a", "resident-b"]);
    state.agents["resident-a"].belief.localEntities.stranger = {
      id: "stranger",
      name: "蒙面人",
      description: "我认为对方是盟友。",
      status: "hypothesized",
    };
    state.agents["resident-a"].belief.claims.role = {
      id: "role",
      subjectId: "stranger",
      predicate: "role",
      value: { kind: "text", value: "ally" },
      description: "对方是盟友。",
      stance: "believed",
      confidence: 0.8,
      evidenceIds: [],
    };
    state.agents["resident-b"].belief.localEntities.stranger = {
      id: "stranger",
      name: "蒙面人",
      description: "我认为对方是敌人。",
      status: "hypothesized",
    };
    state.agents["resident-b"].belief.localEntities["imaginary-order"] = {
      id: "imaginary-order",
      name: "不存在的组织",
      description: "只存在于主观推断中。",
      status: "hypothesized",
    };
    state.agents["resident-b"].belief.claims.role = {
      id: "role",
      subjectId: "stranger",
      predicate: "role",
      value: { kind: "text", value: "enemy" },
      description: "对方是敌人。",
      stance: "believed",
      confidence: 0.9,
      evidenceIds: [],
    };
    const engine = engineWith(state, ({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as TruthContext & { revision: number; agent: { id: string } };
      if (profileId !== "truth-engine") return mindOutput(context.agent.id, context.revision);
      return { kind: "transition", proposal: jointTransition(context) };
    });
    engine.beginPlayerIntent("观察两人的不同判断");

    const result = await engine.step();

    expect(result.state.agents["resident-a"].belief.claims.role.value).toEqual({ kind: "text", value: "ally" });
    expect(result.state.agents["resident-b"].belief.claims.role.value).toEqual({ kind: "text", value: "enemy" });
    expect(result.state.truth.entities["imaginary-order"]).toBeUndefined();
  });

  it("keeps the revision unchanged after exhausted Truth repairs and can retry from that revision", async () => {
    let valid = false;
    let truthCalls = 0;
    const engine = engineWith(acceptanceState(), ({ prompt }) => {
      const context = JSON.parse(prompt) as TruthContext;
      truthCalls += 1;
      if (!valid) return { kind: "transition", proposal: { ...jointTransition(context), operations: [] } };
      return { kind: "transition", proposal: jointTransition(context) };
    });
    engine.beginPlayerIntent("先失败再重试");

    await expect(engine.step()).rejects.toThrow("TruthEngine failed after repairs");
    expect(truthCalls).toBe(3);
    expect(engine.snapshot).toMatchObject({ revision: 0, step: 0 });
    valid = true;
    const retried = await engine.step();
    expect(retried.state).toMatchObject({ revision: 1, step: 1 });
    expect(retried.committed.actions.every((action) => action.baseRevision === 0)).toBe(true);
  });
});
