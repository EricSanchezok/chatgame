// Event execution pipeline: the single place events are played. The
// director selects, commitments/festivals/time conditions trigger, and
// `playEvent` applies effects + progression + narrative text + novelty
// tracking. Non-repeatable events play once; repeatable events respect
// their cooldown (falling back to director.novelty.cooldown_default).
import type { WorldState, WorldDefinition, EventLogEntry } from "./types";
import type { Effect } from "../script/schemas/common";
import { isBuiltinEffect } from "../script/schemas/common";
import { applyEffects } from "./effect";
import { applyProgression } from "./mechanics/progression";
import { absoluteDay } from "./time";
import { eventEligible } from "./director";
import { pickOne } from "./rng";

/** Max nested event plays from a single event's effects (loop guard). */
export const EVENT_PLAY_DEPTH_LIMIT = 5;

export interface PlayEventResult {
  state: WorldState;
  /** Narrative text for the event (from event_texts or a fallback line). */
  text: string;
  logEntries: EventLogEntry[];
  /** False when the event is unknown, non-repeatable-and-already-played, or depth-exceeded. */
  played: boolean;
}

/** Event narrative template text (first matching template; undefined when absent). */
export function eventTextFor(
  definition: WorldDefinition,
  eventId: string,
): string | undefined {
  const texts = definition.narrative.eventTexts.find((t) => t.event_id === eventId);
  return texts?.templates[0]?.text;
}

/**
 * Plays one event: applies its effects (event-kind effects recurse with a
 * depth guard), records play tracking, applies "event" progression, and
 * returns narrative text. Pure immutable update.
 */
export function playEvent(
  state: WorldState,
  definition: WorldDefinition,
  eventId: string,
  options: { depth?: number } = {},
): PlayEventResult {
  const depth = options.depth ?? 0;
  const event = definition.events.get(eventId);
  const day = absoluteDay(definition, state.clock);
  if (!event) {
    return { state, text: "", logEntries: [], played: false };
  }
  if (depth > EVENT_PLAY_DEPTH_LIMIT) {
    const log: EventLogEntry = {
      id: `log-${state.eventLog.length + 1}`,
      day,
      hour: state.clock.hour,
      type: "world",
      actor: "system",
      summary: `event "${eventId}" skipped: play depth exceeded`,
    };
    return {
      state: { ...state, eventLog: [...state.eventLog, log] },
      text: "",
      logEntries: [log],
      played: false,
    };
  }

  // Novelty gate: non-repeatable events play once; repeatable events wait
  // out their cooldown (event.cooldown ?? director.novelty.cooldown_default).
  const alreadyPlayed = state.playedEventIds.includes(eventId);
  const lastPlayed = state.eventLastPlayedDay[eventId];
  const cooldown = event.cooldown > 0 ? event.cooldown : definition.director.novelty.cooldown_default;
  if (alreadyPlayed && !event.repeatable) {
    return { state, text: "", logEntries: [], played: false };
  }
  if (
    alreadyPlayed &&
    event.repeatable &&
    cooldown > 0 &&
    lastPlayed !== undefined &&
    day - lastPlayed < cooldown
  ) {
    return { state, text: "", logEntries: [], played: false };
  }

  // Apply non-event effects; event-kind effects recurse (depth guard above).
  // Custom effect kinds flow through applyEffects to the script extension.
  let current = state;
  const directEffects = event.effects.filter(
    (e) => !isBuiltinEffect(e) || e.kind !== "event",
  );
  const nestedEvents = event.effects.filter(
    (e): e is Extract<Effect, { kind: "event" }> => isBuiltinEffect(e) && e.kind === "event",
  );
  const out = applyEffects(current, directEffects, { definition, day });
  current = out.state;
  for (const nested of nestedEvents) {
    const nestedResult = playEvent(current, definition, nested.event, { depth: depth + 1 });
    current = nestedResult.state;
  }

  // Record play tracking (single source of novelty truth).
  current = {
    ...current,
    playedEventIds: alreadyPlayed
      ? current.playedEventIds
      : [...current.playedEventIds, eventId],
    eventLastPlayedDay: { ...current.eventLastPlayedDay, [eventId]: day },
  };

  // Event-source progression.
  current = applyProgression(current, definition, "event").state;

  const text =
    eventTextFor(definition, event.narrative?.template ?? event.id) ??
    `（事件 "${event.name}" 发生了。）`;
  const log: EventLogEntry = {
    id: `log-${current.eventLog.length + 1}`,
    day,
    hour: current.clock.hour,
    type: "world",
    actor: "system",
    summary: `event "${event.id}" played`,
  };
  current = { ...current, eventLog: [...current.eventLog, log] };
  return { state: current, text, logEntries: [log], played: true };
}

export interface ScheduledEventsResult {
  state: WorldState;
  results: PlayEventResult[];
  logEntries: EventLogEntry[];
}

/**
 * Evaluates events with trigger "time" (clock matches) or "condition"
 * (condition met) and plays every currently eligible one. Director-trigger
 * events are the director's job and are not evaluated here.
 */
export function checkScheduledEvents(
  state: WorldState,
  definition: WorldDefinition,
): ScheduledEventsResult {
  let current = state;
  const results: PlayEventResult[] = [];
  const logEntries: EventLogEntry[] = [];
  for (const event of definition.events.values()) {
    if (event.trigger === "director") continue;
    if (!eventEligible(event, current, definition)) continue;
    const result = playEvent(current, definition, event.id);
    current = result.state;
    if (result.played) {
      results.push(result);
      logEntries.push(...result.logEntries);
    }
  }
  return { state: current, results, logEntries };
}

/**
 * Plays one eligible ambient event from a location's ambient_events pool
 * (uniform pick). Returns undefined when nothing is playable.
 */
export function playAmbientEvent(
  state: WorldState,
  definition: WorldDefinition,
  locationId: string,
): PlayEventResult | undefined {
  const location = definition.locations.get(locationId);
  if (!location?.ambient_events || location.ambient_events.length === 0) return undefined;
  const eligible = location.ambient_events
    .map((id) => definition.events.get(id))
    .filter((e): e is NonNullable<typeof e> => e !== undefined && eventEligible(e, state, definition));
  const picked = pickOne(state.rng, eligible);
  if (!picked) return undefined;
  return playEvent(state, definition, picked.id);
}
