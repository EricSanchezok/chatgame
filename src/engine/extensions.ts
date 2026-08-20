// Script extension seam (engine side): typed contracts for script-owned
// engine code (scripts/<id>/engine/index.ts). Handlers are pure functions
// over immutable state — the same discipline as built-in engine modules.
// The script registers handlers at load time; the engine dispatches to them
// for unknown effect kinds / condition sources / custom action handlers.
import type { WorldState, WorldDefinition, ResultGrade, ResolutionLogEntry } from "./types";
import type { TurnInput } from "../shared/client-dto";
import type { Effect, ConditionValue } from "../script/schemas/common";
import type { BuiltinHandler } from "./builtins";
import { mutableSnapshot, readonlySnapshot } from "./readonly-snapshot";

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
export type RuntimeActionHandler = BuiltinHandler;

export interface RuntimeRuleContext {
  definition: WorldDefinition;
  state: WorldState;
  actionId: string;
  target?: string;
  params?: Readonly<Record<string, unknown>>;
}

export type RuntimeRuleChecker = (ctx: RuntimeRuleContext) => string | null;

export interface RuntimeLifecycleContext {
  definition: WorldDefinition;
  previousState?: WorldState;
  turnInput?: TurnInput;
  resolution?: ResolutionLogEntry;
}

export type RuntimeLifecycleHandler = (
  state: WorldState,
  ctx: RuntimeLifecycleContext,
) => { state: WorldState; summaries: string[] };

/** Handlers registered by the script's engine extension (immutable after load). */
export interface ScriptExtensions {
  effects: Record<string, RuntimeEffectHandler>;
  conditions: Record<string, RuntimeConditionEvaluator>;
  actionHandlers: Record<string, RuntimeActionHandler>;
  ruleMechanisms: Record<string, RuntimeRuleChecker>;
  lifecycle: {
    sessionStart: RuntimeLifecycleHandler[];
    turnResolved: RuntimeLifecycleHandler[];
    hour: RuntimeLifecycleHandler[];
    dayBoundary: RuntimeLifecycleHandler[];
  };
}

/** Registration surface passed to the script's engine/index.ts default export. */
export interface EngineExtensionContext {
  registerEffect(kind: string, handler: RuntimeEffectHandler): void;
  registerConditionSource(source: string, evaluator: RuntimeConditionEvaluator): void;
  registerActionHandler(id: string, handler: RuntimeActionHandler): void;
  registerRuleMechanism(id: string, checker: RuntimeRuleChecker): void;
  onSessionStart(handler: RuntimeLifecycleHandler): void;
  onTurnResolved(handler: RuntimeLifecycleHandler): void;
  onHour(handler: RuntimeLifecycleHandler): void;
  onDayBoundary(handler: RuntimeLifecycleHandler): void;
}

export type LifecyclePhase = keyof ScriptExtensions["lifecycle"];

/** Runs registered lifecycle handlers in declaration order. */
export function runLifecycle(
  phase: LifecyclePhase,
  state: WorldState,
  context: RuntimeLifecycleContext,
): { state: WorldState; summaries: string[] } {
  let current = state;
  const summaries: string[] = [];
  const activeScriptId = state.scriptId;
  for (const handler of context.definition.extensions.lifecycle[phase]) {
    const result = handler(
      readonlySnapshot(current),
      readonlySnapshot({ ...context, previousState: context.previousState ?? state }),
    );
    if (result.state.scriptId !== activeScriptId) {
      throw new Error(`lifecycle ${phase} cannot change the active script id`);
    }
    current = mutableSnapshot(result.state);
    summaries.push(...result.summaries);
  }
  return { state: current, summaries };
}
