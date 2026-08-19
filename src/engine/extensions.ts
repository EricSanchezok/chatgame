// Script extension seam (engine side): typed contracts for script-owned
// engine code (scripts/<id>/engine/index.ts). Handlers are pure functions
// over immutable state — the same discipline as built-in engine modules.
// The script registers handlers at load time; the engine dispatches to them
// for unknown effect kinds / condition sources / custom action handlers.
import type { WorldState, WorldDefinition, ResultGrade } from "./types";
import type { Effect, ConditionValue } from "../script/schemas/common";
import type { BuiltinContext, BuiltinOutcome } from "./builtins";

/** Context passed to a custom effect handler. */
export interface RuntimeEffectContext {
  definition: WorldDefinition;
  grade: ResultGrade;
  day: number;
}

/** Custom effect handler: pure immutable update + human-readable summaries. */
export type RuntimeEffectHandler = (
  state: WorldState,
  effect: Effect,
  ctx: RuntimeEffectContext,
) => { state: WorldState; summaries: string[] };

/** A leaf condition with a custom source (key/target/op/value passthrough). */
export interface RuntimeConditionLeaf {
  source: string;
  key?: string;
  target?: string;
  op: string;
  value?: ConditionValue;
}

/** Custom condition source evaluator: returns a boolean for the leaf. */
export type RuntimeConditionEvaluator = (
  state: WorldState,
  leaf: RuntimeConditionLeaf,
  ctx: { definition: WorldDefinition; selfNpcId?: string; playerId?: string },
) => boolean;

/** Custom action handler (same shape as built-in handlers). */
export type RuntimeActionHandler = (ctx: BuiltinContext) => BuiltinOutcome;

/** Handlers registered by the script's engine extension (immutable after load). */
export interface ScriptExtensions {
  effects: Record<string, RuntimeEffectHandler>;
  conditions: Record<string, RuntimeConditionEvaluator>;
  actionHandlers: Record<string, RuntimeActionHandler>;
}

/** Registration surface passed to the script's engine/index.ts default export. */
export interface EngineExtensionContext {
  registerEffect(kind: string, handler: RuntimeEffectHandler): void;
  registerConditionSource(source: string, evaluator: RuntimeConditionEvaluator): void;
  registerActionHandler(id: string, handler: RuntimeActionHandler): void;
}
