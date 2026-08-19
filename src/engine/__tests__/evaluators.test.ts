// Evaluator unit tests: condition algebra (10 ops), effect algebra
// (14 kinds + grade coefficients), and clock math (rollovers, seasons).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
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
import type { WorldState } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const emberfall = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));

/** Minimal but structurally valid WorldState for evaluator tests. */
function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    scriptId: "emberfall",
    clock: createClock(emberfall, "晴", "春"),
    player: {
      originId: "miner",
      name: "矿工",
      stats: { hp: 50, strength: 14, charisma: 8, perception: 10, agility: 10 },
      skills: { persuasion: 4, stealth: 5, perception: 6 },
      needs: { hunger: { value: 70 }, fatigue: { value: 30 } },
      inventory: { stacks: [{ itemId: "pickaxe", quantity: 1 }], currency: 30 },
      locationId: "emberfall-tavern",
      flags: ["returned-visitor"],
      threatGauge: 0,
      statuses: [],
      memories: [],
      relations: [],
      reputation: [],
    },
    npcs: {
      elara: {
        id: "elara",
        stats: { hp: 80, charisma: 14 },
        skills: { persuasion: 10 },
        needs: {},
        inventory: { stacks: [], currency: 0 },
        relations: [{ npcId: "player", value: 65, stance: "friendly", type: "business" }],
        memories: [],
        knowledgeFlags: ["mine-secret-holder"],
        revealedSecrets: [],
        currentLocationId: "emberfall-tavern",
        statuses: [],
        reputation: [],
      },
    },
    flags: [],
    facts: ["mine-collapsed"],
    eventLog: [],
    commitments: [],
    director: { lastEventDay: null, tension: { danger: 10 } },
    rng: { seed: 1, state: 1 },
    tasks: [],
    playedEventIds: [],
    eventLastPlayedDay: {},
    actionCooldowns: {},
    secretHolders: {},
    locationInventories: {},
    transcript: [],
    runtimeState: {},
    ...overrides,
  };
}

