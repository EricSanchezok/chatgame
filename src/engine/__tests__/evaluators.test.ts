// Evaluator unit tests: condition algebra (10 ops), effect algebra
// (14 kinds + grade coefficients), and clock math (rollovers, seasons).
import { describe, expect, it } from "vitest";
import { loadCoreTestDefinition } from "./core-test-fixture";
import { evalCondition, evalConditionLeaf, type ConditionContext } from "../condition";
import { applyEffects, gradeMultiplier } from "../effect";
import {
  advanceClock,
  createClock,
  formatClock,
  scheduleAt,
  todayFestival,
  currentSeason,
} from "../time";
import type { WorldDefinition, WorldState } from "../types";

const coreDefinition = loadCoreTestDefinition();
const definition: WorldDefinition = Object.freeze({
  ...coreDefinition,
  time: {
    ...coreDefinition.time,
    calendar: {
      months: [
        { name: "Cycle 1", days: 30 },
        { name: "Cycle 2", days: 30 },
        { name: "Cycle 3", days: 30 },
        { name: "Cycle 4", days: 30 },
      ],
      weekdays: ["D1", "D2", "D3", "D4", "D5", "D6", "D7"],
    },
    seasons: [
      { name: "spring", start: "02-01", weather_table: [{ weather: "clear", weight: 1 }] },
      { name: "summer", start: "03-01", weather_table: [{ weather: "clear", weight: 1 }] },
      { name: "winter", start: "04-01", weather_table: [{ weather: "clear", weight: 1 }] },
    ],
    festivals: [{ id: "calibration-day", name: "Calibration day", date: "01-15" }],
    schedules: [{
      id: "operator-shift",
      entries: [{ from: "08:00", to: "22:00", activity: "monitor relay", location: "relay-room" }],
    }],
  },
  mechanics: {
    ...coreDefinition.mechanics,
    stats: [
      { name: "hp", min: 0, max: 100, initial: 50 },
      { name: "strength", min: 0, max: 20, initial: 14 },
      { name: "charisma", min: 0, max: 20, initial: 8 },
      { name: "perception", min: 0, max: 20, initial: 10 },
      { name: "agility", min: 0, max: 20, initial: 10 },
    ],
    skills: [
      { name: "persuasion", min: 0, max: 20, initial: 4 },
      { name: "stealth", min: 0, max: 20, initial: 5 },
      { name: "perception", min: 0, max: 20, initial: 6 },
    ],
    needs: [
      { name: "energy", min: 0, max: 100, initial: 70, decay_per_day: 20, thresholds: [] },
      { name: "load", min: 0, max: 100, initial: 30, decay_per_day: -15, thresholds: [] },
    ],
    status_effects: [
      { id: "alert", name: "Alert", kind: "debuff", effects: [], stackable: false },
      {
        id: "signal-drift",
        name: "Signal drift",
        kind: "debuff",
        effects: [],
        duration: 2,
        stackable: false,
      },
    ],
    inventory: { capacity: 20, stacking: true },
  },
  items: new Map([
    ...coreDefinition.items,
    ["sample", {
      id: "sample",
      name: "Sample",
      type: "material" as const,
      description: "A deterministic test sample.",
      properties: { stackable: true },
      effects_on_use: [],
      rarity: "common",
      value: 1,
    }],
    ["toolkit", {
      id: "toolkit",
      name: "Toolkit",
      type: "equipment" as const,
      description: "A deterministic test toolkit.",
      properties: { stackable: false },
      effects_on_use: [],
      rarity: "common",
      value: 1,
    }],
  ]),
  factions: new Map([
    ...coreDefinition.factions,
    ["relay-crew", {
      id: "relay-crew",
      name: "Relay crew",
      description: "Operators used by generic engine tests.",
      goals: [],
      members: ["operator"],
      relations: [],
      reputation: {
        thresholds: [{
          value: 60,
          label: "trusted",
          effects: [{ kind: "flag", direction: "set", target: "player", flag: "archive-access" }],
        }],
        decay: 0,
      },
    }],
  ]),
});

