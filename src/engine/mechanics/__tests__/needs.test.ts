// Needs mechanics unit tests: continuous decay (player + NPCs), clamping,
// and sustained threshold effects.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../../loader";
import { applyNeedDecay, applyNeedThresholds } from "../needs";
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
      needs: { hunger: { value: 80 }, fatigue: { value: 85 } },
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
        needs: { hunger: { value: 60 } },
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
    ...overrides,
  };
}

describe("needs", () => {
  it("decays needs proportionally to hours elapsed (decay_per_day * hours/24)", () => {
    const state = makeState();
    const halfDay = applyNeedDecay(state, emberfall, 12);
    expect(halfDay.player.needs.hunger.value).toBe(70); // 20/day * 12/24
    const fullDay = applyNeedDecay(state, emberfall, 24);
    expect(fullDay.player.needs.hunger.value).toBe(60);
    expect(state.player.needs.hunger.value).toBe(80); // original untouched
  });

  it("decays NPC needs and clamps to the definition min", () => {
    const state = makeState();
    const out = applyNeedDecay(state, emberfall, 24);
    expect(out.npcs.elara.needs.hunger.value).toBe(40); // 60 - 20
    const clamped = applyNeedDecay(out, emberfall, 24 * 10);
    expect(clamped.npcs.elara.needs.hunger.value).toBe(0); // floor at min
    expect(clamped.player.needs.hunger.value).toBe(0);
  });

  it("zero elapsed hours changes nothing", () => {
    const state = makeState();
    expect(applyNeedDecay(state, emberfall, 0)).toBe(state);
  });

  it("fires threshold effects when a need crosses its level", () => {
    const state = makeState({
      player: {
        ...makeState().player,
        needs: { hunger: { value: 25 }, fatigue: { value: 85 } },
      },
    });
    const out = applyNeedThresholds(state, emberfall, 3);
    // hunger 25 <= 30 → strength -2; fatigue 85 >= 80 → perception -3
    expect(out.triggered).toContain("hunger:饥饿");
    expect(out.triggered).toContain("fatigue:疲惫不堪");
    expect(out.state.player.stats.strength).toBe(12);
    expect(out.state.player.stats.perception).toBe(7);
    expect(state.player.stats.strength).toBe(14); // original untouched
  });

  it("fires all thresholds past the value and does not fire above level", () => {
    const base = makeState();
    const starving = makeState({
      player: { ...base.player, needs: { hunger: { value: 0 } } },
    });
    const out = applyNeedThresholds(starving, emberfall, 3);
    expect(out.triggered).toEqual(["hunger:饥饿", "hunger:饿晕"]); // both crossed
    expect(out.state.player.stats.strength).toBe(12);
    expect(out.state.player.stats.hp).toBe(40);

    const full = makeState({
      player: { ...base.player, needs: { hunger: { value: 70 }, fatigue: { value: 50 } } },
    });
    const quiet = applyNeedThresholds(full, emberfall, 3);
    expect(quiet.triggered).toEqual([]);
    expect(quiet.state).toBe(full); // nothing fired, state identity kept
  });

  it("does not reapply a threshold until the need recovers and crosses again", () => {
    const base = makeState();
    const low = { ...base, player: { ...base.player, needs: { hunger: { value: 20 } } } };
    const first = applyNeedThresholds(low, emberfall, 1);
    const second = applyNeedThresholds(first.state, emberfall, 2);
    expect(second.triggered).toEqual([]);
    expect(second.state.player.stats.strength).toBe(first.state.player.stats.strength);
    const recovered = { ...second.state, player: { ...second.state.player, needs: { hunger: { value: 70 } } } };
    const clear = applyNeedThresholds(recovered, emberfall, 3);
    const lowAgain = { ...clear.state, player: { ...clear.state.player, needs: { hunger: { value: 20 } } } };
    expect(applyNeedThresholds(lowAgain, emberfall, 4).triggered).toContain("hunger:饥饿");
  });
});
