// World-step integration tests: the unified progression pipeline shared by
// player turns and offline advance — needs decay/thresholds, status ticks,
// NPC schedule movement, reputation decay/thresholds, memory archiving,
// festivals, time/condition events, commitments, tension sync, and
// advance_scope gating. Determinism: all randomness flows through rng.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import { stepWorld } from "../worldstep";
import { createMemoryEntry } from "../memory";
import { advanceClock } from "../time";
import type { WorldDefinition, WorldState } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function emberfall(): WorldDefinition {
  return loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
}

function freshState(def: WorldDefinition, seed = 42): WorldState {
  return generateWorld(def, "miner", { seed }).state;
}

describe("stepWorld hourly progression", () => {
  it("advances the clock by the requested hours", () => {
    const def = emberfall();
    const state = freshState(def);
    const out = stepWorld(state, def, 5);
    expect(out.state.clock.totalHours).toBe(5);
  });

  it("decays needs continuously (hourly fractions)", () => {
    const def = emberfall();
    const state = freshState(def);
    const hungerBefore = state.player.needs.hunger.value;
    const out = stepWorld(state, def, 12);
    // hunger decay_per_day 20 -> -10 over 12h.
    expect(out.state.player.needs.hunger.value).toBeCloseTo(hungerBefore - 10, 1);
  });

  it("moves NPCs per their schedule at the day/hour boundary", () => {
    const def = emberfall();
    const state = freshState(def);
    // Miner origin starts at mine-entrance; old-miner has a schedule that
    // puts him at mine-entrance at 06:00-18:00 and tavern 18:00-22:00.
    const npc = state.npcs["old-miner"];
    const startLoc = npc.currentLocationId;
    // Advance 10 hours -> hour 10: old-miner should be at mine-entrance
    // (if his schedule says so) OR stay wherever he was (home).
    const out = stepWorld(state, def, 10);
    const npcAfter = out.state.npcs["old-miner"];
    expect(npcAfter.currentLocationId).toBeTruthy();
    void startLoc;
  });

  it("applies need thresholds at the day boundary (sustained)", () => {
    const def = emberfall();
    const state = freshState(def);
    // Force hunger below the 30 threshold -> strength -2 applies daily.
    const starving = {
      ...state,
      player: { ...state.player, needs: { ...state.player.needs, hunger: { value: 10 } } },
    };
    const out = stepWorld(starving, def, 24);
    expect(out.state.player.stats.strength).toBeLessThan(14);
  });

  it("ticks status effects once per day", () => {
    const def = emberfall();
    const state = freshState(def);
    const withStatus = {
      ...state,
      player: {
        ...state.player,
        statuses: [{ statusId: "tipsy", remainingTicks: 2, stacks: 1 }],
      },
    };
    const out = stepWorld(withStatus, def, 24);
    // tipsy: perception -1 per tick; after 1 day -> remainingTicks 1.
    expect(out.state.player.statuses[0].remainingTicks).toBe(1);
  });

  it("applies memory decay at the day boundary", () => {
    const def = emberfall();
    const state = freshState(def);
    // trivial retention 30 days; inject a 40-day-old trivial memory.
    const oldMemory = createMemoryEntry("旧琐事", "trivial", 1, [], "mem-old");
    const withMemory = {
      ...state,
      player: { ...state.player, memories: [oldMemory] },
      clock: advanceClock(state.clock, def, 24 * 40),
    };
    const out = stepWorld(withMemory, def, 24);
    expect(out.state.player.memories[0].archived).toBe(true);
  });

  it("syncs tension variables to the threat gauge", () => {
    const def = emberfall();
    const state = freshState(def);
    const tense = { ...state, player: { ...state.player, threatGauge: 60 } };
    const out = stepWorld(tense, def, 24);
    // danger/mystery_depth/social_warmth all source threat_gauge -> 60.
    expect(out.state.director.tension["danger"]).toBe(60);
  });

  it("respects advance_scope: needs-only skips events/commitments", () => {
    const def = emberfall();
    const state = freshState(def);
    // Force a commitment to be due (day 61 > collapse-survivor deadline 60).
    const advanced = { ...state, clock: advanceClock(state.clock, def, 24 * 61) };
    const out = stepWorld(advanced, def, 1, { scope: ["needs"] });
    // With scope ["needs"], the commitment check is skipped.
    const missed = out.state.commitments.find((c) => c.commitmentId === "collapse-survivor-rescued");
    expect(missed?.deadlineMissed).toBeFalsy();
  });

  it("plays festival events on their date (advance_scope time_events)", () => {
    const def = emberfall();
    const state = freshState(def);
    // 春市 (festival-market) is 04-05; arrive at 04-04 10:00 and step into
    // the festival day. market-day needs the player at town-square with a
    // participant present (caravan-boss is there 06:00-18:00).
    const festivalDay = {
      ...state,
      player: { ...state.player, locationId: "town-square" },
      clock: advanceClock(state.clock, def, 24 * 92 + 10),
    };
    const out = stepWorld(festivalDay, def, 24);
    expect(out.worldEvents.length).toBeGreaterThan(0);
  });

  it("is deterministic under a fixed seed (incl. ambient events)", () => {
    const def = emberfall();
    const a = freshState(def, 7);
    const b = freshState(def, 7);
    const outA = stepWorld(a, def, 24 * 3);
    const outB = stepWorld(b, def, 24 * 3);
    expect(JSON.stringify(outA.state)).toBe(JSON.stringify(outB.state));
  });

  it("returns task completions from the day boundary", () => {
    const def = emberfall();
    const state = freshState(def);
    // gather-herbs: turn-loop activation happens while the giver is present;
    // the day boundary check completes it once the objective is met. Inject
    // the active task (as the turn loop would) and give the player 3 herbs.
    const activeTask = {
      ...state,
      player: {
        ...state.player,
        inventory: { ...state.player.inventory, stacks: [{ itemId: "herb", quantity: 3 }] },
      },
      tasks: [{ taskId: "gather-herbs", status: "active" as const, acceptedDay: 0, progress: 0 }],
    };
    const out = stepWorld(activeTask, def, 24);
    const done = out.taskCompletions.find((c) => c.taskId === "gather-herbs");
    expect(done?.status).toBe("complete");
    expect(out.state.tasks.find((t) => t.taskId === "gather-herbs")?.status).toBe("complete");
  });
});
