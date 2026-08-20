// Gameplay tests: action resolution, RuleOK, commitments, and director
// selection over immutable overlays of the independent core definition.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import { checkActionLegality, gradeFromRoll, resolveAction } from "../actions";
import { checkWorldRules, isKnownAction } from "../rules";
import { checkCommitments, commitmentTriggerFires, secretRevealable } from "../plot";
import { playEvent } from "../events";
import { currentTensionBand, eventEligible, selectDirectorEvent } from "../director";
import { advanceClock } from "../time";
import type { WorldDefinition, WorldState } from "../types";
import type { Actions } from "../../script/schemas/actions";
import type { Event } from "../../script/schemas/event";
import type { Item } from "../../script/schemas/item";
import { loadCoreTestDefinition } from "./core-test-fixture";

type Action = Actions["actions"][number];

const COMPONENT: Item = {
  id: "component",
  name: "校准组件",
  type: "material",
  description: "用于确定性动作测试的组件。",
  properties: { stackable: true },
  effects_on_use: [],
  rarity: "test",
  value: 1,
  ext: {},
};

const DIRECTOR_EVENT: Event = {
  id: "director-pulse",
  name: "导演脉冲",
  type: "test",
  tags: [],
  trigger: "director",
  effects: [],
  weight: 1,
  cooldown: 0,
  repeatable: false,
  participants: ["operator"],
  locations: ["relay-room"],
  ext: {},
};

function action(id: string, resolve: Action["resolve"], overrides: Partial<Action> = {}): Action {
  return {
    id,
    enabled: true,
    resolve,
    llm_freedom: "narration",
    ...overrides,
  } as Action;
}

function gameplayDefinition(): WorldDefinition {
  const base = loadCoreTestDefinition();
  const operator = base.npcs.get("operator")!;
  const auditor = {
    ...operator,
    id: "auditor",
    name: "审计员",
    schedule: undefined,
    occupation: undefined,
    home: "service-corridor",
    relations: [],
    secrets: [],
    knowledge_flags: [],
  };
  const secret = {
    id: "relay-secret",
    content: "中继站保留了一条隐藏校准记录。",
    reveal: {
      logic: {
        all: [
          { source: "relationship", op: "gte" as const, value: 60 },
          { source: "flag", key: "badge-shown", op: "has" as const },
        ],
      },
    },
  };
  const actions: Action[] = [
    action("talk", { type: "auto" }),
    action("persuade", { type: "skill_check", skill: "focus", dc: 12 }),
    action("steal", { type: "opposed_check", stat: "hp", npc_stat: "hp" }),
    action("give", { type: "narrative_only" }),
    action("attack", { type: "stat_check", stat: "strength", dc: 12 }),
    action("defend", { type: "auto" }),
    action("take", { type: "auto" }, {
      conditions: { all: [{ source: "location", key: "current", op: "eq", value: "service-corridor" }] },
    }),
    action("wait", { type: "auto" }, { costs: { time: 1 } }),
    action("cast", { type: "auto" }, { costs: { items: [{ item: COMPONENT.id, quantity: 1 }] } }),
    action("gather", { type: "auto" }),
    action("travel", { type: "auto" }),
  ];
  return {
    ...base,
    mechanics: {
      ...base.mechanics,
      stats: [
        ...base.mechanics.stats,
        { name: "strength", min: 0, max: 20, initial: 14, description: "测试力量" },
      ],
    },
    actions: { ...base.actions, actions },
    items: new Map([[COMPONENT.id, COMPONENT]]),
    npcs: new Map([
      [operator.id, { ...operator, secrets: [secret] }],
      [auditor.id, auditor],
    ]),
    plot: {
      ...base.plot,
      commitments: [
        {
          id: "shift-anniversary",
          description: "第二日第三小时进行交班。",
          type: "time",
          trigger: { time: { day: 2, hour: 3 } },
          must_happen: true,
        },
        {
          id: "operator-trust",
          description: "值班员信任达到阈值。",
          type: "condition",
          trigger: { condition: { all: [{ source: "relationship", key: "operator", op: "gte", value: 60 }] } },
          must_happen: true,
        },
        {
          id: "restore-signal",
          description: "恢复中继信号。",
          type: "condition",
          trigger: { condition: { all: [{ source: "flag", key: "signal-restored", op: "has" }] } },
          must_happen: true,
          deadline: {
            time: { day: 2 },
            on_miss: {
              escalation_text: "中继信号进入降级模式",
              effects: [{ kind: "flag", direction: "set", target: "player", flag: "signal-degraded" }],
            },
          },
        },
      ],
    },
    director: {
      ...base.director,
      event_selection: {
        ...base.director.event_selection,
        bands: [{ band: [0, 100], weight_multiplier: 1 }],
      },
    },
    events: new Map([[DIRECTOR_EVENT.id, DIRECTOR_EVENT]]),
    extensions: {
      ...base.extensions,
      ruleMechanisms: {
        ...base.extensions.ruleMechanisms,
        "quiet-window": ({ state }) => state.clock.hour >= 22 ? "travel is closed" : null,
      },
    },
  };
}

