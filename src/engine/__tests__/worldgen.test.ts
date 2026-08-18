// Worldgen tests: fixed-seed determinism, origin-based player init,
// NPC state assembly from script definitions, and randomization effects.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import type { WorldDefinition } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function emberfallDef(): WorldDefinition {
  return loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
}

describe("worldgen", () => {
  it("same seed produces identical worlds (determinism)", () => {
    const def = emberfallDef();
    const a = generateWorld(def, "miner", { seed: 42 });
    const b = generateWorld(def, "miner", { seed: 42 });
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.summary.join(",")).toBe(b.summary.join(","));
  });

  it("different seeds produce different worlds (randomness)", () => {
    const def = emberfallDef();
    const a = generateWorld(def, "miner", { seed: 1 });
    const b = generateWorld(def, "miner", { seed: 2 });
    // NPC stat jitter or starting event should differ for at least one aspect.
    const statsA = JSON.stringify(a.state.npcs.elara.stats);
    const statsB = JSON.stringify(b.state.npcs.elara.stats);
    const eventA = JSON.stringify(a.startingEvent ?? "");
    const eventB = JSON.stringify(b.startingEvent ?? "");
    expect(statsA !== statsB || eventA !== eventB).toBe(true);
  });

  it("builds player from origin with stats/items/relations", () => {
    const def = emberfallDef();
    const { state } = generateWorld(def, "miner", { seed: 7 });
    expect(state.player.originId).toBe("miner");
    expect(state.player.stats.strength).toBeGreaterThan(0);
    expect(state.player.inventory.stacks.length).toBeGreaterThan(0);
    expect(state.player.locationId).toBeTruthy();
    expect(state.player.flags).toBeDefined();
  });

  it("builds NPC runtime state from definitions", () => {
    const def = emberfallDef();
    const { state } = generateWorld(def, "miner", { seed: 7 });
    expect(Object.keys(state.npcs).length).toBeGreaterThanOrEqual(1);
    for (const npc of Object.values(state.npcs)) {
      expect(npc.stats.hp).toBeGreaterThan(0);
      expect(npc.currentLocationId).toBeTruthy();
      expect(npc.knowledgeFlags).toBeDefined();
    }
  });

  it("initializes commitments and director tension", () => {
    const def = emberfallDef();
    const { state } = generateWorld(def, "miner", { seed: 7 });
    expect(state.commitments.length).toBe(def.plot.commitments.length);
    expect(state.commitments.every((c) => !c.triggered)).toBe(true);
    expect(Object.keys(state.director.tension).length).toBeGreaterThan(0);
  });

  it("randomizes starting event from worldgen pool", () => {
    const def = emberfallDef();
    const { startingEvent } = generateWorld(def, "miner", { seed: 3 });
    // starting_event pool: [lantern-festival, market-day]
    if (startingEvent) {
      expect(["lantern-festival", "market-day"]).toContain(startingEvent);
    }
  });

  it("randomizes weather within season table", () => {
    const def = emberfallDef();
    const { state } = generateWorld(def, "miner", { seed: 9 });
    expect(state.clock.weather.length).toBeGreaterThan(0);
  });

  it("applies npc_stats jitter within bounds", () => {
    const def = emberfallDef();
    const { state } = generateWorld(def, "miner", { seed: 11 });
    const hpDef = def.mechanics.stats.find((s) => s.name === "hp")!;
    for (const npc of Object.values(state.npcs)) {
      expect(npc.stats.hp).toBeGreaterThanOrEqual(hpDef.min);
      expect(npc.stats.hp).toBeLessThanOrEqual(hpDef.max);
    }
  });

  it("seeds NPC initial memories with deterministic ids", () => {
    const def = emberfallDef();
    const { state } = generateWorld(def, "miner", { seed: 7 });
    // old-wei declares memory.initial with two entries.
    const oldWei = state.npcs["old-wei"];
    expect(oldWei).toBeDefined();
    expect(oldWei.memories.length).toBe(2);
    // Deterministic id: <prefix>-<day>-<tags.length> — same seed -> same id.
    expect(oldWei.memories[0].id).toMatch(/^mem-old-wei-\d+-\d+-\d+$/);
    expect(oldWei.memories[1].id).not.toBe(oldWei.memories[0].id);
    expect(oldWei.memories[0].text).toContain("敲击声");
    expect(oldWei.memories[0].createdAtDay).toBe(0);
    expect(oldWei.memories[0].archived).toBe(false);
    // Same seed reproduces the exact same memory entries.
    const again = generateWorld(def, "miner", { seed: 7 });
    expect(JSON.stringify(again.state.npcs["old-wei"].memories)).toBe(
      JSON.stringify(oldWei.memories),
    );
  });
});
