// Status mechanics unit tests: add/stack/remove, timed tick countdown with
// effect application, expiry at 0, and permanent statuses.
import { describe, expect, it } from "vitest";
import { loadCoreTestDefinition } from "../../__tests__/core-test-fixture";
import { addStatus, removeStatus, tickStatuses } from "../status";
import type { StatusInstance, WorldDefinition, WorldState } from "../../types";
import { createClock } from "../../time";

const coreDefinition = loadCoreTestDefinition();
const definition: WorldDefinition = Object.freeze({
  ...coreDefinition,
  mechanics: {
    ...coreDefinition.mechanics,
    stats: [
      ...coreDefinition.mechanics.stats,
      { name: "perception", min: 0, max: 20, initial: 10 },
      { name: "charisma", min: 0, max: 20, initial: 8 },
      { name: "agility", min: 1, max: 20, initial: 10 },
    ],
    status_effects: [
      {
        id: "signal-drift",
        name: "Signal drift",
        kind: "debuff",
        effects: [
          { kind: "stat", direction: "add", target: "player", stat: "perception", value: -1 },
          { kind: "stat", direction: "add", target: "player", stat: "charisma", value: 1 },
        ],
        duration: 2,
        stackable: false,
      },
      {
        id: "calibration-mark",
        name: "Calibration mark",
        kind: "debuff",
        effects: [{ kind: "stat", direction: "add", target: "player", stat: "hp", value: -10 }],
        stackable: true,
      },
      {
        id: "persistent-drag",
        name: "Persistent drag",
        kind: "debuff",
        effects: [{ kind: "stat", direction: "add", target: "player", stat: "agility", value: -2 }],
        stackable: false,
      },
    ],
  },
});

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    scriptId: definition.script.id,
    clock: createClock(definition, "clear", "baseline"),
    player: {
      originId: "observer",
      name: "观察员",
      stats: { hp: 50, charisma: 8, perception: 10, agility: 10 },
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

describe("status", () => {
  it("addStatus creates a timed instance with the definition duration", () => {
    const statuses = addStatus([], "signal-drift", definition);
    expect(statuses).toEqual([{ statusId: "signal-drift", remainingTicks: 2, stacks: 1 }]);
  });

  it("addStatus stacks stackable statuses and restarts their timer", () => {
    const initial: StatusInstance[] = [{ statusId: "calibration-mark", remainingTicks: 1, stacks: 1 }];
    const out = addStatus(initial, "calibration-mark", definition);
    expect(out[0].stacks).toBe(2);
    expect(out[0].remainingTicks).toBeNull(); // no duration → permanent
  });

  it("addStatus refreshes a non-stackable timed status without stacking", () => {
    const initial: StatusInstance[] = [{ statusId: "signal-drift", remainingTicks: 1, stacks: 1 }];
    const out = addStatus(initial, "signal-drift", definition);
    expect(out).toEqual([{ statusId: "signal-drift", remainingTicks: 2, stacks: 1 }]);
  });

  it("removeStatus removes every instance of the status id", () => {
    const out = removeStatus([{ statusId: "signal-drift", remainingTicks: 1, stacks: 1 }], "signal-drift");
    expect(out).toEqual([]);
    expect(removeStatus(out, "signal-drift")).toEqual([]); // absent is a no-op
  });

  it("ticks a timed status: applies effects, decrements, and removes at 0", () => {
    const state = makeState({
      player: { ...makeState().player, statuses: [{ statusId: "signal-drift", remainingTicks: 2, stacks: 1 }] },
    });
    const tick1 = tickStatuses(state, definition);
    expect(tick1.player.stats.perception).toBe(9); // perception -1
    expect(tick1.player.stats.charisma).toBe(9); // charisma +1
    expect(tick1.player.statuses).toEqual([{ statusId: "signal-drift", remainingTicks: 1, stacks: 1 }]);

    const tick2 = tickStatuses(tick1, definition);
    expect(tick2.player.stats.perception).toBe(8);
    expect(tick2.player.statuses).toEqual([]); // expired at 0
    expect(state.player.stats.perception).toBe(10); // original untouched
  });

  it("permanent statuses (null remainingTicks) keep applying and never expire", () => {
    const state = makeState({
      player: { ...makeState().player, statuses: [{ statusId: "persistent-drag", remainingTicks: null, stacks: 1 }] },
    });
    let current = state;
    for (let i = 0; i < 5; i++) current = tickStatuses(current, definition);
    expect(current.player.statuses).toEqual([{ statusId: "persistent-drag", remainingTicks: null, stacks: 1 }]);
    expect(current.player.stats.agility).toBe(1); // clamped to the agility stat min (1)
  });
});
