// Run policy + save system tests: death modes (soft_failure/
// world_continue/hard_reset), meta-progression snapshot, and save/load
// round-trip stability + version gates.
import { describe, expect, it } from "vitest";
import { generateWorld } from "../worldgen";
import {
  checkSoftFailure,
  applyWorldContinue,
  applyHardReset,
  applyDeathPolicy,
  metaProgressionSnapshot,
  applyUnlocks,
} from "../run";
import {
  serializeSave,
  deserializeSave,
  roundTrip,
  writeSave,
  readSave,
  SAVE_SCHEMA_VERSION,
  SaveError,
  normalizeWorldState,
} from "../save";
import { emptyContextSummary } from "../context";
import type { WorldState, WorldDefinition } from "../types";
import type { Location } from "../../script/schemas/location";
import type { Npc } from "../../script/schemas/npc";
import { loadCoreTestDefinition } from "./core-test-fixture";

const SCRIPT_ID = "core-test-script";

function setup(): { def: WorldDefinition; state: WorldState } {
  const def = loadCoreTestDefinition();
  const { state } = generateWorld(def, "observer", { seed: 42 });
  return { def, state };
}

function withSoftFailure(def: WorldDefinition): WorldDefinition {
  return {
    ...def,
    run: {
      ...def.run,
      death_policy: {
        mode: "soft_failure",
        soft_failure: {
          gauge_ref: "threat_gauge",
          threshold: 100,
          consequence: {
            location: "relay-room",
            effects: [{ kind: "stat", direction: "add", target: "player", stat: "hp", value: -5 }],
            narrative: "值班员将观察员送回中继室复位。",
          },
        },
      },
    },
  };
}

function withMetaUnlock(def: WorldDefinition): WorldDefinition {
  return {
    ...def,
    run: {
      ...def.run,
      meta_progression: {
        ...def.run.meta_progression,
        unlocks: [{ flag: "returned-visitor", grant: ["observer"] }],
      },
    },
  };
}

function withDerivedFields(def: WorldDefinition): WorldDefinition {
  const relayRoom = def.locations.get("relay-room");
  const operator = def.npcs.get("operator");
  if (!relayRoom || !operator) throw new Error("core test fixture is incomplete");
  const locationWithItem: Location = {
    ...relayRoom,
    items: [...relayRoom.items, "test-token"],
  };
  const operatorWithSecret: Npc = {
    ...operator,
    secrets: [
      ...operator.secrets,
      {
        id: "relay-secret",
        content: "备用线路已完成校验。",
        reveal: { logic: { all: [{ source: "flag", key: "access-granted", op: "has" }] } },
      },
    ],
  };
  return {
    ...def,
    locations: new Map([...def.locations, [locationWithItem.id, locationWithItem]]),
    npcs: new Map([...def.npcs, [operatorWithSecret.id, operatorWithSecret]]),
  };
}

describe("run policy: soft_failure", () => {
  it("does not fire below threshold", () => {
    const { def: base, state } = setup();
    const def = withSoftFailure(base);
    const result = checkSoftFailure(state, def);
    expect(result.firedMode).toBeUndefined();
  });

  it("fires at threshold: teleports + resets gauge", () => {
    const { def: base, state } = setup();
    const def = withSoftFailure(base);
    const stressed = { ...state, player: { ...state.player, threatGauge: 100 } };
    const result = checkSoftFailure(stressed, def);
    expect(result.firedMode).toBe("soft_failure");
    expect(result.state.player.locationId).toBe(def.run.death_policy.soft_failure!.consequence.location);
    expect(result.state.player.threatGauge).toBe(0);
    expect(result.narrative).toBeTruthy();
  });

  it("does not fire when policy mode is not soft_failure", () => {
    const { def, state } = setup();
    const hardDef = {
      ...def,
      run: {
        ...def.run,
        death_policy: { mode: "hard_reset" as const, hard_reset: { world_reroll: "keep_world" as const } },
      },
    };
    const result = checkSoftFailure(state, hardDef);
    expect(result.firedMode).toBeUndefined();
  });

  it("applyDeathPolicy dispatches to soft_failure", () => {
    const { def: base, state } = setup();
    const def = withSoftFailure(base);
    const stressed = { ...state, player: { ...state.player, threatGauge: 100 } };
    const result = applyDeathPolicy(stressed, def);
    expect(result.firedMode).toBe("soft_failure");
  });
});

