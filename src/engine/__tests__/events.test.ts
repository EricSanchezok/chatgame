// Event execution pipeline tests: effects, progression, narrative templates,
// novelty, scheduled triggers, ambient pools, and recursion protection.
import { describe, expect, it } from "vitest";
import { generateWorld } from "../worldgen";
import {
  EVENT_PLAY_DEPTH_LIMIT,
  checkScheduledEvents,
  eventTextFor,
  playAmbientEvent,
  playEvent,
} from "../events";
import { advanceClock } from "../time";
import type { WorldDefinition, WorldState } from "../types";
import type { Event } from "../../script/schemas/event";
import { loadCoreTestDefinition } from "./core-test-fixture";

function event(id: string, overrides: Partial<Event> = {}): Event {
  return {
    id,
    name: id,
    type: "test",
    tags: [],
    trigger: "director",
    effects: [],
    weight: 1,
    cooldown: 0,
    repeatable: false,
    participants: [],
    locations: [],
    ext: {},
    ...overrides,
  };
}

function eventDefinition(): WorldDefinition {
  const base = loadCoreTestDefinition();
  const pulse = event("calibration-pulse", {
    effects: [{ kind: "currency", direction: "add", target: "player", value: 5 }],
    narrative: { template: "calibration-pulse" },
    repeatable: true,
    cooldown: 30,
  });
  const oneShot = event("one-shot-alert");
  const scheduled = event("scheduled-check", {
    trigger: "time",
    conditions: { all: [{ source: "time", key: "hour", op: "eq", value: 10 }] },
  });
  const conditional = event("conditional-check", {
    trigger: "condition",
    conditions: { all: [{ source: "flag", key: "return-authorized", op: "has" }] },
  });
  const directorOnly = event("director-only");
  const ambient = event("corridor-hum", { locations: ["service-corridor"] });
  const corridor = base.locations.get("service-corridor")!;
  return {
    ...base,
    mechanics: {
      ...base.mechanics,
      progression: [
        ...(base.mechanics.progression ?? []),
        { source: "event", target: "hp", amount: 1, cap: 100 },
      ],
    },
    events: new Map([
      [pulse.id, pulse],
      [oneShot.id, oneShot],
      [scheduled.id, scheduled],
      [conditional.id, conditional],
      [directorOnly.id, directorOnly],
      [ambient.id, ambient],
    ]),
    locations: new Map(base.locations).set(corridor.id, {
      ...corridor,
      ambient_events: [ambient.id],
    }),
    narrative: {
      ...base.narrative,
      eventTexts: [
        ...base.narrative.eventTexts,
        {
          event_id: pulse.id,
          templates: [{ tone: "neutral", text: "校准脉冲沿线路通过。", slot_vars: [] }],
          ext: {},
        },
      ],
    },
  };
}

function freshState(definition: WorldDefinition, seed = 42): WorldState {
  return generateWorld(definition, "observer", { seed }).state;
}

describe("playEvent", () => {
  it("applies effects, records novelty tracking, and returns narrative text", () => {
    const definition = eventDefinition();
    const state = freshState(definition);
    const out = playEvent(state, definition, "calibration-pulse");

    expect(out.played).toBe(true);
    expect(out.state.player.inventory.currency).toBe(state.player.inventory.currency + 5);
    expect(out.state.playedEventIds).toContain("calibration-pulse");
    expect(out.state.eventLastPlayedDay["calibration-pulse"]).toBe(0);
    expect(out.text).toContain("校准脉冲");
  });

  it("returns the event text template when available", () => {
    expect(eventTextFor(eventDefinition(), "calibration-pulse")).toContain("校准脉冲");
  });

  it("does not replay a non-repeatable event", () => {
    const definition = eventDefinition();
    const first = playEvent(freshState(definition), definition, "one-shot-alert");
    expect(first.played).toBe(true);
    expect(playEvent(first.state, definition, "one-shot-alert").played).toBe(false);
  });

  it("respects a repeatable event's cooldown", () => {
    const definition = eventDefinition();
    const first = playEvent(freshState(definition), definition, "calibration-pulse");
    const advanced = {
      ...first.state,
      clock: advanceClock(first.state.clock, definition, definition.time.day_length_hours * 5),
    };
    expect(playEvent(advanced, definition, "calibration-pulse").played).toBe(false);
  });

  it("applies event-source progression", () => {
    const definition = eventDefinition();
    const state = freshState(definition);
    const out = playEvent(state, definition, "one-shot-alert");
    expect(out.state.player.stats.hp).toBe(state.player.stats.hp + 1);
  });

  it("depth-guards nested event effects", () => {
    const base = eventDefinition();
    const loopEvent = event("loop-event", {
      effects: [{ kind: "event", target: "player", event: "loop-event" }],
      repeatable: true,
    });
    const definition = { ...base, events: new Map(base.events).set(loopEvent.id, loopEvent) };
    const out = playEvent(freshState(definition), definition, loopEvent.id);

    expect(out.played).toBe(true);
    expect(out.state.eventLog.some((entry) => entry.summary.includes("depth exceeded"))).toBe(true);
    expect(EVENT_PLAY_DEPTH_LIMIT).toBeGreaterThan(0);
  });
});

describe("checkScheduledEvents", () => {
  it("plays time-triggered events when their clock condition matches", () => {
    const definition = eventDefinition();
    const state = freshState(definition);
    const atTen = { ...state, clock: advanceClock(state.clock, definition, 10) };
    const out = checkScheduledEvents(atTen, definition);
    expect(out.state.playedEventIds).toContain("scheduled-check");
  });

  it("plays a condition-triggered event only when its condition holds", () => {
    const definition = eventDefinition();
    const state = freshState(definition);
    expect(checkScheduledEvents(state, definition).state.playedEventIds).not.toContain("conditional-check");

    const withFlag = {
      ...state,
      player: { ...state.player, flags: [...state.player.flags, "return-authorized"] },
    };
    expect(checkScheduledEvents(withFlag, definition).state.playedEventIds).toContain("conditional-check");
  });

  it("does not evaluate director-triggered events", () => {
    const definition = eventDefinition();
    const out = checkScheduledEvents(freshState(definition), definition);
    expect(out.state.playedEventIds).not.toContain("director-only");
  });
});

describe("playAmbientEvent", () => {
  it("returns undefined when the location has no ambient pool", () => {
    const definition = eventDefinition();
    const state = freshState(definition);
    expect(playAmbientEvent(state, definition, "relay-room")).toBeUndefined();
  });

  it("plays an eligible ambient event from the location pool", () => {
    const definition = eventDefinition();
    const state = freshState(definition);
    const inCorridor = {
      ...state,
      player: { ...state.player, locationId: "service-corridor" },
    };
    const out = playAmbientEvent(inCorridor, definition, "service-corridor");
    expect(out?.played).toBe(true);
    expect(out?.state.playedEventIds).toContain("corridor-hum");
  });
});
