// Worldgen tests: fixed-seed determinism, origin-based player init,
// NPC state assembly from script definitions, and randomization effects.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import type { WorldDefinition } from "../types";
import { loadCoreTestDefinition } from "./core-test-fixture";

function worldgenDefinition(): WorldDefinition {
  const base = loadCoreTestDefinition();
  const operator = base.npcs.get("operator")!;
  const handoff = base.events.get("handoff-signal")!;
  const alternate = { ...handoff, id: "alternate-signal", name: "备用交班信号" };
  return {
    ...base,
    npcs: new Map(base.npcs).set("operator", {
      ...operator,
      stats: { ...operator.stats, hp: 50 },
    }),
    events: new Map(base.events).set(alternate.id, alternate),
    time: {
      ...base.time,
      seasons: [{
        name: "校准季",
        start: "01-01",
        weather_table: [
          { weather: "clear-signal", weight: 1 },
          { weather: "static", weight: 1 },
        ],
      }],
    },
    worldgen: {
      ...base.worldgen,
      randomize: [
        ...base.worldgen.randomize.filter((entry) => entry.target !== "starting_event"),
        { target: "npc_stats", jitter: 0.2, distribution: "uniform" },
        { target: "weather", distribution: "uniform" },
        {
          target: "starting_event",
          pool: [handoff.id, alternate.id],
          distribution: "uniform",
        },
      ],
    },
  };
}

describe("worldgen", () => {
  it("same seed produces identical worlds (determinism)", () => {
    const def = worldgenDefinition();
    const a = generateWorld(def, "observer", { seed: 42 });
    const b = generateWorld(def, "observer", { seed: 42 });
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.summary.join(",")).toBe(b.summary.join(","));
  });

  it("different seeds produce different worlds (randomness)", () => {
    const def = worldgenDefinition();
    const a = generateWorld(def, "observer", { seed: 1 });
    const b = generateWorld(def, "observer", { seed: 2 });
    expect(a.state.npcs.operator.stats.hp).not.toBe(b.state.npcs.operator.stats.hp);
  });

  it("builds player from origin with stats and relations", () => {
    const def = worldgenDefinition();
    const { state } = generateWorld(def, "observer", { seed: 7 });
    expect(state.player.originId).toBe("observer");
    expect(state.player.stats.hp).toBeGreaterThan(0);
    expect(state.player.skills.focus).toBe(8);
    expect(state.player.relations.some((relation) => relation.npcId === "operator")).toBe(true);
    expect(state.player.locationId).toBe("relay-room");
    expect(state.player.flags).toBeDefined();
  });

  it("builds NPC runtime state from definitions", () => {
    const def = worldgenDefinition();
    const { state } = generateWorld(def, "observer", { seed: 7 });
    expect(Object.keys(state.npcs)).toEqual(["operator"]);
    expect(state.npcs.operator.stats.hp).toBeGreaterThan(0);
    expect(state.npcs.operator.currentLocationId).toBe("relay-room");
    expect(state.npcs.operator.knowledgeFlags).toContain("handoff-known");
  });

  it("initializes commitments and director tension", () => {
    const def = worldgenDefinition();
    const { state } = generateWorld(def, "observer", { seed: 7 });
    expect(state.commitments.length).toBe(def.plot.commitments.length);
    expect(state.commitments.every((commitment) => !commitment.triggered)).toBe(true);
    expect(state.director.tension).toEqual({ load: 0 });
  });

  it("randomizes starting event from the declared pool", () => {
    const def = worldgenDefinition();
    const { startingEvent } = generateWorld(def, "observer", { seed: 3 });
    expect(["handoff-signal", "alternate-signal"]).toContain(startingEvent);
  });

  it("randomizes weather within the season table", () => {
    const def = worldgenDefinition();
    const { state } = generateWorld(def, "observer", { seed: 9 });
    expect(["clear-signal", "static"]).toContain(state.clock.weather);
  });

  it("applies npc_stats jitter within bounds", () => {
    const def = worldgenDefinition();
    const { state } = generateWorld(def, "observer", { seed: 11 });
    const hpDef = def.mechanics.stats.find((stat) => stat.name === "hp")!;
    expect(state.npcs.operator.stats.hp).toBeGreaterThanOrEqual(hpDef.min);
    expect(state.npcs.operator.stats.hp).toBeLessThanOrEqual(hpDef.max);
  });
});

describe("Starlight content regression", () => {
  it("seeds Starlight shift memories with authored content and deterministic ids", () => {
    const definition = loadScript(path.resolve(__dirname, "../../../scripts/starlight"));
    const { state } = generateWorld(definition, "crew-member", { seed: 7 });
    const chief = state.npcs["chief-engineer"];

    expect(chief).toBeDefined();
    expect(chief.memories).toHaveLength(2);
    expect(chief.memories[0].id).toMatch(/^mem-chief-engineer-\d+-\d+-\d+$/);
    expect(chief.memories[1].id).not.toBe(chief.memories[0].id);
    expect(chief.memories[0].text).toContain("P-07 压差");
    expect(chief.memories[0].createdAtDay).toBe(0);
    expect(chief.memories[0].archived).toBe(false);

    const again = generateWorld(definition, "crew-member", { seed: 7 });
    expect(again.state.npcs["chief-engineer"].memories).toEqual(chief.memories);
  });
});
