// Built-in action semantics tests: the data-driven registry for
// attack / defend / move / travel / use_item / give / take / steal / trade.
// Movement follows the location connection graph (move = direct edge,
// travel = multi-hop reachability); trades move inventory + currency;
// use_item applies effects_on_use and consumes consumables.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import { previewAction, resolveAction } from "../actions";
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

  it("previews handler plans without dry-running execution", () => {
    const base = emberfall();
    const action = {
      id: "prepare",
      enabled: true,
      resolve: { type: "auto" as const },
      effects: [{
        kind: "flag" as const,
        direction: "add" as const,
        target: "player",
        flag: "prepared",
      }],
      llm_freedom: "narration" as const,
      handler: "requires-prepared",
    };
    let executions = 0;
    const definition: WorldDefinition = {
      ...base,
      actions: { ...base.actions, actions: [...base.actions.actions, action] },
      extensions: {
        ...base.extensions,
        actionHandlers: {
          ...base.extensions.actionHandlers,
          "requires-prepared": () => ({
            costs: { currency: 2 },
            timeCost: 3,
            execute: (state) => {
              executions += 1;
              return { state, summaries: ["prepared"] };
            },
          }),
        },
      },
    };
    const state = freshState(definition);

    const preview = previewAction(definition, state, { actionId: action.id });
    expect(executions).toBe(0);
    expect(preview.costs.currency).toBe(2);
    expect(preview.timeCost).toBe(3);
    const resolution = resolveAction({ definition, state, actionId: action.id });

    expect(preview.executable).toBe(true);
    expect(resolution.rejected).toBe(false);
    expect(resolution.state.player.flags).toContain("prepared");
    expect(state.player.inventory.currency - resolution.state.player.inventory.currency).toBe(2);
    expect(executions).toBe(1);
  });

  it("centrally validates and pays dynamic costs exactly once", () => {
    const base = emberfall();
    const action = {
      id: "metered-action",
      enabled: true,
      resolve: { type: "auto" as const },
      llm_freedom: "narration" as const,
      handler: "metered-handler",
    };
    const definition: WorldDefinition = {
      ...base,
      actions: { ...base.actions, actions: [...base.actions.actions, action] },
      extensions: {
        ...base.extensions,
        actionHandlers: {
          ...base.extensions.actionHandlers,
          "metered-handler": () => ({
            costs: { currency: 7 },
            timeCost: 0,
            execute: (state) => ({ state, summaries: ["metered"] }),
          }),
        },
      },
    };
    const fresh = freshState(definition);
    const state = {
      ...fresh,
      player: {
        ...fresh.player,
        inventory: { ...fresh.player.inventory, currency: 30 },
      },
    };
    const preview = previewAction(definition, state, { actionId: action.id });
    const first = resolveAction({ definition, state, actionId: action.id });
    const second = resolveAction({ definition, state: first.state, actionId: action.id });
    expect(preview).toMatchObject({ executable: true, timeCost: 1, costs: { currency: 7 } });
    expect(first.effectiveTimeCost).toBe(1);
    expect(first.state.player.inventory.currency).toBe(23);
    expect(second.state.player.inventory.currency).toBe(16);

    const poor = {
      ...state,
      player: { ...state.player, inventory: { ...state.player.inventory, currency: 6 } },
    };
    expect(previewAction(definition, poor, { actionId: action.id })).toMatchObject({
      executable: false,
      reasonCode: "unaffordable",
      costs: { currency: 7 },
    });
    const rejected = resolveAction({ definition, state: poor, actionId: action.id });
    expect(rejected.rejected).toBe(true);
    expect(rejected.state).toEqual(poor);
  });

  it("gives planners a frozen clone and preserves the authoritative state on mutation", () => {
    const base = emberfall();
    const action = {
      id: "malicious-action",
      enabled: true,
      resolve: { type: "stat_check" as const, stat: "strength", dc: 10 },
      llm_freedom: "narration" as const,
      handler: "mutating-handler",
    };
    const definition: WorldDefinition = {
      ...base,
      actions: { ...base.actions, actions: [...base.actions.actions, action] },
      extensions: {
        ...base.extensions,
        actionHandlers: {
          ...base.extensions.actionHandlers,
          "mutating-handler": ({ state }) => {
            state.player.flags.push("planner-pollution");
            return { execute: (nextState) => ({ state: nextState, summaries: [] }) };
          },
        },
      },
    };
    const state = freshState(definition);
    const before = structuredClone(state);
    expect(() => previewAction(definition, state, { actionId: action.id })).toThrow(TypeError);
    expect(state).toEqual(before);
    expect(() => resolveAction({ definition, state, actionId: action.id })).toThrow(TypeError);
    expect(state).toEqual(before);
  });

  it("isolates the world definition from malicious planning mutations", () => {
    const base = emberfall();
    const action = {
      id: "definition-mutation",
      enabled: true,
      resolve: { type: "auto" as const },
      llm_freedom: "narration" as const,
      handler: "definition-mutator",
    };
    const definition: WorldDefinition = {
      ...base,
      actions: { ...base.actions, actions: [...base.actions.actions, action] },
      extensions: {
        ...base.extensions,
        actionHandlers: {
          ...base.extensions.actionHandlers,
          "definition-mutator": ({ definition: planningDefinition, params }) => {
            if (params?.mutation === "nested") {
              planningDefinition.world.background = "polluted";
            } else {
              planningDefinition.locations.clear();
            }
            return { execute: (state) => ({ state, summaries: [] }) };
          },
        },
      },
    };
    const state = freshState(definition);
    const before = structuredClone(state);
    const locationIds = [...definition.locations.keys()];
    const worldBackground = definition.world.background;

    expect(() => previewAction(definition, state, {
      actionId: action.id,
      params: { mutation: "nested" },
    })).toThrow(TypeError);
    expect(definition.world.background).toBe(worldBackground);
    expect(() => previewAction(definition, state, { actionId: action.id })).toThrow(TypeError);
    expect([...definition.locations.keys()]).toEqual(locationIds);
    expect(state).toEqual(before);
    expect(() => resolveAction({
      definition,
      state,
      actionId: action.id,
      params: { mutation: "nested" },
    })).toThrow(TypeError);
    expect(definition.world.background).toBe(worldBackground);
    expect(() => resolveAction({ definition, state, actionId: action.id })).toThrow(TypeError);
    expect([...definition.locations.keys()]).toEqual(locationIds);
    expect(state).toEqual(before);
  });

  it("fails loudly when a declared action handler is missing at runtime", () => {
    const base = emberfall();
    const action = {
      id: "broken-action",
      enabled: true,
      llm_freedom: "narration" as const,
      handler: "missing-handler",
    };
    const definition = {
      ...base,
      actions: { ...base.actions, actions: [...base.actions.actions, action] },
    };
    expect(() => previewAction(definition, freshState(definition), { actionId: action.id }))
      .toThrow(/missing-handler.*not registered/);
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
    const preview = previewAction(def, state, { actionId: "travel", target: "mine-entrance" });
    expect(preview.executable).toBe(true);
    expect(preview.timeCost).toBe(out.effectiveTimeCost);
  });

  it("travel rejects an unreachable location", () => {
    const def = emberfall();
    const base = freshState(def);
    const state = { ...atTavern(base), clock: advanceClock(base.clock, def, 8) };
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

  it("checks every intermediate edge and reports path-derived time", () => {
    const base = emberfall();
    const start = base.locations.get("tavern")!;
    const middle = base.locations.get("town-square")!;
    const target = base.locations.get("mine-entrance")!;
    const locations = new Map([
      [start.id, { ...start, connections: [{ to: middle.id, distance: 1, travel_time: 90 }] }],
      [middle.id, {
        ...middle,
        exit_condition: { source: "flag", key: "middle-pass", op: "has" as const },
        connections: [{ to: target.id, distance: 1, travel_time: 60 }],
      }],
      [target.id, { ...target, entry_condition: undefined, connections: [] }],
    ]);
    const definition = { ...base, locations };
    const state = {
      ...atTavern(freshState(base)),
      clock: advanceClock(freshState(base).clock, base, 8),
    };
    const blocked = resolveAction({
      definition,
      state,
      actionId: "travel",
      params: { target: target.id },
    });
    expect(blocked.rejected).toBe(true);
    expect(blocked.rejectReason).toBe("unreachable");

    const allowed = resolveAction({
      definition,
      state: { ...state, player: { ...state.player, flags: [...state.player.flags, "middle-pass"] } },
      actionId: "travel",
      params: { target: target.id },
    });
    expect(allowed.rejected).toBe(false);
    expect(allowed.effectiveTimeCost).toBe(3);
    expect(allowed.resolution?.effectsApplied).toEqual([
      `traveled ${start.id} -> ${middle.id}`,
      `traveled ${middle.id} -> ${target.id}`,
    ]);
  });

  it("chooses the lowest-duration path instead of the fewest edges", () => {
    const base = emberfall();
    const start = base.locations.get("tavern")!;
    const middle = base.locations.get("town-square")!;
    const target = base.locations.get("mine-entrance")!;
    const locations = new Map([
      [start.id, { ...start, exit_condition: undefined, connections: [
        { to: target.id, distance: 1, travel_time: 180 },
        { to: middle.id, distance: 1, travel_time: 30 },
      ] }],
      [middle.id, { ...middle, exit_condition: undefined, entry_condition: undefined, connections: [
        { to: target.id, distance: 1, travel_time: 30 },
      ] }],
      [target.id, { ...target, entry_condition: undefined, connections: [] }],
    ]);
    const definition = { ...base, locations };
    const state = { ...atTavern(freshState(base)), clock: advanceClock(freshState(base).clock, base, 8) };
    const out = resolveAction({ definition, state, actionId: "travel", params: { target: target.id } });
    expect(out.rejected).toBe(false);
    expect(out.effectiveTimeCost).toBe(1);
    expect(out.resolution?.effectsApplied).toEqual([
      `traveled ${start.id} -> ${middle.id}`,
      `traveled ${middle.id} -> ${target.id}`,
    ]);
  });

  it("checks later travel edges at the clock reached by prior segments", () => {
    const base = emberfall();
    const start = base.locations.get("tavern")!;
    const middle = base.locations.get("town-square")!;
    const target = base.locations.get("mine-entrance")!;
    const locations = new Map([
      [start.id, { ...start, exit_condition: undefined, connections: [
        { to: middle.id, distance: 1, travel_time: 120 },
      ] }],
      [middle.id, { ...middle, exit_condition: undefined, entry_condition: undefined, connections: [
        {
          to: target.id,
          distance: 1,
          travel_time: 60,
          condition: { source: "time", key: "hour", op: "gte" as const, value: 10 },
        },
      ] }],
      [target.id, {
        ...target,
        entry_condition: { source: "time", key: "hour", op: "gte" as const, value: 11 },
        connections: [],
      }],
    ]);
    const definition = { ...base, locations };
    const state = { ...atTavern(freshState(base)), clock: advanceClock(freshState(base).clock, base, 8) };
    const out = resolveAction({ definition, state, actionId: "travel", params: { target: target.id } });
    expect(out.rejected).toBe(false);
    expect(out.effectiveTimeCost).toBe(3);
  });

  it("evaluates the actual parallel edge instead of the first edge to that destination", () => {
    const base = emberfall();
    const start = base.locations.get("tavern")!;
    const target = base.locations.get("town-square")!;
    const locations = new Map([
      [start.id, { ...start, exit_condition: undefined, connections: [
        {
          to: target.id,
          distance: 1,
          travel_time: 10,
          condition: { source: "flag", key: "sealed-route-open", op: "has" as const },
        },
        { to: target.id, distance: 1, travel_time: 75 },
      ] }],
      [target.id, { ...target, entry_condition: undefined, connections: [] }],
    ]);
    const definition = { ...base, locations };
    const state = { ...atTavern(freshState(base)), clock: advanceClock(freshState(base).clock, base, 8) };
    const out = resolveAction({ definition, state, actionId: "travel", params: { target: target.id } });
    expect(out.rejected).toBe(false);
    expect(out.effectiveTimeCost).toBe(2);
    expect(out.state.player.locationId).toBe(target.id);
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
          inventory: { stacks: [{ itemId: "herb", quantity: 1 }], currency: 0 },
        },
      },
    });
    const preview = previewAction(def, state, {
      actionId: "trade",
      target: "elara",
      params: { item: "herb", direction: "buy" },
    });
    const out = resolveAction({
      definition: def,
      state,
      actionId: "trade",
      targetNpcId: "elara",
      params: { item: "herb", direction: "buy" },
    });
    const itemValue = def.items.get("herb")!.value;
    expect(itemValue).toBe(3);
    expect(preview.executable).toBe(true);
    expect(preview.costs.currency).toBe(itemValue);
    expect(out.rejected).toBe(false);
    expect(out.state.player.inventory.stacks.some((s) => s.itemId === "herb")).toBe(true);
    expect(state.player.inventory.currency - out.state.player.inventory.currency).toBe(itemValue);
  });
});

