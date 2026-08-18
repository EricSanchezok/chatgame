// Action pipeline: the deterministic heart of gameplay (I4/I5 — resolution
// is ALWAYS engine-side; LLM never judges success/failure).
//
// Flow: legality check (action known + enabled + conditions + rules) →
// resolve (stat/skill/opposed/auto/narrative_only) → result grade
// (fail/partial/success/crit, Blades-style) → costs (currency/items/time) →
// effects (scaled by grade) → ResolutionLog (auditable).
import type { WorldState, WorldDefinition, ResultGrade, ResolutionLogEntry, EventLogEntry } from "./types";
import type { Actions } from "../script/schemas/actions";

/** The action definition type (from actions schema). */
type ActionEntry = Actions["actions"][number];
import { evalCondition, type ConditionContext } from "./condition";
import { applyEffects } from "./effect";
import { checkWorldRules } from "./rules";
import { rollD20 } from "./rng";
import { BUILTIN_HANDLERS } from "./builtins";
import { applyProgression } from "./mechanics/progression";

export interface ResolutionContext {
  definition: WorldDefinition;
  state: WorldState;
  actionId: string;
  /** NPC target for opposed checks / effects (optional). */
  targetNpcId?: string;
  /** Free-form params (e.g. item id for use_item). */
  params?: Record<string, unknown>;
  /** Override the d20 roll (deterministic tests). */
  rollOverride?: number;
  /** Override the NPC d20 roll in opposed checks (deterministic tests). */
  npcRollOverride?: number;
}

export interface ActionResolution {
  state: WorldState;
  /** Undefined when the action was rejected pre-resolution. */
  resolution?: ResolutionLogEntry;
  /** True when the action was rejected by legality/rules. */
  rejected: boolean;
  /** Machine reason code for rejection (narrativized by LLM layer). */
  rejectReason?: string;
  rejectMessage?: string;
  logEntries: EventLogEntry[];
  /** Effective time cost of the action (>= 1h); the caller steps the world. */
  effectiveTimeCost: number;
}

/** Looks up the action definition from the script (enabled flag respected). */
export function findAction(def: WorldDefinition, actionId: string): ActionEntry | undefined {
  return def.actions.actions.find((a) => a.id === actionId && a.enabled);
}

/** Resolves the result grade from a roll vs DC (Blades-style). */
export function gradeFromRoll(roll: number, dc: number): ResultGrade {
  if (roll >= dc + 5) return "crit";
  if (roll >= dc) return "success";
  if (roll >= dc - 3) return "partial";
  return "fail";
}

/**
 * Resolves an opposed check: player roll+stat vs npc roll+npc_stat.
 * Tie (diff === 0) = actor fails (5e semantics). Bands:
 *   diff >= 5  -> crit
 *   diff >= 1  -> success (net win)
 *   diff === 0 -> fail (tie goes to the defender)
 *   diff >= -3 -> partial (narrow loss)
 *   else       -> fail (decisive loss)
 */
function resolveOpposed(ctx: ResolutionContext, action: ActionEntry): { grade: ResultGrade; roll: number; dc: number } {
  const resolve = action.resolve;
  if (resolve.type !== "opposed_check") throw new Error("resolveOpposed called for non-opposed");
  const playerBonus = ctx.state.player.stats[resolve.stat] ?? 0;
  const npc = ctx.targetNpcId ? ctx.state.npcs[ctx.targetNpcId] : undefined;
  const npcBonus = npc ? npc.stats[resolve.npc_stat] ?? 0 : 10;
  const playerRoll = ctx.rollOverride ?? rollD20(ctx.state.rng);
  const npcRoll = ctx.npcRollOverride ?? rollD20(ctx.state.rng);
  const diff = playerRoll + playerBonus - (npcRoll + npcBonus);
  if (diff >= 5) return { grade: "crit", roll: playerRoll + playerBonus, dc: npcRoll + npcBonus };
  if (diff >= 1) return { grade: "success", roll: playerRoll + playerBonus, dc: npcRoll + npcBonus };
  if (diff === 0) return { grade: "fail", roll: playerRoll + playerBonus, dc: npcRoll + npcBonus };
  if (diff >= -3) return { grade: "partial", roll: playerRoll + playerBonus, dc: npcRoll + npcBonus };
  return { grade: "fail", roll: playerRoll + playerBonus, dc: npcRoll + npcBonus };
}

