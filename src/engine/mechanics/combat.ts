// Combat resolution primitives: deterministic damage math, hit resolution
// against defense, HP damage application (hp_stat from mechanics.combat),
// and threat gauge accumulation (clamped to threat_gauge.max).
import type { WorldState } from "../types";
import type { WorldDefinition } from "../types";
import type { ResultGrade } from "../types";
import { gradeMultiplier } from "../effect";

/**
 * Base damage scaled by the result grade multiplier (0.5x partial, 1x
 * success/fail, 2x crit), rounded to integer.
 */
export function computeDamage(base: number, grade: ResultGrade): number {
  return Math.round(base * gradeMultiplier(grade));
}

/** True when the attacker roll meets or beats the defense value. */
export function resolveHit(attackerRoll: number, defenseValue: number): boolean {
  return attackerRoll >= defenseValue;
}

/** Stat name that holds HP (mechanics.combat.hp_stat). */
export function hpStat(definition: WorldDefinition): string {
  return definition.mechanics.combat.hp_stat;
}

/** Clamps HP to the stat definition's bounds (falls back to >= 0). */
function clampHp(definition: WorldDefinition, stat: string, value: number): number {
  const def = definition.mechanics.stats.find((s) => s.name === stat);
  if (!def) return Math.max(0, value);
  return Math.min(def.max, Math.max(def.min, value));
}

/** The stat map for a target ("player" or npc id). */
function statsOf(state: WorldState, target: string): Record<string, number> | undefined {
  if (target === "player") return state.player.stats;
  return state.npcs[target]?.stats;
}

/**
 * Reduces the target's HP by amount, clamped at the stat floor (0 for hp).
 * Unknown targets are a no-op. Returns new state + HP remaining.
 */
export function applyDamage(
  state: WorldState,
  definition: WorldDefinition,
  target: string,
  amount: number,
  damageType: string,
): { state: WorldState; hpRemaining: number } {
  void damageType; // reserved for damage-type modifiers (none in the base math)
  const stat = hpStat(definition);
  const stats = statsOf(state, target);
  const current = stats?.[stat];
  if (current === undefined) return { state, hpRemaining: 0 };

  const hpRemaining = clampHp(definition, stat, current - amount);
  if (target === "player") {
    return {
      state: {
        ...state,
        player: { ...state.player, stats: { ...state.player.stats, [stat]: hpRemaining } },
      },
      hpRemaining,
    };
  }
  return {
    state: {
      ...state,
      npcs: {
        ...state.npcs,
        [target]: { ...state.npcs[target], stats: { ...state.npcs[target].stats, [stat]: hpRemaining } },
      },
    },
    hpRemaining,
  };
}

/**
 * Adds amount to the player's threat gauge, clamped to threat_gauge.max.
 * Returns new state + whether the gauge is full (for soft-failure handling).
 */
export function addThreat(
  state: WorldState,
  definition: WorldDefinition,
  amount: number,
): { state: WorldState; reachedMax: boolean } {
  const max = definition.mechanics.combat.threat_gauge.max;
  const gauge = Math.max(0, Math.min(max, state.player.threatGauge + amount));
  const reachedMax = gauge >= max;
  return {
    state: { ...state, player: { ...state.player, threatGauge: gauge } },
    reachedMax,
  };
}