/** Minimal but structurally valid WorldState for evaluator tests. */
function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    scriptId: definition.script.id,
    clock: createClock(definition, "clear", "spring"),
    player: {
      originId: "observer",
      name: "观察员",
      stats: { hp: 50, strength: 14, charisma: 8, perception: 10, agility: 10 },
      skills: { persuasion: 4, stealth: 5, perception: 6 },
      needs: { energy: { value: 70 }, load: { value: 30 } },
      inventory: { stacks: [{ itemId: "toolkit", quantity: 1 }], currency: 30 },
      locationId: "relay-room",
      flags: ["returned-visitor"],
      threatGauge: 0,
      statuses: [],
      memories: [],
      relations: [],
      reputation: [],
    },
    npcs: {
      operator: {
        id: "operator",
        stats: { hp: 80, charisma: 14 },
        skills: { persuasion: 10 },
        needs: {},
        inventory: { stacks: [], currency: 0 },
        relations: [{ npcId: "player", value: 65, stance: "friendly", type: "shift" }],
        memories: [],
        knowledgeFlags: ["sealed-note-holder"],
        revealedSecrets: [],
        currentLocationId: "relay-room",
        statuses: [],
        reputation: [],
      },
    },
    flags: [],
    facts: ["signal-lost"],
    eventLog: [],
    commitments: [],
    director: { lastEventDay: null, tension: { danger: 10 } },
    rng: { seed: 1, state: 1 },
    tasks: [],
    playedEventIds: [],
    eventLastPlayedDay: {},
    actionCooldowns: {},
    secretHolders: { "sealed-note": "operator" },
    locationInventories: {},
    transcript: [],
    runtimeState: {},
    activeNeedThresholds: [],
    ...overrides,
  };
}

function ctx(): ConditionContext {
  return { definition, state: makeState() };
}

