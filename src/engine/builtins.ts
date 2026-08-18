// Built-in action semantics: a data-driven registry of mechanical action
// behaviors (attack / defend / move / travel / use_item / give / take /
// steal / trade). resolveAction applies script effects first, then calls
// the registered handler for mechanical consequences. Handlers are pure
// immutable updates; movement/steal rejections carry machine reason codes
// that the narrative layer narrativizes (I7).
import type { WorldState, WorldDefinition, ResultGrade } from "./types";
import { computeDamage, applyDamage, addThreat } from "./mechanics/combat";
import { applyEffects } from "./effect";
import { evalCondition, type ConditionContext } from "./condition";
import { itemCount, addItem, removeItem, addCurrency, removeCurrency } from "./mechanics/inventory";

export interface BuiltinContext {
  definition: WorldDefinition;
  state: WorldState;
  /** Result grade from the resolution (auto/check). */
  grade: ResultGrade;
  targetNpcId?: string;
  params?: Record<string, unknown>;
}

export interface BuiltinOutcome {
  state: WorldState;
  summaries: string[];
  /** Movement-style rejection (narrativized by the caller). */
  rejected?: boolean;
  rejectReason?: string;
  rejectMessage?: string;
}

export type BuiltinHandler = (ctx: BuiltinContext) => BuiltinOutcome;

/** Convenience: builds an accepted outcome. */
function ok(state: WorldState, summaries: string[]): BuiltinOutcome {
  return { state, summaries };
}

/** Convenience: builds a rejected outcome (no state change). */
function reject(reason: string, message: string, ctx: BuiltinContext): BuiltinOutcome {
  return {
    state: ctx.state,
    summaries: [],
    rejected: true,
    rejectReason: reason,
    rejectMessage: message,
  };
}

/** Transfers qty of itemId from one inventory to another (both sides). */
function transfer(
  state: WorldState,
  definition: WorldDefinition,
  from: "player" | string,
  to: "player" | string,
  itemId: string,
  qty: number,
): WorldState | null {
  const fromInv = from === "player" ? state.player.inventory : state.npcs[from]?.inventory;
  const toInv = to === "player" ? state.player.inventory : state.npcs[to]?.inventory;
  if (!fromInv || !toInv) return null;
  if (itemCount(fromInv, itemId) < qty) return null;
  const removed = removeItem(fromInv, itemId, qty);
  if (!removed.ok) return null;
  const added = addItem(toInv, itemId, qty, definition);
  if (!added.ok) return null;
  if (from === "player" && to === "player") return state;
  if (from === "player") {
    return {
      ...state,
      player: { ...state.player, inventory: removed.inv },
      npcs: { ...state.npcs, [to]: { ...state.npcs[to], inventory: added.inv } },
    };
  }
  if (to === "player") {
    return {
      ...state,
      npcs: { ...state.npcs, [from]: { ...state.npcs[from], inventory: removed.inv } },
      player: { ...state.player, inventory: added.inv },
    };
  }
  return state;
}

/** BFS reachability across the location connection graph. */
function locationReachable(
  definition: WorldDefinition,
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  const visited = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const loc = definition.locations.get(current);
    if (!loc) continue;
    for (const conn of loc.connections ?? []) {
      if (conn.to === to) return true;
      if (!visited.has(conn.to) && definition.locations.has(conn.to)) {
        visited.add(conn.to);
        queue.push(conn.to);
      }
    }
  }
  return false;
}

/** Checks entry/exit conditions for a move/travel between two locations. */
function movementBlocked(
  definition: WorldDefinition,
  state: WorldState,
  from: string,
  to: string,
): string | null {
  const fromLoc = definition.locations.get(from);
  const toLoc = definition.locations.get(to);
  if (!toLoc) return `location "${to}" does not exist`;
  const ctx: ConditionContext = { definition, state };
  if (fromLoc?.exit_condition && !evalCondition(fromLoc.exit_condition, ctx)) {
    return "you cannot leave this place right now";
  }
  if (toLoc.entry_condition && !evalCondition(toLoc.entry_condition, ctx)) {
    return "you cannot enter that place right now";
  }
  // Direct connection condition (for move).
  const conn = fromLoc?.connections?.find((c) => c.to === to);
  if (conn?.condition && !evalCondition(conn.condition, ctx)) {
    return "the way is blocked";
  }
  return null;
}

