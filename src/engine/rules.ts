// World rule enforcement (RuleOK gate, invariant I4).
//
// world.yaml `rules` are declarative world laws the ENGINE executes
// deterministically — a violation rejects the state change. This is the
// hard programmatic guardrail; prompt-embedded rules are only a soft
// first line (CoC-Seduce evidence: LLM judges are unreliable). The same
// rule declarations feed both the validator and the LLM prompt (single
// source of truth).
import type { WorldState } from "./types";
import type { WorldDefinition } from "./types";
import { BUILTIN_RULE_MECHANISMS as BUILTIN_RULE_MECHANISM_IDS } from "../script/schemas/world";
import { readonlySnapshot } from "./readonly-snapshot";

export interface RuleCheckContext {
  definition: WorldDefinition;
  state: WorldState;
  /** Which action is being attempted (for targeted rule checks). */
  actionId: string;
  /** Target entity id (npc/player) when applicable. */
  target?: string;
  params?: Readonly<Record<string, unknown>>;
}

export interface RuleCheckResult {
  allowed: boolean;
  /** Machine reason code for the refusal (narrativized by the LLM layer). */
  reasonCode: string;
  /** Human-readable refusal text (deterministic, world-consistent). */
  message: string;
}

/** Built-in mechanism checks keyed by world rule `mechanism` field. */
type MechanismChecker = (ctx: RuleCheckContext) => string | null;

/** Action vocabulary check: an action is known when the script declares it
 *  (enabled) OR the script's engine extension registered a handler for it.
 *  Single source of truth = actions.yaml + engine extensions. */
function actionAllowed(def: WorldDefinition, actionId: string): boolean {
  if (def.actions.actions.some((a) => a.id === actionId && a.enabled)) return true;
  return actionId in def.extensions.actionHandlers;
}

/** item existence check: effects must reference existing script items (I2). */
function itemExists(ctx: RuleCheckContext): string | null {
  const def = ctx.definition;
  // action-level: the target item must be a known script item
  if (ctx.actionId === "use_item" && ctx.target) {
    if (!def.items.has(ctx.target)) {
      return `item "${ctx.target}" does not exist in this world`;
    }
  }
  return null;
}

/** no-matter-creation check: cannot create items out of thin air (I2). */
function noMatterCreation(ctx: RuleCheckContext): string | null {
  const def = ctx.definition;
  // gather/steal/take must target an existing item defined by the script —
  // UNLESS the target is an NPC (stealing from a character is allowed; the
  // item check applies to the item being taken, not the person).
  if (["gather", "steal", "take"].includes(ctx.actionId) && ctx.target) {
    if (def.npcs.has(ctx.target)) return null;
    if (!def.items.has(ctx.target)) {
      return "the world has no such thing to obtain";
    }
  }
  return null;
}

/** npc-presence check: actions with an npc target require the npc present (same location). */
function npcPresent(ctx: RuleCheckContext): string | null {
  const def = ctx.definition;
  if (ctx.target && def.npcs.has(ctx.target)) {
    const npcState = ctx.state.npcs[ctx.target];
    const playerLoc = ctx.state.player.locationId;
    if (npcState && npcState.currentLocationId !== playerLoc) {
      return `${npcState.id} is not here`;
    }
  }
  return null;
}

/** teleport check: teleports must reference a known location. */
function teleportTarget(ctx: RuleCheckContext): string | null {
  const def = ctx.definition;
  if (ctx.target && !def.locations.has(ctx.target)) {
    return `location "${ctx.target}" does not exist in this world`;
  }
  return null;
}

/** gold check: cannot go into debt (currency floors at 0 in effects). */
function noDebt(ctx: RuleCheckContext): string | null {
  if (ctx.state.player.inventory.currency < 0) {
    return "you do not have enough coin";
  }
  return null;
}

/** threat check: cannot act when the threat gauge is at maximum. */
function threatNotFull(ctx: RuleCheckContext): string | null {
  const max = ctx.definition.mechanics.combat.threat_gauge.max;
  if (ctx.state.player.threatGauge >= max) {
    return "you are overwhelmed and cannot act";
  }
  return null;
}

const BUILTIN_RULE_CHECKERS: Readonly<Record<(typeof BUILTIN_RULE_MECHANISM_IDS)[number], MechanismChecker>> = {
  item_exists: itemExists,
  no_matter_creation: noMatterCreation,
  npc_present: npcPresent,
  teleport_target: teleportTarget,
  no_debt: noDebt,
  threat_not_full: threatNotFull,
};

/**
 * Checks a proposed action against world rules. Returns allowed=false with
 * a reason when ANY rule is violated. The refusal is narrativized by the
 * LLM layer (I7 — rejections are never cold "you can't").
 */
export function checkWorldRules(ctx: RuleCheckContext): RuleCheckResult {
  const def = ctx.definition;

  // 1. Action vocabulary check (I2/I5: intent must map to a known action).
  if (!actionAllowed(def, ctx.actionId)) {
    return {
      allowed: false,
      reasonCode: "unknown_action",
      message: `the action "${ctx.actionId}" is not possible in this world`,
    };
  }

  // 2. World rules declared in world.yaml with mechanism -> deterministic checkers.
  for (const rule of def.world.rules) {
    if (rule.mechanism) {
      const builtinChecker = (BUILTIN_RULE_CHECKERS as Readonly<Record<string, MechanismChecker>>)[rule.mechanism];
      const extensionChecker = def.extensions.ruleMechanisms[rule.mechanism];
      if (!builtinChecker && !extensionChecker) {
        return {
          allowed: false,
          reasonCode: `unregistered_rule:${rule.mechanism}`,
          message: `world rule mechanism "${rule.mechanism}" is not registered`,
        };
      }
      const violation = builtinChecker
        ? builtinChecker(ctx)
        : extensionChecker!(readonlySnapshot(ctx));
      if (violation) {
        return {
          allowed: false,
          reasonCode: `rule:${rule.id}`,
          message: violation,
        };
      }
    }
  }

  // 3. Built-in hard invariants (always active).
  const npcCheck = npcPresent(ctx);
  if (npcCheck) {
    return { allowed: false, reasonCode: "npc_absent", message: npcCheck };
  }

  return { allowed: true, reasonCode: "ok", message: "" };
}

/** Convenience: does the world allow the action at all (vocabulary gate)? */
export function isKnownAction(def: WorldDefinition, actionId: string): boolean {
  return actionAllowed(def, actionId);
}
