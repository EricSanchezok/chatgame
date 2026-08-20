// Progression mechanics unit tests: source-matched stat/skill growth with
// cap/min/max clamping on the player and NPCs.
import { describe, expect, it } from "vitest";
import { loadCoreTestDefinition } from "../../__tests__/core-test-fixture";
import { applyProgression } from "../progression";
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
      { name: "agility", min: 0, max: 20, initial: 10 },
      { name: "perception", min: 0, max: 20, initial: 10 },
    ],
    skills: [
      ...(coreDefinition.mechanics.skills ?? []),
      { name: "persuasion", min: 0, max: 20, initial: 4 },
      { name: "perception", min: 0, max: 20, initial: 6 },
      { name: "survival", min: 0, max: 20, initial: 0 },
      { name: "crafting", min: 0, max: 20, initial: 0 },
    ],
    progression: [
      { source: "stat_check" as const, target: "strength", amount: 1, cap: 20 },
      { source: "stat_check" as const, target: "agility", amount: 1, cap: 20 },
      { source: "skill_check" as const, target: "persuasion", amount: 1, cap: 20 },
      { source: "skill_check" as const, target: "survival", amount: 1, cap: 20 },
      { source: "task" as const, target: "crafting", amount: 1, cap: 20 },
      { source: "event" as const, target: "perception", amount: 1, cap: 20 },
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
      stats: { hp: 50, strength: 14, perception: 10, agility: 10 },
      skills: { persuasion: 4, perception: 6 },
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
        stats: { hp: 80, strength: 14 },
        skills: { persuasion: 10 },
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

describe("progression", () => {
  it("stat_check grows matching stats only on the authoritative actor", () => {
    const state = makeState();
    const out = applyProgression(state, definition, "stat_check", { target: "strength" });
    expect(out.state.player.stats.strength).toBe(15); // +1
    expect(out.state.player.stats.agility).toBe(10); // a strength check does not train agility
    expect(out.state.player.skills.persuasion).toBe(4); // skill_check only
    expect(out.state.npcs.operator.stats.strength).toBe(14); // only the authoritative actor grows
    expect(state.player.stats.strength).toBe(14); // original untouched
  });

  it("skill_check grows skills only", () => {
    const out = applyProgression(makeState(), definition, "skill_check");
    expect(out.state.player.skills.persuasion).toBe(5);
    expect(out.state.player.skills.perception).toBe(6); // survival is the target, not perception
    expect(out.state.player.stats.strength).toBe(14); // stats untouched
  });

  it("task source grows the crafting skill on entities that have it", () => {
    const base = makeState();
    const state = makeState({ player: { ...base.player, skills: { ...base.player.skills, crafting: 3 } } });
    const out = applyProgression(state, definition, "task");
    expect(out.state.player.skills.crafting).toBe(4);
  });

  it("event source grows stats when the target name collides (stats checked first)", () => {
    const state = makeState();
    const out = applyProgression(state, definition, "event");
    expect(out.state.player.stats.perception).toBe(11); // stats win over the same-named skill
    expect(out.state.player.skills.perception).toBe(6); // skill untouched
    expect(out.summaries).toHaveLength(1);
  });

  it("clamps at the entry cap and skips summaries when nothing changed", () => {
    const base = makeState();
    const state = makeState({ player: { ...base.player, stats: { ...base.player.stats, perception: 20 } } });
    const out = applyProgression(state, definition, "event");
    expect(out.state.player.stats.perception).toBe(20); // no change past cap
    expect(out.summaries).toEqual([]); // nothing applied → no summary
  });

  it("summaries report applied entries with entity ids", () => {
    const base = makeState();
    const state = makeState({
      npcs: {
        ...base.npcs,
        operator: {
          ...base.npcs.operator,
          skills: { ...base.npcs.operator.skills, survival: 5 },
        },
      },
    });
    const out = applyProgression(state, definition, "skill_check", { entityId: "operator" });
    const npcSummary = out.summaries.find((s) => s.entity === "operator" && s.target === "survival");
    expect(npcSummary).toEqual({ source: "skill_check", target: "survival", entity: "operator", amount: 1 });
    expect(out.state.npcs.operator.skills.survival).toBe(6);
  });
});
