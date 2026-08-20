// Built-in action semantics: a data-driven registry of mechanical action
// behaviors (attack / defend / move / travel / use_item / give / take /
// steal / trade). A handler first produces a pure plan (validation, dynamic
// costs, time); execution applies that plan exactly once after script effects.
// Preview reads plan metadata without dry-running the state transition.
import type { WorldState, WorldDefinition, ResultGrade } from "./types";
import { computeDamage, applyDamage, addThreat } from "./mechanics/combat";
import { applyEffects } from "./effect";
import { evalCondition, type ConditionContext } from "./condition";
import { itemCount, addItem, removeItem, addCurrency, removeCurrency } from "./mechanics/inventory";
import { advanceClock } from "./time";

type LocationDefinition = NonNullable<ReturnType<WorldDefinition["locations"]["get"]>>;
type LocationConnection = NonNullable<LocationDefinition["connections"]>[number];

export interface BuiltinContext {
  definition: WorldDefinition;
  state: WorldState;
  targetNpcId?: string;
  params?: Record<string, unknown>;
}

export interface BuiltinOutcome {
  state: WorldState;
  summaries: string[];
}

export interface HandlerCosts {
  currency?: number;
  items?: Array<{ itemId: string; quantity: number }>;
  resources?: Array<{
    kind: "need" | "stat" | "skill" | "runtime";
    id: string;
    amount: number;
  }>;
}

export interface ActionHandlerPlan {
  /** Planning rejection (narrativized by the caller); execute is not called. */
  rejected?: boolean;
  rejectReason?: string;
  rejectMessage?: string;
  /** Dynamic costs in addition to actions.yaml declarative costs. */
  costs?: HandlerCosts;
  /** Authoritative duration override in non-negative integer engine hours. */
  timeCost?: number;
  /** Applies the already-validated plan once to the post-effect state. */
  execute(state: WorldState, grade: ResultGrade): BuiltinOutcome;
}

export type BuiltinHandler = (ctx: BuiltinContext) => ActionHandlerPlan;

/** Convenience: builds an accepted outcome. */
function ok(state: WorldState, summaries: string[]): BuiltinOutcome {
  return { state, summaries };
}

/** Convenience: builds a rejected plan (no execution). */
function reject(reason: string, message: string): ActionHandlerPlan {
  return {
    rejected: true,
    rejectReason: reason,
    rejectMessage: message,
    execute: (state) => ok(state, []),
  };
}

