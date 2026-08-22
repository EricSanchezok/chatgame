// @vitest-environment jsdom
import type { ComponentType } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AssetManifest, Catalog, WorldStateView } from "../../../src/shared/client-dto";
import type {
  GamePresentation,
  PanelSlotProps,
  ScriptUiContext,
  SlotId,
  SlotProps,
} from "../../../src/shared/ui-api";
import registerStarlightUi from "../../../scripts/starlight/ui/index";

function fixture() {
  const slots = new Map<SlotId, ComponentType<never>>();
  let presentation: GamePresentation | null = null;
  const context: ScriptUiContext = {
    apiVersion: 6,
    register(slot, definition) { slots.set(slot, definition.component as ComponentType<never>); },
    configureGame(next) { presentation = next; },
  };
  registerStarlightUi(context);
  const catalog = {
    locations: [{ id: "reactor-level", name: "维修主干 B-12", type: "维修与交班", description: "P-07 检修现场", npcsPresent: ["chief-engineer"], connections: [] }],
    currency: { name: "工分", symbol: "WP" },
    items: [], npcs: [], events: [], actions: [], stats: [], skills: [], needs: [], factions: [], statusEffects: [],
    tasks: [{ id: "p-07", name: "P-07 工单", summary: "压差超限", objectiveText: "检查颗粒阀", quantity: 1 }],
    origins: [], hpStat: "hp",
  } satisfies Catalog;
  const state = {
    scriptId: "starlight",
    clock: { totalHours: 7, day: 1, month: 1, year: 2078, hour: 7, weekday: 0, weather: "station", season: "cycle" },
    player: { originId: "crew-member", name: "值班员", stats: {}, skills: {}, needs: {}, inventory: { stacks: [], currency: 36 }, locationId: "reactor-level", flags: [], threatGauge: 12, statuses: [], memories: [], relations: [], reputation: [] },
    npcs: {}, flags: [], facts: [], eventLog: [], commitments: [], tasks: [], playedEventIds: [], secretHolders: {}, locationInventories: {}, transcript: [],
    runtimeState: {
      grid: 61, supply: 4, fatigue: 18, eva_oxygen: 100,
      incident: { status: "open", stage: "reported", solution: null },
      allocation: { register: "REG-2178", excluded: 47 },
      shift: { label: "夜班 B-12", last_feedback: "等待 P-07 处置签名" },
      logs: [{ id: "handoff-1", channel: "ALM", source: "P-07", summary: "颗粒阀压差超限" }],
    },
  } as unknown as WorldStateView;
  const assets = { portraits: {}, backgrounds: {}, illustrations: {}, icons: {}, sprites: {}, voices: {}, ambient: {}, effects: {}, ui: {} } satisfies AssetManifest;
  const model = { scriptId: "starlight", state, catalog, assets };
  function component<K extends SlotId>(slot: K): ComponentType<SlotProps<K>> {
    const value = slots.get(slot);
    if (!value) throw new Error(`slot not registered: ${slot}`);
    return value as unknown as ComponentType<SlotProps<K>>;
  }
  if (!presentation) throw new Error("game presentation not configured");
  return { model, component, presentation: presentation as GamePresentation };
}

afterEach(cleanup);

describe("Starlight UI API v6 presentation", () => {
  it("provides the compact objective and at most three contextual suggestions", () => {
    const { model, presentation } = fixture();
    expect(presentation.objective(model)).toEqual({ title: "检查 P-07 颗粒阀", detail: "确认压差与住户影响" });
    expect(presentation.suggestions(model)).toEqual([
      expect.objectContaining({ label: "检查 P-07", intentHint: { actionId: "investigate" } }),
      expect.objectContaining({ label: "询问老周", intentHint: { actionId: "talk", target: "chief-engineer" } }),
      expect.objectContaining({ label: "前往居住环", intentHint: { actionId: "move", target: "habitat-deck" } }),
    ]);
  });

  it("keeps the authored shift log in the records panel", () => {
    const { model, component } = fixture();
    const Records = component("panel:records");
    const props = { ...model, panelId: "records", focusId: null, trackedTaskId: null, trackTask: () => undefined, close: () => undefined } satisfies PanelSlotProps;
    render(<Records {...props} />);
    expect(screen.getByText("ALM · P-07")).toBeVisible();
    expect(screen.getByText("颗粒阀压差超限")).toBeVisible();
  });
});
