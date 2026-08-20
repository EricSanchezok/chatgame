import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { Engine } from "../../../src/engine";
import { previewAction, resolveAction } from "../../../src/engine/actions";
import { MockProvider } from "../../../src/engine/narrative/mock";
import type { SaveStore } from "../../../src/engine/save-store";
import type { IntentHint } from "../../../src/shared/client-dto";
import type { ScriptHostModel } from "../../../src/shared/ui-api";
import { createPreviewRequestGate, emberfallActionChoices } from "../../../scripts/emberfall/ui";

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

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function uiActionIds(engine: Engine): string[] {
  return emberfallActionChoices({ state: engine.worldState } as unknown as ScriptHostModel).map((choice) => choice.hint.actionId);
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

  it("rejects allocation before the required testimony without hiding the completion path", async () => {
    const engine = create(42);
    for (const step of MAIN_SHIFT.slice(0, 10)) await perform(engine, step.label, step.hint);
    expect(engine.worldState.runtimeState.phase).toBe("returned");

    const allocation = { actionId: "allocate-coal", params: { allocation: "clinic" } } satisfies IntentHint;
    const stalePreview = engine.previewAction(allocation);
    expect(stalePreview.executable).toBe(false);
    expect(stalePreview.reasonCode).toBe("missing_evidence");
    expect(uiActionIds(engine)).toEqual(["record-testimony"]);
    const before = JSON.stringify(scriptState(engine.worldState));
    await engine.playerTurn({ text: "先配给诊所", intentHint: allocation });
    expect(JSON.stringify(scriptState(engine.worldState))).toBe(before);

    const testimony = { actionId: "record-testimony", target: "han-zhi" } satisfies IntentHint;
    expect(engine.previewAction(testimony).executable).toBe(true);
    await perform(engine, "记录韩直证词", testimony);
    expect(uiActionIds(engine)).toEqual(["allocate-coal", "allocate-coal", "allocate-coal"]);
    expect(engine.previewAction(allocation).executable).toBe(true);
    await perform(engine, "公开配给诊所", allocation);
    expect(engine.worldState.runtimeState.phase).toBe("settled");
  });

  it("closes the eighth underground action before a ninth and always permits emergency return", async () => {
    const engine = create(1);
    await perform(engine, "击鼓下井", { actionId: "begin-shift" });
    for (let index = 0; index < 8; index += 1) {
      await perform(engine, `第 ${index + 1} 次测层`, { actionId: "survey-seam" });
    }
    expect(engine.worldState.runtimeState.undergroundActions).toBe(8);
    expect(engine.previewAction({ actionId: "survey-seam" })).toMatchObject({ executable: false, reasonCode: "rule:witnessed-accounting" });
    expect(uiActionIds(engine)).toEqual(["return-shift"]);
    expect(engine.previewAction({ actionId: "return-shift" }).executable).toBe(true);
    await perform(engine, "紧急返镇", { actionId: "return-shift" });
    expect(engine.worldState.runtimeState.phase).toBe("preparing");
    expect(engine.worldState.player.locationId).toBe("lamp-house");
    expect(engine.previewAction({ actionId: "begin-shift" }).executable).toBe(true);

    const fresh = create(7);
    const dangerous: Engine["worldState"] = {
      ...fresh.worldState,
      player: { ...fresh.worldState.player, locationId: "upper-drift" },
      runtimeState: {
        ...fresh.worldState.runtimeState,
        phase: "underground",
        lamp: 0,
        ashExposure: 100,
        undergroundActions: 9,
        carriedCoal: 0,
        physicalEvidence: false,
      },
    };
    expect(previewAction(fresh.definition, dangerous, { actionId: "return-shift" })).toMatchObject({ executable: true });
    const returned = resolveAction({ definition: fresh.definition, state: dangerous, actionId: "return-shift" });
    expect(returned.rejected).toBe(false);
    expect(returned.state.runtimeState.phase).toBe("preparing");
    expect(returned.state.player.locationId).toBe("lamp-house");
  });

  it("does not mint successful artifacts on forced failed checks and differentiates partial from crit", () => {
    const engine = create(42);
    const begun = resolveAction({ definition: engine.definition, state: engine.worldState, actionId: "begin-shift" }).state;
    const at = (locationId: string, runtimePatch: Record<string, unknown> = {}) => ({
      ...begun,
      player: { ...begun.player, locationId },
      runtimeState: { ...begun.runtimeState, ...runtimePatch },
    });

    const surveyFail = resolveAction({ definition: engine.definition, state: at("upper-drift"), actionId: "survey-seam", rollOverride: -100 });
    expect(surveyFail.resolution?.grade).toBe("fail");
    expect(surveyFail.state.runtimeState.physicalEvidence).toBe(false);
    expect(surveyFail.state.facts).not.toContain("evidence:seam-sample");
    expect(surveyFail.state.player.inventory.stacks.some((stack) => stack.itemId === "seam-sample")).toBe(false);

    const listenFail = resolveAction({ definition: engine.definition, state: at("bell-gallery"), actionId: "listen-strata", rollOverride: -100 });
    expect(listenFail.resolution?.grade).toBe("fail");
    expect(listenFail.state.runtimeState.echoRecorded).toBe(false);

    const coalFail = resolveAction({ definition: engine.definition, state: at("blue-seam"), actionId: "collect-coal", rollOverride: -100 });
    expect(coalFail.resolution?.grade).toBe("fail");
    expect(coalFail.state.runtimeState.carriedCoal).toBe(0);
    expect(coalFail.state.runtimeState.coalExtracted).toBe(0);

    const propState = at("upper-drift");
    const propFail = resolveAction({ definition: engine.definition, state: propState, actionId: "set-prop", rollOverride: -100 });
    expect(propFail.resolution?.grade).toBe("fail");
    expect(propFail.state.runtimeState.minePressure).toBe(propState.runtimeState.minePressure);

    const tokenFail = resolveAction({ definition: engine.definition, state: at("blue-seam"), actionId: "recover-token", rollOverride: -100 });
    expect(tokenFail.resolution?.grade).toBe("fail");
    expect(tokenFail.state.runtimeState.tokenRecovered).toBe(false);
    expect(tokenFail.state.facts).not.toContain("evidence:old-shift-token");
    expect(tokenFail.state.player.inventory.stacks.some((stack) => stack.itemId === "bell-clapper")).toBe(false);

    const testimonyState = at("lamp-house", { phase: "returned", physicalEvidence: true });
    const testimonyFail = resolveAction({ definition: engine.definition, state: testimonyState, actionId: "record-testimony", targetNpcId: "han-zhi", rollOverride: -100 });
    expect(testimonyFail.resolution?.grade).toBe("fail");
    expect(testimonyFail.state.runtimeState.testimonyAttempts).toBe(1);
    expect(testimonyFail.state.runtimeState.testimonyEvidence).toBe(false);
    expect(testimonyFail.state.runtimeState.conclusionReached).toBe(false);
    expect(testimonyFail.state.facts).not.toContain("evidence:bell-testimony");

    const partial = resolveAction({ definition: engine.definition, state: at("upper-drift"), actionId: "survey-seam", rollOverride: 1 });
    const crit = resolveAction({ definition: engine.definition, state: at("upper-drift"), actionId: "survey-seam", rollOverride: 9 });
    expect(partial.resolution?.grade).toBe("partial");
    expect(crit.resolution?.grade).toBe("crit");
    expect(partial.state.runtimeState.physicalEvidence).toBe(true);
    expect(crit.state.runtimeState.physicalEvidence).toBe(true);
    expect(partial.state.runtimeState.ashExposure).toBe(14);
    expect(crit.state.runtimeState.ashExposure).toBe(8);
    expect(crit.state.runtimeState.minePressure).toBe(14);
  });

  it("records evidence as facts without bypassing a full inventory", () => {
    const engine = create(42);
    const begun = resolveAction({ definition: engine.definition, state: engine.worldState, actionId: "begin-shift" }).state;
    const fullInventory = { stacks: [{ itemId: "witness-ledger", quantity: 8 }], currency: begun.player.inventory.currency };
    const surveyState = { ...begun, player: { ...begun.player, locationId: "upper-drift", inventory: fullInventory } };
    const surveyed = resolveAction({ definition: engine.definition, state: surveyState, actionId: "survey-seam", rollOverride: 20 });
    expect(surveyed.state.player.inventory).toEqual(fullInventory);
    expect(surveyed.state.facts).toContain("evidence:seam-sample");

    const tokenState = { ...begun, player: { ...begun.player, locationId: "blue-seam", inventory: fullInventory } };
    const recovered = resolveAction({ definition: engine.definition, state: tokenState, actionId: "recover-token", rollOverride: 20 });
    expect(recovered.state.player.inventory).toEqual(fullInventory);
    expect(recovered.state.facts).toContain("evidence:old-shift-token");
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

  it("publishes observable NPC fields and changes next-shift feedback by allocation", async () => {
    const engine = create();
    const state = engine.worldState.runtimeState;
    expect(state.npcDutyHeGui).toContain("职责");
    expect(state.npcDebtHanZhi).toContain("欠");
    expect(state.npcPromiseWangShulan).toContain("承诺");
    expect(state.npcPlanLiangSu).toContain("计划");

    for (const step of MAIN_SHIFT.slice(0, 11)) await perform(engine, step.label, step.hint);
    const allocations = ["clinic", "pump", "hearth"] as const;
    const results = allocations.map((allocation) => resolveAction({
      definition: engine.definition,
      state: engine.worldState,
      actionId: "allocate-coal",
      params: { allocation },
    }).state.runtimeState);
    expect(new Set(results.map((result) => result.allocationOutcome)).size).toBe(3);
    expect(new Set(results.map((result) => result.npcPlanLiangSu)).size).toBe(3);
    expect(results[0].clinicCoal).toBe(8);
    expect(results[1].pumpCoal).toBe(8);
    expect(results[2].hearthCoal).toBe(8);
  });

  it("rejects stale preview generations and keeps the current selection authoritative", () => {
    const gate = createPreviewRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(second)).toBe(true);
    expect(gate.isCurrent(first)).toBe(false);
  });

  it("keeps the script UI host-driven, responsive, and removes legacy SVG presentation assets", () => {
    const source = readFileSync(path.join(SCRIPT_DIR, "ui/index.tsx"), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/createStore|useSyncExternalStore|localStorage/);
    expect(source).toContain('ctx.register("game-shell"');
    expect(source).toContain('ctx.register("composer"');
    expect(source).toContain("previewAction(choice.hint)");
    expect(source).toContain("isCurrent(generation)");
    expect(source).toContain('stringValue(model, "allocationOutcome")');
    expect(source).toContain('stringValue(model, "lastDutyTarget")');
    expect(source).not.toContain(".ef-hud .ef-optional{display:none}");
    expect(source).not.toContain(".ef-hud .ef-mobile-hide{display:none}");
    expect(source).not.toContain(".ef-transcript{display:none}");
    expect(source).not.toContain(".ef-freeform{display:none}");
    expect(source).toContain(".ef-action{appearance:none;flex:0 0 auto;min-height:2.75rem");
    expect(source).toContain(".ef-input{min-height:2.75rem");
    expect(source).toContain(".ef-execute,.ef-send{appearance:none;min-height:2.75rem");
    expect(readFileSync(path.join(SCRIPT_DIR, "assets.yaml"), "utf8")).not.toContain(".svg");
  });

  it("keeps primary action text above WCAG AA contrast", () => {
    const theme = parse(readFileSync(path.join(SCRIPT_DIR, "theme.yaml"), "utf8")) as { palette: { primary: string; on_primary: string } };
    expect(contrastRatio(theme.palette.primary, theme.palette.on_primary)).toBeGreaterThanOrEqual(4.5);
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
