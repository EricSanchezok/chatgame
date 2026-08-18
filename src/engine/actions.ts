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
import { advanceClock } from "./time";
import { computeDamage, applyDamage, addThreat } from "./mechanics/combat";

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

/** Legality gate: action known + enabled + conditions + world rules. */
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

  // 4. Apply effects (scaled by grade).
  const effects = action.effects ?? [];
  const effectOut = applyEffects(afterCosts, effects, { definition, grade, day });
  let finalState = effectOut.state;

  // 4b. Combat + movement wiring (v1 minimal, deterministic):
  //   - attack: on a hit (partial/success/crit) applies grade-scaled damage
  //     to the target NPC (base = player strength); HP reaching 0 records a
  //     `defeated:<npc>` fact.
  //   - defend: passive defense stance — success reduces threat gauge.
  //   - move/travel: with a known location target, relocates the player.
  const actionSummaries: string[] = [];
  if (ctx.actionId === "attack" && ctx.targetNpcId) {
    if (grade === "success" || grade === "crit" || grade === "partial") {
      const base = finalState.player.stats.strength ?? 1;
      const dmg = computeDamage(base, grade);
      const hit = applyDamage(finalState, definition, ctx.targetNpcId, dmg, "physical");
      finalState = hit.state;
      actionSummaries.push(`attack hit ${ctx.targetNpcId} for ${dmg} (hp ${hit.hpRemaining})`);
      if (hit.hpRemaining <= 0) {
        finalState = { ...finalState, facts: [...finalState.facts, `defeated:${ctx.targetNpcId}`] };
        actionSummaries.push(`${ctx.targetNpcId} defeated`);
      }
    } else {
      actionSummaries.push(`attack missed ${ctx.targetNpcId}`);
    }
  } else if (ctx.actionId === "defend") {
    if (grade === "success" || grade === "crit") {
      const stance = addThreat(finalState, definition, -5);
      finalState = stance.state;
      actionSummaries.push("defend stance: threat -5");
    } else {
      actionSummaries.push("defend stance: no effect");
    }
  } else if (
    (ctx.actionId === "move" || ctx.actionId === "travel") &&
    typeof ctx.params?.target === "string"
  ) {
    const loc = ctx.params.target;
    if (definition.locations.has(loc)) {
      finalState = { ...finalState, player: { ...finalState.player, locationId: loc } };
      actionSummaries.push(`moved to ${loc}`);
    }
  }

  // 5. Advance time by the action cost (always >= 1h for actions with time cost).
  const timeCost = action.costs?.time ?? 0;
  if (timeCost > 0) {
    finalState = { ...finalState, clock: advanceClock(finalState.clock, definition, timeCost) };
  }
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

  return { state: finalState, resolution, rejected: false, logEntries };
}
