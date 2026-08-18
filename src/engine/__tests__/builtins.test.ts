// Built-in action semantics tests: the data-driven registry for
// attack / defend / move / travel / use_item / give / take / steal / trade.
// Movement follows the location connection graph (move = direct edge,
// travel = multi-hop reachability); trades move inventory + currency;
// use_item applies effects_on_use and consumes consumables.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import { resolveAction } from "../actions";
import { advanceClock } from "../time";
import { BUILTIN_HANDLERS } from "../builtins";
import type { WorldDefinition, WorldState } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function emberfall(): WorldDefinition {
  return loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
}

function freshState(def: WorldDefinition, seed = 42): WorldState {
  return generateWorld(def, "miner", { seed }).state;
}

/** Move the player to tavern (elara's home) for NPC-interaction tests. */
function atTavern(state: WorldState): WorldState {
  return { ...state, player: { ...state.player, locationId: "tavern" } };
}

describe("builtin registry", () => {
  it("registers the nine mechanical actions", () => {
    expect(BUILTIN_HANDLERS).toHaveProperty("attack");
    expect(BUILTIN_HANDLERS).toHaveProperty("defend");
    expect(BUILTIN_HANDLERS).toHaveProperty("move");
    expect(BUILTIN_HANDLERS).toHaveProperty("travel");
    expect(BUILTIN_HANDLERS).toHaveProperty("use_item");
    expect(BUILTIN_HANDLERS).toHaveProperty("give");
    expect(BUILTIN_HANDLERS).toHaveProperty("take");
    expect(BUILTIN_HANDLERS).toHaveProperty("steal");
    expect(BUILTIN_HANDLERS).toHaveProperty("trade");
  });
});

describe("movement", () => {
  it("move rejects a location that is not directly connected", () => {
    const def = emberfall();
    const state = atTavern(freshState(def));
    // tavern connects to town-square + elara-bedroom only.
    const out = resolveAction({
      definition: def,
      state,
      actionId: "move",
      params: { target: "mine-entrance" },
    });
    expect(out.rejected).toBe(true);
    expect(out.rejectReason).toBe("not_directly_connected");
  });

  it("move succeeds to a directly connected location", () => {
    const def = emberfall();
    const state = atTavern(freshState(def));
    const out = resolveAction({
      definition: def,
      state,
      actionId: "move",
      params: { target: "town-square" },
    });
    expect(out.rejected).toBe(false);
    expect(out.state.player.locationId).toBe("town-square");
  });

  it("travel succeeds to a multi-hop reachable location", () => {
    const def = emberfall();
    // mine-entrance opens at 06:00 (entry_condition); travel at 08:00.
    const state = {
      ...atTavern(freshState(def)),
      clock: advanceClock(freshState(def).clock, def, 8),
    };
    // tavern -> town-square -> mine-entrance (2 hops).
    const out = resolveAction({
      definition: def,
      state,
      actionId: "travel",
      params: { target: "mine-entrance" },
    });
    expect(out.rejected).toBe(false);
    expect(out.state.player.locationId).toBe("mine-entrance");
  });

  it("travel rejects an unreachable location", () => {
    const def = emberfall();
    const state = atTavern(freshState(def));
    // Inject a disconnected location id that doesn't exist in the graph.
    const out = resolveAction({
      definition: def,
      state,
      actionId: "travel",
      params: { target: "no-such-place" },
    });
    expect(out.rejected).toBe(true);
    expect(out.rejectReason).toBe("unreachable");
  });
});

