// Run policy + save system tests: death modes (soft_failure/
// world_continue/hard_reset), meta-progression snapshot, and save/load
// round-trip stability + version gates.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
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
import type { WorldState, WorldDefinition } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function setup(): { def: WorldDefinition; state: WorldState } {
  const def = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
  const { state } = generateWorld(def, "miner", { seed: 42 });
  return { def, state };
}

describe("run policy: soft_failure", () => {
  it("does not fire below threshold", () => {
    const { def, state } = setup();
    const result = checkSoftFailure(state, def);
    expect(result.firedMode).toBeUndefined();
  });

  it("fires at threshold: teleports + resets gauge", () => {
    const { def, state } = setup();
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
    const { def, state } = setup();
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
    expect(result.state.scriptId).toBe("emberfall");
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
    const result = applyHardReset(deadState(state), hrDef);
    expect(result.state.npcs).toEqual(state.npcs); // world kept
    // Player reset to the first origin in the script (keys order).
    const firstOriginId = def.origins.keys().next().value as string;
    expect(result.state.player.originId).toBe(firstOriginId);
    expect(result.state.player.inventory).not.toEqual(state.player.inventory); // reset
  });
});

describe("meta-progression", () => {
  it("metaProgressionSnapshot respects keep list", () => {
    const { def, state } = setup();
    const snap = metaProgressionSnapshot(state, def);
    // emberfall run.yaml keep: [flags, lore, relations_overview]
    expect(Array.isArray(snap.flags)).toBe(true);
    expect(Array.isArray(snap.lore)).toBe(true);
    expect(Array.isArray(snap.relations)).toBe(true);
  });

  it("applyUnlocks grants origins for met flags", () => {
    const { def, state } = setup();
    const withFlag = { ...state, player: { ...state.player, flags: [...state.player.flags, "returned_visitor"] } };
    const granted = applyUnlocks(withFlag, def);
    // emberfall run.yaml unlocks: returned_visitor -> [miner-foreman] (if defined)
    expect(Array.isArray(granted)).toBe(true);
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
    expect(save.scriptId).toBe("emberfall");
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
    expect(() => deserializeSave(save, "starlight")).toThrow(SaveError);
  });

  it("deserializeSave rejects non-object", () => {
    expect(() => deserializeSave(null)).toThrow(SaveError);
    expect(() => deserializeSave("nope")).toThrow(SaveError);
  });

  it("writeSave + readSave round-trips to disk", () => {
    const { def, state } = setup();
    const filePath = writeSave(def, state, "test-run-001");
    expect(filePath).toContain("test-run-001.json");
    const restored = readSave(filePath, "emberfall");
    expect(JSON.stringify(restored.worldState)).toBe(JSON.stringify(state));
  });

  it("readSave rejects missing file", () => {
    expect(() => readSave("/nonexistent/save.json")).toThrow(SaveError);
  });
});

describe("save system: normalizeWorldState", () => {
  it("fills missing derived fields from the definition", () => {
    const { def, state } = setup();
    // Strip the derived fields as a v2 snapshot could when hand-built.
    const stripped: WorldState = {
      ...state,
      locationInventories: undefined as unknown as WorldState["locationInventories"],
      secretHolders: undefined as unknown as WorldState["secretHolders"],
      playedEventIds: undefined as unknown as WorldState["playedEventIds"],
      eventLastPlayedDay: undefined as unknown as WorldState["eventLastPlayedDay"],
    };
    const normalized = normalizeWorldState(def, stripped);
    // locationInventories rebuilt from locations[].items.
    expect(normalized.locationInventories).toBeDefined();
    const mine = normalized.locationInventories["mine-entrance"];
    expect(mine.stacks.some((s) => s.itemId === "coal-essence")).toBe(true);
    // secretHolders rebuilt from NPC secrets (knock-code -> old-wei).
    expect(normalized.secretHolders["knock-code"]).toBe("old-wei");
    // Played-tracking defaults.
    expect(normalized.playedEventIds).toEqual([]);
    expect(normalized.eventLastPlayedDay).toEqual({});
  });

  it("is a no-op on a complete v2 state", () => {
    const { def, state } = setup();
    const normalized = normalizeWorldState(def, state);
    expect(JSON.stringify(normalized)).toBe(JSON.stringify(state));
  });
});
