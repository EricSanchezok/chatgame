// Condition algebra evaluator: recursive {all|any|not} logic over typed
// leaves (10 ops x 11 sources). Pure function of (condition, context) —
// the engine's deterministic rule layer (I4: rules are never judged by LLM).
import type { Condition } from "../script/schemas/common";
import type { WorldState } from "./types";
import type { WorldDefinition } from "./types";

/** Runtime context required to evaluate a condition against world state. */
export interface ConditionContext {
  definition: WorldDefinition;
  state: WorldState;
  /** Which NPC is the "speaker" for relationship/key resolution. */
  selfNpcId?: string;
  /** Extra player-facing override for "player" keys. */
  playerId?: string;
}

const PLAYER = "player";

/** Clamps a stat/skill/need value to the definition bounds. */
function statValue(
  ctx: ConditionContext,
  source: string,
  key: string,
): number | undefined {
  const { state } = ctx;
  const player = state.player;
  const npc = ctx.selfNpcId ? state.npcs[ctx.selfNpcId] : undefined;

  const statMap =
    source === "stat" ? (npc ? npc.stats : player.stats) :
    source === "skill" ? (npc ? npc.skills : player.skills) :
    source === "need" ? (npc ? npc.needs[key]?.value : player.needs[key]?.value) :
    undefined;

  if (statMap === undefined) return undefined;
  if (source === "need") {
    return typeof statMap === "number" ? statMap : undefined;
  }
  return (statMap as Record<string, number>)[key];
}

/** Numeric comparison helper shared by all numeric ops. */
function compare(op: string, actual: number, value: number): boolean {
  switch (op) {
    case "gte": return actual >= value;
    case "lte": return actual <= value;
    case "gt": return actual > value;
    case "lt": return actual < value;
    case "eq": return actual === value;
    case "neq": return actual !== value;
    default: return false;
  }
}
/** Unified marker lookup (player.flags ∪ world.flags ∪ facts). */
export function hasMarker(state: WorldState, key: string): boolean {
  return (
    state.player.flags.includes(key) ||
    state.flags.includes(key) ||
    state.facts.includes(key)
  );
}


/** Resolves a leaf condition to a boolean. Unknown/missing data => false. */
export function evalConditionLeaf(
  cond: Extract<Condition, { source: string }>,
  ctx: ConditionContext,
): boolean {
  const { source, key, target, op, value } = cond;
  const { state } = ctx;

  switch (source) {
    case "stat":
    case "skill":
    case "need": {
      if (!key) return false;
      const actual = statValue(ctx, source, key);
      if (actual === undefined || typeof value !== "number") return false;
      return compare(op, actual, value);
    }
    case "flag":
    case "fact": {
      // flags and facts share one runtime marker space (no declaration pool
      // in the schema — appendix E); both sources resolve via hasMarker.
      if (!key) return false;
      const has = hasMarker(state, key);
      if (op === "has") return has;
      if (op === "not_has") return !has;
      return false;
    }
    case "relationship": {
      // NPC perspective (selfNpcId set): read the NPC -> player edge.
      // Player perspective: read the player -> NPC edge (key is the NPC id).
      if (ctx.selfNpcId) {
        const npc = state.npcs[ctx.selfNpcId];
        const rel = npc?.relations.find((r) => r.npcId === PLAYER);
        if (!rel || typeof value !== "number") return false;
        return compare(op, rel.value, value);
      }
      const npcId = key && key !== PLAYER ? key : target;
      if (!npcId) return false;
      const rel = state.player.relations.find((r) => r.npcId === npcId);
      if (!rel || typeof value !== "number") return false;
      return compare(op, rel.value, value);
    }
    case "reputation": {
      const factionId = key ?? "";
      const playerRep = state.player.reputation.find((r) => r.factionId === factionId);
      if (!playerRep || typeof value !== "number") return false;
      return compare(op, playerRep.value, value);
    }
    case "time": {
      const clock = state.clock;
      const timeKey = key ?? "hour";
      const actual =
        timeKey === "hour" ? clock.hour :
        timeKey === "day" ? clock.day :
        timeKey === "month" ? clock.month :
        timeKey === "weekday" ? clock.weekday :
        undefined;
      if (actual === undefined || typeof value !== "number") return false;
      return compare(op, actual, value);
    }
    case "location": {
      const locId = ctx.selfNpcId ? state.npcs[ctx.selfNpcId].currentLocationId : state.player.locationId;
      if (op === "eq") return locId === value;
      if (op === "neq") return locId !== value;
      if (op === "in" && Array.isArray(value)) return value.includes(locId);
      if (op === "not_in" && Array.isArray(value)) return !value.includes(locId);
      return false;
    }
    case "inventory": {
      if (!key) return false;
      const inv = ctx.selfNpcId ? state.npcs[ctx.selfNpcId].inventory : state.player.inventory;
      const stack = inv.stacks.find((s) => s.itemId === key);
      const qty = stack?.quantity ?? 0;
      if (typeof value !== "number") return false;
      return compare(op, qty, value);
    }
    case "currency": {
      const inv = ctx.selfNpcId ? state.npcs[ctx.selfNpcId].inventory : state.player.inventory;
      if (typeof value !== "number") return false;
      return compare(op, inv.currency, value);
    }
    default: {
      // Custom condition source: dispatched to the script's engine
      // extension. Unregistered sources evaluate to false (the validator
      // reports them at load time; this is a runtime-only safety net).
      const evaluator = ctx.definition.extensions?.conditions[source];
      if (!evaluator) return false;
      return evaluator(state, cond, { definition: ctx.definition, selfNpcId: ctx.selfNpcId, playerId: ctx.playerId });
    }
  }
}

/** Recursively evaluates a condition tree. */
export function evalCondition(cond: Condition | undefined, ctx: ConditionContext): boolean {
  if (!cond) return true;
  if ("all" in cond) return cond.all.every((c) => evalCondition(c, ctx));
  if ("any" in cond) return cond.any.some((c) => evalCondition(c, ctx));
  if ("not" in cond) return !evalCondition(cond.not, ctx);
  return evalConditionLeaf(cond, ctx);
}

/** Convenience: evaluate against player context (no self NPC). */
export function evalPlayerCondition(cond: Condition | undefined, definition: WorldDefinition, state: WorldState): boolean {
  return evalCondition(cond, { definition, state });
}