function ctx(): ConditionContext {
  return { definition: emberfall, state: makeState() };
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
  it("need lt / eq", () => {
    expect(evalConditionLeaf({ source: "need", key: "fatigue", op: "lt", value: 31 }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "need", key: "hunger", op: "eq", value: 70 }, ctx())).toBe(true);
  });
  it("flag has / not_has (player + world)", () => {
    expect(evalConditionLeaf({ source: "flag", key: "returned-visitor", op: "has" }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "flag", key: "no-such-flag", op: "has" }, ctx())).toBe(false);
    expect(evalConditionLeaf({ source: "flag", key: "no-such-flag", op: "not_has" }, ctx())).toBe(true);
  });
  it("fact has / not_has", () => {
    expect(evalConditionLeaf({ source: "fact", key: "mine-collapsed", op: "has" }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "fact", key: "mine-collapsed", op: "not_has" }, ctx())).toBe(false);
  });
  it("relationship gte resolves player→NPC by default", () => {
    const s = makeState();
    s.player.relations = [
      { npcId: "elara", value: 65, stance: "friendly", type: "business" },
    ];
    const c = { definition: emberfall, state: s };
    expect(evalConditionLeaf({ source: "relationship", key: "elara", op: "gte", value: 60 }, c)).toBe(true);
    expect(evalConditionLeaf({ source: "relationship", key: "elara", op: "gte", value: 70 }, c)).toBe(false);
  });
  it("relationship gte resolves NPC→player when selfNpcId is set", () => {
    const c = { definition: emberfall, state: makeState(), selfNpcId: "elara" };
    expect(evalConditionLeaf({ source: "relationship", key: "player", op: "gte", value: 60 }, c)).toBe(true);
    expect(evalConditionLeaf({ source: "relationship", key: "player", op: "gte", value: 70 }, c)).toBe(false);
  });
  it("reputation gte", () => {
    const s = makeState();
    s.player.reputation = [{ factionId: "miners-guild", value: 20 }];
    const c = { definition: emberfall, state: s };
    expect(evalConditionLeaf({ source: "reputation", key: "miners-guild", op: "gte", value: 20 }, c)).toBe(true);
    expect(evalConditionLeaf({ source: "reputation", key: "miners-guild", op: "gte", value: 21 }, c)).toBe(false);
  });
  it("time comparisons", () => {
    expect(evalConditionLeaf({ source: "time", key: "hour", op: "gte", value: 0 }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "time", key: "day", op: "eq", value: 1 }, ctx())).toBe(true);
  });
  it("location eq / neq / in / not_in", () => {
    expect(evalConditionLeaf({ source: "location", key: "current", op: "eq", value: "emberfall-tavern" }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "location", key: "current", op: "neq", value: "town-square" }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "location", key: "current", op: "in", value: ["town-square", "emberfall-tavern"] }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "location", key: "current", op: "not_in", value: ["town-square", "mine-entrance"] }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "location", key: "current", op: "not_in", value: ["emberfall-tavern"] }, ctx())).toBe(false);
  });
  it("inventory gte / currency lt", () => {
    expect(evalConditionLeaf({ source: "inventory", key: "pickaxe", op: "gte", value: 1 }, ctx())).toBe(true);
    expect(evalConditionLeaf({ source: "inventory", key: "pickaxe", op: "gte", value: 2 }, ctx())).toBe(false);
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
  it("grade multipliers", () => {
    expect(gradeMultiplier("fail")).toBe(1);
    expect(gradeMultiplier("success")).toBe(1);
    expect(gradeMultiplier("partial")).toBe(0.5);
    expect(gradeMultiplier("crit")).toBe(2);
  });

  it("stat add with success grade", () => {
    const out = applyEffects(makeState(), [{ kind: "stat", direction: "add", target: "player", stat: "hp", value: -10 }], { definition: emberfall, day: 0 });
    expect(out.state.player.stats.hp).toBe(40);
  });
  it("stat add scaled by crit", () => {
    const out = applyEffects(makeState(), [{ kind: "stat", direction: "add", target: "player", stat: "hp", value: -10 }], { definition: emberfall, day: 0, grade: "crit" });
    expect(out.state.player.stats.hp).toBe(30);
  });
  it("stat add scaled by partial", () => {
    const out = applyEffects(makeState(), [{ kind: "stat", direction: "add", target: "player", stat: "hp", value: -10 }], { definition: emberfall, day: 0, grade: "partial" });
    expect(out.state.player.stats.hp).toBe(45);
  });
  it("clamps to stat bounds", () => {
    const out = applyEffects(makeState(), [{ kind: "stat", direction: "add", target: "player", stat: "hp", value: -1000 }], { definition: emberfall, day: 0 });
    expect(out.state.player.stats.hp).toBeGreaterThanOrEqual(0);
  });
  it("skill set", () => {
    const out = applyEffects(makeState(), [{ kind: "skill", direction: "set", target: "player", skill: "persuasion", value: 12 }], { definition: emberfall, day: 0 });
    expect(out.state.player.skills.persuasion).toBe(12);
  });
  it("need add (direction add on a need value)", () => {
    const out = applyEffects(makeState(), [{ kind: "need", direction: "add", target: "player", need: "hunger", value: -20 }], { definition: emberfall, day: 0 });
    expect(out.state.player.needs.hunger.value).toBe(50);
  });
  it("item add / remove", () => {
    let out = applyEffects(makeState(), [{ kind: "item", direction: "add", target: "player", item: "herb", value: 3 }], { definition: emberfall, day: 0 });
    expect(out.state.player.inventory.stacks.find((s) => s.itemId === "herb")?.quantity).toBe(3);
    out = applyEffects(out.state, [{ kind: "item", direction: "remove", target: "player", item: "herb", value: 1 }], { definition: emberfall, day: 0 });
    expect(out.state.player.inventory.stacks.find((s) => s.itemId === "herb")?.quantity).toBe(2);
  });
  it("currency add / remove floors at 0", () => {
    let out = applyEffects(makeState(), [{ kind: "currency", direction: "add", target: "player", value: 10 }], { definition: emberfall, day: 0 });
    expect(out.state.player.inventory.currency).toBe(40);
    out = applyEffects(makeState(), [{ kind: "currency", direction: "remove", target: "player", value: 1000 }], { definition: emberfall, day: 0 });
    expect(out.state.player.inventory.currency).toBe(0);
  });
  it("relation add updates stance + marks descriptor stale", () => {
    const s = makeState();
    s.player.relations = [{ npcId: "elara", value: 0, stance: "neutral", type: "acquaintance", descriptor: { label: "陌生", description: "", version: 1, stale: false, sourceEventIds: [], userEdited: false } }];
    const out = applyEffects(s, [{ kind: "relation", direction: "add", target: "player", npc: "elara", value: 70 }], { definition: emberfall, day: 0 });
    const rel = out.state.player.relations.find((r) => r.npcId === "elara")!;
    expect(rel.value).toBe(70);
    expect(rel.stance).toBe("allied");
    expect(rel.descriptor?.stale).toBe(true);
  });
  it("reputation add", () => {
    const s = makeState();
    s.player.reputation = [{ factionId: "miners-guild", value: 10 }];
    const out = applyEffects(s, [{ kind: "reputation", direction: "add", target: "player", faction: "miners-guild", value: 15 }], { definition: emberfall, day: 0 });
    expect(out.state.player.reputation.find((r) => r.factionId === "miners-guild")?.value).toBe(25);
  });
  it("flag set / remove", () => {
    let out = applyEffects(makeState(), [{ kind: "flag", direction: "set", target: "player", flag: "new-flag" }], { definition: emberfall, day: 0 });
    expect(out.state.player.flags).toContain("new-flag");
    out = applyEffects(out.state, [{ kind: "flag", direction: "remove", target: "player", flag: "new-flag" }], { definition: emberfall, day: 0 });
    expect(out.state.player.flags).not.toContain("new-flag");
  });
  it("teleport player", () => {
    const out = applyEffects(makeState(), [{ kind: "teleport", direction: "set", target: "player", location: "town-square" }], { definition: emberfall, day: 0 });
    expect(out.state.player.locationId).toBe("town-square");
  });
  it("status add / remove", () => {
    let out = applyEffects(makeState(), [{ kind: "status", direction: "add", target: "player", status: "poison" }], { definition: emberfall, day: 0 });
    expect(out.state.player.statuses.some((s) => s.statusId === "poison")).toBe(true);
    out = applyEffects(out.state, [{ kind: "status", direction: "remove", target: "player", status: "poison" }], { definition: emberfall, day: 0 });
    expect(out.state.player.statuses.some((s) => s.statusId === "poison")).toBe(false);
  });
  it("memory add to player with deterministic batch-unique id", () => {
    const out = applyEffects(makeState(), [
      { kind: "memory", direction: "add", target: "player", text: "遇见艾拉", importance: "major", tags: ["elara"] },
      { kind: "memory", direction: "add", target: "player", text: "买了药水", importance: "minor" },
    ], { definition: emberfall, day: 5 });
    expect(out.state.player.memories).toHaveLength(2);
    expect(out.state.player.memories[0].importance).toBe("major");
    expect(out.state.player.memories[0].createdAtDay).toBe(5);
    expect(out.state.player.memories[0].tags).toEqual(["elara"]);
    // Batch-unique ids: no collision within a single effects batch.
    expect(out.state.player.memories[0].id).toBe("player-mem-5-0");
    expect(out.state.player.memories[1].id).toBe("player-mem-5-1");
  });
  it("memory replaces archives the superseded entry", () => {
    const first = applyEffects(makeState(), [
      { kind: "memory", direction: "add", target: "player", text: "欠酒商 20 金币", importance: "minor", tags: ["debt"] },
    ], { definition: emberfall, day: 1 });
    const id = first.state.player.memories[0].id;
    const out = applyEffects(first.state, [
      { kind: "memory", direction: "add", target: "player", text: "已还清酒商债务", importance: "minor", tags: ["debt"], replaces: id },
    ], { definition: emberfall, day: 2 });
    const old = out.state.player.memories.find((m) => m.id === id)!;
    expect(old.archived).toBe(true);
    expect(old.supersededBy).toBe(out.state.player.memories[1].id);
  });
  it("memory replaces with missing target is a tolerant no-op append", () => {
    const out = applyEffects(makeState(), [
      { kind: "memory", direction: "add", target: "player", text: "新记忆", replaces: "nope" },
    ], { definition: emberfall, day: 1 });
    expect(out.state.player.memories).toHaveLength(1);
    expect(out.state.player.memories[0].archived).toBe(false);
  });
  it("secret reveal adds fact + marks NPC revealed", () => {
    const out = applyEffects(makeState(), [{ kind: "secret", direction: "set", target: "player", secret: "mine-secret" }], { definition: emberfall, day: 0 });
    expect(out.state.facts).toContain("mine-secret");
    expect(out.state.npcs.elara.revealedSecrets).toContain("mine-secret");
  });
  it("event effect is a no-op without an onEvent hook", () => {
    const out = applyEffects(makeState(), [{ kind: "event", direction: "set", target: "player", event: "mine-collapse" }], { definition: emberfall, day: 0 });
    expect(out.state).toEqual(makeState());
    expect(out.summaries[0]).toContain("event");
  });
  it("narrative effect changes nothing", () => {
    const before = makeState();
    const out = applyEffects(before, [{ kind: "narrative", direction: "set", target: "player", text: "一阵风吹过" }], { definition: emberfall, day: 0 });
    expect(out.state).toEqual(before);
    expect(out.summaries[0]).toContain("narrative:");
  });
});