function setup(): { def: WorldDefinition; state: WorldState } {
  const def = gameplayDefinition();
  const generated = generateWorld(def, "observer", { seed: 42 }).state;
  return {
    def,
    state: {
      ...generated,
      player: {
        ...generated.player,
        locationId: "relay-room",
        inventory: { ...generated.player.inventory, stacks: [{ itemId: COMPONENT.id, quantity: 1 }] },
      },
      npcs: {
        ...generated.npcs,
        operator: {
          ...generated.npcs.operator,
          currentLocationId: "relay-room",
          inventory: { stacks: [{ itemId: COMPONENT.id, quantity: 1 }], currency: 0 },
        },
        auditor: { ...generated.npcs.auditor, currentLocationId: "service-corridor" },
      },
    },
  };
}

describe("action resolution", () => {
  it("auto action succeeds without roll", () => {
    const { def, state } = setup();
    const out = resolveAction({ definition: def, state, actionId: "talk" });
    expect(out.rejected).toBe(false);
    expect(out.resolution).toMatchObject({ grade: "success", resolveType: "auto", roll: null });
  });

  it("skill_check resolves grade from roll", () => {
    const { def, state } = setup();
    const out = resolveAction({
      definition: def,
      state,
      actionId: "persuade",
      targetNpcId: "operator",
      rollOverride: 20,
    });
    expect(out.rejected).toBe(false);
    expect(out.resolution?.grade).toBe("crit");
    expect(out.resolution?.dc).toBe(12);
  });

  it("failed roll yields fail grade and records a log", () => {
    const { def, state } = setup();
    const unfocused = { ...state, player: { ...state.player, skills: { ...state.player.skills, focus: 0 } } };
    const out = resolveAction({ definition: def, state: unfocused, actionId: "persuade", rollOverride: 1 });
    expect(out.resolution?.grade).toBe("fail");
    expect(out.state.eventLog).toHaveLength(1);
  });

  it("opposed check tie means the actor fails", () => {
    const { def, state } = setup();
    const tied = {
      ...state,
      player: { ...state.player, stats: { ...state.player.stats, hp: 10 } },
      npcs: {
        ...state.npcs,
        operator: { ...state.npcs.operator, stats: { ...state.npcs.operator.stats, hp: 10 } },
      },
    };
    const out = resolveAction({
      definition: def,
      state: tied,
      actionId: "steal",
      targetNpcId: "operator",
      rollOverride: 10,
      npcRollOverride: 10,
    });
    expect(out.resolution?.grade).toBe("fail");
    expect(out.state.player.inventory.stacks).toEqual(tied.player.inventory.stacks);
    expect(out.state.player.threatGauge).toBe(10);
  });

  it("opposed check net win succeeds with a stealable item", () => {
    const { def, state } = setup();
    const balanced = {
      ...state,
      player: { ...state.player, stats: { ...state.player.stats, hp: 10 }, inventory: { ...state.player.inventory, stacks: [] } },
      npcs: {
        ...state.npcs,
        operator: { ...state.npcs.operator, stats: { ...state.npcs.operator.stats, hp: 10 } },
      },
    };
    const out = resolveAction({
      definition: def,
      state: balanced,
      actionId: "steal",
      targetNpcId: "operator",
      rollOverride: 12,
      npcRollOverride: 10,
    });
    expect(out.resolution?.grade).toBe("success");
    expect(out.state.player.inventory.stacks).toContainEqual({ itemId: COMPONENT.id, quantity: 1 });
  });

  it("narrative_only give transfers without rolling", () => {
    const { def, state } = setup();
    const out = resolveAction({
      definition: def,
      state,
      actionId: "give",
      targetNpcId: "operator",
      params: { item: COMPONENT.id },
    });
    expect(out.resolution).toMatchObject({ resolveType: "narrative_only", grade: "success", roll: null });
    expect(out.state.player.inventory.stacks).not.toContainEqual({ itemId: COMPONENT.id, quantity: 1 });
    expect(out.state.npcs.operator.inventory.stacks).toContainEqual({ itemId: COMPONENT.id, quantity: 2 });
  });

  it("attack hit applies combat damage to the target NPC", () => {
    const { def, state } = setup();
    const target = {
      ...state,
      npcs: { ...state.npcs, operator: { ...state.npcs.operator, stats: { ...state.npcs.operator.stats, hp: 80 } } },
    };
    const out = resolveAction({
      definition: def,
      state: target,
      actionId: "attack",
      targetNpcId: "operator",
      rollOverride: 20,
    });
    expect(out.resolution?.grade).toBe("crit");
    expect(out.state.npcs.operator.stats.hp).toBeLessThan(80);
    expect(out.resolution?.effectsApplied.some((summary) => summary.includes("attack hit"))).toBe(true);
  });

  it("attack defeat records a defeated fact at zero hp", () => {
    const { def, state } = setup();
    const weak = {
      ...state,
      npcs: { ...state.npcs, operator: { ...state.npcs.operator, stats: { ...state.npcs.operator.stats, hp: 10 } } },
    };
    const out = resolveAction({
      definition: def,
      state: weak,
      actionId: "attack",
      targetNpcId: "operator",
      rollOverride: 20,
    });
    expect(out.state.npcs.operator.stats.hp).toBe(0);
    expect(out.state.facts).toContain("defeated:operator");
  });

  it("defend success reduces threat gauge", () => {
    const { def, state } = setup();
    const tense = { ...state, player: { ...state.player, threatGauge: 30 } };
    const out = resolveAction({ definition: def, state: tense, actionId: "defend" });
    expect(out.state.player.threatGauge).toBe(25);
  });

  it("unknown action is rejected with a reason", () => {
    const { def, state } = setup();
    const out = resolveAction({ definition: def, state, actionId: "teleport-anywhere" });
    expect(out).toMatchObject({ rejected: true, rejectReason: "unknown_action" });
  });

  it("action with an unmet condition is rejected", () => {
    const { def, state } = setup();
    const out = resolveAction({ definition: def, state, actionId: "take" });
    expect(out).toMatchObject({ rejected: true, rejectReason: "condition_not_met" });
  });

  it("gradeFromRoll maps result bands", () => {
    expect(gradeFromRoll(20, 10)).toBe("crit");
    expect(gradeFromRoll(12, 10)).toBe("success");
    expect(gradeFromRoll(8, 10)).toBe("partial");
    expect(gradeFromRoll(3, 10)).toBe("fail");
  });

  it("reports time cost without advancing the clock", () => {
    const { def, state } = setup();
    const out = resolveAction({ definition: def, state, actionId: "wait" });
    expect(out.effectiveTimeCost).toBe(1);
    expect(out.state.clock.totalHours).toBe(state.clock.totalHours);
  });

  it("unaffordable cost rejects without state change", () => {
    const { def, state } = setup();
    const empty = {
      ...state,
      player: { ...state.player, inventory: { ...state.player.inventory, stacks: [] } },
    };
    const out = resolveAction({ definition: def, state: empty, actionId: "cast" });
    expect(out).toMatchObject({ rejected: true, rejectReason: "unaffordable", state: empty });
  });

  it("origin denied_actions rejects before costs are checked", () => {
    const def = gameplayDefinition();
    const observer = def.origins.get("observer")!;
    const restricted = {
      ...def,
      origins: new Map(def.origins).set(observer.id, { ...observer, denied_actions: ["cast"] }),
    };
    const state = generateWorld(restricted, "observer", { seed: 42 }).state;
    const out = resolveAction({ definition: restricted, state, actionId: "cast" });
    expect(out).toMatchObject({ rejected: true, rejectReason: "denied_action" });
  });
});

