import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { Engine } from "../../../src/engine";
import { MockProvider } from "../../../src/engine/narrative/mock";
import type { SaveStore } from "../../../src/engine/save-store";
import type { IntentHint } from "../../../src/shared/client-dto";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPT_DIR = path.join(REPO_ROOT, "scripts/emberfall");

const MAIN_SHIFT: Array<{ label: string; hint: IntentHint }> = [
  { label: "修整灰灯", hint: { actionId: "trim-wick" } },
  { label: "领取支护", hint: { actionId: "draw-support" } },
  { label: "击鼓下井", hint: { actionId: "begin-shift" } },
  { label: "测绘矿层", hint: { actionId: "survey-seam" } },
  { label: "移至回钟横巷", hint: { actionId: "mine-move", params: { target: "bell-gallery" } } },
  { label: "听辨岩钟", hint: { actionId: "listen-strata" } },
  { label: "移至青火煤层", hint: { actionId: "mine-move", params: { target: "blue-seam" } } },
  { label: "采集炉煤", hint: { actionId: "collect-coal" } },
  { label: "起取旧班签", hint: { actionId: "recover-token" } },
  { label: "收班返镇", hint: { actionId: "return-shift" } },
  { label: "记录钟房证词", hint: { actionId: "record-testimony", target: "han-zhi" } },
  { label: "公开配给诊所", hint: { actionId: "allocate-coal", params: { allocation: "clinic" } } },
];

function create(seed = 42, store?: SaveStore): Engine {
  return Engine.create({
    scriptDir: SCRIPT_DIR,
    originId: "lamp-keeper",
    seed,
    provider: new MockProvider(),
    saveStore: store,
  });
}

function numericRuntime(state: Engine["worldState"], id: string): number {
  const value = state.runtimeState[id];
  if (typeof value !== "number") throw new Error(`runtime field ${id} is not numeric`);
  return value;
}

function scriptState(state: Engine["worldState"]): unknown {
  return {
    runtimeState: state.runtimeState,
    facts: state.facts,
    flags: state.flags,
    locationId: state.player.locationId,
    inventory: state.player.inventory,
  };
}

async function perform(engine: Engine, label: string, hint: IntentHint): Promise<void> {
  const preview = engine.previewAction(hint);
  expect(preview.executable, `${hint.actionId}: ${preview.reason ?? "preview rejected"}`).toBe(true);
  const before = engine.worldState;
  const beforeScript = JSON.stringify(scriptState(before));
  const paid = (preview.costs.resources ?? []).map((resource) => ({ resource, before: numericRuntime(before, resource.id) }));
  const result = await engine.playerTurn({ text: label, intentHint: hint });
  expect(result.rejection, `${hint.actionId} was rejected`).toBeUndefined();
  expect(result.resolution?.actionId).toBe(hint.actionId);
  expect(JSON.stringify(scriptState(engine.worldState)), `${hint.actionId} changed only clock/transcript`).not.toBe(beforeScript);
  for (const { resource, before: value } of paid) {
    expect(numericRuntime(engine.worldState, resource.id), `${hint.actionId} paid ${resource.id} exactly once`).toBe(value - resource.amount);
  }
}

async function completeShift(engine: Engine): Promise<void> {
  for (const step of MAIN_SHIFT) await perform(engine, step.label, step.hint);
}

function memoryStore(): SaveStore {
  const files = new Map<string, string>();
  return {
    write(scriptId, runId, json) { files.set(`${scriptId}/${runId}`, json); },
    read(scriptId, runId) {
      const value = files.get(`${scriptId}/${runId}`);
      if (!value) throw new Error(`missing ${scriptId}/${runId}`);
      return value;
    },
    list(scriptId) {
      return [...files.keys()].filter((key) => key.startsWith(`${scriptId}/`)).map((key) => ({ runId: key.slice(scriptId.length + 1), updatedAt: "2026-01-01T00:00:00.000Z" }));
    },
  };
}

