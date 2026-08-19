// Starlight engine extension: hull-integrity mechanics for station survival.
// Registers one custom effect kind (`hull`, a station hull-integrity gauge
// stored in runtimeState), one custom condition source (`hull_integrity`),
// and one custom action handler (`reroute`). All handlers are pure
// immutable updates over state — the same discipline as the built-ins.
import type {
  EngineExtensionContext,
  RuntimeActionHandler,
  RuntimeConditionEvaluator,
  RuntimeEffectHandler,
} from "../../../src/engine/extensions";
import type { WorldState } from "../../../src/engine/types";

/** Extension-owned runtime state (opaque to the engine core). */
interface StarlightRuntime {
  /** Station hull integrity 0–100; defaults to 100 until first damaged. */
  hull_integrity?: number;
  /** Absolute day of the last power reroute (one reroute per day). */
  last_reroute_day?: number;
}

function readRuntime(state: WorldState): StarlightRuntime {
  const raw = state.runtimeState;
  return typeof raw === "object" && raw !== null ? (raw as StarlightRuntime) : {};
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `hull` effect: raises/lowers station hull integrity (params: value). */
const hullEffect: RuntimeEffectHandler = (state, effect, _ctx) => {
  const params = effect as { value?: unknown };
  const delta = typeof params.value === "number" ? params.value : 5;
  const current = readRuntime(state).hull_integrity ?? 100;
  const next = clamp(current + delta, 0, 100);
  return {
    state: { ...state, runtimeState: { ...state.runtimeState, hull_integrity: next } },
    summaries: [`hull integrity ${delta >= 0 ? "+" : ""}${delta} (now ${next}%)`],
  };
};

/** `hull_integrity` condition source: compares station hull integrity. */
const hullIntegrityEvaluator: RuntimeConditionEvaluator = (state, leaf) => {
  const current = readRuntime(state).hull_integrity ?? 100;
  const value = typeof leaf.value === "number" ? leaf.value : 0;
  switch (leaf.op) {
    case "gte":
      return current >= value;
    case "lte":
      return current <= value;
    case "gt":
      return current > value;
    case "lt":
      return current < value;
    case "eq":
      return current === value;
    case "neq":
      return current !== value;
    default:
      return false;
  }
};

/**
 * `reroute` action handler: diverts life-support power to the hull grid.
 * Costs energy, is limited to once per day; the action's `hull` effect
 * (applied before the handler) does the actual hull repair.
 */
const rerouteHandler: RuntimeActionHandler = (ctx) => {
  const { definition, state } = ctx;
  const reject = (reason: string, message: string) => ({
    state,
    summaries: [],
    rejected: true,
    rejectReason: reason,
    rejectMessage: message,
  });

  const energy = state.player.needs.energy?.value ?? 0;
  if (energy < 20) {
    return reject("insufficient_energy", "you are too drained to reroute power");
  }
  const day = Math.floor(state.clock.totalHours / definition.time.day_length_hours);
  if (readRuntime(state).last_reroute_day === day) {
    return reject("already_routed", "the power grid was rerouted earlier today");
  }

  const needs = {
    ...state.player.needs,
    energy: { ...(state.player.needs.energy ?? { value: 0 }), value: Math.max(0, energy - 20) },
  };
  return {
    state: {
      ...state,
      player: { ...state.player, needs },
      runtimeState: { ...state.runtimeState, last_reroute_day: day },
    },
    summaries: ["rerouted life-support power to the hull grid (-20 energy)"],
  };
};

export default function registerStarlightExtensions(ctx: EngineExtensionContext): void {
  ctx.registerEffect("hull", hullEffect);
  ctx.registerConditionSource("hull_integrity", hullIntegrityEvaluator);
  ctx.registerActionHandler("reroute", rerouteHandler);
}
