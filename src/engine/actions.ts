// Action pipeline: the deterministic heart of gameplay (I4/I5 — resolution
// is ALWAYS engine-side; LLM never judges success/failure).
//
// Flow: legality check (action known + enabled + conditions + rules) →
// costs (currency/items) → resolve (stat/skill/opposed/auto/narrative_only)
// → result grade (fail/partial/success/crit, Blades-style) →
// effects (scaled by grade) → ResolutionLog (auditable).
import type { WorldState, WorldDefinition, ResultGrade, ResolutionLogEntry, EventLogEntry } from "./types";
import type { Actions } from "../script/schemas/actions";
import { absoluteDay } from "./time";

/** The action definition type (from actions schema). */
type ActionEntry = Actions["actions"][number];
import { evalCondition, type ConditionContext } from "./condition";
import { applyEffects } from "./effect";
import { checkWorldRules } from "./rules";
import { rollD20 } from "./rng";
import { BUILTIN_HANDLERS, type ActionHandlerPlan, type HandlerCosts } from "./builtins";
import { applyProgression } from "./mechanics/progression";
import type { ActionPreview, IntentHint } from "../shared/client-dto";
import { mutableSnapshot, readonlySnapshot } from "./readonly-snapshot";

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
  if (!resolve) throw new Error("resolveOpposed called for handler-only action");
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

function resolveCheck(ctx: ResolutionContext, action: ActionEntry): { grade: ResultGrade; roll: number; dc: number } {
  const resolve = action.resolve;
  if (!resolve) throw new Error("resolveCheck called for handler-only action");
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
  target?: string,
  params?: Readonly<Record<string, unknown>>,
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
  const ruleResult = checkWorldRules({ definition: def, state, actionId, target, params });
  if (!ruleResult.allowed) {
    return { ok: false, reasonCode: ruleResult.reasonCode, message: ruleResult.message };
  }
  // Cooldown gate: the action may not be repeated until the declared
  // cooldown (hours -> absolute days) has elapsed since its last success.
  if (action.cooldown && action.cooldown > 0) {
    const lastUsedDay = state.actionCooldowns[actionId];
    if (lastUsedDay !== undefined) {
      const elapsedDays = absoluteDay(def, state.clock) - lastUsedDay;
      if (elapsedDays < action.cooldown) {
        return {
          ok: false,
          reasonCode: "on_cooldown",
          message: "this action is still on cooldown",
        };
      }
    }
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

function normalizedHandlerTimeCost(timeCost: number | undefined, declarativeTimeCost: number | undefined): number {
  if (timeCost !== undefined && (!Number.isFinite(timeCost) || timeCost < 0)) {
    throw new Error("handler timeCost must be a non-negative finite number");
  }
  return Math.max(timeCost ?? declarativeTimeCost ?? 1, 1);
}

function normalizedHandlerCosts(costs?: HandlerCosts): Required<Pick<HandlerCosts, "currency" | "items" | "resources">> {
  const currency = costs?.currency ?? 0;
  if (!Number.isFinite(currency) || currency < 0) throw new Error("handler currency cost must be a non-negative finite number");
  const itemTotals = new Map<string, number>();
  for (const item of costs?.items ?? []) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(`handler item cost for "${item.itemId}" must be a positive integer`);
    }
    itemTotals.set(item.itemId, (itemTotals.get(item.itemId) ?? 0) + item.quantity);
  }
  const resourceTotals = new Map<string, NonNullable<HandlerCosts["resources"]>[number]>();
  for (const resource of costs?.resources ?? []) {
    if (!Number.isFinite(resource.amount) || resource.amount <= 0) {
      throw new Error(`handler resource cost for "${resource.id}" must be positive and finite`);
    }
    const key = `${resource.kind}\0${resource.id}`;
    const existing = resourceTotals.get(key);
    resourceTotals.set(key, {
      ...resource,
      amount: (existing?.amount ?? 0) + resource.amount,
    });
  }
  return {
    currency,
    items: [...itemTotals].map(([itemId, quantity]) => ({ itemId, quantity })),
    resources: [...resourceTotals.values()],
  };
}

