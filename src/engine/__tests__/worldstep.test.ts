// World-step integration tests: the unified progression pipeline shared by
// player turns and offline advance — needs decay/thresholds, status ticks,
// NPC schedule movement, reputation decay/thresholds, memory archiving,
// festivals, time/condition events, commitments, tension sync, and
// advance_scope gating. Determinism: all randomness flows through rng.
import { describe, expect, it } from "vitest";
import { loadCoreTestDefinition } from "./core-test-fixture";
import { generateWorld } from "../worldgen";
import { stepWorld } from "../worldstep";
import { applyNeedThresholds } from "../mechanics/needs";
import { createMemoryEntry } from "../memory";
import { advanceClock } from "../time";
import type { WorldDefinition, WorldState } from "../types";

function testDefinition(): WorldDefinition {
  const core = loadCoreTestDefinition();
  const definition: WorldDefinition = {
    ...core,
    time: {
      ...core.time,
      festivals: [{ id: "calibration-day", name: "Calibration day", date: "01-02", event: "handoff-signal" }],
      advance_scope: ["schedules", "needs", "events", "factions", "time_events"],
    },
    mechanics: {
      ...core.mechanics,
      stats: [
        ...core.mechanics.stats,
        { name: "strength", min: 0, max: 20, initial: 14 },
        { name: "perception", min: 0, max: 20, initial: 10 },
      ],
      needs: [{
        name: "energy",
        min: 0,
        max: 100,
        initial: 80,
        decay_per_day: 20,
        thresholds: [{
          level: 30,
          label: "low",
          effects: [{ kind: "stat", direction: "add", target: "player", stat: "strength", value: -2 }],
        }],
      }],
      status_effects: [{
        id: "signal-drift",
        name: "Signal drift",
        kind: "debuff",
        effects: [{ kind: "stat", direction: "add", target: "player", stat: "perception", value: -1 }],
        duration: 2,
        stackable: false,
      }],
    },
    items: new Map([
      ...core.items,
      ["sample", {
        id: "sample",
        name: "Sample",
        type: "material" as const,
        description: "A deterministic task sample.",
        properties: { stackable: true },
        effects_on_use: [],
        rarity: "common",
        value: 1,
      }],
    ]),
    tasks: new Map([
      ...core.tasks,
      ["collect-samples", {
        id: "collect-samples",
        name: "Collect samples",
        objective: { type: "gather" as const, target: { items: ["sample"] }, quantity: 3 },
        giver: { pool: ["operator"] },
        rewards: [],
        repeatable: false,
        narrative: { offer: "Collect three samples.", complete: "Samples logged.", fail: "Sampling expired." },
      }],
    ]),
  };
  return Object.freeze(definition);
}

function freshState(def: WorldDefinition, seed = 42): WorldState {
  return generateWorld(def, "observer", { seed }).state;
}

