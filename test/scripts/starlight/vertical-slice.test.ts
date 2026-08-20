import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAction } from "../../../src/engine/actions";
import { Engine } from "../../../src/engine/index";
import { MockProvider } from "../../../src/engine/narrative/mock";
import { roundTrip } from "../../../src/engine/save";
import type { IntentHint } from "../../../src/shared/client-dto";
import type { WorldState } from "../../../src/engine/types";

const STARLIGHT_DIR = path.resolve(__dirname, "../../../scripts/starlight");
const SEEDS = [1, 7, 42, 99] as const;

type Solution = "standard-repair" | "exterior-bypass" | "allocation-exception";

interface StarlightRuntime {
  hull: number;
  grid: number;
  supply: number;
  fatigue: number;
  fatigue_capacity: number;
  eva_oxygen: number;
  heat: number;
  airflow: number;
  incident: { status: "open" | "contained"; stage: string; solution: Solution | null };
  allocation: { excluded: number; policy: string };
  shift: { number: number; next_handoff_at: number; last_feedback: string };
  logs: Array<{ channel: string; summary: string }>;
}

function createEngine(seed = 42): Engine {
  return Engine.create({
    scriptDir: STARLIGHT_DIR,
    originId: "crew-member",
    seed,
    provider: new MockProvider(),
  });
}

function runtime(state: WorldState): StarlightRuntime {
  return state.runtimeState as unknown as StarlightRuntime;
}

function scriptState(state: WorldState): unknown {
  return {
    runtimeState: state.runtimeState,
    locationId: state.player.locationId,
    currency: state.player.inventory.currency,
    flags: state.player.flags,
    reputation: state.player.reputation,
  };
}

async function turn(engine: Engine, hint: IntentHint): Promise<void> {
  const preview = engine.previewAction(hint);
  expect(preview.executable, `${hint.actionId}: ${preview.reason ?? preview.reasonCode ?? "unavailable"}`).toBe(true);
  await engine.playerTurn({ text: `执行 ${hint.actionId}`, intentHint: hint });
}

async function assess(engine: Engine): Promise<void> {
  await turn(engine, { actionId: "investigate" });
  expect(runtime(engine.worldState).incident.stage).toBe("assessed");
}

async function solve(engine: Engine, solution: Solution): Promise<number> {
  let actions = 0;
  await assess(engine);
  actions += 1;
  if (solution === "exterior-bypass") {
    await turn(engine, { actionId: "move", target: "eva-truss" });
    await turn(engine, { actionId: "sneak" });
    actions += 2;
  } else if (solution === "allocation-exception") {
    await turn(engine, { actionId: "move", target: "cargo-bay" });
    await turn(engine, { actionId: "trade" });
    actions += 2;
  } else {
    await turn(engine, { actionId: "repair" });
    actions += 1;
  }
  expect(runtime(engine.worldState).incident.solution).toBe(solution);
  return actions;
}

