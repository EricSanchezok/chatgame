// Unified world step: the single deterministic progression pipeline shared
// by player turns (stepWorld with full scope) and offline advance
// (stepWorld with time.advance_scope). One hour at a time, with a daily
// boundary batch — needs decay, NPC schedules, status ticks, reputation
// decay/thresholds, memory archiving, festivals, time/condition events,
// ambient events, commitments and tension sync all flow through here.
import type { WorldState, WorldDefinition, EventLogEntry, TaskCompletion } from "./types";
import { advanceClock, absoluteDay, todayFestival, scheduleAt } from "./time";
import { applyNeedDecay, applyNeedThresholds } from "./mechanics/needs";
import { tickStatuses } from "./mechanics/status";
import { applyGlobalMemoryDecay } from "./memory";
import { checkCommitments } from "./plot";
import { checkTasks } from "./tasks";
import { playEvent, checkScheduledEvents, playAmbientEvent } from "./events";
import { chance } from "./rng";
import { runLifecycle } from "./extensions";

/** Ambient event play chance per day while in a location with ambient events. */
export const AMBIENT_EVENT_CHANCE = 0.3;

/** advance_scope item names (from time.yaml). */
export type AdvanceScope = "schedules" | "needs" | "events" | "factions" | "time_events";

export interface StepWorldOptions {
  /** Which advance_scope items apply. Defaults to all five. */
  scope?: AdvanceScope[];
}
export interface StepWorldResult {
  state: WorldState;
  /** Human-readable event/festival/ambient texts from this step. */
  worldEvents: string[];
  /** Task completions/failures detected this step (day boundary). */
  taskCompletions: TaskCompletion[];
  /** New event-log entries appended by this step. */
  logEntries: EventLogEntry[];
}


/** Whether the given day boundary (before/after clocks) crossed a day. */
function dayChanged(definition: WorldDefinition, before: WorldState["clock"], after: WorldState["clock"]): boolean {
  return absoluteDay(definition, after) > absoluteDay(definition, before);
}

/** Clamps a numeric value to [min, max] from the definition (if declared). */
function clampReputation(definition: WorldDefinition, value: number): number {
  return Math.max(-100, Math.min(100, value));
}

/** Applies faction reputation decay (advance_scope: factions). */
function applyFactionStep(
  state: WorldState,
  definition: WorldDefinition,
): WorldState {
  let current = state;
  const repDefs = [...definition.factions.values()]
    .map((f) => ({ faction: f, rep: f.reputation }))
    .filter((x): x is { faction: NonNullable<typeof x.faction>; rep: NonNullable<typeof x.rep> } => !!x.rep);
  for (const { faction, rep } of repDefs) {
    const existing = current.player.reputation.find((r) => r.factionId === faction.id);
    const before = existing?.value ?? 0;
    if (rep.decay > 0 && before > 0) {
      const next = clampReputation(definition, before - rep.decay);
      const row = {
        factionId: faction.id,
        value: next,
        descriptor: existing?.descriptor ? { ...existing.descriptor, stale: true } : undefined,
      };
      current = existing
        ? {
            ...current,
            player: {
              ...current.player,
              reputation: current.player.reputation.map((r) => (r.factionId === faction.id ? row : r)),
            },
          }
        : { ...current, player: { ...current.player, reputation: [...current.player.reputation, row] } };
    }
  }
  return current;
}

/**
 * Steps the world forward by `hours` (>= 0) through the unified pipeline.
 * Pure immutable; all randomness flows through state.rng.
 */
