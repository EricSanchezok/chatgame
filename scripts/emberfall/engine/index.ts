// Emberfall engine extension: forge-themed mechanics around the ash forge.
// Registers one custom effect kind (`ember`, a forge-heat gauge stored in
// runtimeState), one custom condition source (`ember_level`), and one
// custom action handler (`forge`). All handlers are pure immutable updates
// over state — the same discipline as the built-in engine modules.
import type {
  EngineExtensionContext,
  RuntimeActionHandler,
  RuntimeConditionEvaluator,
  RuntimeEffectHandler,
  RuntimeRuleChecker,
} from "../../../src/engine/extensions";
import type { WorldState } from "../../../src/engine/types";

/** Extension-owned runtime state (opaque to the engine core). */
interface EmberfallRuntime {
  /** Ash-forge heat gauge 0–100, raised by the `ember` effect. */
  ember?: number;
}

function readRuntime(state: WorldState): EmberfallRuntime {
  const raw = state.runtimeState;
  return typeof raw === "object" && raw !== null ? (raw as EmberfallRuntime) : {};
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `ember` effect: raises/lowers the forge-heat gauge (params: value, target). */
const emberEffect: RuntimeEffectHandler = (state, effect) => {
  const params = effect as { value?: unknown; target?: unknown };
  const delta = typeof params.value === "number" ? params.value : 1;
  const current = readRuntime(state).ember ?? 0;
  const next = clamp(current + delta, 0, 100);
  const who = typeof params.target === "string" && params.target !== "player" ? params.target : "the ash forge";
  return {
    state: { ...state, runtimeState: { ...state.runtimeState, ember: next } },
    summaries: [`ember heat at ${who}: ${delta >= 0 ? "+" : ""}${delta} (now ${next})`],
  };
};

/** `ember_level` condition source: compares the forge-heat gauge (gte/lte/gt/lt/eq/neq). */
const emberLevelEvaluator: RuntimeConditionEvaluator = (state, leaf) => {
  const current = readRuntime(state).ember ?? 0;
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
 * `forge` action handler: shapes a coal-essence lantern at the ash forge.
 * The action entry consumes the coal via costs.items; the handler requires
 * residual ember heat and mints the lantern (respecting inventory capacity).
 */
const forgeHandler: RuntimeActionHandler = (ctx) => {
  const { definition, state, params } = ctx;
  const reject = (reason: string, message: string) => ({
    rejected: true,
    rejectReason: reason,
    rejectMessage: message,
    execute: (nextState: typeof state) => ({ state: nextState, summaries: [] }),
  });

  const item = typeof params?.item === "string" ? params.item : "lantern";
  if (item !== "lantern") {
    return reject("unsupported_item", "the ash forge can only shape coal-essence lanterns");
  }
  if ((readRuntime(state).ember ?? 0) < 1) {
    return reject("forge_cold", "the forge is cold — stoke it with ember first");
  }

  const capacity = definition.mechanics.inventory.capacity;
  const inv = state.player.inventory;
  const used = inv.stacks.reduce((sum, s) => sum + s.quantity, 0);
  if (used >= capacity) {
    return reject("inventory_full", "your pack has no room for the lantern");
  }

  return {
    execute: (nextState) => {
      const nextInv = nextState.player.inventory;
      const existing = nextInv.stacks.find((s) => s.itemId === item);
      const stacks = existing
        ? nextInv.stacks.map((s) => (s.itemId === item ? { ...s, quantity: s.quantity + 1 } : s))
        : [...nextInv.stacks, { itemId: item, quantity: 1 }];
      return {
        state: { ...nextState, player: { ...nextState.player, inventory: { ...nextInv, stacks } } },
        summaries: ["forged 1 lantern at the ash forge"],
      };
    },
  };
};

const nightTravelRule: RuntimeRuleChecker = ({ state, actionId }) => {
  if (actionId !== "travel") return null;
  return state.clock.hour >= 22 || state.clock.hour < 6
    ? "mountain routes are closed between 22:00 and 06:00"
    : null;
};

export default function registerEmberfallExtensions(ctx: EngineExtensionContext): void {
  ctx.registerEffect("ember", emberEffect);
  ctx.registerConditionSource("ember_level", emberLevelEvaluator);
  ctx.registerActionHandler("forge", forgeHandler);
  ctx.registerRuleMechanism("night_travel", nightTravelRule);
}