describe("world rules (RuleOK)", () => {
  it("known actions pass the vocabulary gate", () => {
    const { def } = setup();
    expect(isKnownAction(def, "talk")).toBe(true);
    expect(isKnownAction(def, "fly")).toBe(false);
  });

  it("rejects an action against an absent NPC", () => {
    const { def, state } = setup();
    const result = checkWorldRules({ definition: def, state, actionId: "talk", target: "auditor" });
    expect(result).toMatchObject({ allowed: false, reasonCode: "npc_absent" });
  });

  it("allows talk with a present NPC", () => {
    const { def, state } = setup();
    expect(checkWorldRules({ definition: def, state, actionId: "talk", target: "operator" }).allowed).toBe(true);
  });

  it("no-matter-creation blocks obtaining undefined items", () => {
    const { def, state } = setup();
    const result = checkWorldRules({
      definition: def,
      state,
      actionId: "gather",
      target: "missing-component",
    });
    expect(result).toMatchObject({ allowed: false, reasonCode: "rule:conservation" });
  });

  it("checkActionLegality propagates rule violations", () => {
    const { def, state } = setup();
    const result = checkActionLegality(def, state, "gather", "missing-component");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("rule:conservation");
  });

  it("runs a script-registered rule mechanism", () => {
    const { def, state } = setup();
    const definition = {
      ...def,
      world: {
        ...def.world,
        rules: [...def.world.rules, { id: "quiet-hours", text: "深夜关闭旅行", mechanism: "quiet-window" }],
      },
    };
    const atNight = { ...state, clock: { ...state.clock, hour: 23 } };
    const result = checkWorldRules({
      definition,
      state: atNight,
      actionId: "travel",
      target: "service-corridor",
    });
    expect(result).toMatchObject({ allowed: false, reasonCode: "rule:quiet-hours" });
  });

  it("rejects an unregistered rule mechanism loudly", () => {
    const { def, state } = setup();
    const result = checkWorldRules({
      definition: {
        ...def,
        world: { ...def.world, rules: [{ id: "broken", text: "broken", mechanism: "missing" }] },
      },
      state,
      actionId: "talk",
    });
    expect(result).toMatchObject({ allowed: false, reasonCode: "unregistered_rule:missing" });
  });
});

