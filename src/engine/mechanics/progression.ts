// Progression: script-declared stat/skill growth. For each
// mechanics.progression entry matching the source (stat_check | skill_check
// | task | event), add `amount` to the triggering entity's target stat/skill,
// clamped to entry.cap (else the stat/skill definition min/max).
import type { WorldState } from "../types";
import type { WorldDefinition } from "../types";
import type { progressionEntrySchema } from "../../script/schemas/mechanics";
import type { z } from "zod";

/** Progression trigger sources (schema-enforced). */
export type ProgressionSource = z.infer<typeof progressionEntrySchema>["source"];

/** One applied growth entry. */
export interface ProgressionSummary {
  source: ProgressionSource;
  target: string;
  /** "player" or an npc id. */
  entity: string;
  amount: number;
}

/** Max bound for a target: entry.cap first, then stat/skill definition max. */
function boundOf(definition: WorldDefinition, target: string, cap?: number): number | undefined {
  if (cap !== undefined) return cap;
  const stat = definition.mechanics.stats.find((s) => s.name === target);
  if (stat) return stat.max;
  return definition.mechanics.skills?.find((s) => s.name === target)?.max;
}

/** Min bound for a target from the stat/skill definition (0 when undeclared). */
function floorOf(definition: WorldDefinition, target: string): number {
  const stat = definition.mechanics.stats.find((s) => s.name === target);
  if (stat) return stat.min;
  return definition.mechanics.skills?.find((s) => s.name === target)?.min ?? 0;
}

/** Clamps next to [min, max]; keeps next as-is when the target is unbound. */
function clampValue(
  definition: WorldDefinition,
  target: string,
  cap: number | undefined,
  next: number,
): number {
  const max = boundOf(definition, target, cap);
  if (max === undefined) return next;
  return Math.min(max, Math.max(floorOf(definition, target), next));
}

/**
 * Progresses one entity's stats/skills. Returns the same entity reference
 * when nothing changed (no target matched or amounts clamped to no-op).
 */
function progressEntity<T extends { stats: Record<string, number>; skills: Record<string, number> }>(
  entity: T,
  entityId: string,
  definition: WorldDefinition,
  source: ProgressionSource,
  summaries: ProgressionSummary[],
  targetFilter?: string,
): T {
  let stats = entity.stats;
  let skills = entity.skills;
  for (const entry of definition.mechanics.progression ?? []) {
    if (entry.source !== source) continue;
    const target = entry.target;
    if (targetFilter && target !== targetFilter) continue;
    if (target in stats) {
      const next = clampValue(definition, target, entry.cap, stats[target] + entry.amount);
      if (next !== stats[target]) {
        stats = { ...stats, [target]: next };
        summaries.push({ source, target, entity: entityId, amount: entry.amount });
      }
    } else if (target in skills) {
      const next = clampValue(definition, target, entry.cap, skills[target] + entry.amount);
      if (next !== skills[target]) {
        skills = { ...skills, [target]: next };
        summaries.push({ source, target, entity: entityId, amount: entry.amount });
      }
    }
  }
  return stats === entity.stats && skills === entity.skills
    ? entity
    : { ...entity, stats, skills };
}

/**
 * Applies matching progression entries only to `options.entityId` (the
 * player by default). Target lookup checks stats first, then skills. Returns
 * the new state plus one summary per applied entry.
 */
export function applyProgression(
  state: WorldState,
  definition: WorldDefinition,
  source: ProgressionSource,
  options: { entityId?: "player" | string; target?: string } = {},
): { state: WorldState; summaries: ProgressionSummary[] } {
  const summaries: ProgressionSummary[] = [];
  const entityId = options.entityId ?? "player";
  const player = entityId === "player"
    ? progressEntity(state.player, "player", definition, source, summaries, options.target)
    : state.player;
  const npc = entityId === "player" ? undefined : state.npcs[entityId];
  const progressedNpc = npc
    ? progressEntity(npc, entityId, definition, source, summaries, options.target)
    : undefined;

  return {
    state: {
      ...state,
      player,
      npcs: progressedNpc ? { ...state.npcs, [entityId]: progressedNpc } : state.npcs,
    },
    summaries,
  };
}