/** Validates and deducts planned dynamic costs exactly once. */
function payHandlerCosts(state: WorldState, costs?: HandlerCosts): WorldState | null {
  const normalized = normalizedHandlerCosts(costs);
  if (state.player.inventory.currency < normalized.currency) return null;
  for (const item of normalized.items) {
    const held = state.player.inventory.stacks.find((stack) => stack.itemId === item.itemId)?.quantity ?? 0;
    if (held < item.quantity) return null;
  }
  for (const resource of normalized.resources) {
    const current = resource.kind === "need"
      ? state.player.needs[resource.id]?.value
      : resource.kind === "stat"
        ? state.player.stats[resource.id]
        : resource.kind === "skill"
          ? state.player.skills[resource.id]
          : state.runtimeState[resource.id];
    if (typeof current !== "number" || !Number.isFinite(current) || current < resource.amount) return null;
  }

  let next: WorldState = {
    ...state,
    player: {
      ...state.player,
      inventory: {
        ...state.player.inventory,
        currency: state.player.inventory.currency - normalized.currency,
        stacks: state.player.inventory.stacks
          .map((stack) => {
            const cost = normalized.items.find((item) => item.itemId === stack.itemId);
            return cost ? { ...stack, quantity: stack.quantity - cost.quantity } : stack;
          })
          .filter((stack) => stack.quantity > 0),
      },
    },
  };
  for (const resource of normalized.resources) {
    if (resource.kind === "need") {
      const need = next.player.needs[resource.id]!;
      next = {
        ...next,
        player: {
          ...next.player,
          needs: { ...next.player.needs, [resource.id]: { ...need, value: need.value - resource.amount } },
        },
      };
    } else if (resource.kind === "stat") {
      next = { ...next, player: { ...next.player, stats: { ...next.player.stats, [resource.id]: next.player.stats[resource.id] - resource.amount } } };
    } else if (resource.kind === "skill") {
      next = { ...next, player: { ...next.player, skills: { ...next.player.skills, [resource.id]: next.player.skills[resource.id] - resource.amount } } };
    } else {
      next = { ...next, runtimeState: { ...next.runtimeState, [resource.id]: (next.runtimeState[resource.id] as number) - resource.amount } };
    }
  }
  return next;
}

function previewCosts(action: ActionEntry, dynamic?: HandlerCosts): ActionPreview["costs"] {
  const normalized = normalizedHandlerCosts(dynamic);
  const items = new Map<string, number>();
  for (const item of action.costs?.items ?? []) {
    items.set(item.item, (items.get(item.item) ?? 0) + item.quantity);
  }
  for (const item of normalized.items) {
    items.set(item.itemId, (items.get(item.itemId) ?? 0) + item.quantity);
  }
  return {
    currency: (action.costs?.currency ?? 0) + normalized.currency,
    items: [...items].map(([itemId, quantity]) => ({ itemId, quantity })),
    ...(normalized.resources.length ? { resources: normalized.resources } : {}),
  };
}

function planHandler(
  definition: WorldDefinition,
  state: WorldState,
  action: ActionEntry,
  actionId: string,
  targetNpcId: string | undefined,
  params: Record<string, unknown> | undefined,
): ActionHandlerPlan | undefined {
  if (action.handler) {
    const handler = definition.extensions.actionHandlers[action.handler];
    if (!handler) throw new Error(`action handler "${action.handler}" is not registered`);
    return handler({
      definition: readonlySnapshot(definition),
      state: readonlySnapshot(state),
      targetNpcId,
      params: params ? readonlySnapshot(params) : undefined,
    });
  }
  const handler = BUILTIN_HANDLERS[actionId];
  return handler?.({
    definition: readonlySnapshot(definition),
    state: readonlySnapshot(state),
    targetNpcId,
    params: params ? readonlySnapshot(params) : undefined,
  });
}

