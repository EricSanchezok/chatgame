// Status mechanics unit tests: add/stack/remove, timed tick countdown with
// effect application, expiry at 0, and permanent statuses.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../../loader";
import { addStatus, removeStatus, tickStatuses } from "../status";
import type { StatusInstance, WorldState } from "../../types";
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
    runtimeState: {},
    activeNeedThresholds: [],
    ...overrides,
  };
}

describe("status", () => {
  it("addStatus creates a timed instance with the definition duration", () => {
    const statuses = addStatus([], "tipsy", emberfall);
    expect(statuses).toEqual([{ statusId: "tipsy", remainingTicks: 2, stacks: 1 }]);
  });

  it("addStatus stacks stackable statuses and restarts their timer", () => {
    const initial: StatusInstance[] = [{ statusId: "light-wound", remainingTicks: 1, stacks: 1 }];
    const out = addStatus(initial, "light-wound", emberfall);
    expect(out[0].stacks).toBe(2);
    expect(out[0].remainingTicks).toBeNull(); // no duration → permanent
  });

  it("addStatus refreshes a non-stackable timed status without stacking", () => {
    const initial: StatusInstance[] = [{ statusId: "tipsy", remainingTicks: 1, stacks: 1 }];
    const out = addStatus(initial, "tipsy", emberfall);
    expect(out).toEqual([{ statusId: "tipsy", remainingTicks: 2, stacks: 1 }]);
  });

  it("removeStatus removes every instance of the status id", () => {
    const out = removeStatus([{ statusId: "tipsy", remainingTicks: 1, stacks: 1 }], "tipsy");
    expect(out).toEqual([]);
    expect(removeStatus(out, "tipsy")).toEqual([]); // absent is a no-op
  });

  it("ticks a timed status: applies effects, decrements, and removes at 0", () => {
    const state = makeState({
      player: { ...makeState().player, statuses: [{ statusId: "tipsy", remainingTicks: 2, stacks: 1 }] },
    });
    const tick1 = tickStatuses(state, emberfall);
    expect(tick1.player.stats.perception).toBe(9); // perception -1
    expect(tick1.player.stats.charisma).toBe(9); // charisma +1
    expect(tick1.player.statuses).toEqual([{ statusId: "tipsy", remainingTicks: 1, stacks: 1 }]);

    const tick2 = tickStatuses(tick1, emberfall);
    expect(tick2.player.stats.perception).toBe(8);
    expect(tick2.player.statuses).toEqual([]); // expired at 0
    expect(state.player.stats.perception).toBe(10); // original untouched
  });

  it("permanent statuses (null remainingTicks) keep applying and never expire", () => {
    const state = makeState({
      player: { ...makeState().player, statuses: [{ statusId: "ash-lung", remainingTicks: null, stacks: 1 }] },
    });
    let current = state;
    for (let i = 0; i < 5; i++) current = tickStatuses(current, emberfall);
    expect(current.player.statuses).toEqual([{ statusId: "ash-lung", remainingTicks: null, stacks: 1 }]);
    expect(current.player.stats.agility).toBe(1); // clamped to the agility stat min (1)
  });
});
