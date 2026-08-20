// Status effect ticking: each tick applies status_effects[].effects via the
// shared effect executor, then decrements remainingTicks (null = permanent);
// instances that reach 0 are removed. A status with duration N therefore
// applies its effects exactly N times.
import type { StatusInstance, WorldState } from "../types";
import type { WorldDefinition } from "../types";
import { applyEffects } from "../effect";
import { absoluteDay } from "../time";

/** Returns the status_effects entry for statusId (undefined when unknown). */
function statusDefinition(definition: WorldDefinition, statusId: string) {
  return definition.mechanics.status_effects?.find((s) => s.id === statusId);
}

/** Duration in ticks from the definition (null/undefined = permanent). */
function statusDuration(definition: WorldDefinition, statusId: string): number | null {
  return statusDefinition(definition, statusId)?.duration ?? null;
}

/** Effects listed for the status (empty array when unknown). */
function statusEffects(definition: WorldDefinition, statusId: string) {
  return statusDefinition(definition, statusId)?.effects ?? [];
}

/**
 * Adds (or stacks) a status on one holder. Stackable statuses increment
 * stacks and restart the timer; non-stackable statuses refresh the timer
 * when re-applied. Unknown status ids are recorded as permanent — definition
 * lookup happens at tick time.
 */
export function addStatus(
  statuses: StatusInstance[],
  statusId: string,
  definition: WorldDefinition,
): StatusInstance[] {
  const duration = statusDuration(definition, statusId);
  const existing = statuses.find((s) => s.statusId === statusId);
  if (!existing) return [...statuses, { statusId, remainingTicks: duration, stacks: 1 }];
  const stackable = statusDefinition(definition, statusId)?.stackable ?? false;
  return statuses.map((s) =>
    s.statusId === statusId
      ? {
          ...s,
          stacks: stackable ? s.stacks + 1 : s.stacks,
          remainingTicks: duration,
          descriptor: s.descriptor ? { ...s.descriptor, stale: true } : undefined,
        }
      : s,
  );
}

/** Removes every instance of statusId from the holder. */
export function removeStatus(statuses: StatusInstance[], statusId: string): StatusInstance[] {
  return statuses.filter((s) => s.statusId !== statusId);
}

/** Applies each held status's effects (definition order) to the state. */
function applyStatusEffects(
  state: WorldState,
  definition: WorldDefinition,
  day: number,
  statuses: StatusInstance[],
): WorldState {
  let current = state;
  for (const status of statuses) {
    const effects = statusEffects(definition, status.statusId);
    if (effects.length === 0) continue;
    for (let stack = 0; stack < status.stacks; stack++) {
      const out = applyEffects(current, effects, { definition, day });
      current = out.state;
    }
  }
  return current;
}

/** Decrements timed statuses, dropping those that reach 0. */
function tickTimers(statuses: StatusInstance[]): StatusInstance[] {
  let changed = false;
  const next = statuses.map((status) => {
    if (status.remainingTicks === null) return status;
    changed = true;
    return { ...status, remainingTicks: status.remainingTicks - 1 };
  });
  if (!changed) return statuses;
  return next.filter((s) => s.remainingTicks === null || s.remainingTicks > 0);
}

/**
 * Ticks all statuses on the player and every NPC for one time unit.
 * Per entity: apply the held statuses' effects, then decrement timers on
 * the post-effect statuses and drop expired instances.
 */
export function tickStatuses(state: WorldState, definition: WorldDefinition): WorldState {
  const day = absoluteDay(definition, state.clock);

  // Player first: effects may target NPCs, which the NPC loop then sees.
  let current = applyStatusEffects(state, definition, day, state.player.statuses);
  const playerStatuses = tickTimers(current.player.statuses);
  if (playerStatuses !== current.player.statuses) {
    current = { ...current, player: { ...current.player, statuses: playerStatuses } };
  }

  let npcsChanged = false;
  const nextNpcs: Record<string, WorldState["npcs"][string]> = {};
  for (const [id] of Object.entries(current.npcs)) {
    const npc = current.npcs[id];
    current = applyStatusEffects(current, definition, day, npc.statuses);
    // Re-read the NPC after its effects (stats/statuses may have changed),
    // then tick timers on the post-effect statuses.
    const updatedNpc = current.npcs[id];
    const statuses = tickTimers(updatedNpc.statuses);
    nextNpcs[id] = statuses === updatedNpc.statuses ? updatedNpc : { ...updatedNpc, statuses };
    if (nextNpcs[id] !== npc) npcsChanged = true;
  }
  return npcsChanged ? { ...current, npcs: nextNpcs } : current;
}