function filesBelow(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const absolute = path.join(root, name);
    return statSync(absolute).isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

describe("Emberfall flagship vertical slice", () => {
  it.each([1, 7, 42, 99])("closes one deterministic shift in at most 12 actions (seed %i)", async (seed) => {
    const engine = create(seed);
    expect(engine.worldState.playedEventIds).toContain("shift-handoff");
    expect(engine.worldState.transcript[0]?.mediaCues).toContainEqual({ kind: "event", eventId: "shift-handoff" });

    await completeShift(engine);

    expect(MAIN_SHIFT).toHaveLength(12);
    expect(engine.worldState.runtimeState).toMatchObject({
      phase: "settled",
      settlementCount: 1,
      physicalEvidence: true,
      testimonyEvidence: true,
      conclusionReached: true,
      carriedCoal: 0,
      clinicCoal: 8,
    });
    expect(engine.worldState.player.locationId).toBe("lamp-house");
  });

  it("makes every enabled action reachable and mechanically effective", async () => {
    const main = create();
    for (const step of MAIN_SHIFT) await perform(main, step.label, step.hint);

    const optional = create(7);
    await perform(optional, "核问何桂", { actionId: "talk", target: "he-gui" });
    await perform(optional, "领取支护", { actionId: "draw-support" });
    await perform(optional, "击鼓下井", { actionId: "begin-shift" });
    await perform(optional, "加设支柱", { actionId: "set-prop" });

    const reached = new Set([...MAIN_SHIFT.map((step) => step.hint.actionId), "talk", "set-prop"]);
    const enabled = main.definition.actions.actions.filter((action) => action.enabled).map((action) => action.id);
    expect([...reached].sort()).toEqual([...enabled].sort());
  });

  it("keeps coal non-negative, conserved, and settles a shift once", async () => {
    const engine = create();
    const initialCoal = numericRuntime(engine.worldState, "publicFurnace");
    await completeShift(engine);
    const state = engine.worldState;
    const runtime = state.runtimeState;
    expect(numericRuntime(state, "publicFurnace")).toBeGreaterThanOrEqual(0);
    expect(numericRuntime(state, "carriedCoal")).toBeGreaterThanOrEqual(0);
    expect(initialCoal + numericRuntime(state, "coalExtracted")).toBe(
      numericRuntime(state, "publicFurnace") + numericRuntime(state, "carriedCoal") + numericRuntime(state, "coalSpent") + numericRuntime(state, "coalAllocated"),
    );
    expect(runtime.settlementCount).toBe(1);
    const stale = engine.previewAction({ actionId: "allocate-coal", params: { allocation: "pump" } });
    expect(stale.executable).toBe(false);
    const before = JSON.stringify(scriptState(state));
    await engine.playerTurn({ text: "再次配煤", intentHint: { actionId: "allocate-coal", params: { allocation: "pump" } } });
    expect(JSON.stringify(scriptState(engine.worldState))).toBe(before);
  });

  it("requires two independently recorded evidence ids before reaching the conclusion", async () => {
    const engine = create();
    for (const step of MAIN_SHIFT.slice(0, 4)) await perform(engine, step.label, step.hint);
    expect(engine.worldState.facts).toContain("evidence:seam-sample");
    expect(engine.worldState.facts).not.toContain("evidence:bell-testimony");
    expect(engine.worldState.facts).not.toContain("conclusion:unlogged-second-descent");
    for (const step of MAIN_SHIFT.slice(4, 11)) await perform(engine, step.label, step.hint);
    expect(engine.worldState.facts).toContain("evidence:bell-testimony");
    expect(engine.worldState.facts).toContain("conclusion:unlogged-second-descent");
  });

  it("round-trips extension runtime state without replaying the opening or session start", async () => {
    const store = memoryStore();
    const engine = create(42, store);
    for (const step of MAIN_SHIFT.slice(0, 7)) await perform(engine, step.label, step.hint);
    const savedRuntime = structuredClone(engine.worldState.runtimeState);
    const savedTranscript = engine.worldState.transcript.length;
    const runId = engine.save("emberfall-slice.json");
    const resumed = Engine.create({ scriptDir: SCRIPT_DIR, originId: "lamp-keeper", loadSaveFile: runId, provider: new MockProvider(), saveStore: store });
    expect(resumed.worldState.runtimeState).toEqual(savedRuntime);
    expect(resumed.worldState.transcript).toHaveLength(savedTranscript);
    expect(resumed.worldState.playedEventIds.filter((id) => id === "shift-handoff")).toHaveLength(1);
  });

  it("publishes observable NPC duty, debt, promise, and plan state", () => {
    const state = create().worldState.runtimeState;
    expect(state.npcDutyHeGui).toContain("职责");
    expect(state.npcDebtHanZhi).toContain("欠");
    expect(state.npcPromiseWangShulan).toContain("承诺");
    expect(state.npcPlanLiangSu).toContain("计划");
  });

  it("keeps the script UI host-driven and removes legacy SVG presentation assets", () => {
    const source = readFileSync(path.join(SCRIPT_DIR, "ui/index.tsx"), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/createStore|useSyncExternalStore|localStorage/);
    expect(source).toContain('ctx.register("game-shell"');
    expect(source).toContain('ctx.register("composer"');
    expect(source).toContain("previewAction(choice.hint)");
    expect(readFileSync(path.join(SCRIPT_DIR, "assets.yaml"), "utf8")).not.toContain(".svg");
  });

  it("records provenance for every local asset and nothing else", () => {
    const assetRoot = path.join(SCRIPT_DIR, "assets");
    const manifest = parse(readFileSync(path.join(assetRoot, "provenance.yaml"), "utf8")) as { files: Record<string, unknown> };
    const actual = filesBelow(assetRoot)
      .map((file) => path.relative(SCRIPT_DIR, file).split(path.sep).join("/"))
      .filter((file) => file !== "assets/provenance.yaml")
      .sort();
    expect(Object.keys(manifest.files).sort()).toEqual(actual);
  });
});