describe("Starlight vertical slice: authoritative incident loop", () => {
  it.each(SEEDS)("seed %s reaches every distinct resolution in at most 12 actions", async (seed) => {
    for (const solution of ["standard-repair", "exterior-bypass", "allocation-exception"] as const) {
      const engine = createEngine(seed);
      const actions = await solve(engine, solution);
      expect(actions).toBeLessThanOrEqual(12);
      expect(runtime(engine.worldState).incident.status).toBe("contained");
      expect(runtime(engine.worldState).allocation.excluded).toBe(0);
    }
  });

  it("initializes the worker shift in runtimeState and preserves it across save/load", () => {
    const engine = createEngine();
    expect(engine.worldState.clock.totalHours).toBe(7);
    expect(runtime(engine.worldState)).toMatchObject({
      hull: 83,
      grid: 61,
      supply: 4,
      fatigue: 18,
      fatigue_capacity: 82,
      eva_oxygen: 100,
      heat: 12,
      incident: { status: "open", stage: "reported", solution: null },
      allocation: { excluded: 47, policy: "registered-only" },
    });
    expect(roundTrip(engine.worldState, engine.definition)).toEqual(engine.worldState);
  });

  it("previews authoritative costs without mutation and deducts each cost exactly once", async () => {
    const engine = createEngine();
    await assess(engine);
    const before = structuredClone(engine.worldState);
    const preview = engine.previewAction({ actionId: "repair" });
    expect(preview).toMatchObject({
      executable: true,
      timeCost: 1,
      costs: { resources: [
        { kind: "runtime", id: "supply", amount: 1 },
        { kind: "runtime", id: "grid", amount: 5 },
        { kind: "runtime", id: "fatigue_capacity", amount: 12 },
      ] },
    });
    expect(engine.worldState).toEqual(before);

    await engine.playerTurn({ text: "更换颗粒阀", intentHint: { actionId: "repair" } });
    const after = runtime(engine.worldState);
    const prior = runtime(before);
    expect(after.supply).toBe(prior.supply - 1);
    expect(after.grid).toBe(prior.grid - 5);
    expect(after.fatigue_capacity).toBe(prior.fatigue_capacity - 12);
    expect(after.fatigue).toBe(prior.fatigue + 12);
  });

  it.each([
    { actionId: "sneak", location: "eva-truss", currency: 0, resources: { grid: 2, eva_oxygen: 24, fatigue_capacity: 16 } },
    { actionId: "trade", location: "cargo-bay", currency: 18, resources: { grid: 3, fatigue_capacity: 6 } },
  ] as const)("previews and deducts $actionId costs once", async ({ actionId, location, currency, resources }) => {
    const engine = createEngine(7);
    await assess(engine);
    await turn(engine, { actionId: "move", target: location });
    const before = structuredClone(engine.worldState);
    const preview = engine.previewAction({ actionId });
    expect(preview.executable).toBe(true);
    expect(preview.costs.currency).toBe(currency);
    expect(preview.costs.resources).toEqual(
      Object.entries(resources).map(([id, amount]) => ({ kind: "runtime", id, amount })),
    );
    expect(engine.worldState).toEqual(before);

    await engine.playerTurn({ text: `执行 ${actionId}`, intentHint: { actionId } });
    const prior = runtime(before) as unknown as Record<string, number>;
    const after = runtime(engine.worldState) as unknown as Record<string, number>;
    for (const [id, amount] of Object.entries(resources)) {
      expect(prior[id] - after[id], id).toBe(amount);
    }
    expect(before.player.inventory.currency - engine.worldState.player.inventory.currency).toBe(currency);
  });

  it("every enabled successful action changes authored state beyond clock and transcript", async () => {
    const cases: Array<{ hint: IntentHint; prepare?: (engine: Engine) => Promise<void> }> = [
      { hint: { actionId: "talk", target: "chief-engineer", params: { channel: "MAINT" } } },
      { hint: { actionId: "move", target: "cargo-bay" } },
      { hint: { actionId: "investigate" } },
      { hint: { actionId: "repair" }, prepare: assess },
      { hint: { actionId: "sneak" }, prepare: async (engine) => { await assess(engine); await turn(engine, { actionId: "move", target: "eva-truss" }); } },
      { hint: { actionId: "trade" }, prepare: async (engine) => { await assess(engine); await turn(engine, { actionId: "move", target: "cargo-bay" }); } },
      { hint: { actionId: "rest" } },
    ];
    expect(cases.map(({ hint }) => hint.actionId).sort()).toEqual(
      engineActionIds(createEngine()).sort(),
    );
    for (const { hint, prepare } of cases) {
      const engine = createEngine(7);
      await prepare?.(engine);
      const before = scriptState(engine.worldState);
      await turn(engine, hint);
      expect(scriptState(engine.worldState), hint.actionId).not.toEqual(before);
    }
  });

  it.each(["standard-repair", "exterior-bypass", "allocation-exception"] as const)(
    "%s resolves once, cannot farm reputation across days, and emits deterministic next-shift feedback",
    async (solution) => {
      const first = createEngine(42);
      const second = createEngine(42);
      await solve(first, solution);
      await solve(second, solution);
      const actionId = solution === "standard-repair" ? "repair" : solution === "exterior-bypass" ? "sneak" : "trade";
      const reputation = structuredClone(first.worldState.player.reputation);
      const resolutionLogCount = runtime(first.worldState).logs.length;
      expect(first.worldState.playedEventIds.filter((eventId) => eventId === "scrubber-p07-alert")).toHaveLength(1);
      const handoffAt = runtime(first.worldState).shift.next_handoff_at;
      first.advance(handoffAt - first.worldState.clock.totalHours);
      second.advance(handoffAt - second.worldState.clock.totalHours);
      expect(runtime(first.worldState).shift.last_feedback).toBe(runtime(second.worldState).shift.last_feedback);
      expect(runtime(first.worldState).shift.number).toBe(2);

      first.advance(24);
      const attempted = resolveAction({ definition: first.definition, state: first.worldState, actionId, rollOverride: 20 });
      expect(attempted.rejected).toBe(true);
      expect(attempted.state.player.reputation).toEqual(reputation);
      expect(runtime(attempted.state).logs).toHaveLength(runtime(first.worldState).logs.length);
      expect(runtime(first.worldState).logs.length).toBeGreaterThan(resolutionLogCount);
    },
  );

  it("keeps hull, grid, supply, fatigue capacity, oxygen and heat non-negative", async () => {
    for (const solution of ["standard-repair", "exterior-bypass", "allocation-exception"] as const) {
      const engine = createEngine(99);
      await solve(engine, solution);
      engine.advance(72);
      const values = runtime(engine.worldState);
      expect([values.hull, values.grid, values.supply, values.fatigue_capacity, values.eva_oxygen, values.heat])
        .toEqual(expect.arrayContaining([expect.any(Number)]));
      for (const value of [values.hull, values.grid, values.supply, values.fatigue_capacity, values.eva_oxygen, values.heat]) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("Starlight vertical slice: authored evidence and workers", () => {
  it("provides independent habitat and cargo evidence for the registry exclusion", () => {
    const definition = createEngine().definition;
    const habitat = definition.narrative.lore.find((entry) => entry.id === "habitat-ledger");
    const cargo = definition.narrative.lore.find((entry) => entry.id === "cargo-ledger");
    expect(habitat?.npcs).toEqual(["doctor-vera"]);
    expect(cargo?.npcs).toEqual(["night-cat"]);
    expect(habitat?.content).toContain("二十二人");
    expect(cargo?.content).toContain("四十七人");
    expect(definition.npcs.get("doctor-vera")?.secrets.map((secret) => secret.id)).toContain("unregistered-clinic-count");
    expect(definition.npcs.get("night-cat")?.secrets.map((secret) => secret.id)).toContain("lighthouse-ledger-copy");
  });

  it("makes each NPC's job responsibility, current plan, and shift knowledge observable", () => {
    const definition = createEngine().definition;
    for (const npcId of ["chief-engineer", "doctor-vera", "night-cat"]) {
      const npc = definition.npcs.get(npcId);
      expect(npc?.occupation).toBeTruthy();
      expect(npc?.schedule).toBeTruthy();
      expect(definition.time.schedules.find((schedule) => schedule.id === npc?.schedule)?.entries.length).toBeGreaterThan(0);
      expect(npc?.memory?.initial.length).toBeGreaterThan(0);
      expect(npc?.description.length).toBeGreaterThan(20);
    }
  });
});

function engineActionIds(engine: Engine): string[] {
  return engine.definition.actions.actions.filter((action) => action.enabled).map((action) => action.id);
}
