// Combat mechanics unit tests: grade-scaled damage, hit resolution,
// clamped HP application, and threat gauge accumulation.
import { describe, expect, it } from "vitest";
import { loadCoreTestDefinition } from "../../__tests__/core-test-fixture";
import { addThreat, applyDamage, computeDamage, resolveHit } from "../combat";
import type { WorldState } from "../../types";
import { createClock } from "../../time";

const definition = Object.freeze(loadCoreTestDefinition());

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    scriptId: definition.script.id,
    clock: createClock(definition, "clear", "baseline"),
    player: {
      originId: "observer",
      name: "观察员",
      stats: { hp: 50 },
      skills: { focus: 6 },
      needs: {},
      inventory: { stacks: [], currency: 0 },
      locationId: "relay-room",
      flags: [],
      threatGauge: 0,
      statuses: [],
      memories: [],
      relations: [],
      reputation: [],
    },
    npcs: {
      operator: {
        id: "operator",
        stats: { hp: 80 },
        skills: { focus: 9 },
        needs: {},
        inventory: { stacks: [], currency: 0 },
        relations: [],
        memories: [],
        knowledgeFlags: [],
        revealedSecrets: [],
        currentLocationId: "relay-room",
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
    runtimeState: {},
    activeNeedThresholds: [],
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
    const out = applyDamage(state, definition, "player", 20, "signal");
    expect(out.hpRemaining).toBe(30);
    expect(out.state.player.stats.hp).toBe(30);

    const overkill = applyDamage(out.state, definition, "player", 100, "signal");
    expect(overkill.hpRemaining).toBe(0);
    expect(overkill.state.player.stats.hp).toBe(0);
    expect(state.player.stats.hp).toBe(50); // original untouched
  });

  it("applyDamage targets NPCs by id", () => {
    const out = applyDamage(makeState(), definition, "operator", 35, "signal");
    expect(out.hpRemaining).toBe(45);
    expect(out.state.npcs.operator.stats.hp).toBe(45);
  });

  it("applyDamage is a no-op for unknown targets", () => {
    const state = makeState();
    const out = applyDamage(state, definition, "no-such-npc", 10, "signal");
    expect(out.state).toBe(state);
    expect(out.hpRemaining).toBe(0);
  });

  it("addThreat accumulates, clamps to max, and reports reaching max", () => {
    const state = makeState();
    const partial = addThreat(state, definition, 40);
    expect(partial.reachedMax).toBe(false);
    expect(partial.state.player.threatGauge).toBe(40);

    const overflow = addThreat(partial.state, definition, 999);
    expect(overflow.reachedMax).toBe(true);
    expect(overflow.state.player.threatGauge).toBe(100); // clamped to max

    expect(state.player.threatGauge).toBe(0); // original untouched
  });
});