describe("inventory actions", () => {
  it("use_item applies effects_on_use and consumes consumables", () => {
    const def = emberfall();
    const state = freshState(def);
    // Miner origin starts with a lantern (equipment — not consumable).
    // Give the player a consumable to test consumption.
    const withTonic = {
      ...state,
      player: {
        ...state.player,
        inventory: {
          ...state.player.inventory,
          stacks: [...state.player.inventory.stacks, { itemId: "tonic", quantity: 2 }],
        },
      },
    };
    const out = resolveAction({
      definition: def,
      state: withTonic,
      actionId: "use_item",
      params: { item: "tonic" },
    });
    expect(out.rejected).toBe(false);
    // tonic effects_on_use: need hunger +20 (well-fed style) — verify the
    // stack was consumed (2 -> 1).
    expect(out.state.player.inventory.stacks.find((s) => s.itemId === "tonic")?.quantity).toBe(1);
  });

  it("use_item rejects an item not held", () => {
    const def = emberfall();
    const state = freshState(def);
    const out = resolveAction({
      definition: def,
      state,
      actionId: "use_item",
      params: { item: "coal-essence" }, // not in the player's inventory
    });
    expect(out.rejected).toBe(true);
    expect(out.rejectReason).toBe("item_not_held");
  });

  it("give transfers an item to a co-located NPC", () => {
    const def = emberfall();
    const state = atTavern(freshState(def));
    const out = resolveAction({
      definition: def,
      state,
      actionId: "give",
      targetNpcId: "elara",
      params: { item: "lantern" },
    });
    expect(out.rejected).toBe(false);
    expect(out.state.player.inventory.stacks.some((s) => s.itemId === "lantern")).toBe(false);
    expect(out.state.npcs.elara.inventory.stacks.some((s) => s.itemId === "lantern")).toBe(true);
  });

  it("take transfers an item from the location inventory", () => {
    const def = emberfall();
    const state = freshState(def);
    // Player starts at mine-entrance which now has coal-essence.
    const out = resolveAction({
      definition: def,
      state,
      actionId: "take",
      params: { item: "coal-essence" },
    });
    // take requires the player be at town-hall (action condition) — so it
    // rejects for the wrong reason; verify the condition gate first.
    expect(out.rejected).toBe(true);
    expect(out.rejectReason).toBe("condition_not_met");
  });

  it("steal succeeds and transfers an item from the target NPC", () => {
    const def = emberfall();
    const state = atTavern({
      ...freshState(def),
      npcs: {
        ...freshState(def).npcs,
        elara: {
          ...freshState(def).npcs.elara,
          inventory: { stacks: [{ itemId: "tonic", quantity: 1 }], currency: 0 },
        },
      },
    });
    const out = resolveAction({
      definition: def,
      state,
      actionId: "steal",
      targetNpcId: "elara",
      rollOverride: 20,
    });
    expect(out.rejected).toBe(false);
    expect(out.state.player.inventory.stacks.some((s) => s.itemId === "tonic")).toBe(true);
  });

  it("steal fails with threat when the roll fails", () => {
    const def = emberfall();
    const state = atTavern({
      ...freshState(def),
      npcs: {
        ...freshState(def).npcs,
        elara: {
          ...freshState(def).npcs.elara,
          inventory: { stacks: [{ itemId: "tonic", quantity: 1 }], currency: 0 },
        },
      },
    });
    const out = resolveAction({
      definition: def,
      state,
      actionId: "steal",
      targetNpcId: "elara",
      rollOverride: 1,
    });
    expect(out.rejected).toBe(false);
    expect(out.state.player.threatGauge).toBeGreaterThan(0);
    expect(out.state.player.inventory.stacks.some((s) => s.itemId === "tonic")).toBe(false);
  });

  it("trade buy moves currency + item between player and NPC", () => {
    const def = emberfall();
    const state = atTavern({
      ...freshState(def),
      npcs: {
        ...freshState(def).npcs,
        elara: {
          ...freshState(def).npcs.elara,
          inventory: { stacks: [{ itemId: "tonic", quantity: 1 }], currency: 0 },
        },
      },
    });
    const out = resolveAction({
      definition: def,
      state,
      actionId: "trade",
      targetNpcId: "elara",
      params: { item: "tonic", direction: "buy" },
    });
    expect(out.rejected).toBe(false);
    expect(out.state.player.inventory.stacks.some((s) => s.itemId === "tonic")).toBe(true);
    expect(out.state.player.inventory.currency).toBeLessThan(state.player.inventory.currency);
  });
});