describe("condition algebra", () => {
  it("stat gte", () => {
    expect(evalConditionLeaf({ source: "stat", key: "strength", op: "gte", value: 14 }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "stat", key: "strength", op: "gte", value: 15 }, ctx())).toBe(false);
  });
  it("skill lte / gt", () => {
    expect(evalConditionLeaf({ source: "skill", key: "persuasion", op: "lte", value: 4 }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "skill", key: "persuasion", op: "gt", value: 5 }, ctx())).toBe(false);
  });
  it("fails loudly for an unregistered custom source", () => {
    expect(() =>
      evalConditionLeaf(
        { source: "missing_source", op: "eq", value: 1 },
        ctx(),
      )
    ).toThrow(/no registered evaluator/);
  });
  it("need lt / eq", () => {
    expect(evalConditionLeaf({ source: "need", key: "load", op: "lt", value: 31 }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "need", key: "energy", op: "eq", value: 70 }, ctx())).toBe(true);
  });
  it("flag has / not_has (player + world)", () => {
    expect(evalConditionLeaf({ source: "flag", key: "returned-visitor", op: "has" }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "flag", key: "no-such-flag", op: "has" }, ctx())).toBe(false);
    expect(evalConditionLeaf({ source: "flag", key: "no-such-flag", op: "not_has" }, ctx())).toBe(true);
  });
  it("fact has / not_has", () => {
    expect(evalConditionLeaf({ source: "fact", key: "signal-lost", op: "has" }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "fact", key: "signal-lost", op: "not_has" }, ctx())).toBe(false);
  });
  it("relationship gte resolves player→NPC by default", () => {
    const base = makeState();
    const s = makeState({ player: {
      ...base.player,
      relations: [{ npcId: "operator", value: 65, stance: "friendly", type: "shift" }],
    } });
    const c = { definition, state: s };
    expect(evalConditionLeaf({ source: "relationship", key: "operator", op: "gte", value: 60 }, c)).toBe(true);
    expect(evalConditionLeaf({ source: "relationship", key: "operator", op: "gte", value: 70 }, c)).toBe(false);
  });
  it("relationship gte resolves NPC→player when selfNpcId is set", () => {
    const c = { definition, state: makeState(), selfNpcId: "operator" };
    expect(evalConditionLeaf({ source: "relationship", key: "player", op: "gte", value: 60 }, c)).toBe(true);
    expect(evalConditionLeaf({ source: "relationship", key: "player", op: "gte", value: 70 }, c)).toBe(false);
  });
  it("reputation gte", () => {
    const base = makeState();
    const s = makeState({ player: {
      ...base.player,
      reputation: [{ factionId: "relay-crew", value: 20 }],
    } });
    const c = { definition, state: s };
    expect(evalConditionLeaf({ source: "reputation", key: "relay-crew", op: "gte", value: 20 }, c)).toBe(true);
    expect(evalConditionLeaf({ source: "reputation", key: "relay-crew", op: "gte", value: 21 }, c)).toBe(false);
  });
  it("time comparisons", () => {
    expect(evalConditionLeaf({ source: "time", key: "hour", op: "gte", value: 0 }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "time", key: "day", op: "eq", value: 1 }, ctx())).toBe(true);
  });
  it("location eq / neq / in / not_in", () => {
    expect(evalConditionLeaf({ source: "location", key: "current", op: "eq", value: "relay-room" }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "location", key: "current", op: "neq", value: "service-corridor" }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "location", key: "current", op: "in", value: ["service-corridor", "relay-room"] }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "location", key: "current", op: "not_in", value: ["service-corridor", "external-node"] }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "location", key: "current", op: "not_in", value: ["relay-room"] }, ctx())).toBe(false);
  });
  it("inventory gte / currency lt", () => {
    expect(evalConditionLeaf({ source: "inventory", key: "toolkit", op: "gte", value: 1 }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "inventory", key: "toolkit", op: "gte", value: 2 }, ctx())).toBe(false);
    expect(evalConditionLeaf({ source: "currency", op: "lt", value: 31 }, ctx())).toBe(true);
  });
  it("recursive all / any / not", () => {
    const c = ctx();
    const cond = {
      all: [
        { source: "stat", key: "strength", op: "gte", value: 14 },
        {
          any: [
            { source: "flag", key: "returned-visitor", op: "has" },
            { source: "flag", key: "nope", op: "has" },
          ],
        },
        { not: { source: "fact", key: "nope-fact", op: "has" } },
      ],
    } as const;
    expect(evalCondition(cond as never, c)).toBe(true);
  });
  it("undefined condition is true (no precondition)", () => {
    expect(evalCondition(undefined, ctx())).toBe(true);
  });
});