/** Resolves a stat/skill check (d20 + bonus vs DC). */
function resolveCheck(ctx: ResolutionContext, action: ActionEntry): { grade: ResultGrade; roll: number; dc: number } {
  const resolve = action.resolve;
  const roll = ctx.rollOverride ?? rollD20(ctx.state.rng);
  if (resolve.type === "stat_check") {
    const bonus = ctx.state.player.stats[resolve.stat] ?? 0;
    return { grade: gradeFromRoll(roll + bonus, resolve.dc), roll: roll + bonus, dc: resolve.dc };
  }
  if (resolve.type === "skill_check") {
    const bonus = ctx.state.player.skills[resolve.skill] ?? 0;
    return { grade: gradeFromRoll(roll + bonus, resolve.dc), roll: roll + bonus, dc: resolve.dc };
  }
  throw new Error("resolveCheck called for non-check");
}

/** Legality gate: action known + enabled + conditions + world rules + origin denials. */
export function checkActionLegality(
  def: WorldDefinition,
  state: WorldState,
  actionId: string,
  targetNpcId?: string,
): { ok: true } | { ok: false; reasonCode: string; message: string } {
  const action = findAction(def, actionId);
  if (!action) {
    return { ok: false, reasonCode: "unknown_action", message: `action "${actionId}" is not available` };
  }
  // Origin denied actions (origins[].denied_actions).
  const origin = def.origins.get(state.player.originId);
  if (origin?.denied_actions?.includes(actionId)) {
    return { ok: false, reasonCode: "denied_action", message: "your background prevents this action" };
  }
  if (action.conditions) {
    const ctx: ConditionContext = { definition: def, state };
    if (!evalCondition(action.conditions, ctx)) {
      return { ok: false, reasonCode: "condition_not_met", message: "the situation does not allow this" };
    }
  }
  const ruleResult = checkWorldRules({ definition: def, state, actionId, target: targetNpcId });
  if (!ruleResult.allowed) {
    return { ok: false, reasonCode: ruleResult.reasonCode, message: ruleResult.message };
  }
  return { ok: true };
}

/** Deducts costs (currency/items/time) from state. Returns null when unpayable. */
function payCosts(
  state: WorldState,
  action: ActionEntry,
): WorldState | null {
  const costs = action.costs;
  if (!costs) return state;
  let next = state;
  if (costs.currency) {
    if (next.player.inventory.currency < costs.currency) return null;
    next = {
      ...next,
      player: {
        ...next.player,
        inventory: { ...next.player.inventory, currency: next.player.inventory.currency - costs.currency },
      },
    };
  }
  if (costs.items) {
    for (const req of costs.items) {
      const stack = next.player.inventory.stacks.find((s) => s.itemId === req.item);
      if (!stack || stack.quantity < req.quantity) return null;
    }
    next = {
      ...next,
      player: {
        ...next.player,
        inventory: {
          ...next.player.inventory,
          stacks: next.player.inventory.stacks
            .map((s) => {
              const req = costs.items!.find((r) => r.item === s.itemId);
              return req ? { ...s, quantity: s.quantity - req.quantity } : s;
            })
            .filter((s) => s.quantity > 0),
        },
      },
    };
  }
  // Time cost is applied after effects (see resolveAction); validated here only.
  return next;
}
/**
 * Resolves an action end-to-end. Returns the new state + resolution log.
 * Pure immutable; all randomness flows through state.rng.
 */