describe("commitments", () => {
  it("time commitment fires on its date", () => {
    const { def, state } = setup();
    const atTrigger = { ...state, clock: advanceClock(state.clock, def, 27) };
    expect(checkCommitments(atTrigger, def).fired).toContain("shift-anniversary");
  });

  it("condition commitment fires when a relationship reaches its threshold", () => {
    const { def, state } = setup();
    const trusted = {
      ...state,
      player: {
        ...state.player,
        relations: [{ npcId: "operator", value: 70, stance: "friendly", type: "colleague" }],
      },
    };
    const result = checkCommitments(trusted, def);
    expect(result.fired).toContain("operator-trust");
    expect(result.state.commitments.find((entry) => entry.commitmentId === "operator-trust")?.triggered).toBe(true);
  });

  it("deadline miss applies its escalation", () => {
    const { def, state } = setup();
    const late = { ...state, clock: advanceClock(state.clock, def, def.time.day_length_hours * 3) };
    const result = checkCommitments(late, def);
    expect(result.missed).toContain("restore-signal");
    expect(result.state.player.flags).toContain("signal-degraded");
  });

  it("secretRevealable respects relationship and flag conditions", () => {
    const { def, state } = setup();
    const held = { ...state, secretHolders: { "relay-secret": "operator" } };
    expect(secretRevealable(held, def, "operator", "relay-secret")).toBe(false);
    const trusted = {
      ...held,
      npcs: {
        ...held.npcs,
        operator: {
          ...held.npcs.operator,
          relations: [{ npcId: "player", value: 80, stance: "allied", type: "colleague" }],
        },
      },
    };
    expect(secretRevealable(trusted, def, "operator", "relay-secret")).toBe(false);
    const authorized = {
      ...trusted,
      player: { ...trusted.player, flags: [...trusted.player.flags, "badge-shown"] },
    };
    expect(secretRevealable(authorized, def, "operator", "relay-secret")).toBe(true);
  });

  it("uses the runtime secret holder as the knowledge boundary", () => {
    const { def, state } = setup();
    const reassigned = {
      ...state,
      facts: [...state.facts, "relay-secret"],
      secretHolders: { "relay-secret": "auditor" },
    };
    expect(secretRevealable(reassigned, def, "operator", "relay-secret")).toBe(false);
    expect(secretRevealable(reassigned, def, "auditor", "relay-secret")).toBe(true);
  });

  it("commitmentTriggerFires checks time and condition triggers", () => {
    const { def, state } = setup();
    const commitment = def.plot.commitments.find((entry) => entry.id === "shift-anniversary")!;
    expect(commitmentTriggerFires(commitment, { definition: def, state })).toBe(false);
    expect(commitmentTriggerFires(
      { ...commitment, trigger: { time: { day: state.clock.day, month: state.clock.month } } },
      { definition: def, state },
    )).toBe(true);
  });
});

