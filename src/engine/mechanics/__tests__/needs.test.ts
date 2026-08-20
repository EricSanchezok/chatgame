// Needs mechanics unit tests: continuous decay (player + NPCs), clamping,
// and sustained threshold effects.
import { describe, expect, it } from "vitest";
import { loadCoreTestDefinition } from "../../__tests__/core-test-fixture";
import { applyNeedDecay, applyNeedThresholds } from "../needs";
import type { WorldDefinition, WorldState } from "../../types";
import { createClock } from "../../time";

const coreDefinition = loadCoreTestDefinition();
const definition: WorldDefinition = Object.freeze({
  ...coreDefinition,
  mechanics: {
    ...coreDefinition.mechanics,
    stats: [
      ...coreDefinition.mechanics.stats,
      { name: "strength", min: 0, max: 20, initial: 14 },
      { name: "perception", min: 0, max: 20, initial: 10 },
    ],
    needs: [
      {
        name: "energy",
        min: 0,
        max: 100,
        initial: 80,
        decay_per_day: 20,
        thresholds: [
          {
            level: 30,
            label: "low",
            effects: [{ kind: "stat", direction: "add", target: "player", stat: "strength", value: -2 }],
          },
          {
            level: 0,
            label: "empty",
            effects: [{ kind: "stat", direction: "add", target: "player", stat: "hp", value: -10 }],
          },
        ],
      },
      {
        name: "load",
        min: 0,
        max: 100,
        initial: 20,
        decay_per_day: -15,
        thresholds: [{
          level: 80,
          label: "overloaded",
          effects: [{ kind: "stat", direction: "add", target: "player", stat: "perception", value: -3 }],
        }],
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
      stats: { hp: 50, strength: 14, perception: 10 },
      skills: { focus: 6 },
      needs: { energy: { value: 80 }, load: { value: 85 } },
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
        needs: { energy: { value: 60 } },
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

describe("needs", () => {
  it("decays needs proportionally to hours elapsed (decay_per_day * hours/24)", () => {
    const state = makeState();
    const halfDay = applyNeedDecay(state, definition, 12);
    expect(halfDay.player.needs.energy.value).toBe(70); // 20/day * 12/24
    const fullDay = applyNeedDecay(state, definition, 24);
    expect(fullDay.player.needs.energy.value).toBe(60);
    expect(state.player.needs.energy.value).toBe(80); // original untouched
  });

  it("decays NPC needs and clamps to the definition min", () => {
    const state = makeState();
    const out = applyNeedDecay(state, definition, 24);
    expect(out.npcs.operator.needs.energy.value).toBe(40); // 60 - 20
    const clamped = applyNeedDecay(out, definition, 24 * 10);
    expect(clamped.npcs.operator.needs.energy.value).toBe(0); // floor at min
    expect(clamped.player.needs.energy.value).toBe(0);
  });

  it("zero elapsed hours changes nothing", () => {
    const state = makeState();
    expect(applyNeedDecay(state, definition, 0)).toBe(state);
  });

  it("fires threshold effects when a need crosses its level", () => {
    const state = makeState({
      player: {
        ...makeState().player,
        needs: { energy: { value: 25 }, load: { value: 85 } },
      },
    });
    const out = applyNeedThresholds(state, definition, 3);
    // energy 25 <= 30 → strength -2; load 85 >= 80 → perception -3
    expect(out.triggered).toContain("energy:low");
    expect(out.triggered).toContain("load:overloaded");
    expect(out.state.player.stats.strength).toBe(12);
    expect(out.state.player.stats.perception).toBe(7);
    expect(state.player.stats.strength).toBe(14); // original untouched
  });

  it("fires all thresholds past the value and does not fire above level", () => {
    const base = makeState();
    const starving = makeState({
      player: { ...base.player, needs: { energy: { value: 0 } } },
    });
    const out = applyNeedThresholds(starving, definition, 3);
    expect(out.triggered).toEqual(["energy:low", "energy:empty"]); // both crossed
    expect(out.state.player.stats.strength).toBe(12);
    expect(out.state.player.stats.hp).toBe(40);

    const full = makeState({
      player: { ...base.player, needs: { energy: { value: 70 }, load: { value: 50 } } },
    });
    const quiet = applyNeedThresholds(full, definition, 3);
    expect(quiet.triggered).toEqual([]);
    expect(quiet.state).toBe(full); // nothing fired, state identity kept
  });

  it("does not reapply a threshold until the need recovers and crosses again", () => {
    const base = makeState();
    const low = { ...base, player: { ...base.player, needs: { energy: { value: 20 } } } };
    const first = applyNeedThresholds(low, definition, 1);
    const second = applyNeedThresholds(first.state, definition, 2);
    expect(second.triggered).toEqual([]);
    expect(second.state.player.stats.strength).toBe(first.state.player.stats.strength);
    const recovered = { ...second.state, player: { ...second.state.player, needs: { energy: { value: 70 } } } };
    const clear = applyNeedThresholds(recovered, definition, 3);
    const lowAgain = { ...clear.state, player: { ...clear.state.player, needs: { energy: { value: 20 } } } };
    expect(applyNeedThresholds(lowAgain, definition, 4).triggered).toContain("energy:low");
  });
});