export function resolveAction(ctx: ResolutionContext): ActionResolution {
  const { definition, state } = ctx;
  const day = Math.floor(state.clock.totalHours / definition.time.day_length_hours);
  const logEntries: EventLogEntry[] = [];

  // 1. Legality gate (deterministic).
  const legality = checkActionLegality(definition, state, ctx.actionId, ctx.targetNpcId);
  if (!legality.ok) {
    return {
      state,
      rejected: true,
      rejectReason: legality.reasonCode,
      rejectMessage: legality.message,
      logEntries,
      effectiveTimeCost: 0,
    };
  }

  const action = findAction(definition, ctx.actionId)!;

  // 2. Pay costs first (unpayable -> rejection, no state change).
  const afterCosts = payCosts(state, action);
  if (!afterCosts) {
    return {
      state,
      rejected: true,
      rejectReason: "unaffordable",
      rejectMessage: "you cannot afford this",
      logEntries,
      effectiveTimeCost: 0,
    };
  }

  // 3. Resolve (auto / narrative_only never roll).
  let grade: ResultGrade = "success";
  let roll: number | null = null;
  let dc: number | null = null;
  switch (action.resolve.type) {
    case "auto":
      grade = "success";
      break;
    case "narrative_only":
      grade = "success";
      break;
    case "stat_check":
    case "skill_check": {
      const r = resolveCheck(ctx, action);
      grade = r.grade;
      roll = r.roll;
      dc = r.dc;
      break;
    }
    case "opposed_check": {
      const r = resolveOpposed(ctx, action);
      grade = r.grade;
      roll = r.roll;
      dc = r.dc;
      break;
    }
  }

  // 4. Apply effects (scaled by grade). narrative_only skips script effects
  //    (pure narration — mechanical semantics live in builtins).
  const effects = action.resolve.type === "narrative_only" ? [] : (action.effects ?? []);
  const effectOut = applyEffects(afterCosts, effects, { definition, grade, day });
  let finalState = effectOut.state;

  // 4b. Built-in mechanical semantics (attack/defend/move/travel/use_item/
  //     give/take/steal/trade) — data-driven registry, no per-action
  //     hardcoding. Handlers return the next state + summaries.
  let actionSummaries: string[] = [];
  const handler = BUILTIN_HANDLERS[ctx.actionId];
  if (handler) {
    const builtinOut = handler({
      definition,
      state: finalState,
      grade,
      targetNpcId: ctx.targetNpcId,
      params: ctx.params,
    });
    finalState = builtinOut.state;
    actionSummaries = builtinOut.summaries;
    if (builtinOut.rejected) {
      return {
        state,
        rejected: true,
        rejectReason: builtinOut.rejectReason,
        rejectMessage: builtinOut.rejectMessage,
        logEntries,
        effectiveTimeCost: 0,
      };
    }
  }

  // 4c. Progression (stat_check / skill_check sources) after the check.
  if (action.resolve.type === "stat_check" || action.resolve.type === "skill_check") {
    const prog = applyProgression(finalState, definition, action.resolve.type);
    finalState = prog.state;
  }

  // 5. Effective time cost (>= 1h, anti-spam). The caller (playerTurn)
  //    steps the world by this amount — clock advancement is NOT here.
  const effectiveTimeCost = Math.max(action.costs?.time ?? 1, 1);

  // 6. ResolutionLog (auditable).
  const resolution: ResolutionLogEntry = {
    actionId: ctx.actionId,
    target: ctx.targetNpcId,
    resolveType: action.resolve.type,
    roll,
    dc,
    grade,
    effectsApplied: [...effectOut.summaries, ...actionSummaries],
  };
  logEntries.push({
    id: `log-${finalState.eventLog.length + 1}`,
    day,
    hour: finalState.clock.hour,
    type: "resolution",
    actor: "player",
    summary: `action "${ctx.actionId}" → ${grade}`,
    detail: resolution,
  });

  // Merge resolution logs into the world state (auditable history).
  finalState = { ...finalState, eventLog: [...finalState.eventLog, ...logEntries] };

  return { state: finalState, resolution, rejected: false, logEntries, effectiveTimeCost };
}