/** Runs a planned transition once behind the same extension purity boundary. */
function executeHandlerPlan(
  plan: ActionHandlerPlan,
  state: WorldState,
  grade: ResultGrade,
  handlerId: string,
): ReturnType<ActionHandlerPlan["execute"]> {
  const activeScriptId = state.scriptId;
  const input = readonlySnapshot({ state, grade });
  const outcome = plan.execute(input.state, input.grade);
  if (outcome.state.scriptId !== activeScriptId) {
    throw new Error(`action handler "${handlerId}" execute cannot change the active script id`);
  }
  return mutableSnapshot(outcome);
}

/** Authoritative, side-effect-free action preflight used by the host composer. */
export function previewAction(
  definition: WorldDefinition,
  state: WorldState,
  hint: IntentHint,
): ActionPreview {
  const action = findAction(definition, hint.actionId);
  const displayName = action?.display_name ?? hint.actionId;
  let timeCost = Math.max(action?.costs?.time ?? 1, 1);
  let costs = action ? previewCosts(action) : { currency: 0, items: [] };
  const resolve = action?.resolve;
  const risk: ActionPreview["risk"] = !resolve || resolve.type === "auto" || resolve.type === "narrative_only"
    ? { type: "none" }
    : resolve.type === "stat_check"
      ? { type: "stat", key: resolve.stat, dc: resolve.dc }
      : resolve.type === "skill_check"
        ? { type: "skill", key: resolve.skill, dc: resolve.dc }
        : { type: "opposed", key: resolve.stat };
  const targetNpcId = hint.target && definition.npcs.has(hint.target) ? hint.target : undefined;
  const legality = checkActionLegality(definition, state, hint.actionId, hint.target, hint.params);
  if (!action || !legality.ok) {
    return {
      actionId: hint.actionId,
      displayName,
      executable: false,
      reasonCode: legality.ok ? "unknown_action" : legality.reasonCode,
      reason: legality.ok ? "action is not available" : legality.message,
      timeCost,
      costs,
      risk,
    };
  }
  const paidCosts = payCosts(state, action);
  if (!paidCosts) {
    return { actionId: hint.actionId, displayName, executable: false, reasonCode: "unaffordable", reason: "costs are not available", timeCost, costs, risk };
  }
  const plan = planHandler(
    definition,
    paidCosts,
    action,
    hint.actionId,
    targetNpcId,
    { ...(hint.params ?? {}), ...(hint.target ? { target: hint.target } : {}) },
  );
  if (plan) {
    costs = previewCosts(action, plan.costs);
    timeCost = normalizedHandlerTimeCost(plan.timeCost, action.costs?.time);
    if (plan.rejected) {
      return {
        actionId: hint.actionId,
        displayName,
        executable: false,
        reasonCode: plan.rejectReason ?? "action_rejected",
        reason: plan.rejectMessage ?? "the action cannot be performed now",
        timeCost,
        costs,
        risk,
      };
    }
    if (!payHandlerCosts(paidCosts, plan.costs)) {
      return { actionId: hint.actionId, displayName, executable: false, reasonCode: "unaffordable", reason: "dynamic costs are not available", timeCost, costs, risk };
    }
  }
  return { actionId: hint.actionId, displayName, executable: true, timeCost, costs, risk };
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
  const target = typeof ctx.params?.target === "string" ? ctx.params.target : ctx.targetNpcId;
  const legality = checkActionLegality(definition, state, ctx.actionId, target, ctx.params);
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
  const paidCosts = payCosts(state, action);
  if (!paidCosts) {
    return {
      state,
      rejected: true,
      rejectReason: "unaffordable",
      rejectMessage: "you cannot afford this",
      logEntries,
      effectiveTimeCost: 0,
    };
  }
  // Resolution mutates the RNG cursor; isolate it from the caller's snapshot.
  const afterCosts = { ...paidCosts, rng: { ...paidCosts.rng } };

  // 3. Plan handler semantics against the paid state, then let the engine
  //    validate and deduct all dynamic costs before any roll or effect.
  const plan = planHandler(
    definition,
    afterCosts,
    action,
    ctx.actionId,
    ctx.targetNpcId,
    ctx.params,
  );
  const effectiveTimeCost = normalizedHandlerTimeCost(plan?.timeCost, action.costs?.time);
  if (plan?.rejected) {
    return {
      state,
      rejected: true,
      rejectReason: plan.rejectReason,
      rejectMessage: plan.rejectMessage,
      logEntries,
      effectiveTimeCost: 0,
    };
  }
  const afterHandlerCosts = payHandlerCosts(afterCosts, plan?.costs);
  if (!afterHandlerCosts) {
    return {
      state,
      rejected: true,
      rejectReason: "unaffordable",
      rejectMessage: "you cannot afford this",
      logEntries,
      effectiveTimeCost: 0,
    };
  }

  // 4. Resolve (auto / narrative_only never roll). Custom-handler actions
  //    may omit resolve entirely — the handler owns resolution semantics.
  let grade: ResultGrade = "success";
  let roll: number | null = null;
  let dc: number | null = null;
  if (action.resolve) {
    switch (action.resolve.type) {
      case "auto":
        grade = "success";
        break;
      case "narrative_only":
        grade = "success";
        break;
      case "stat_check":
      case "skill_check": {
        const r = resolveCheck({ ...ctx, state: afterHandlerCosts }, action);
        grade = r.grade;
        roll = r.roll;
        dc = r.dc;
        break;
      }
      case "opposed_check": {
        const r = resolveOpposed({ ...ctx, state: afterHandlerCosts }, action);
        grade = r.grade;
        roll = r.roll;
        dc = r.dc;
        break;
      }
    }
  }

  // 5. Apply effects (scaled by grade). narrative_only skips script effects
  //    (pure narration — mechanical semantics live in builtins).
  const effects =
    action.resolve?.type === "narrative_only" ? [] : (action.effects ?? []);
  const effectOut = applyEffects(afterHandlerCosts, effects, { definition, grade, day });
  let finalState = effectOut.state;

  // 5b. Execute the already-validated handler plan exactly once. Custom actions
  //     declare a `handler` id resolved from the script's engine extension
  //     (overrides the built-in registry for the same id). Built-in actions
  //     without a declared handler use the framework registry.
  let actionSummaries: string[] = [];
  if (plan) {
    const builtinOut = executeHandlerPlan(
      plan,
      finalState,
      grade,
      action.handler ?? ctx.actionId,
    );
    finalState = builtinOut.state;
    actionSummaries = builtinOut.summaries;
  }

  // 5c. Progression (stat_check / skill_check sources) after the check.
  if (action.resolve && (action.resolve.type === "stat_check" || action.resolve.type === "skill_check")) {
    const prog = applyProgression(finalState, definition, action.resolve.type, {
      target: action.resolve.type === "stat_check" ? action.resolve.stat : action.resolve.skill,
    });
    finalState = prog.state;
  }

  // 6. Effective time cost (>= 1h, anti-spam). The caller (playerTurn)
  //    steps the world by this amount — clock advancement is NOT here.
  // 6b. Record the cooldown anchor (absolute day) for actions that declare
  //     a cooldown, so the legality gate can reject early repeats.
  if (action.cooldown && action.cooldown > 0) {
    finalState = {
      ...finalState,
      actionCooldowns: { ...finalState.actionCooldowns, [ctx.actionId]: day },
    };
  }

  // 7. ResolutionLog (auditable).
  const resolution: ResolutionLogEntry = {
    actionId: ctx.actionId,
    target: ctx.targetNpcId,
    resolveType: action.resolve?.type ?? "auto",
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