describe("director", () => {
  it("selects an event when the pool is eligible", () => {
    const { def, state } = setup();
    const result = selectDirectorEvent(state, def);
    expect(result.selectedEventId).toBe(DIRECTOR_EVENT.id);
    expect(result.state.director.lastEventDay).toBeGreaterThanOrEqual(0);
  });

  it("eventEligible filters by location constraint", () => {
    const { def, state } = setup();
    const elsewhere = { ...state, player: { ...state.player, locationId: "service-corridor" } };
    expect(eventEligible(DIRECTOR_EVENT, elsewhere, def)).toBe(false);
  });

  it("resolves a positive tension band multiplier", () => {
    const { def, state } = setup();
    const { band, multiplier } = currentTensionBand(state, def);
    expect(band).toEqual([0, 100]);
    expect(multiplier).toBe(1);
  });

  it("does not select when nothing is eligible", () => {
    const { def, state } = setup();
    const result = selectDirectorEvent(state, { ...def, events: new Map() });
    expect(result.selectedEventId).toBeUndefined();
  });
});

describe("Emberfall content regression", () => {
  it("R8 mine-collapse flag closes the fact-source commitment loop", () => {
    const definition = loadScript(path.resolve(__dirname, "../../../scripts/emberfall"));
    const state = generateWorld(definition, "miner", { seed: 42 }).state;
    const played = playEvent(state, definition, "mine-collapse");

    expect(played.played).toBe(true);
    expect(played.state.player.flags).toContain("mine-collapse-witnessed");
    const withPerception = {
      ...played.state,
      player: { ...played.state.player, stats: { ...played.state.player.stats, perception: 12 } },
    };
    const result = checkCommitments(withPerception, definition);
    expect(result.fired).toContain("collapse-survivor-rescued");
    expect(
      result.state.commitments.find((entry) => entry.commitmentId === "collapse-survivor-rescued")
        ?.triggered,
    ).toBe(true);
  });
});