function planned(
  execute: ActionHandlerPlan["execute"],
  metadata: Omit<ActionHandlerPlan, "execute"> = {},
): ActionHandlerPlan {
  return { ...metadata, execute };
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

/** Lowest-duration simple path, with every edge checked at its actual clock. */
function travelPath(
  definition: WorldDefinition,
  state: WorldState,
  from: string,
  to: string,
): Array<{ from: string; to: string; travelMinutes: number }> | null {
  if (from === to) return [];
  const queue: Array<{
    locationId: string;
    elapsedMinutes: number;
    visited: ReadonlySet<string>;
    edges: Array<{ from: string; to: string; travelMinutes: number }>;
  }> = [
    { locationId: from, elapsedMinutes: 0, visited: new Set([from]), edges: [] },
  ];
  while (queue.length > 0) {
    queue.sort((a, b) => a.elapsedMinutes - b.elapsedMinutes);
    const current = queue.shift()!;
    if (current.locationId === to) return current.edges;
    const loc = definition.locations.get(current.locationId);
    if (!loc) continue;
    for (const conn of loc.connections ?? []) {
      if (current.visited.has(conn.to) || !definition.locations.has(conn.to)) continue;
      const departureState = {
        ...state,
        clock: advanceClock(state.clock, definition, current.elapsedMinutes / 60),
        player: { ...state.player, locationId: current.locationId },
      };
      if (movementBlocked(definition, departureState, current.locationId, conn)) continue;
      const edge = { from: current.locationId, to: conn.to, travelMinutes: conn.travel_time };
      const edges = [...current.edges, edge];
      queue.push({
        locationId: conn.to,
        elapsedMinutes: current.elapsedMinutes + conn.travel_time,
        visited: new Set([...current.visited, conn.to]),
        edges,
      });
    }
  }
  return null;
}

/** Checks departure gates now and the destination entry gate on arrival. */
function movementBlocked(
  definition: WorldDefinition,
  state: WorldState,
  from: string,
  connection: LocationConnection,
): string | null {
  const to = connection.to;
  const fromLoc = definition.locations.get(from);
  const toLoc = definition.locations.get(to);
  if (!toLoc) return `location "${to}" does not exist`;
  const departureCtx: ConditionContext = { definition, state };
  if (fromLoc?.exit_condition && !evalCondition(fromLoc.exit_condition, departureCtx)) {
    return "you cannot leave this place right now";
  }
  if (connection.condition && !evalCondition(connection.condition, departureCtx)) {
    return "the way is blocked";
  }
  const arrivalState = {
    ...state,
    clock: advanceClock(state.clock, definition, connection.travel_time / 60),
    player: { ...state.player, locationId: to },
  };
  const arrivalCtx: ConditionContext = { definition, state: arrivalState };
  if (toLoc.entry_condition && !evalCondition(toLoc.entry_condition, arrivalCtx)) {
    return "you cannot enter that place right now";
  }
  return null;
}

const attackHandler: BuiltinHandler = (ctx) => {
  const { definition, targetNpcId } = ctx;
  return planned((state, grade) => {
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
  });
};

const defendHandler: BuiltinHandler = (ctx) => {
  const { definition } = ctx;
  return planned((state, grade) => {
    if (grade === "success" || grade === "crit") {
      const stance = addThreat(state, definition, -5);
      return ok(stance.state, ["defend stance: threat -5"]);
    }
    return ok(state, ["defend stance: no effect"]);
  });
};

const moveHandler: BuiltinHandler = (ctx) => {
  const { definition, state, params } = ctx;
  const target = typeof params?.target === "string" ? params.target : undefined;
  if (!target) return reject("invalid_target", "no target location");
  const current = state.player.locationId;
  const loc = definition.locations.get(current);
  const directEdges = (loc?.connections ?? []).filter((connection) => connection.to === target);
  if (directEdges.length === 0) return reject("not_directly_connected", "that place is not directly reachable from here");
  const viableEdges = directEdges
    .filter((connection) => movementBlocked(definition, state, current, connection) === null)
    .sort((a, b) => a.travel_time - b.travel_time);
  const edge = viableEdges[0];
  if (!edge) {
    const blocked = movementBlocked(definition, state, current, directEdges[0]);
    return reject("movement_blocked", blocked ?? "the way is blocked");
  }
  return planned(
    (nextState) => ok(
      { ...nextState, player: { ...nextState.player, locationId: target } },
      [`moved to ${target}`],
    ),
    {
      timeCost: Math.max(1, Math.ceil((edge?.travel_time ?? 60) / 60)),
    },
  );
};

const travelHandler: BuiltinHandler = (ctx) => {
  const { definition, state, params } = ctx;
  const target = typeof params?.target === "string" ? params.target : undefined;
  if (!target) return reject("invalid_target", "no target location");
  const current = state.player.locationId;
  const path = travelPath(definition, state, current, target);
  if (!path) {
    return reject("unreachable", "that place is not reachable from here");
  }
  const travelMinutes = path.reduce((sum, edge) => sum + edge.travelMinutes, 0);
  return planned(
    (nextState) => ok(
      { ...nextState, player: { ...nextState.player, locationId: target } },
      path.map((edge) => `traveled ${edge.from} -> ${edge.to}`),
    ),
    { timeCost: Math.max(1, Math.ceil(travelMinutes / 60)) },
  );
};

const useItemHandler: BuiltinHandler = (ctx) => {
  const { definition, state, params } = ctx;
  const itemId = typeof params?.item === "string" ? params.item : undefined;
  if (!itemId) return reject("invalid_target", "no item specified");
  const item = definition.items.get(itemId);
  if (!item) return reject("unknown_item", `item "${itemId}" does not exist`);
  if (item.requirements) {
    const condCtx: ConditionContext = { definition, state };
    if (!evalCondition(item.requirements, condCtx)) {
      return reject("item_requirement_not_met", "you cannot use that right now");
    }
  }
  const inv = state.player.inventory;
  if (item.type !== "consumable" && itemCount(inv, itemId) < 1) {
    return reject("item_not_held", "you do not have that item");
  }
  const day = Math.floor(state.clock.totalHours / definition.time.day_length_hours);
  return planned(
    (nextState) => {
      const out = applyEffects(nextState, item.effects_on_use, { definition, day });
      const summaries = [...out.summaries];
      if (item.type === "consumable") {
        summaries.push(`consumed 1 ${itemId}`);
      }
      return ok(out.state, summaries);
    },
    item.type === "consumable"
      ? { costs: { items: [{ itemId, quantity: 1 }] } }
      : {},
  );
};

const giveHandler: BuiltinHandler = (ctx) => {
  const { definition, state, targetNpcId, params } = ctx;
  const itemId = typeof params?.item === "string" ? params.item : undefined;
  if (!targetNpcId) return reject("invalid_target", "no recipient");
  if (!itemId) return reject("invalid_target", "no item specified");
  if (!definition.npcs.has(targetNpcId)) return reject("unknown_npc", "that person does not exist");
  if (!definition.items.has(itemId)) return reject("unknown_item", `item "${itemId}" does not exist`);
  if (!addItem(state.npcs[targetNpcId].inventory, itemId, 1, definition).ok) {
    return reject("transfer_failed", "that person cannot carry it");
  }
  return planned(
    (nextState) => {
      const recipient = nextState.npcs[targetNpcId];
      const added = addItem(recipient.inventory, itemId, 1, definition);
      if (!added.ok) throw new Error(`planned recipient capacity changed: ${itemId}`);
      return ok(
        { ...nextState, npcs: { ...nextState.npcs, [targetNpcId]: { ...recipient, inventory: added.inv } } },
        [`gave 1 ${itemId} to ${targetNpcId}`],
      );
    },
    { costs: { items: [{ itemId, quantity: 1 }] } },
  );
};

const takeHandler: BuiltinHandler = (ctx) => {
  const { definition, state, params } = ctx;
  const itemId = typeof params?.item === "string" ? params.item : undefined;
  if (!itemId) return reject("invalid_target", "no item specified");
  const loc = state.player.locationId;
  const locInv = state.locationInventories[loc];
  if (!locInv || itemCount(locInv, itemId) < 1) return reject("item_not_here", "that item is not here");
  const removed = removeItem(locInv, itemId, 1);
  const added = addItem(state.player.inventory, itemId, 1, definition);
  if (!removed.ok || !added.ok) return reject("transfer_failed", "you cannot carry that");
  return planned((nextState) => {
    const nextLocInv = nextState.locationInventories[loc];
    const nextRemoved = removeItem(nextLocInv, itemId, 1);
    const nextAdded = addItem(nextState.player.inventory, itemId, 1, definition);
    if (!nextRemoved.ok || !nextAdded.ok) throw new Error(`planned location transfer failed: ${itemId}`);
    return ok(
      {
        ...nextState,
        locationInventories: { ...nextState.locationInventories, [loc]: nextRemoved.inv },
        player: { ...nextState.player, inventory: nextAdded.inv },
      },
      [`took 1 ${itemId}`],
    );
  });
};

const stealHandler: BuiltinHandler = (ctx) => {
  const { definition, state, targetNpcId, params } = ctx;
  if (!targetNpcId) return reject("invalid_target", "no target");
  const npc = state.npcs[targetNpcId];
  if (!npc) return reject("unknown_npc", "that person does not exist");
  if (npc.inventory.stacks.length === 0) return reject("nothing_to_steal", "that person has nothing to steal");
  const itemId = typeof params?.item === "string" ? params.item : npc.inventory.stacks[0].itemId;
  const moved = transfer(state, definition, targetNpcId, "player", itemId, 1);
  if (!moved) return reject("transfer_failed", "you cannot carry that");
  return planned((nextState, grade) => {
    if (grade === "success" || grade === "crit") {
      const next = transfer(nextState, definition, targetNpcId, "player", itemId, 1);
      if (!next) throw new Error(`planned theft transfer failed: ${itemId}`);
      return ok(next, [`stole 1 ${itemId} from ${targetNpcId}`]);
    }
    if (grade === "partial") {
      const threat = addThreat(nextState, definition, 5);
      return ok(threat.state, ["steal partial: no item, threat +5"]);
    }
    const threat = addThreat(nextState, definition, 10);
    return ok(threat.state, ["steal failed: threat +10"]);
  });
};

const tradeHandler: BuiltinHandler = (ctx) => {
  const { definition, state, targetNpcId, params } = ctx;
  if (!targetNpcId) return reject("invalid_target", "no trading partner");
  const npc = state.npcs[targetNpcId];
  if (!npc) return reject("unknown_npc", "that person does not exist");
  const itemId = typeof params?.item === "string" ? params.item : undefined;
  const direction = typeof params?.direction === "string" ? params.direction : "buy";
  if (!itemId) return reject("invalid_target", "no item specified");
  const item = definition.items.get(itemId);
  if (!item) return reject("unknown_item", `item "${itemId}" does not exist`);

  if (direction === "buy") {
    // Player buys from NPC: NPC holds the item, player pays its value.
    if (itemCount(npc.inventory, itemId) < 1) return reject("item_not_held", "that person does not have that item");
    const moved = transfer(state, definition, targetNpcId, "player", itemId, 1);
    if (!moved) return reject("transfer_failed", "you cannot carry that");
    return planned(
      (nextState) => {
        const next = transfer(nextState, definition, targetNpcId, "player", itemId, 1);
        if (!next) throw new Error(`planned trade transfer failed: ${itemId}`);
        const npcPaid = {
          ...next.npcs[targetNpcId],
          inventory: addCurrency(next.npcs[targetNpcId].inventory, item.value),
        };
        return ok(
          {
            ...next,
            npcs: { ...next.npcs, [targetNpcId]: npcPaid },
          },
          [`bought 1 ${itemId} for ${item.value}`],
        );
      },
      { costs: { currency: item.value } },
    );
  }
  // Player sells to NPC: NPC must have enough currency (v1: NPCs start with 0).
  if (npc.inventory.currency < item.value) return reject("unaffordable", "that person cannot afford it");
  if (!addItem(npc.inventory, itemId, 1, definition).ok) {
    return reject("transfer_failed", "that person cannot carry it");
  }
  return planned(
    (nextState) => {
      const recipient = nextState.npcs[targetNpcId];
      const added = addItem(recipient.inventory, itemId, 1, definition);
      if (!added.ok) throw new Error(`planned trade recipient capacity changed: ${itemId}`);
      const npcPaid = {
        ...recipient,
        inventory: removeCurrency({ ...added.inv }, item.value),
      };
      const playerPaid = addCurrency(nextState.player.inventory, item.value);
      return ok(
        {
          ...nextState,
          player: { ...nextState.player, inventory: playerPaid },
          npcs: { ...nextState.npcs, [targetNpcId]: npcPaid },
        },
        [`sold 1 ${itemId} for ${item.value}`],
      );
    },
    { costs: { items: [{ itemId, quantity: 1 }] } },
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
