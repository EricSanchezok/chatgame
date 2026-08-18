// Director system: selects events by tension-band weighting + novelty
// (seen/cooldown) + pacing. RimWorld Storyteller-style — the world does
// not randomly roll events, it selects them from a weighted pool filtered
// by player/world state, and tracks what has been seen to avoid repetition.
import type { WorldState, EventLogEntry } from "./types";
import type { WorldDefinition } from "./types";
import type { Event } from "../script/schemas/event";
import { evalCondition, type ConditionContext } from "./condition";
import { weightedPick, nextInt, nextFloat } from "./rng";
import { absoluteDay } from "./time";

export interface DirectorSelectResult {
  state: WorldState;
  /** The selected event id (undefined when nothing eligible). */
  selectedEventId?: string;
  logEntries: EventLogEntry[];
}

/** Computes the current tension band for an event selection. */
export function currentTensionBand(
  state: WorldState,
  definition: WorldDefinition,
): { band: [number, number]; multiplier: number } {
  const tension = state.director.tension;
  const bands = definition.director.event_selection.bands;
  // Determine the "band" via the first tension variable (danger).
  const danger = tension["danger"] ?? 0;
  let multiplier = 1;
  let band: [number, number] = [0, 100];
  for (const b of bands) {
    if (danger >= b.band[0] && danger <= b.band[1]) {
      multiplier = b.weight_multiplier;
      band = b.band;
      break;
    }
  }
  return { band, multiplier };
}

/** Whether an event is currently eligible for selection. */
export function eventEligible(
  event: Event,
  state: WorldState,
  definition: WorldDefinition,
  day: number,
): boolean {
  // Not seen / cooldown respected.
  const seen = state.director.seenEventIds.includes(event.id);
  if (seen && !event.repeatable) return false;
  if (seen && event.repeatable && event.cooldown > 0) {
    // Cooldown: approximate with the last director event day.
    if (state.director.lastEventDay !== null && day - state.director.lastEventDay < event.cooldown) {
      return false;
    }
  }
  // Exclusivity: if any mutually-exclusive event is already active/seen, skip.
  if (event.exclusivity) {
    for (const other of event.exclusivity.mutually_exclusive) {
      if (state.activeEventIds.includes(other)) return false;
    }
  }
  // Location eligibility: at least one listed location matches player location
  // (or event has no location constraint).
  if (event.locations.length > 0 && !event.locations.includes(state.player.locationId)) {
    return false;
  }
  // Participant presence: participants should be at the player's location
  // for social/crisis events (skip when constraint exists and none present).
  if (event.participants.length > 0) {
    const present = event.participants.some((p) => {
      const npc = state.npcs[p];
      return npc && npc.currentLocationId === state.player.locationId;
    });
    if (!present) return false;
  }
  // Conditions (condition algebra).
  if (event.conditions) {
    const ctx: ConditionContext = { definition, state };
    if (!evalCondition(event.conditions, ctx)) return false;
  }
  return true;
}

/**
 * Selects an event from the director pool using tension-band weighted
 * selection. Pure immutable update; returns the new state with the event
 * queued as active and the seen tracking updated.
 */
export function selectDirectorEvent(
  state: WorldState,
  definition: WorldDefinition,
): DirectorSelectResult {
  const day = absoluteDay(definition, state.clock);
  const eligible = [...definition.events.values()].filter((e) =>
    eventEligible(e, state, definition, day),
  );
  if (eligible.length === 0) {
    return { state, logEntries: [] };
  }

  const { multiplier } = currentTensionBand(state, definition);
  const weights = eligible.map((e) => e.weight * multiplier);
  const idx = weightedPick(state.rng, weights);
  if (idx < 0) return { state, logEntries: [] };

  const event = eligible[idx];
  const logEntries: EventLogEntry[] = [
    {
      id: `log-${state.eventLog.length + 1}`,
      day,
      hour: state.clock.hour,
      type: "director",
      actor: "system",
      summary: `director selected event "${event.id}"`,
    },
  ];

  // Mark seen + queue as active.
  const seenEventIds = event.repeatable
    ? [...state.director.seenEventIds, event.id]
    : [...state.director.seenEventIds, event.id]; // non-repeatable filtered by eventEligible
  const activeEventIds = state.activeEventIds.includes(event.id)
    ? state.activeEventIds
    : [...state.activeEventIds, event.id];

  return {
    state: {
      ...state,
      director: {
        ...state.director,
        seenEventIds,
        lastEventDay: day,
      },
      activeEventIds,
    },
    selectedEventId: event.id,
    logEntries,
  };
}

/** Returns a random eligible event (uniform, no tension weighting). */
export function pickAmbientEvent(
  state: WorldState,
  definition: WorldDefinition,
): Event | undefined {
  const day = absoluteDay(definition, state.clock);
  const eligible = [...definition.events.values()].filter((e) =>
    eventEligible(e, state, definition, day),
  );
  if (eligible.length === 0) return undefined;
  return eligible[nextInt(state.rng, 0, eligible.length - 1)];
}

/** Whether the director should attempt selection this turn (pacing). */
export function directorShouldSelect(
  state: WorldState,
  definition: WorldDefinition,
): boolean {
  const day = absoluteDay(definition, state.clock);
  const pacing = definition.director.pacing;
  // Crisis density caps how often we inject events.
  if (state.director.lastEventDay !== null) {
    const daysSince = day - state.director.lastEventDay;
    if (daysSince < pacing.breather_min_interval) return false;
  }
  // Simple probability based on crisis density.
  return nextFloat(state.rng) < pacing.crisis_density;
}