describe("effect algebra", () => {
  it("fails loudly for an unregistered custom effect", () => {
    expect(() =>
      applyEffects(
        makeState(),
        [{ kind: "missing_effect", value: 1 }],
        { definition, day: 0 },
      )
    ).toThrow(/no registered handler/);
  });
  it("grade multipliers", () => {
    expect(gradeMultiplier("fail")).toBe(1);
    expect(gradeMultiplier("success")).toBe(1);
    expect(gradeMultiplier("partial")).toBe(0.5);
    expect(gradeMultiplier("crit")).toBe(2);
  });

  it("stat add with success grade", () => {
    const out = applyEffects(makeState(), [{ kind: "stat", direction: "add", target: "player", stat: "hp", value: -10 }], { definition, day: 0 });
    expect(out.state.player.stats.hp).toBe(40);
  });
  it("stat add scaled by crit", () => {
    const out = applyEffects(makeState(), [{ kind: "stat", direction: "add", target: "player", stat: "hp", value: -10 }], { definition, day: 0, grade: "crit" });
    expect(out.state.player.stats.hp).toBe(30);
  });
  it("stat add scaled by partial", () => {
    const out = applyEffects(makeState(), [{ kind: "stat", direction: "add", target: "player", stat: "hp", value: -10 }], { definition, day: 0, grade: "partial" });
    expect(out.state.player.stats.hp).toBe(45);
  });
  it("clamps to stat bounds", () => {
    const out = applyEffects(makeState(), [{ kind: "stat", direction: "add", target: "player", stat: "hp", value: -1000 }], { definition, day: 0 });
    expect(out.state.player.stats.hp).toBeGreaterThanOrEqual(0);
  });
  it("skill set", () => {
    const out = applyEffects(makeState(), [{ kind: "skill", direction: "set", target: "player", skill: "persuasion", value: 12 }], { definition, day: 0 });
    expect(out.state.player.skills.persuasion).toBe(12);
  });
  it("need add (direction add on a need value)", () => {
    const out = applyEffects(makeState(), [{ kind: "need", direction: "add", target: "player", need: "energy", value: -20 }], { definition, day: 0 });
    expect(out.state.player.needs.energy.value).toBe(50);
  });
  it("item add / remove", () => {
    let out = applyEffects(makeState(), [{ kind: "item", direction: "add", target: "player", item: "sample", value: 3 }], { definition, day: 0 });
    expect(out.state.player.inventory.stacks.find((s) => s.itemId === "sample")?.quantity).toBe(3);
    out = applyEffects(out.state, [{ kind: "item", direction: "remove", target: "player", item: "sample", value: 1 }], { definition, day: 0 });
    expect(out.state.player.inventory.stacks.find((s) => s.itemId === "sample")?.quantity).toBe(2);
  });
  it("currency add / remove floors at 0", () => {
    let out = applyEffects(makeState(), [{ kind: "currency", direction: "add", target: "player", value: 10 }], { definition, day: 0 });
    expect(out.state.player.inventory.currency).toBe(40);
    out = applyEffects(makeState(), [{ kind: "currency", direction: "remove", target: "player", value: 1000 }], { definition, day: 0 });
    expect(out.state.player.inventory.currency).toBe(0);
  });
  it("relation add updates stance + marks descriptor stale", () => {
    const base = makeState();
    const s = makeState({ player: {
      ...base.player,
      relations: [{ npcId: "operator", value: 0, stance: "neutral", type: "acquaintance", descriptor: { label: "陌生", description: "", version: 1, stale: false, sourceEventIds: [], userEdited: false } }],
    } });
    const out = applyEffects(s, [{ kind: "relation", direction: "add", target: "player", npc: "operator", value: 70 }], { definition, day: 0 });
    const rel = out.state.player.relations.find((r) => r.npcId === "operator")!;
    expect(rel.value).toBe(70);
    expect(rel.stance).toBe("allied");
    expect(rel.descriptor?.stale).toBe(true);
  });
  it("reputation add", () => {
    const base = makeState();
    const s = makeState({ player: {
      ...base.player,
      reputation: [{ factionId: "relay-crew", value: 10 }],
    } });
    const out = applyEffects(s, [{ kind: "reputation", direction: "add", target: "player", faction: "relay-crew", value: 15 }], { definition, day: 0 });
    expect(out.state.player.reputation.find((r) => r.factionId === "relay-crew")?.value).toBe(25);
  });
  it("applies reputation threshold effects on the rising edge", () => {
    const state = makeState({
      player: {
        ...makeState().player,
        reputation: [{ factionId: "relay-crew", value: 59 }],
      },
    });
    const out = applyEffects(
      state,
      [{ kind: "reputation", direction: "add", target: "player", faction: "relay-crew", value: 1 }],
      { definition, day: 0 },
    );
    expect(out.state.player.flags).toContain("archive-access");
    const repeated = applyEffects(
      out.state,
      [{ kind: "reputation", direction: "add", target: "player", faction: "relay-crew", value: 1 }],
      { definition, day: 0 },
    );
    expect(repeated.summaries.filter((summary) => summary.includes("trusted"))).toHaveLength(0);
  });
  it("flag set / remove", () => {
    let out = applyEffects(makeState(), [{ kind: "flag", direction: "set", target: "player", flag: "new-flag" }], { definition, day: 0 });
    expect(out.state.player.flags).toContain("new-flag");
    out = applyEffects(out.state, [{ kind: "flag", direction: "remove", target: "player", flag: "new-flag" }], { definition, day: 0 });
    expect(out.state.player.flags).not.toContain("new-flag");
  });
  it("teleport player", () => {
    const out = applyEffects(makeState(), [{ kind: "teleport", direction: "set", target: "player", location: "service-corridor" }], { definition, day: 0 });
    expect(out.state.player.locationId).toBe("service-corridor");
  });
  it("status add / remove", () => {
    let out = applyEffects(makeState(), [{ kind: "status", direction: "add", target: "player", status: "alert" }], { definition, day: 0 });
    expect(out.state.player.statuses.some((s) => s.statusId === "alert")).toBe(true);
    out = applyEffects(out.state, [{ kind: "status", direction: "remove", target: "player", status: "alert" }], { definition, day: 0 });
    expect(out.state.player.statuses.some((s) => s.statusId === "alert")).toBe(false);
  });
  it("status reapplication refreshes duration through the shared status mechanic", () => {
    const base = makeState();
    const state = makeState({
      player: {
        ...base.player,
        statuses: [{
          statusId: "signal-drift",
          remainingTicks: 1,
          stacks: 1,
          descriptor: {
            label: "Signal drift",
            description: "The signal remains unstable.",
            version: 1,
            stale: false,
            sourceEventIds: [],
            userEdited: false,
          },
        }],
      },
    });
    const out = applyEffects(
      state,
      [{ kind: "status", direction: "add", target: "player", status: "signal-drift" }],
      { definition, day: 0 },
    );
    expect(out.state.player.statuses[0]).toMatchObject({
      statusId: "signal-drift",
      remainingTicks: 2,
      stacks: 1,
      descriptor: { stale: true },
    });
  });
  it("memory add to player with deterministic batch-unique id", () => {
    const out = applyEffects(makeState(), [
      { kind: "memory", direction: "add", target: "player", text: "Met the operator", importance: "major", tags: ["operator"] },
      { kind: "memory", direction: "add", target: "player", text: "Logged a sample", importance: "minor" },
    ], { definition, day: 5 });
    expect(out.state.player.memories).toHaveLength(2);
    expect(out.state.player.memories[0].importance).toBe("major");
    expect(out.state.player.memories[0].createdAtDay).toBe(5);
    expect(out.state.player.memories[0].tags).toEqual(["operator"]);
    // Batch-unique ids: no collision within a single effects batch.
    expect(out.state.player.memories[0].id).toBe("player-mem-5-0");
    expect(out.state.player.memories[1].id).toBe("player-mem-5-1");
  });
  it("memory replaces archives the superseded entry", () => {
    const first = applyEffects(makeState(), [
      { kind: "memory", direction: "add", target: "player", text: "Pending calibration", importance: "minor", tags: ["calibration"] },
    ], { definition, day: 1 });
    const id = first.state.player.memories[0].id;
    const out = applyEffects(first.state, [
      { kind: "memory", direction: "add", target: "player", text: "Calibration complete", importance: "minor", tags: ["calibration"], replaces: id },
    ], { definition, day: 2 });
    const old = out.state.player.memories.find((m) => m.id === id)!;
    expect(old.archived).toBe(true);
    expect(old.supersededBy).toBe(out.state.player.memories[1].id);
  });
  it("memory replaces with missing target is a tolerant no-op append", () => {
    const out = applyEffects(makeState(), [
      { kind: "memory", direction: "add", target: "player", text: "新记忆", replaces: "nope" },
    ], { definition, day: 1 });
    expect(out.state.player.memories).toHaveLength(1);
    expect(out.state.player.memories[0].archived).toBe(false);
  });
  it("secret reveal adds fact + marks NPC revealed", () => {
    const out = applyEffects(makeState(), [{ kind: "secret", direction: "set", target: "player", secret: "sealed-note" }], { definition, day: 0 });
    expect(out.state.facts).toContain("sealed-note");
    expect(out.state.npcs.operator.revealedSecrets).toContain("sealed-note");
  });
  it("event effect is a no-op without an onEvent hook", () => {
    const out = applyEffects(makeState(), [{ kind: "event", direction: "set", target: "player", event: "handoff-signal" }], { definition, day: 0 });
    expect(out.state).toEqual(makeState());
    expect(out.summaries[0]).toContain("event");
  });
  it("narrative effect changes nothing", () => {
    const before = makeState();
    const out = applyEffects(before, [{ kind: "narrative", direction: "set", target: "player", text: "The relay light flickers." }], { definition, day: 0 });
    expect(out.state).toEqual(before);
    expect(out.summaries[0]).toContain("narrative:");
  });
});

