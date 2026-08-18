// Director system: selects events by tension-band weighting + novelty
// (played/cooldown) + pacing. RimWorld Storyteller-style — the world does
// not randomly roll events, it selects them from a weighted pool filtered
// by player/world state, and tracks what has been played to avoid
// repetition. Selection only picks; playback lives in events.ts.
import type { WorldState, EventLogEntry } from "./types";
import type { WorldDefinition } from "./types";
import type { Event } from "../script/schemas/event";
import { evalCondition, type ConditionContext } from "./condition";
import { weightedPick, nextFloat } from "./rng";
import { absoluteDay } from "./time";

export interface DirectorSelectResult {
  state: WorldState;
  /** The selected event id (undefined when nothing eligible). */
  selectedEventId?: string;
  logEntries: EventLogEntry[];
}

/** Difficulty ramp cap (multiplier never exceeds this constant). */
export const DIFFICULTY_RAMP_CAP = 5;

/** Effective cooldown for an event: event.cooldown, else novelty.cooldown_default. */
export function eventCooldown(definition: WorldDefinition, event: Event): number {
  return event.cooldown > 0 ? event.cooldown : definition.director.novelty.cooldown_default;
}

/**
 * Novelty gate: a non-repeatable event plays once; a repeatable event must
 * wait out its cooldown (event.cooldown ?? novelty.cooldown_default).
 */
export function eventNoveltyOk(
  state: WorldState,
  definition: WorldDefinition,
  event: Event,
): boolean {
  const alreadyPlayed = state.playedEventIds.includes(event.id);
  if (alreadyPlayed && !event.repeatable) return false;
  if (alreadyPlayed && event.repeatable) {
    const lastPlayed = state.eventLastPlayedDay[event.id];
    const cooldown = eventCooldown(definition, event);
    if (cooldown > 0 && lastPlayed !== undefined) {
      const day = absoluteDay(definition, state.clock);
      if (day - lastPlayed < cooldown) return false;
    }
  }
  return true;
}

/** Computes the current tension band for an event selection. */
export function currentTensionBand(
  state: WorldState,
  definition: WorldDefinition,
): { band: [number, number]; multiplier: number } {
  const tension = state.director.tension;
  const bands = definition.director.event_selection.bands;
  // The first tension variable drives the band (all variables sync to the
  // same gauge source, so any of them is representative).
  const primary = definition.director.tension.variables[0];
  const value = primary ? tension[primary.name] ?? primary.initial : 0;
  let multiplier = 1;
  let band: [number, number] = [0, 100];
  for (const b of bands) {
    if (value >= b.band[0] && value <= b.band[1]) {
      multiplier = b.weight_multiplier;
      band = b.band;
      break;
    }
  }
  // Difficulty ramp: events get more likely/weighted as absolute days pass.
  const ramp = definition.director.pacing.difficulty_ramp;
  if (ramp > 0) {
    const day = absoluteDay(definition, state.clock);
    multiplier *= Math.min(1 + ramp * day, DIFFICULTY_RAMP_CAP);
  }
  return { band, multiplier };
}

/** Whether an event is currently eligible for selection. */
export function eventEligible(
  event: Event,
  state: WorldState,
  definition: WorldDefinition,
): boolean {
  if (!eventNoveltyOk(state, definition, event)) return false;
  // Exclusivity: skip when any mutually-exclusive event has been played.
  if (event.exclusivity) {
    for (const other of event.exclusivity.mutually_exclusive) {
      if (state.playedEventIds.includes(other)) return false;
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
 * selection. Pure immutable update; returns the new state with the play
 * tracking updated. The caller plays the selected event via events.ts.
 */
export function selectDirectorEvent(
  state: WorldState,
  definition: WorldDefinition,
): DirectorSelectResult {
  const day = absoluteDay(definition, state.clock);
  const eligible = [...definition.events.values()].filter((e) =>
    eventEligible(e, state, definition),
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

  return {
    state: { ...state, director: { ...state.director, lastEventDay: day } },
    selectedEventId: event.id,
    logEntries,
  };
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
