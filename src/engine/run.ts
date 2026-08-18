// Run policy: death handling (soft_failure / world_continue / hard_reset)
// and meta-progression (cross-run keep/reset/unlocks). Deterministic and
// engine-owned — the player never "dies" mid-text; the policy transforms
// the world state according to run.yaml.
import type { WorldState, EventLogEntry } from "./types";
import type { WorldDefinition } from "./types";
import { applyEffects } from "./effect";
import { generateWorld } from "./worldgen";

export interface DeathCheckResult {
  state: WorldState;
  /** Which policy mode fired (undefined when no death condition met). */
  firedMode?: "soft_failure" | "world_continue" | "hard_reset";
  /** Human-readable consequence narrative (from run.yaml). */
  narrative?: string;
  logEntries: EventLogEntry[];
}

/**
 * Checks whether the soft-failure gauge has reached the threshold and, if
 * so, applies the consequence: teleport + effects + narrative. Resets the
 * gauge afterward to avoid re-triggering in the same turn.
 */
export function checkSoftFailure(
  state: WorldState,
  definition: WorldDefinition,
): DeathCheckResult {
  const policy = definition.run.death_policy;
  const logEntries: EventLogEntry[] = [];
  if (policy.mode !== "soft_failure" || !policy.soft_failure) {
    return { state, logEntries };
  }
  const sf = policy.soft_failure;
  const gaugeValue = state.player.threatGauge;
  const threshold = sf.threshold;
  if (gaugeValue < threshold) {
    return { state, logEntries };
  }

  // Apply consequence: teleport to consequence.location + effects.
  const day = Math.floor(state.clock.totalHours / definition.time.day_length_hours);
  const teleported = {
    ...state,
    player: { ...state.player, locationId: sf.consequence.location, threatGauge: 0 },
  };
  const out = applyEffects(teleported, sf.consequence.effects, { definition, day });

  const narrative = sf.consequence.narrative;
  logEntries.push({
    id: `log-${out.state.eventLog.length + 1}`,
    day,
    hour: out.state.clock.hour,
    type: "world",
    actor: "system",
    summary: `soft_failure triggered: ${narrative}`,
  });

  return {
    state: { ...out.state, eventLog: [...out.state.eventLog, ...logEntries] },
    firedMode: "soft_failure",
    narrative,
    logEntries,
  };
}

/**
 * world_continue: rebuild the player from a new origin while keeping the
 * world state (per state_kept list). Falls back to the first origin when
 * the configured succession pool is empty.
 */
export function applyWorldContinue(
  state: WorldState,
  definition: WorldDefinition,
): DeathCheckResult {
  const policy = definition.run.death_policy;
  const logEntries: EventLogEntry[] = [];
  if (policy.mode !== "world_continue" || !policy.world_continue) {
    return { state, logEntries };
  }
  const wc = policy.world_continue;
  const kept = wc.state_kept;
  const keepFlags = kept.includes("flags");
  const keepRelations = kept.includes("relations_overview");

  const previousPlayer = state.player;
  const firstOriginId = definition.origins.keys().next().value as string;
  const newOriginId =
    wc.succession === "new_character"
      ? firstOriginId
      : firstOriginId; // heir_pool: use first origin in v1 (documented)

  const generated = generateWorld(definition, newOriginId, {
    seed: state.rng.seed + 1,
  });
  let newPlayer = { ...generated.state.player, name: previousPlayer.name };
  if (keepFlags) newPlayer = { ...newPlayer, flags: [...previousPlayer.flags] };
  if (keepRelations) newPlayer = { ...newPlayer, relations: [...previousPlayer.relations] };

  const day = Math.floor(state.clock.totalHours / definition.time.day_length_hours);
  logEntries.push({
    id: `log-${state.eventLog.length + 1}`,
    day,
    hour: state.clock.hour,
    type: "world",
    actor: "system",
    summary: "world_continue: player rebuilt from a new origin",
  });

  return {
    state: {
      ...state,
      player: newPlayer,
      rng: generated.state.rng,
      eventLog: [...state.eventLog, ...logEntries],
    },
    firedMode: "world_continue",
    narrative: "你失去了之前的身份，但世界记得你来过。",
    logEntries,
  };
}

/**
 * hard_reset: reroll the whole world (reroll_worldgen) or keep the world
 * definition but reset the player (keep_world).
 */
export function applyHardReset(
  state: WorldState,
  definition: WorldDefinition,
): DeathCheckResult {
  const policy = definition.run.death_policy;
  const logEntries: EventLogEntry[] = [];
  if (policy.mode !== "hard_reset" || !policy.hard_reset) {
    return { state, logEntries };
  }
  const hr = policy.hard_reset;
  const firstOriginId = definition.origins.keys().next().value as string;

  let next: WorldState;
  if (hr.world_reroll === "reroll_worldgen") {
    const generated = generateWorld(definition, firstOriginId, {
      seed: state.rng.seed + 1,
    });
    next = generated.state;
  } else {
    // keep_world: keep npcs/clock/flags, reset player only.
    const generated = generateWorld(definition, firstOriginId, {
      seed: state.rng.seed + 1,
    });
    next = {
      ...state,
      player: generated.state.player,
      rng: generated.state.rng,
    };
  }

  const day = Math.floor(state.clock.totalHours / definition.time.day_length_hours);
  logEntries.push({
    id: `log-${next.eventLog.length + 1}`,
    day,
    hour: next.clock.hour,
    type: "world",
    actor: "system",
    summary: `hard_reset (${hr.world_reroll})`,
  });

  return {
    state: { ...next, eventLog: [...next.eventLog, ...logEntries] },
    firedMode: "hard_reset",
    narrative: "世界重置了。",
    logEntries,
  };
}

/** Dispatches to the configured death policy. */
export function applyDeathPolicy(
  state: WorldState,
  definition: WorldDefinition,
): DeathCheckResult {
  switch (definition.run.death_policy.mode) {
    case "soft_failure":
      return checkSoftFailure(state, definition);
    case "world_continue":
      return applyWorldContinue(state, definition);
    case "hard_reset":
      return applyHardReset(state, definition);
    default:
      return { state, logEntries: [] };
  }
}

/**
 * Meta-progression: returns the per-run persisted subset (flags/lore/
 * relations) for the meta layer (UI/next-run seeding). The engine keeps
 * this separate from the world snapshot.
 */
export function metaProgressionSnapshot(
  state: WorldState,
  definition: WorldDefinition,
): { flags: string[]; lore: string[]; relations: WorldState["player"]["relations"] } {
  const keep = definition.run.meta_progression.keep;
  return {
    flags: keep.includes("flags") ? [...state.player.flags] : [],
    lore: keep.includes("lore") ? state.facts.filter((f) => f.startsWith("lore-")) : [],
    relations: keep.includes("relations_overview") ? [...state.player.relations] : [],
  };
}

/** Applies a meta unlock (flag -> grant origins) by returning the granted origin ids. */
export function applyUnlocks(
  state: WorldState,
  definition: WorldDefinition,
): string[] {
  const granted: string[] = [];
  for (const unlock of definition.run.meta_progression.unlocks) {
    if (state.player.flags.includes(unlock.flag)) {
      granted.push(...unlock.grant);
    }
  }
  return granted;
}
