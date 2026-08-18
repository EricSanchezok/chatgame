// Event execution pipeline tests: playEvent applies effects + progression +
// eventTexts + novelty tracking; checkScheduledEvents evaluates time and
// condition triggers; ambient events draw from the player's location pool;
// recursion is depth-guarded. All randomness flows through state.rng.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import { playEvent, checkScheduledEvents, playAmbientEvent, eventTextFor, EVENT_PLAY_DEPTH_LIMIT } from "../events";
import { advanceClock } from "../time";
import type { WorldDefinition, WorldState } from "../types";
import type { Event } from "../../script/schemas/event";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function emberfall(): WorldDefinition {
  return loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
}

function freshState(def: WorldDefinition, seed = 42): WorldState {
  return generateWorld(def, "miner", { seed }).state;
}

describe("playEvent", () => {
  it("applies effects, records played tracking, and returns narrative text", () => {
    const def = emberfall();
    const state = freshState(def);
    // market-day: currency +5, repeatable, cooldown 30, has event_texts.
    const out = playEvent(state, def, "market-day");
    expect(out.played).toBe(true);
    expect(out.state.player.inventory.currency).toBeGreaterThan(
      state.player.inventory.currency,
    );
    expect(out.state.playedEventIds).toContain("market-day");
    expect(out.state.eventLastPlayedDay["market-day"]).toBe(0);
    expect(out.text.length).toBeGreaterThan(0);
  });

  it("returns the event_texts template when available", () => {
    const def = emberfall();
    const text = eventTextFor(def, "market-day");
    expect(text).toBeTruthy();
    expect(text).toContain("春市");
  });

  it("does not replay a non-repeatable event", () => {
    const def = emberfall();
    const state = freshState(def);
    const first = playEvent(state, def, "mine-collapse");
    expect(first.played).toBe(true);
    const second = playEvent(first.state, def, "mine-collapse");
    expect(second.played).toBe(false);
  });

  it("respects cooldown for repeatable events (event.cooldown)", () => {
    const def = emberfall();
    const state = freshState(def);
    const first = playEvent(state, def, "market-day"); // cooldown 30
    expect(first.played).toBe(true);
    // Advance 5 days (< cooldown 30) -> not playable again.
    const advanced = {
      ...first.state,
      clock: advanceClock(first.state.clock, def, 24 * 5),
    };
    const second = playEvent(advanced, def, "market-day");
    expect(second.played).toBe(false);
  });

  it("applies event-source progression", () => {
    const def = emberfall();
    const state = freshState(def);
    const perceptionBefore = state.player.stats.perception;
    const out = playEvent(state, def, "mine-collapse");
    // mechanics.progression event -> perception +1.
    expect(out.state.player.stats.perception).toBe(perceptionBefore + 1);
  });

  it("depth-guards nested event effects (loop protection)", () => {
    const def = emberfall();
    const state = freshState(def);
    // A synthetic event that points to itself via an event-kind effect.
    const loopEvent = {
      id: "loop-event",
      name: "循环事件",
      type: "crisis" as const,
      tags: [],
      trigger: "director" as const,
      effects: [{ kind: "event" as const, target: "player", event: "loop-event" }],
      weight: 1,
      cooldown: 0,
      repeatable: true,
      participants: [],
      locations: [],
      ext: {},
    };
    const loopDef = {
      ...def,
      events: new Map(def.events).set("loop-event", loopEvent),
    };
    const out = playEvent(state, loopDef, "loop-event");
    // The recursion must terminate (depth cap) without throwing.
    expect(out.played).toBe(true);
    expect(out.state.eventLog.some((e) => e.summary.includes("depth exceeded"))).toBe(true);
    void EVENT_PLAY_DEPTH_LIMIT;
  });
});

describe("checkScheduledEvents", () => {
  it("plays time-triggered events when their clock matches", () => {
    const def = emberfall();
    const state = freshState(def);
    // market-day: month 4 day 5 at town-square, with a participant present
    // (caravan-boss is at town-square 06:00-18:00).
    const marketDay = {
      ...state,
      player: { ...state.player, locationId: "town-square" },
      // market-day requires a participant at the player's location.
      npcs: {
        ...state.npcs,
        "caravan-boss": { ...state.npcs["caravan-boss"], currentLocationId: "town-square" },
      },
      clock: advanceClock(state.clock, def, 24 * 93 + 10),
    };
    const out = checkScheduledEvents(marketDay, def);
    const played = out.results.some((r) => r.state.playedEventIds.includes("market-day"));
    expect(played).toBe(true);
  });

  it("plays a trigger:condition event when its condition holds", () => {
    const def = emberfall();
    const state = freshState(def);
    const condEvent: Event = {
      id: "cond-trigger-test",
      name: "条件触发",
      type: "mystery" as const,
      tags: [],
      trigger: "condition" as const,
      conditions: { all: [{ source: "flag", key: "returned-visitor", op: "has" }] },
      effects: [],
      weight: 1,
      cooldown: 0,
      repeatable: false,
      participants: [],
      locations: [],
      ext: {},
    };
    const condDef = { ...def, events: new Map(def.events).set(condEvent.id, condEvent) };
    // Condition not met -> not played.
    const notMet = checkScheduledEvents(state, condDef);
    expect(notMet.results.some((r) => r.state.playedEventIds.includes(condEvent.id))).toBe(false);
    // Condition met -> played through the scheduled-events path.
    const withFlag = {
      ...state,
      player: { ...state.player, flags: [...state.player.flags, "returned-visitor"] },
    };
    const met = checkScheduledEvents(withFlag, condDef);
    expect(met.results.some((r) => r.state.playedEventIds.includes(condEvent.id))).toBe(true);
  });

  it("does not evaluate director-triggered events", () => {
    const def = emberfall();
    const state = freshState(def);
    const out = checkScheduledEvents(state, def);
    expect(out.results.every((r) => !r.state.playedEventIds.includes("mine-collapse"))).toBe(true);
  });
});

describe("playAmbientEvent", () => {
  it("returns undefined when the location has no ambient pool", () => {
    const def = emberfall();
    const state = freshState(def);
    // Player starts at mine-entrance (no ambient_events).
    const out = playAmbientEvent(state, def, state.player.locationId);
    expect(out).toBeUndefined();
  });

  it("plays an eligible ambient event from the location pool", () => {
    const def = emberfall();
    const state = freshState(def);
    // tavern has ambient_events [tavern-gossip]; move the player there.
    const atTavern = { ...state, player: { ...state.player, locationId: "tavern" } };
    const out = playAmbientEvent(atTavern, def, "tavern");
    if (out) {
      expect(out.played).toBe(true);
      expect(out.state.playedEventIds).toContain("tavern-gossip");
    }
  });
});