describe("clock", () => {
  it("advances hours within a day", () => {
    const c = advanceClock(createClock(emberfall, "晴", "春"), emberfall, 14);
    expect(c.hour).toBe(14);
    expect(c.day).toBe(1);
  });
  it("rolls over to next day at day boundary", () => {
    const c = advanceClock(createClock(emberfall, "晴", "春"), emberfall, 24);
    expect(c.day).toBe(2);
    expect(c.hour).toBe(0);
  });
  it("rolls over month boundaries", () => {
    const c = advanceClock(createClock(emberfall, "晴", "春"), emberfall, 24 * 30); // 正月 30 天
    expect(c.month).toBe(2);
    expect(c.day).toBe(1);
  });
  it("rolls over year boundaries", () => {
    const c = advanceClock(createClock(emberfall, "晴", "春"), emberfall, 24 * 356); // 12 个月总天数
    expect(c.year).toBe(2);
    expect(c.month).toBe(1);
    expect(c.day).toBe(1);
  });
  it("rejects negative hours", () => {
    expect(() => advanceClock(createClock(emberfall, "晴", "春"), emberfall, -1)).toThrow();
  });
  it("weekday cycles", () => {
    const c = advanceClock(createClock(emberfall, "晴", "春"), emberfall, 24 * 7);
    expect(c.weekday).toBe(0);
  });
  it("formatClock renders", () => {
    const c = createClock(emberfall, "晴", "春");
    expect(formatClock(c)).toContain("第1年 1月1日");
  });
  it("todayFestival finds festival", () => {
    const c = advanceClock(createClock(emberfall, "晴", "春"), emberfall, 24 * 14); // 1月15日 灯节
    expect(todayFestival(emberfall, c)).toBe("festival-lanterns");
  });
  it("currentSeason wraps to the last season before the first start", () => {
    // 1月1日 is before 春 (02-01) -> wraps to 冬 (11-01).
    const c = createClock(emberfall, "晴", "春");
    expect(currentSeason(emberfall, c)).toBe("冬");
  });
  it("currentSeason crosses into spring at 02-01", () => {
    // 正月 has 30 days; advancing 30 days lands on 2月1日 = 春 start.
    const c = advanceClock(createClock(emberfall, "晴", "春"), emberfall, 24 * 30);
    expect(c.month).toBe(2);
    expect(c.day).toBe(1);
    expect(currentSeason(emberfall, c)).toBe("春");
  });
  it("currentSeason crosses into summer at 05-01", () => {
    // Days in months 1-4: 30+29+30+30 = 119 -> 5月1日 = 夏 start.
    const c = advanceClock(createClock(emberfall, "晴", "春"), emberfall, 24 * 119);
    expect(c.month).toBe(5);
    expect(c.day).toBe(1);
    expect(currentSeason(emberfall, c)).toBe("夏");
  });
  it("scheduleAt returns activity for schedule entries", () => {
    const clock = advanceClock(createClock(emberfall, "晴", "春"), emberfall, 10); // 10:00
    const slot = scheduleAt(emberfall, "tavern-keeper-schedule", clock);
    expect(slot).toBeDefined();
    expect(slot!.activity).toBe("开店招呼客人");
  });
});