const attackHandler: BuiltinHandler = (ctx) => {
  const { definition, state, grade, targetNpcId } = ctx;
  if (!targetNpcId) return ok(state, []);
  const summaries: string[] = [];
  let current = state;
  if (grade === "success" || grade === "crit" || grade === "partial") {
    const base = current.player.stats.strength ?? 1;
    const dmg = computeDamage(base, grade);
    const hit = applyDamage(current, definition, targetNpcId, dmg, "physical");
    current = hit.state;
    summaries.push(`attack hit ${targetNpcId} for ${dmg} (hp ${hit.hpRemaining})`);
    if (hit.hpRemaining <= 0) {
      current = { ...current, facts: [...current.facts, `defeated:${targetNpcId}`] };
      summaries.push(`${targetNpcId} defeated`);
    }
  } else {
    summaries.push(`attack missed ${targetNpcId}`);
  }
  return ok(current, summaries);
};

const defendHandler: BuiltinHandler = (ctx) => {
  const { definition, state, grade } = ctx;
  if (grade === "success" || grade === "crit") {
    const stance = addThreat(state, definition, -5);
    return ok(stance.state, ["defend stance: threat -5"]);
  }
  return ok(state, ["defend stance: no effect"]);
};

const moveHandler: BuiltinHandler = (ctx) => {
  const { definition, state, params } = ctx;
  const target = typeof params?.target === "string" ? params.target : undefined;
  if (!target) return reject("invalid_target", "no target location", ctx);
  const current = state.player.locationId;
  const loc = definition.locations.get(current);
  const direct = loc?.connections?.some((c) => c.to === target) ?? false;
  if (!direct) return reject("not_directly_connected", "that place is not directly reachable from here", ctx);
  const blocked = movementBlocked(definition, state, current, target);
  if (blocked) return reject("movement_blocked", blocked, ctx);
  return ok({ ...state, player: { ...state.player, locationId: target } }, [`moved to ${target}`]);
};

const travelHandler: BuiltinHandler = (ctx) => {
  const { definition, state, params } = ctx;
  const target = typeof params?.target === "string" ? params.target : undefined;
  if (!target) return reject("invalid_target", "no target location", ctx);
  const current = state.player.locationId;
  if (!locationReachable(definition, current, target)) {
    return reject("unreachable", "that place is not reachable from here", ctx);
  }
  const blocked = movementBlocked(definition, state, current, target);
  if (blocked) return reject("movement_blocked", blocked, ctx);
  return ok({ ...state, player: { ...state.player, locationId: target } }, [`traveled to ${target}`]);
};

const useItemHandler: BuiltinHandler = (ctx) => {
  const { definition, state, params } = ctx;
  const itemId = typeof params?.item === "string" ? params.item : undefined;
  if (!itemId) return reject("invalid_target", "no item specified", ctx);
  const item = definition.items.get(itemId);
  if (!item) return reject("unknown_item", `item "${itemId}" does not exist`, ctx);
  if (item.requirements) {
    const condCtx: ConditionContext = { definition, state };
    if (!evalCondition(item.requirements, condCtx)) {
      return reject("item_requirement_not_met", "you cannot use that right now", ctx);
    }
  }
  const inv = state.player.inventory;
  if (itemCount(inv, itemId) < 1) return reject("item_not_held", "you do not have that item", ctx);
  const day = Math.floor(state.clock.totalHours / definition.time.day_length_hours);
  const out = applyEffects(state, item.effects_on_use, { definition, day });
  let current = out.state;
  const summaries = [...out.summaries];
  if (item.type === "consumable") {
    const removed = removeItem(current.player.inventory, itemId, 1);
    if (!removed.ok) return reject("item_not_held", "you do not have that item", ctx);
    current = {
      ...current,
      player: { ...current.player, inventory: removed.inv },
    };
    summaries.push(`consumed 1 ${itemId}`);
  }
  return ok(current, summaries);
};

const giveHandler: BuiltinHandler = (ctx) => {
  const { definition, state, targetNpcId, params } = ctx;
  const itemId = typeof params?.item === "string" ? params.item : undefined;
  if (!targetNpcId) return reject("invalid_target", "no recipient", ctx);
  if (!itemId) return reject("invalid_target", "no item specified", ctx);
  if (!definition.npcs.has(targetNpcId)) return reject("unknown_npc", "that person does not exist", ctx);
  if (itemCount(state.player.inventory, itemId) < 1) return reject("item_not_held", "you do not have that item", ctx);
  const moved = transfer(state, definition, "player", targetNpcId, itemId, 1);
  if (!moved) return reject("transfer_failed", "that person cannot carry it", ctx);
  return ok(moved, [`gave 1 ${itemId} to ${targetNpcId}`]);
};

