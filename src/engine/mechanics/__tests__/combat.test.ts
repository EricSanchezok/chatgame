// Combat mechanics unit tests: grade-scaled damage, hit resolution,
// clamped HP application, and threat gauge accumulation.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../../loader";
import { addThreat, applyDamage, computeDamage, resolveHit } from "../combat";
import type { WorldState } from "../../types";
import { createClock } from "../../time";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const emberfall = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));

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
      inventory: { stacks: [], currency: 0 },
      locationId: "emberfall-tavern",
      flags: [],
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
        relations: [],
        memories: [],
        knowledgeFlags: [],
        revealedSecrets: [],
        currentLocationId: "emberfall-tavern",
        statuses: [],
        reputation: [],
      },
    },
    flags: [],
    facts: [],
    eventLog: [],
    commitments: [],
    director: { lastEventDay: null, tension: {} },
    rng: { seed: 1, state: 1 },
    tasks: [],
    playedEventIds: [],
    eventLastPlayedDay: {},
    actionCooldowns: {},
    secretHolders: {},
    locationInventories: {},
    transcript: [],
    ...overrides,
  };
}

describe("combat", () => {
  it("computeDamage scales by grade multiplier", () => {
    expect(computeDamage(10, "fail")).toBe(10);
    expect(computeDamage(10, "success")).toBe(10);
    expect(computeDamage(10, "partial")).toBe(5);
    expect(computeDamage(10, "crit")).toBe(20);
  });

  it("resolveHit requires the roll to meet the defense value", () => {
    expect(resolveHit(15, 15)).toBe(true);
    expect(resolveHit(16, 15)).toBe(true);
    expect(resolveHit(14, 15)).toBe(false);
  });

  it("applyDamage reduces player hp and clamps at 0", () => {
    const state = makeState();
    const out = applyDamage(state, emberfall, "player", 20, "physical");
    expect(out.hpRemaining).toBe(30);
    expect(out.state.player.stats.hp).toBe(30);

    const overkill = applyDamage(out.state, emberfall, "player", 100, "physical");
    expect(overkill.hpRemaining).toBe(0);
    expect(overkill.state.player.stats.hp).toBe(0);
    expect(state.player.stats.hp).toBe(50); // original untouched
  });

  it("applyDamage targets NPCs by id", () => {
    const out = applyDamage(makeState(), emberfall, "elara", 35, "arcane");
    expect(out.hpRemaining).toBe(45);
    expect(out.state.npcs.elara.stats.hp).toBe(45);
  });

  it("applyDamage is a no-op for unknown targets", () => {
    const state = makeState();
    const out = applyDamage(state, emberfall, "no-such-npc", 10, "physical");
    expect(out.state).toBe(state);
    expect(out.hpRemaining).toBe(0);
  });

  it("addThreat accumulates, clamps to max, and reports reaching max", () => {
    const state = makeState();
    const partial = addThreat(state, emberfall, 40);
    expect(partial.reachedMax).toBe(false);
    expect(partial.state.player.threatGauge).toBe(40);

    const overflow = addThreat(partial.state, emberfall, 999);
    expect(overflow.reachedMax).toBe(true);
    expect(overflow.state.player.threatGauge).toBe(100); // clamped to max

    expect(state.player.threatGauge).toBe(0); // original untouched
  });
});
