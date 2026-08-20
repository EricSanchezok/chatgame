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
import { playEvent } from "../events";
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
        elara: {
          ...state.npcs.elara,
          stats: { ...state.npcs.elara.stats, perception: 10 },
          inventory: { stacks: [{ itemId: "tonic", quantity: 1 }], currency: 0 },
        },
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
    // Fail: no item stolen, threat +10.
    expect(out.state.player.inventory.stacks.some((s) => s.itemId === "tonic")).toBe(false);
    expect(out.state.player.threatGauge).toBe(10);
  });

  it("opposed check net win succeeds (with a stealable item)", () => {
    const { def, state } = setup();
    const withElara = {
      ...state,
      npcs: {
        ...state.npcs,
        elara: {
          ...state.npcs.elara,
          stats: { ...state.npcs.elara.stats, perception: 10 },
          inventory: { stacks: [{ itemId: "tonic", quantity: 1 }], currency: 0 },
        },
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
    expect(out.rejected).toBe(false);
    expect(out.resolution?.grade).toBe("success");
    // Steal success transfers one item to the player.
    expect(out.state.player.inventory.stacks.some((s) => s.itemId === "tonic")).toBe(true);
  });

  it("narrative_only give transfers without rolling (builtin semantics)", () => {
    const { def, state } = setup();
    // Miner origin starts with a lantern; give has narrative_only resolve +
    // builtin transfer semantics (no d20 roll, no grade scaling).
    const out = resolveAction({
      definition: def,
      state,
      actionId: "give",
      targetNpcId: "elara",
      params: { item: "lantern" },
    });
    expect(out.rejected).toBe(false);
    expect(out.resolution?.resolveType).toBe("narrative_only");
    expect(out.resolution?.grade).toBe("success");
    expect(out.resolution?.roll).toBeNull();
    // The lantern moved from the player to elara.
    expect(out.state.player.inventory.stacks.some((s) => s.itemId === "lantern")).toBe(false);
    expect(out.state.npcs.elara.inventory.stacks.some((s) => s.itemId === "lantern")).toBe(true);
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

  it("time cost reports effectiveTimeCost (clock advances in stepWorld)", () => {
    const { def, state } = setup();
    const before = state.clock.totalHours;
    const out = resolveAction({ definition: def, state, actionId: "wait" }); // wait costs 1h
    // resolveAction no longer advances the clock — it reports the cost and
    // the caller (playerTurn) steps the world by it.
    expect(out.effectiveTimeCost).toBe(1);
    expect(out.state.clock.totalHours).toBe(before);
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

  it("origin denied_actions rejects the action (apprentice cannot cast)", () => {
    const def = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
    const { state } = generateWorld(def, "apprentice", { seed: 42 });
    // apprentice.yaml declares denied_actions: [cast]; legality rejects
    // before costs are checked (R8).
    const out = resolveAction({ definition: def, state, actionId: "cast" });
    expect(out.rejected).toBe(true);
    expect(out.rejectReason).toBe("denied_action");
  });
});

describe("world rules (RuleOK)", () => {
  it("known actions pass vocabulary gate", () => {
    const { def } = setup();
    expect(isKnownAction(def, "talk")).toBe(true);
    expect(isKnownAction(def, "fly")).toBe(false);
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

  it("runs a script-registered rule mechanism", () => {
    const { def, state } = setup();
    const atNight = { ...state, clock: { ...state.clock, hour: 23 } };
    const result = checkWorldRules({
      definition: def,
      state: atNight,
      actionId: "travel",
      target: "mine-entrance",
    });
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("rule:night-travel-forbidden");
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
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("unregistered_rule:missing");
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
    const heldByElara = {
      ...state,
      secretHolders: { ...state.secretHolders, "mine-secret": "elara" },
    };
    // elara's mine-secret requires player relationship >= 60 AND flag miner-badge-shown
    const notRevealable = secretRevealable(heldByElara, def, "elara", "mine-secret");
    expect(notRevealable).toBe(false);
    const withRel = {
      ...heldByElara,
      npcs: {
        ...heldByElara.npcs,
        elara: {
          ...heldByElara.npcs.elara,
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

  it("uses the runtime secret holder as the NPC knowledge boundary", () => {
    const { def, state } = setup();
    const reassigned = {
      ...state,
      facts: [...state.facts, "mine-secret"],
      secretHolders: { ...state.secretHolders, "mine-secret": "old-miner" },
    };
    expect(secretRevealable(reassigned, def, "elara", "mine-secret")).toBe(false);
    expect(secretRevealable(reassigned, def, "old-miner", "mine-secret")).toBe(true);
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

  it("R8 mainline: mine-collapse flag triggers the fact-source commitment", () => {
    const { def, state } = setup();
    // mine-collapse writes flag: mine-collapse-witnessed; the commitment
    // collapse-survivor-rescued reads fact: mine-collapse-witnessed. The
    // unified marker space (hasMarker) bridges the two, so the mainline
    // commitment fires once the event played and perception >= 12.
    const played = playEvent(state, def, "mine-collapse");
    expect(played.played).toBe(true);
    expect(played.state.player.flags).toContain("mine-collapse-witnessed");
    const withPerception = {
      ...played.state,
      player: { ...played.state.player, stats: { ...played.state.player.stats, perception: 12 } },
    };
    const result = checkCommitments(withPerception, def);
    expect(result.fired).toContain("collapse-survivor-rescued");
    expect(
      result.state.commitments.find((c) => c.commitmentId === "collapse-survivor-rescued")
        ?.triggered,
    ).toBe(true);
  });
});

describe("director", () => {
  it("selects an event when pool is eligible", () => {
    const { def, state } = setup();
    const result = selectDirectorEvent(state, def);
    expect(result.selectedEventId).toBeDefined();
    // Selection records the play day; novelty truth lives in playedEventIds.
    expect(result.state.director.lastEventDay).toBeGreaterThanOrEqual(0);
  });

  it("eventEligible filters by location constraint", () => {
    const { def, state } = setup();
    const mineEvent = def.events.get("mine-collapse");
    if (mineEvent) {
      // mine-collapse targets mine-entrance; player at tavern -> not eligible
      expect(eventEligible(mineEvent, state, def)).toBe(false);
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