const takeHandler: BuiltinHandler = (ctx) => {
  const { definition, state, params } = ctx;
  const itemId = typeof params?.item === "string" ? params.item : undefined;
  if (!itemId) return reject("invalid_target", "no item specified", ctx);
  const loc = state.player.locationId;
  const locInv = state.locationInventories[loc];
  if (!locInv || itemCount(locInv, itemId) < 1) return reject("item_not_here", "that item is not here", ctx);
  const removed = removeItem(locInv, itemId, 1);
  const added = addItem(state.player.inventory, itemId, 1, definition);
  if (!removed.ok || !added.ok) return reject("transfer_failed", "you cannot carry that", ctx);
  return ok(
    {
      ...state,
      locationInventories: { ...state.locationInventories, [loc]: removed.inv },
      player: { ...state.player, inventory: added.inv },
    },
    [`took 1 ${itemId}`],
  );
};

const stealHandler: BuiltinHandler = (ctx) => {
  const { definition, state, grade, targetNpcId, params } = ctx;
  if (!targetNpcId) return reject("invalid_target", "no target", ctx);
  const npc = state.npcs[targetNpcId];
  if (!npc) return reject("unknown_npc", "that person does not exist", ctx);
  if (npc.inventory.stacks.length === 0) return reject("nothing_to_steal", "that person has nothing to steal", ctx);
  const itemId = typeof params?.item === "string" ? params.item : npc.inventory.stacks[0].itemId;
  if (grade === "success" || grade === "crit") {
    const moved = transfer(state, definition, targetNpcId, "player", itemId, 1);
    if (!moved) return reject("transfer_failed", "you cannot carry that", ctx);
    return ok(moved, [`stole 1 ${itemId} from ${targetNpcId}`]);
  }
  if (grade === "partial") {
    const threat = addThreat(state, definition, 5);
    return ok(threat.state, ["steal partial: no item, threat +5"]);
  }
  const threat = addThreat(state, definition, 10);
  return ok(threat.state, ["steal failed: threat +10"]);
};

const tradeHandler: BuiltinHandler = (ctx) => {
  const { definition, state, targetNpcId, params } = ctx;
  if (!targetNpcId) return reject("invalid_target", "no trading partner", ctx);
  const npc = state.npcs[targetNpcId];
  if (!npc) return reject("unknown_npc", "that person does not exist", ctx);
  const itemId = typeof params?.item === "string" ? params.item : undefined;
  const direction = typeof params?.direction === "string" ? params.direction : "buy";
  if (!itemId) return reject("invalid_target", "no item specified", ctx);
  const item = definition.items.get(itemId);
  if (!item) return reject("unknown_item", `item "${itemId}" does not exist`, ctx);

  if (direction === "buy") {
    // Player buys from NPC: NPC holds the item, player pays its value.
    if (itemCount(npc.inventory, itemId) < 1) return reject("item_not_held", "that person does not have that item", ctx);
    if (state.player.inventory.currency < item.value) return reject("unaffordable", "you cannot afford that", ctx);
    const moved = transfer(state, definition, targetNpcId, "player", itemId, 1);
    if (!moved) return reject("transfer_failed", "you cannot carry that", ctx);
    const paid = removeCurrency(moved.player.inventory, item.value);
    const npcPaid = { ...moved.npcs[targetNpcId], inventory: addCurrency(moved.npcs[targetNpcId].inventory, item.value) };
    return ok(
      {
        ...moved,
        player: { ...moved.player, inventory: paid },
        npcs: { ...moved.npcs, [targetNpcId]: npcPaid },
      },
      [`bought 1 ${itemId} for ${item.value}`],
    );
  }
  // Player sells to NPC: NPC must have enough currency (v1: NPCs start with 0).
  if (itemCount(state.player.inventory, itemId) < 1) return reject("item_not_held", "you do not have that item", ctx);
  if (npc.inventory.currency < item.value) return reject("unaffordable", "that person cannot afford it", ctx);
  const moved = transfer(state, definition, "player", targetNpcId, itemId, 1);
  if (!moved) return reject("transfer_failed", "that person cannot carry it", ctx);
  const npcPaid = { ...moved.npcs[targetNpcId], inventory: removeCurrency(moved.npcs[targetNpcId].inventory, item.value) };
  const playerPaid = addCurrency(moved.player.inventory, item.value);
  return ok(
    {
      ...moved,
      player: { ...moved.player, inventory: playerPaid },
      npcs: { ...moved.npcs, [targetNpcId]: npcPaid },
    },
    [`sold 1 ${itemId} for ${item.value}`],
  );
};

/** Registered built-in handlers keyed by action id. */
export const BUILTIN_HANDLERS: Record<string, BuiltinHandler> = {
  attack: attackHandler,
  defend: defendHandler,
  move: moveHandler,
  travel: travelHandler,
  use_item: useItemHandler,
  give: giveHandler,
  take: takeHandler,
  steal: stealHandler,
  trade: tradeHandler,
};

/** Convenience: true when the action id has a built-in mechanical handler. */
export function hasBuiltinHandler(actionId: string): boolean {
  return actionId in BUILTIN_HANDLERS;
}
