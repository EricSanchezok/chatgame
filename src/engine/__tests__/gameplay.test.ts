// Gameplay tests: action resolution (grades, legality, anti-cheat),
// world rules enforcement (RuleOK), commitment firing/deadlines,
// director event selection (tension bands + novelty).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import { resolveAction, gradeFromRoll, checkActionLegality } from "../actions";
import { checkWorldRules, isKnownAction } from "../rules";
import { checkCommitments, secretRevealable, commitmentTriggerFires } from "../plot";
import { selectDirectorEvent, eventEligible, currentTensionBand } from "../director";
import { advanceClock } from "../time";
import type { WorldState, WorldDefinition } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function setup(): { def: WorldDefinition; state: WorldState } {
  const def = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
  const { state } = generateWorld(def, "miner", { seed: 42 });
  // Move the player to the tavern so elara (home: tavern) is present.
  const atTavern = { ...state, player: { ...state.player, locationId: "tavern" } };
  return { def, state: atTavern };
}

describe("action resolution", () => {
  it("auto action succeeds without roll", () => {
    const { def, state } = setup();
    const out = resolveAction({ definition: def, state, actionId: "talk" });
    expect(out.rejected).toBe(false);
    expect(out.resolution?.grade).toBe("success");
    expect(out.resolution?.resolveType).toBe("auto");
    expect(out.resolution?.roll).toBeNull();
  });

  it("skill_check resolves grade from roll", () => {
    const { def, state } = setup();
    // persuade DC 12; rollOverride 20 + skill -> crit
    const out = resolveAction({
      definition: def,
      state,
      actionId: "persuade",
      targetNpcId: "elara",
      rollOverride: 20,
    });
    expect(out.rejected).toBe(false);
    expect(["crit", "success"]).toContain(out.resolution!.grade);
    expect(out.resolution!.dc).toBe(12);
  });

  it("failed roll yields fail grade and still records log", () => {
    const { def, state } = setup();
    const out = resolveAction({
      definition: def,
      state,
      actionId: "persuade",
      targetNpcId: "elara",
      rollOverride: 1,
    });
    expect(out.resolution?.grade).toBe("fail");
    expect(out.state.eventLog.length).toBeGreaterThan(0);
  });

  it("opposed check tie = actor fails (5e semantics)", () => {
    const { def, state } = setup();
    // Deterministic tie: player agility 10, elara perception 10, both roll 10.
    const withElara = {
      ...state,
      npcs: {
        ...state.npcs,
        elara: { ...state.npcs.elara, stats: { ...state.npcs.elara.stats, perception: 10 } },
      },
    };
    const out = resolveAction({
      definition: def,
      state: withElara,
      actionId: "steal",
      targetNpcId: "elara",
      rollOverride: 10,
      npcRollOverride: 10,
    });
    expect(out.rejected).toBe(false);
    expect(out.resolution?.resolveType).toBe("opposed_check");
    expect(out.resolution?.grade).toBe("fail");
  });

  it("opposed check net win succeeds", () => {
    const { def, state } = setup();
    const withElara = {
      ...state,
      npcs: {
        ...state.npcs,
        elara: { ...state.npcs.elara, stats: { ...state.npcs.elara.stats, perception: 10 } },
      },
    };
    const out = resolveAction({
      definition: def,
      state: withElara,
      actionId: "steal",
      targetNpcId: "elara",
      rollOverride: 12,
      npcRollOverride: 10,
    });
    expect(out.resolution?.grade).toBe("success");
  });

  it("narrative_only resolves without roll or state consequences", () => {
    const { def, state } = setup();
    const before = JSON.stringify(state.player);
    const out = resolveAction({
      definition: def,
      state,
      actionId: "give",
      targetNpcId: "elara",
    });
    expect(out.rejected).toBe(false);
    expect(out.resolution?.resolveType).toBe("narrative_only");
    expect(out.resolution?.grade).toBe("success");
    expect(out.resolution?.roll).toBeNull();
    expect(JSON.stringify(out.state.player)).toBe(before);
  });

  it("attack hit applies combat damage to the target NPC", () => {
    const { def, state } = setup();
    const withElara = {
      ...state,
      npcs: { ...state.npcs, elara: { ...state.npcs.elara, stats: { ...state.npcs.elara.stats, hp: 80 } } },
    };
    const out = resolveAction({
      definition: def,
      state: withElara,
      actionId: "attack",
      targetNpcId: "elara",
      rollOverride: 20, // crit: 20 + strength 14 vs DC 12
    });
    expect(out.rejected).toBe(false);
    expect(out.resolution?.grade).toBe("crit");
    expect(out.state.npcs.elara.stats.hp).toBeLessThan(80);
    expect(out.resolution?.effectsApplied.some((s) => s.includes("attack hit"))).toBe(true);
  });

  it("attack defeat records defeated fact at 0 hp", () => {
    const { def, state } = setup();
    const weakElara = {
      ...state,
      npcs: { ...state.npcs, elara: { ...state.npcs.elara, stats: { ...state.npcs.elara.stats, hp: 10 } } },
    };
    const out = resolveAction({
      definition: def,
      state: weakElara,
      actionId: "attack",
      targetNpcId: "elara",
      rollOverride: 20, // crit damage 2x14=28 -> hp 0
    });
    expect(out.state.npcs.elara.stats.hp).toBe(0);
    expect(out.state.facts).toContain("defeated:elara");
  });

  it("defend success reduces threat gauge (passive defense)", () => {
    const { def, state } = setup();
    const tense = { ...state, player: { ...state.player, threatGauge: 30 } };
    const out = resolveAction({
      definition: def,
      state: tense,
      actionId: "defend",
      rollOverride: 20, // 20 + defense 5 vs DC 10 -> success
    });
    expect(out.rejected).toBe(false);
    expect(out.state.player.threatGauge).toBe(25);
  });

  it("unknown action is rejected with reason", () => {
    const { def, state } = setup();
    const out = resolveAction({ definition: def, state, actionId: "teleport_anywhere" });
    expect(out.rejected).toBe(true);
    expect(out.rejectReason).toBe("unknown_action");
  });

  it("action with unmet condition is rejected (take requires location)", () => {
    const { def, state } = setup();
    // take has condition location in town-hall; player is at tavern
    const out = resolveAction({ definition: def, state, actionId: "take" });
    expect(out.rejected).toBe(true);
    expect(out.rejectReason).toBe("condition_not_met");
  });

  it("gradeFromRoll maps bands", () => {
    expect(gradeFromRoll(20, 10)).toBe("crit");
    expect(gradeFromRoll(12, 10)).toBe("success");
    expect(gradeFromRoll(8, 10)).toBe("partial");
    expect(gradeFromRoll(3, 10)).toBe("fail");
  });

  it("time cost advances clock (anti-spam)", () => {
    const { def, state } = setup();
    const before = state.clock.totalHours;
    const out = resolveAction({ definition: def, state, actionId: "wait" }); // wait costs 1h
    expect(out.state.clock.totalHours).toBe(before + 1);
  });

  it("unaffordable cost rejects without state change", () => {
    const { def, state } = setup();
    const noHerb = {
      ...state,
      player: { ...state.player, inventory: { ...state.player.inventory, stacks: [] } },
    };
    // cast costs herb (item); without any items -> unaffordable
    const out = resolveAction({ definition: def, state: noHerb, actionId: "cast" });
    expect(out.rejected).toBe(true);
    expect(out.rejectReason).toBe("unaffordable");
  });
});