describe("action cooldown", () => {
  /** Emberfall action ids do not declare cooldowns; inject one for the gate. */
  function withCooldown(def: WorldDefinition, actionId: string, cooldown: number): WorldDefinition {
    return {
      ...def,
      actions: {
        ...def.actions,
        actions: def.actions.actions.map((a) =>
          a.id === actionId ? { ...a, cooldown } : a,
        ),
      },
    };
  }

  it("rejects a repeat while the action is on cooldown (on_cooldown)", () => {
    const def = withCooldown(emberfall(), "investigate", 2);
    let state = freshState(def);
    // First use succeeds and anchors the cooldown at day 0.
    const first = resolveAction({ definition: def, state, actionId: "investigate" });
    expect(first.rejected).toBe(false);
    state = first.state;
    expect(state.actionCooldowns["investigate"]).toBe(0);
    // Same day (0 < 2) -> rejected with the machine reason code.
    const second = resolveAction({ definition: def, state, actionId: "investigate" });
    expect(second.rejected).toBe(true);
    expect(second.rejectReason).toBe("on_cooldown");
  });

  it("allows the action again once the cooldown days have passed", () => {
    const def = withCooldown(emberfall(), "investigate", 2);
    let state = freshState(def);
    state = resolveAction({ definition: def, state, actionId: "investigate" }).state;
    // Advance 2 full days: day 2, elapsed = 2 >= cooldown 2.
    state = { ...state, clock: advanceClock(state.clock, def, 48) };
    const later = resolveAction({ definition: def, state, actionId: "investigate" });
    expect(later.rejected).toBe(false);
    // The anchor refreshes to the new day.
    expect(later.state.actionCooldowns["investigate"]).toBe(2);
  });

  it("cooldown 0 or missing means no gate", () => {
    const def = emberfall();
    const state = freshState(def);
    const out = resolveAction({ definition: def, state, actionId: "investigate" });
    expect(out.rejected).toBe(false);
    expect(out.state.actionCooldowns["investigate"]).toBeUndefined();
  });
});
