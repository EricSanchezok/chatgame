// Progression mechanics unit tests: source-matched stat/skill growth with
// cap/min/max clamping on the player and NPCs.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../../loader";
import { applyProgression } from "../progression";
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
    runtimeState: {},
    ...overrides,
  };
}

describe("progression", () => {
  it("stat_check grows matching stats only on the authoritative actor", () => {
    const state = makeState();
    const out = applyProgression(state, emberfall, "stat_check", { target: "strength" });
    expect(out.state.player.stats.strength).toBe(15); // +1
    expect(out.state.player.stats.agility).toBe(10); // a strength check does not train agility
    expect(out.state.player.skills.persuasion).toBe(4); // skill_check only
    expect(out.state.npcs.elara.stats.charisma).toBe(14); // no matching entry
    expect(state.player.stats.strength).toBe(14); // original untouched
  });

  it("skill_check grows skills only", () => {
    const out = applyProgression(makeState(), emberfall, "skill_check");
    expect(out.state.player.skills.persuasion).toBe(5);
    expect(out.state.player.skills.perception).toBe(6); // survival is the target, not perception
    expect(out.state.player.stats.strength).toBe(14); // stats untouched
  });

  it("task source grows the crafting skill on entities that have it", () => {
    const state = makeState();
    state.player.skills.crafting = 3;
    const out = applyProgression(state, emberfall, "task");
    expect(out.state.player.skills.crafting).toBe(4);
  });

  it("event source grows stats when the target name collides (stats checked first)", () => {
    const state = makeState();
    const out = applyProgression(state, emberfall, "event");
    expect(out.state.player.stats.perception).toBe(11); // stats win over the same-named skill
    expect(out.state.player.skills.perception).toBe(6); // skill untouched
    expect(out.summaries).toHaveLength(1);
  });

  it("clamps at the entry cap and skips summaries when nothing changed", () => {
    const state = makeState();
    state.player.stats.perception = 20; // already at the cap
    const out = applyProgression(state, emberfall, "event");
    expect(out.state.player.stats.perception).toBe(20); // no change past cap
    expect(out.summaries).toEqual([]); // nothing applied → no summary
  });

  it("summaries report applied entries with entity ids", () => {
    const state = makeState();
    state.npcs.elara.skills.survival = 5;
    const out = applyProgression(state, emberfall, "skill_check", { entityId: "elara" });
    const npcSummary = out.summaries.find((s) => s.entity === "elara" && s.target === "survival");
    expect(npcSummary).toEqual({ source: "skill_check", target: "survival", entity: "elara", amount: 1 });
    expect(out.state.npcs.elara.skills.survival).toBe(6);
  });
});