export function stepWorld(
  state: WorldState,
  definition: WorldDefinition,
  hours: number,
  options: StepWorldOptions = {},
): StepWorldResult {
  if (hours <= 0) return { state, worldEvents: [], taskCompletions: [], logEntries: [] };
  const scope = new Set(options.scope ?? (["schedules", "needs", "events", "factions", "time_events"] as AdvanceScope[]));
  const logEntries: EventLogEntry[] = [];
  const worldEvents: string[] = [];
  const taskCompletions: TaskCompletion[] = [];

  let current = state;
  const hoursLeft = Math.floor(hours);

  // Hourly loop: clock + needs decay + NPC schedule movement.
  for (let h = 0; h < hoursLeft; h++) {
    const beforeState = current;
    const before = current.clock;
    const after = advanceClock(current.clock, definition, 1);
    current = { ...current, clock: after };

    if (scope.has("needs")) {
      current = applyNeedDecay(current, definition, 1);
    }
    if (scope.has("schedules")) {
      // NPC schedules: recompute each scheduled NPC's location at the new hour.
      const nextNpcs = { ...current.npcs };
      let npcsChanged = false;
      for (const npcDef of definition.npcs.values()) {
        if (!npcDef.schedule) continue;
        const npc = nextNpcs[npcDef.id];
        if (!npc) continue;
        const entry = scheduleAt(definition, npcDef.schedule, after);
        if (entry?.locationId && entry.locationId !== npc.currentLocationId) {
          nextNpcs[npcDef.id] = { ...npc, currentLocationId: entry.locationId };
          npcsChanged = true;
        }
      }
      if (npcsChanged) current = { ...current, npcs: nextNpcs };
    }

    const hourly = runLifecycle("hour", current, { definition, previousState: beforeState });
    current = hourly.state;
    for (const summary of hourly.summaries) {
      const log: EventLogEntry = {
        id: `log-${current.eventLog.length + 1}`,
        day: absoluteDay(definition, current.clock),
        hour: current.clock.hour,
        type: "system",
        actor: "extension",
        summary,
      };
      current = { ...current, eventLog: [...current.eventLog, log] };
      logEntries.push(log);
    }

    // Daily boundary batch.
    if (dayChanged(definition, before, after)) {
      const day = absoluteDay(definition, after);

      // Status ticks (always — not gated by advance_scope).
      current = tickStatuses(current, definition);

      if (scope.has("needs")) {
        const thresholdOut = applyNeedThresholds(current, definition, day);
        current = thresholdOut.state;
      }

      if (scope.has("factions")) {
        current = applyFactionStep(current, definition);
      }

      // Memory archiving (always — retention is a memory policy, not advance_scope).
      current = applyGlobalMemoryDecay(current, definition);

      // Festivals: the festival's event plays once on its day.
      if (scope.has("time_events") || scope.has("events")) {
        const festivalId = todayFestival(definition, after);
        if (festivalId) {
          const festival = definition.time.festivals?.find((f) => f.id === festivalId);
          if (festival?.event) {
            const out = playEvent(current, definition, festival.event);
            current = out.state;
            if (out.played) worldEvents.push(out.text);
          }
        }
      }

      // Time/condition events (advance_scope: events).
      if (scope.has("events")) {
        const scheduled = checkScheduledEvents(current, definition);
        current = scheduled.state;
        for (const r of scheduled.results) if (r.played) worldEvents.push(r.text);
        logEntries.push(...scheduled.logEntries);
      }

      // Ambient events (advance_scope: events; seeded RNG for determinism).
      if (scope.has("events")) {
        const location = current.player.locationId;
        if (location && chance(current.rng, AMBIENT_EVENT_CHANCE)) {
          const out = playAmbientEvent(current, definition, location);
          if (out?.played) {
            current = out.state;
            worldEvents.push(out.text);
          }
        }
      }

      // Commitments (turn-level condition triggers + deadline misses).
      const commitmentOut = checkCommitments(current, definition);
      current = commitmentOut.state;
      logEntries.push(...commitmentOut.logEntries);

      // Tasks: time-limit expiry + auto-activation at the day boundary.
      const taskOut = checkTasks(current, definition);
      current = taskOut.state;
      for (const c of taskOut.completions) {
        taskCompletions.push({ taskId: c.taskId, status: c.status, narrative: c.narrative });
      }
      logEntries.push(...taskOut.logEntries);

      // Tension sync: each director variable clamps to its gauge source.
      const tension = { ...current.director.tension };
      let tensionChanged = false;
      for (const variable of definition.director.tension.variables) {
        if (variable.source !== "threat_gauge") continue;
        const sourceValue = current.player.threatGauge;
        const clamped = Math.min(variable.max, Math.max(variable.min, sourceValue));
        if (tension[variable.name] !== clamped) {
          tension[variable.name] = clamped;
          tensionChanged = true;
        }
      }
      if (tensionChanged) current = { ...current, director: { ...current.director, tension } };

      const boundary = runLifecycle("dayBoundary", current, { definition, previousState: beforeState });
      current = boundary.state;
      for (const summary of boundary.summaries) {
        const log: EventLogEntry = {
          id: `log-${current.eventLog.length + 1}`,
          day,
          hour: current.clock.hour,
          type: "system",
          actor: "extension",
          summary,
        };
        current = { ...current, eventLog: [...current.eventLog, log] };
        logEntries.push(log);
      }
    }
  }

  return { state: current, worldEvents, taskCompletions, logEntries };
}