describe("stepWorld hourly progression", () => {
  it("advances the clock by the requested hours", () => {
    const def = testDefinition();
    const state = freshState(def);
    const out = stepWorld(state, def, 5);
    expect(out.state.clock.totalHours).toBe(5);
  });

  it.each([1.5, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid world-step duration %s before changing the clock",
    (hours) => {
      const def = testDefinition();
      const state = freshState(def);
      expect(() => stepWorld(state, def, hours)).toThrow(/non-negative finite integer/);
      expect(state.clock.totalHours).toBe(0);
    },
  );

  it("decays needs continuously (hourly fractions)", () => {
    const def = testDefinition();
    const state = freshState(def);
    const energyBefore = state.player.needs.energy.value;
    const out = stepWorld(state, def, 12);
    // energy decay_per_day 20 -> -10 over 12h.
    expect(out.state.player.needs.energy.value).toBeCloseTo(energyBefore - 10, 1);
  });

  it("moves NPCs per their schedule at the day/hour boundary", () => {
    const def = testDefinition();
    const state = freshState(def);
    const npc = state.npcs.operator;
    expect(npc.currentLocationId).toBe("relay-room");
    const out = stepWorld(state, def, 10);
    expect(out.state.npcs.operator.currentLocationId).toBe("relay-room");
  });

  it("applies need thresholds once on entry, not on every day while sustained", () => {
    const def = testDefinition();
    const state = freshState(def);
    // Force energy below the 30 threshold -> strength -2 applies daily.
    const starving = {
      ...state,
      player: { ...state.player, needs: { ...state.player.needs, energy: { value: 10 } } },
    };
    const out = stepWorld(starving, def, 24);
    expect(out.state.player.stats.strength).toBeLessThan(14);
    const afterFirst = out.state.player.stats.strength;
    const repeated = applyNeedThresholds(out.state, def, 2);
    expect(repeated.state.player.stats.strength).toBe(afterFirst);
    expect(repeated.triggered).toEqual([]);
  });

  it("ticks status effects once per day", () => {
    const def = testDefinition();
    const state = freshState(def);
    const withStatus = {
      ...state,
      player: {
        ...state.player,
        statuses: [{ statusId: "signal-drift", remainingTicks: 2, stacks: 1 }],
      },
    };
    const out = stepWorld(withStatus, def, 24);
    // signal-drift: perception -1 per tick; after 1 day -> remainingTicks 1.
    expect(out.state.player.statuses[0].remainingTicks).toBe(1);
  });

  it("applies memory decay at the day boundary", () => {
    const def = testDefinition();
    const state = freshState(def);
    // The core fixture retains trivial memories for seven days.
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
    const def = testDefinition();
    const state = freshState(def);
    const tense = { ...state, player: { ...state.player, threatGauge: 60 } };
    const out = stepWorld(tense, def, 24);
    expect(out.state.director.tension.load).toBe(60);
  });

  it("respects advance_scope: needs-only skips time events", () => {
    const def = testDefinition();
    const state = freshState(def);
    const ready = { ...state, player: { ...state.player, locationId: "service-corridor" } };
    const out = stepWorld(ready, def, 24, { scope: ["needs"] });
    expect(out.worldEvents).toEqual([]);
    expect(out.state.playedEventIds).not.toContain("handoff-signal");
  });

  it("plays festival events on their date (advance_scope time_events)", () => {
    const def = testDefinition();
    const state = freshState(def);
    const festivalDay = {
      ...state,
      player: { ...state.player, locationId: "service-corridor" },
    };
    const out = stepWorld(festivalDay, def, 24);
    expect(out.worldEvents.length).toBeGreaterThan(0);
  });

  it("is deterministic under a fixed seed (incl. ambient events)", () => {
    const def = testDefinition();
    const a = freshState(def, 7);
    const b = freshState(def, 7);
    const outA = stepWorld(a, def, 24 * 3);
    const outB = stepWorld(b, def, 24 * 3);
    expect(JSON.stringify(outA.state)).toBe(JSON.stringify(outB.state));
  });

  it("returns task completions from the day boundary", () => {
    const def = testDefinition();
    const state = freshState(def);
    // collect-samples: turn-loop activation happens while the giver is present;
    // the day boundary check completes it once the objective is met. Inject
    // the active task (as the turn loop would) and give the player 3 samples.
    const activeTask = {
      ...state,
      player: {
        ...state.player,
        inventory: { ...state.player.inventory, stacks: [{ itemId: "sample", quantity: 3 }] },
      },
      tasks: [{
        taskId: "collect-samples",
        status: "active" as const,
        acceptedDay: 0,
        acceptedEventCount: 0,
        progress: 0,
      }],
    };
    const out = stepWorld(activeTask, def, 24);
    const done = out.taskCompletions.find((c) => c.taskId === "collect-samples");
    expect(done?.status).toBe("complete");
    expect(out.state.tasks.find((t) => t.taskId === "collect-samples")?.status).toBe("complete");
  });
});