describe("run policy: world_continue / hard_reset", () => {
  /** hp 归零 triggers the death policy; a healthy player must never fire. */
  function deadState(state: WorldState): WorldState {
    return { ...state, player: { ...state.player, stats: { ...state.player.stats, hp: 0 } } };
  }

  it("world_continue does not fire while the player is alive", () => {
    const { def, state } = setup();
    const wcDef = {
      ...def,
      run: {
        ...def.run,
        death_policy: {
          mode: "world_continue" as const,
          world_continue: { succession: "new_character" as const, state_kept: ["flags"] },
        },
      },
    };
    const result = applyWorldContinue(state, wcDef);
    expect(result.firedMode).toBeUndefined();
    expect(result.state).toBe(state);
  });

  it("world_continue rebuilds player and keeps world state", () => {
    const { def, state } = setup();
    const wcDef = {
      ...def,
      run: {
        ...def.run,
        death_policy: {
          mode: "world_continue" as const,
          world_continue: { succession: "new_character" as const, state_kept: ["flags"] },
        },
      },
    };
    const withFlag = deadState({ ...state, player: { ...state.player, flags: ["my-flag"] } });
    const result = applyWorldContinue(withFlag, wcDef);
    expect(result.firedMode).toBe("world_continue");
    // Flags kept, player origin reset to first origin.
    expect(result.state.player.flags).toContain("my-flag");
    expect(result.state.npcs).toEqual(withFlag.npcs); // world preserved
  });

  it("hard_reset does not fire while the player is alive", () => {
    const { def, state } = setup();
    const hrDef = {
      ...def,
      run: {
        ...def.run,
        death_policy: {
          mode: "hard_reset" as const,
          hard_reset: { world_reroll: "reroll_worldgen" as const },
        },
      },
    };
    const result = applyHardReset(state, hrDef);
    expect(result.firedMode).toBeUndefined();
    expect(result.state).toBe(state);
  });

  it("hard_reset rerolls the world (new npc states)", () => {
    const { def, state } = setup();
    const hrDef = {
      ...def,
      run: {
        ...def.run,
        death_policy: {
          mode: "hard_reset" as const,
          hard_reset: { world_reroll: "reroll_worldgen" as const },
        },
      },
    };
    const result = applyHardReset(deadState(state), hrDef);
    expect(result.firedMode).toBe("hard_reset");
    expect(result.state.scriptId).toBe(SCRIPT_ID);
  });
  it("hard_reset keep_world preserves npcs but resets player", () => {
    const { def, state } = setup();
    const hrDef = {
      ...def,
      run: {
        ...def.run,
        death_policy: {
          mode: "hard_reset" as const,
          hard_reset: { world_reroll: "keep_world" as const },
        },
      },
    };
    const changed = deadState({
      ...state,
      player: {
        ...state.player,
        inventory: { stacks: [{ itemId: "test-token", quantity: 1 }], currency: 99 },
      },
    });
    const result = applyHardReset(changed, hrDef);
    expect(result.state.npcs).toEqual(state.npcs); // world kept
    // Player reset to the first origin in the script (keys order).
    const firstOriginId = def.origins.keys().next().value as string;
    expect(result.state.player.originId).toBe(firstOriginId);
    expect(result.state.player.inventory).not.toEqual(changed.player.inventory); // reset
  });
});

describe("meta-progression", () => {
  it("metaProgressionSnapshot respects keep list", () => {
    const { def, state } = setup();
    const snap = metaProgressionSnapshot(state, def);
    expect(snap.flags).toEqual(state.player.flags);
    expect(snap.lore).toEqual([]);
    expect(snap.relations).toEqual([]);
  });

  it("applyUnlocks grants origins for met flags", () => {
    const { def: base, state } = setup();
    const def = withMetaUnlock(base);
    const withFlag = { ...state, player: { ...state.player, flags: [...state.player.flags, "returned-visitor"] } };
    const granted = applyUnlocks(withFlag, def);
    expect(granted).toEqual(["observer"]);
  });
});