describe("clock", () => {
  it("advances hours within a day", () => {
    const c = advanceClock(createClock(definition, "clear", "spring"), definition, 14);
    expect(c.hour).toBe(14);
    expect(c.day).toBe(1);
  });
  it("rolls over to next day at day boundary", () => {
    const c = advanceClock(createClock(definition, "clear", "spring"), definition, 24);
    expect(c.day).toBe(2);
    expect(c.hour).toBe(0);
  });
  it("rolls over month boundaries", () => {
    const c = advanceClock(createClock(definition, "clear", "spring"), definition, 24 * 30);
    expect(c.month).toBe(2);
    expect(c.day).toBe(1);
  });
  it("rolls over year boundaries", () => {
    const c = advanceClock(createClock(definition, "clear", "spring"), definition, 24 * 120);
    expect(c.year).toBe(2);
    expect(c.month).toBe(1);
    expect(c.day).toBe(1);
  });
  it("rejects negative hours", () => {
    expect(() => advanceClock(createClock(definition, "clear", "spring"), definition, -1)).toThrow();
  });
  it("weekday cycles", () => {
    const c = advanceClock(createClock(definition, "clear", "spring"), definition, 24 * 7);
    expect(c.weekday).toBe(0);
  });
  it("formatClock renders", () => {
    const c = createClock(definition, "clear", "spring");
    expect(formatClock(c)).toContain("第1年 1月1日");
  });
  it("todayFestival finds festival", () => {
    const c = advanceClock(createClock(definition, "clear", "spring"), definition, 24 * 14);
    expect(todayFestival(definition, c)).toBe("calibration-day");
  });
  it("currentSeason wraps to the last season before the first start", () => {
    // Cycle 1 day 1 is before spring (02-01), so it wraps to winter.
    const c = createClock(definition, "clear", "spring");
    expect(currentSeason(definition, c)).toBe("winter");
  });
  it("currentSeason crosses into spring at 02-01", () => {
    const c = advanceClock(createClock(definition, "clear", "spring"), definition, 24 * 30);
    expect(c.month).toBe(2);
    expect(c.day).toBe(1);
    expect(currentSeason(definition, c)).toBe("spring");
  });
  it("currentSeason crosses into summer at 05-01", () => {
    const c = advanceClock(createClock(definition, "clear", "spring"), definition, 24 * 60);
    expect(c.month).toBe(3);
    expect(c.day).toBe(1);
    expect(currentSeason(definition, c)).toBe("summer");
  });
  it("scheduleAt returns activity for schedule entries", () => {
    const clock = advanceClock(createClock(definition, "clear", "spring"), definition, 10); // 10:00
    const slot = scheduleAt(definition, "operator-shift", clock);
    expect(slot).toBeDefined();
    expect(slot!.activity).toBe("monitor relay");
  });
  it("scheduleAt supports windows that cross midnight", () => {
    const overnightDefinition: WorldDefinition = {
      ...definition,
      time: {
        ...definition.time,
        schedules: [
          ...definition.time.schedules,
          {
            id: "overnight-test",
            entries: [{ from: "22:00", to: "06:00", activity: "night watch", location: "relay-room" }],
          },
        ],
      },
    };
    const start = createClock(overnightDefinition, "clear", "spring");
    expect(scheduleAt(overnightDefinition, "overnight-test", advanceClock(start, overnightDefinition, 23))?.activity).toBe("night watch");
    expect(scheduleAt(overnightDefinition, "overnight-test", advanceClock(start, overnightDefinition, 29))?.activity).toBe("night watch");
    expect(scheduleAt(overnightDefinition, "overnight-test", advanceClock(start, overnightDefinition, 12))).toBeUndefined();
  });
});
