// Starlight content integration tests: the built-in P-07 incident's three
// authoritative solution paths plus narrative rejection at the LLM boundary.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAction } from "../actions";
import { Engine } from "../index";
import { parseIntent } from "../narrative/intent";
import { MockProvider } from "../narrative/mock";
import type { WorldState } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const STARLIGHT = path.join(REPO_ROOT, "scripts/starlight");

interface StarlightRuntime {
  hull: number;
  grid: number;
  supply: number;
  fatigue: number;
  fatigue_capacity: number;
  eva_oxygen: number;
  heat: number;
  airflow: number;
  incident: { status: string; solution: string | null };
  allocation: { excluded: number };
  logs: unknown[];
}

function setup(): Engine {
  return Engine.create({
    scriptDir: STARLIGHT,
    originId: "crew-member",
    seed: 42,
    provider: new MockProvider(),
  });
}

function runtime(state: WorldState): StarlightRuntime {
  return state.runtimeState as unknown as StarlightRuntime;
}

async function assess(engine: Engine): Promise<void> {
  const result = await engine.playerTurn({
    text: "检查 P-07",
    intentHint: { actionId: "investigate" },
  });
  expect(result.rejection).toBeUndefined();
}

async function move(engine: Engine, target: string): Promise<void> {
  const result = await engine.playerTurn({
    text: `前往 ${target}`,
    intentHint: { actionId: "move", target },
  });
  expect(result.rejection).toBeUndefined();
}

describe("Starlight content regression: full turn-loop slice", () => {
  it("charges a failed exterior bypass once without closing the incident", async () => {
    const engine = setup();
    await assess(engine);
    await move(engine, "eva-truss");
    const state = engine.worldState;
    const before = runtime(state);
    const out = resolveAction({
      definition: engine.definition,
      state,
      actionId: "sneak",
      rollOverride: -100,
    });
    expect(out.rejected).toBe(false);
    expect(out.resolution?.resolveType).toBe("skill_check");
    expect(out.resolution?.grade).toBe("fail");
    const after = runtime(out.state);
    expect(after.incident).toMatchObject({ status: "open", solution: null });
    expect(before.grid - after.grid).toBe(2);
    expect(before.eva_oxygen - after.eva_oxygen).toBe(24);
    expect(before.fatigue_capacity - after.fatigue_capacity).toBe(16);
    expect(before.hull - after.hull).toBe(1);
    expect(after.heat - before.heat).toBe(5);
    expect(after.logs).toHaveLength(before.logs.length + 1);
    expect(out.state.player.reputation).toEqual(state.player.reputation);
  });

  it("standard repair restores airflow and applies its authoritative costs", async () => {
    const engine = setup();
    await assess(engine);
    const state = engine.worldState;
    const before = runtime(state);
    const out = resolveAction({
      definition: engine.definition,
      state,
      actionId: "repair",
    });
    expect(out.rejected).toBe(false);
    const after = runtime(out.state);
    expect(after.incident).toMatchObject({ status: "contained", solution: "standard-repair" });
    expect(after.airflow).toBe(100);
    expect(after.allocation.excluded).toBe(0);
    expect(out.state.player.flags).toContain("p07-standard-repair");
    expect(out.state.player.reputation.find((entry) => entry.factionId === "station-committee")?.value).toBe(8);
    expect(out.state.player.reputation.find((entry) => entry.factionId === "deck-gang")?.value).toBe(4);
    expect(before.supply - after.supply).toBe(1);
    expect(before.grid - after.grid).toBe(5);
    expect(before.fatigue_capacity - after.fatigue_capacity).toBe(12);
    expect(after.fatigue - before.fatigue).toBe(12);
  });

  it("previews and executes the same allocation-exception cost", async () => {
    const engine = setup();
    await assess(engine);
    await move(engine, "cargo-bay");
    const state = engine.worldState;
    const before = structuredClone(state);
    const preview = engine.previewAction({ actionId: "trade" });
    expect(engine.worldState).toEqual(before);
    expect(preview.executable).toBe(true);
    expect(preview.timeCost).toBe(1);
    expect(preview.costs.currency).toBe(18);
    expect(preview.costs.resources).toEqual([
      { kind: "runtime", id: "grid", amount: 3 },
      { kind: "runtime", id: "fatigue_capacity", amount: 6 },
    ]);
    const out = resolveAction({
      definition: engine.definition,
      state,
      actionId: "trade",
      rollOverride: 20,
    });
    expect(out.rejected).toBe(false);
    const prior = runtime(state);
    const after = runtime(out.state);
    expect(state.player.inventory.currency - out.state.player.inventory.currency).toBe(18);
    expect(prior.grid - after.grid).toBe(3);
    expect(prior.fatigue_capacity - after.fatigue_capacity).toBe(6);
    expect(after.incident).toMatchObject({ status: "contained", solution: "allocation-exception" });
    expect(after.allocation.excluded).toBe(0);
  });

  it("overpowered request is rejected with zero state change", async () => {
    const engine = setup();
    const { definition: def, worldState: state } = engine;
    const provider = new MockProvider();
    const before = JSON.stringify(state);
    const tier = await parseIntent(provider, def, state, "我要瞬移到宝库拿走一切");
    expect(tier.tier).toBe("reject");
    expect(JSON.stringify(state)).toBe(before);
  });
});