describe("save system", () => {
  it("round-trip preserves state deep-equal", () => {
    const { def, state } = setup();
    const restored = roundTrip(state, def);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(state));
  });

  it("serializeSave sets version + script id", () => {
    const { def, state } = setup();
    const save = serializeSave(def, state, "2026-01-01T00:00:00.000Z");
    expect(save.saveSchemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(save.scriptId).toBe(SCRIPT_ID);
    expect(save.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("deserializeSave rejects unknown version", () => {
    const { def, state } = setup();
    const save = serializeSave(def, state);
    expect(() => deserializeSave({ ...save, saveSchemaVersion: 999 })).toThrow(SaveError);
  });

  it("deserializeSave rejects mismatched script id", () => {
    const { def, state } = setup();
    const save = serializeSave(def, state);
    expect(() => deserializeSave(save, "other-script")).toThrow(SaveError);
  });

  it("rejects forged inner script ids and checks the expected script against both ids", () => {
    const { def, state } = setup();
    const save = serializeSave(def, state);
    const forgedInner = {
      ...save,
      worldState: { ...save.worldState, scriptId: "other-script" },
    };
    expect(() => deserializeSave(forgedInner)).toThrow(/worldState\.scriptId.*envelope scriptId/);
    expect(() => deserializeSave(forgedInner, SCRIPT_ID)).toThrow(/worldState\.scriptId.*envelope scriptId/);

    const internallyConsistentWrongScript = {
      ...forgedInner,
      scriptId: "other-script",
    };
    expect(() => deserializeSave(internallyConsistentWrongScript, SCRIPT_ID))
      .toThrow(/save is for script "other-script" but expected "core-test-script"/);
  });

  it("deserializeSave rejects a v5 snapshot missing active need thresholds", () => {
    const { def, state } = setup();
    const save = serializeSave(def, state);
    const worldState = { ...save.worldState } as Partial<WorldState>;
    delete worldState.activeNeedThresholds;
    expect(() => deserializeSave({ ...save, worldState })).toThrow(/activeNeedThresholds/);
  });

  it("deserializeSave rejects a forged v5 envelope with only one world field", () => {
    expect(() => deserializeSave({
      saveSchemaVersion: SAVE_SCHEMA_VERSION,
      scriptId: SCRIPT_ID,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      worldState: { activeNeedThresholds: [] },
    })).toThrow(/worldState\.(scriptId|clock|player|npcs)/);
  });

  it("deserializeSave rejects an invalid nested player inventory shape", () => {
    const { def, state } = setup();
    const save = serializeSave(def, state);
    const malformed = {
      ...save,
      worldState: {
        ...save.worldState,
        player: {
          ...save.worldState.player,
          inventory: { stacks: "not-an-array", currency: 10 },
        },
      },
    };
    expect(() => deserializeSave(malformed)).toThrow(/worldState\.player\.inventory\.stacks/);
  });

  it("deserializeSave rejects non-object", () => {
    expect(() => deserializeSave(null)).toThrow(SaveError);
    expect(() => deserializeSave("nope")).toThrow(SaveError);
  });

  it("writeSave + readSave round-trips to disk", () => {
    const { def, state } = setup();
    const filePath = writeSave(def, state, "test-run-001");
    expect(filePath).toContain("test-run-001.json");
    const restored = readSave(filePath, SCRIPT_ID);
    expect(JSON.stringify(restored.worldState)).toBe(JSON.stringify(state));
  });

  it("readSave rejects missing file", () => {
    expect(() => readSave("/nonexistent/save.json")).toThrow(SaveError);
  });
});

describe("save system: normalizeWorldState", () => {
  it("fills missing derived fields from the definition", () => {
    const { def: base, state } = setup();
    const def = withDerivedFields(base);
    // Strip the derived fields as a v3 snapshot could when hand-built.
    const stripped: WorldState = {
      ...state,
      locationInventories: undefined as unknown as WorldState["locationInventories"],
      secretHolders: undefined as unknown as WorldState["secretHolders"],
      playedEventIds: undefined as unknown as WorldState["playedEventIds"],
      eventLastPlayedDay: undefined as unknown as WorldState["eventLastPlayedDay"],
      contextSummary: undefined as unknown as WorldState["contextSummary"],
    };
    const normalized = normalizeWorldState(def, stripped);
    // locationInventories rebuilt from locations[].items.
    expect(normalized.locationInventories).toBeDefined();
    const relay = normalized.locationInventories["relay-room"];
    expect(relay.stacks.some((s) => s.itemId === "test-token")).toBe(true);
    // secretHolders rebuilt from the overlaid NPC secret.
    expect(normalized.secretHolders["relay-secret"]).toBe("operator");
    // Played-tracking defaults.
    expect(normalized.playedEventIds).toEqual([]);
    expect(normalized.eventLastPlayedDay).toEqual({});
    // Rolling summary defaults to the empty state.
    expect(normalized.contextSummary).toEqual(emptyContextSummary());
  });

  it("is a no-op on a complete v5 state", () => {
    const { def, state } = setup();
    const complete = { ...state, contextSummary: emptyContextSummary() };
    const normalized = normalizeWorldState(def, complete);
    expect(JSON.stringify(normalized)).toBe(JSON.stringify(complete));
  });
});
