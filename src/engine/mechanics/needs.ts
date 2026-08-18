// Need decay + threshold effects. Values decay continuously
// (decay_per_day * hours/24), thresholds fire while the value is past their
// level — sustained RimWorld-style effects, NOT one-shot triggers, so no
// fired-tracking state is needed and types.ts stays untouched.
import type { NeedState, WorldState } from "../types";
import type { WorldDefinition } from "../types";
import { applyEffects } from "../effect";

/** Clamps a need value to the definition's [min, max] (unclamped when undeclared). */
export function clampNeed(
  definition: WorldDefinition,
  needName: string,
  value: number,
): number {
  const def = definition.mechanics.needs?.find((n) => n.name === needName);
  if (!def) return value;
  return Math.min(def.max, Math.max(def.min, value));
}

/** Applies decay to one entity's needs, returning a new map. */
function decayNeeds(
  needs: Record<string, NeedState>,
  definition: WorldDefinition,
  hoursElapsed: number,
): Record<string, NeedState> {
  let changed = false;
  const next: Record<string, NeedState> = {};
  for (const [name, need] of Object.entries(needs)) {
    const def = definition.mechanics.needs?.find((n) => n.name === name);
    if (!def || def.decay_per_day === 0) {
      next[name] = need;
      continue;
    }
    const decay = def.decay_per_day * (hoursElapsed / 24);
    const value = clampNeed(definition, name, need.value - decay);
    next[name] = value === need.value ? need : { value, descriptor: need.descriptor };
    if (value !== need.value) changed = true;
  }
  return changed ? next : needs;
}

/**
 * Decays every need on the player and all NPCs by hoursElapsed.
 * Reconstructs state only when at least one value actually changed.
 */
export function applyNeedDecay(
  state: WorldState,
  definition: WorldDefinition,
  hoursElapsed: number,
): WorldState {
  if (hoursElapsed <= 0) return state;

  const playerNeeds = decayNeeds(state.player.needs, definition, hoursElapsed);
  let current =
    playerNeeds === state.player.needs
      ? state
      : { ...state, player: { ...state.player, needs: playerNeeds } };

  let npcsChanged = false;
  const nextNpcs: Record<string, WorldState["npcs"][string]> = {};
  for (const [id, npc] of Object.entries(current.npcs)) {
    const needs = decayNeeds(npc.needs, definition, hoursElapsed);
    if (needs !== npc.needs) npcsChanged = true;
    nextNpcs[id] = needs === npc.needs ? npc : { ...npc, needs };
  }
  if (npcsChanged) current = { ...current, npcs: nextNpcs };
  return current;
}

/**
 * Threshold polarity: thresholds sit on the far side of the need's initial
 * value — descending needs (initial > level, e.g. hunger) fire when the
 * value falls to <= level; ascending needs (initial < level, e.g. fatigue)
 * fire when it rises to >= level.
 */
function thresholdFires(
  def: { initial: number },
  threshold: { level: number },
  value: number,
): boolean {
  return def.initial >= threshold.level ? value <= threshold.level : value >= threshold.level;
}

/**
 * Applies threshold effects for every need currently past a threshold level.
 * The same threshold re-fires each call while the value stays past it —
 * sustained effects, so status duration/stackability governs how the effect
 * repeats instead of an extra fired-record on WorldState.
 * Returns new state + triggered "need:label" keys.
 */
export function applyNeedThresholds(
  state: WorldState,
  definition: WorldDefinition,
  day: number,
): { state: WorldState; triggered: string[] } {
  const triggered: string[] = [];
  let current = state;

  const applyEntity = (target: string): void => {
    const needs = target === "player" ? current.player.needs : current.npcs[target]?.needs;
    if (!needs) return;
    for (const [name, need] of Object.entries(needs)) {
      const def = definition.mechanics.needs?.find((n) => n.name === name);
      if (!def) continue;
      for (const threshold of def.thresholds) {
        if (!thresholdFires(def, threshold, need.value) || threshold.effects.length === 0) {
          continue;
        }
        const label = `${name}:${threshold.label}`;
        const key = target === "player" ? label : `${target}:${label}`;
        if (triggered.includes(key)) continue;
        triggered.push(key);
        const out = applyEffects(current, threshold.effects, { definition, day });
        current = out.state;
      }
    }
  };

  applyEntity("player");
  for (const npcId of Object.keys(current.npcs)) {
    applyEntity(npcId);
  }
  return { state: current, triggered };
}