describe("world rules (RuleOK)", () => {
  it("known actions pass vocabulary gate", () => {
    expect(isKnownAction("talk")).toBe(true);
    expect(isKnownAction("fly")).toBe(false);
  });

  it("rule check rejects action against absent npc", () => {
    const { def, state } = setup();
    const result = checkWorldRules({
      definition: def,
      state,
      actionId: "talk",
      target: "old-miner", // not at player location (tavern)
    });
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("npc_absent");
  });

  it("rule check allows talk with present npc", () => {
    const { def, state } = setup();
    const result = checkWorldRules({ definition: def, state, actionId: "talk", target: "elara" });
    expect(result.allowed).toBe(true);
  });

  it("no-matter-creation blocks obtaining undefined items", () => {
    const { def, state } = setup();
    const result = checkWorldRules({
      definition: def,
      state,
      actionId: "gather",
      target: "nonexistent-item",
    });
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("rule:no-matter-creation");
  });

  it("checkActionLegality wraps rule violations", () => {
    const { def, state } = setup();
    const result = checkActionLegality(def, state, "gather", "nonexistent-item");
    expect(!result.ok).toBe(true);
    if (!result.ok) {
      expect(result.reasonCode).toContain("rule");
    }
  });
});

describe("commitments", () => {
  it("time commitment fires on its date", () => {
    const { def, state } = setup();
    // ash-day-anniversary: month 11 day 3 hour 18
    // months 1-10 days: 30+29+30+30+29+30+30+29+30+30 = 297
    const advanced = {
      ...state,
      clock: advanceClock(state.clock, def, 24 * 297 + 24 * 2 + 18),
    };
    const result = checkCommitments(advanced, def);
    expect(result.fired).toContain("ash-day-anniversary");
  });

  it("condition commitment fires when relationship reaches threshold", () => {
    const { def, state } = setup();
    // elara-secret-reveal: relationship elara >= 60 (player perspective)
    const withRel = {
      ...state,
      player: {
        ...state.player,
        relations: [
          { npcId: "elara", value: 70, stance: "friendly", type: "business" },
        ],
      },
    };
    const result = checkCommitments(withRel, def);
    expect(result.fired).toContain("elara-secret-reveal");
    expect(
      result.state.commitments.find((c) => c.commitmentId === "elara-secret-reveal")?.triggered,
    ).toBe(true);
  });

  it("deadline miss applies on_miss escalation", () => {
    const { def, state } = setup();
    // collapse-survivor-rescued has deadline day 60
    const advanced = { ...state, clock: advanceClock(state.clock, def, 24 * 61) };
    const result = checkCommitments(advanced, def);
    expect(result.missed).toContain("collapse-survivor-rescued");
  });

  it("secretRevealable respects reveal condition (relationship + flag)", () => {
    const { def, state } = setup();
    // elara's mine-secret requires player relationship >= 60 AND flag miner-badge-shown
    const notRevealable = secretRevealable(state, def, "elara", "mine-secret");
    expect(notRevealable).toBe(false);
    const withRel = {
      ...state,
      npcs: {
        ...state.npcs,
        elara: {
          ...state.npcs.elara,
          relations: [{ npcId: "player", value: 80, stance: "allied", type: "business" }],
        },
      },
    };
    // Relationship met but flag missing -> still not revealable.
    expect(secretRevealable(withRel, def, "elara", "mine-secret")).toBe(false);
    const withBoth = {
      ...withRel,
      player: { ...withRel.player, flags: [...withRel.player.flags, "miner-badge-shown"] },
    };
    expect(secretRevealable(withBoth, def, "elara", "mine-secret")).toBe(true);
  });

  it("commitmentTriggerFires checks time + condition", () => {
    const { def, state } = setup();
    const commitment = def.plot.commitments.find((c) => c.id === "ash-day-anniversary")!;
    expect(commitmentTriggerFires(commitment, { definition: def, state })).toBe(false);
    const fired = commitmentTriggerFires(
      { ...commitment, trigger: { time: { day: state.clock.day, month: state.clock.month } } },
      { definition: def, state },
    );
    expect(fired).toBe(true);
  });
});

describe("director", () => {
  it("selects an event when pool is eligible", () => {
    const { def, state } = setup();
    const result = selectDirectorEvent(state, def);
    expect(result.selectedEventId).toBeDefined();
    expect(result.state.director.seenEventIds).toContain(result.selectedEventId!);
  });

  it("eventEligible filters by location constraint", () => {
    const { def, state } = setup();
    const mineEvent = def.events.get("mine-collapse");
    if (mineEvent) {
      // mine-collapse targets mine-entrance; player at tavern -> not eligible
      expect(eventEligible(mineEvent, state, def, 0)).toBe(false);
    }
  });

  it("tension band multiplier resolves", () => {
    const { def, state } = setup();
    const { band, multiplier } = currentTensionBand(state, def);
    expect(band).toBeDefined();
    expect(multiplier).toBeGreaterThan(0);
  });

  it("does not select when nothing eligible (empty world)", () => {
    const { def, state } = setup();
    const emptyDef = { ...def, events: new Map() };
    const result = selectDirectorEvent(state, emptyDef as WorldDefinition);
    expect(result.selectedEventId).toBeUndefined();
  });
});
