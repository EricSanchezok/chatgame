// @vitest-environment jsdom
import type { ComponentType } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetManifest, Catalog, WorldStateView } from "../../../src/shared/client-dto";
import type {
  ComposerSlotProps,
  HudSlotProps,
  ObjectiveTrackerSlotProps,
  ScriptUiContext,
  SlotId,
  SlotProps,
} from "../../../src/shared/ui-api";
import registerStarlightUi from "../../../scripts/starlight/ui/index";

function fixture() {
  const slots = new Map<SlotId, ComponentType<never>>();
  const context: ScriptUiContext = {
    apiVersion: 5,
    register(slot, definition) {
      slots.set(slot, definition.component as ComponentType<never>);
    },
  };
  registerStarlightUi(context);
  const catalog = {
    locations: [{
      id: "reactor-level", name: "维修主干 B-12", type: "维修与交班", description: "P-07 检修现场", npcsPresent: ["chief-engineer"], connections: [],
    }],
    currency: { name: "工分", symbol: "WP" },
    items: [], npcs: [], events: [], actions: [], stats: [], skills: [], needs: [], factions: [], statusEffects: [], tasks: [], origins: [], hpStat: "hp",
  } satisfies Catalog;
  const state = {
    scriptId: "starlight",
    clock: { totalHours: 7, day: 1, month: 1, year: 2078, hour: 7, weekday: 0, weather: "station", season: "cycle" },
    player: {
      originId: "crew-member", name: "值班员", stats: {}, skills: {}, needs: {},
      inventory: { stacks: [], currency: 36 }, locationId: "reactor-level", flags: [], threatGauge: 12,
      statuses: [], memories: [], relations: [], reputation: [],
    },
    npcs: {}, flags: [], facts: [], eventLog: [], commitments: [], tasks: [], playedEventIds: [], secretHolders: {}, locationInventories: {}, transcript: [],
    runtimeState: {
      hull: 83, grid: 61, supply: 4, fatigue: 18, fatigue_capacity: 82, eva_oxygen: 100, heat: 12, airflow: 42,
      incident: { status: "open", stage: "reported", solution: null },
      allocation: { register: "REG-2178", registered: 182, unregistered: 47, excluded: 47, policy: "registered-only" },
      shift: { label: "夜班 B-12", next_handoff_at: 14, last_feedback: "等待 P-07 处置签名" },
      logs: [{ id: "handoff-1", channel: "ALM", source: "P-07", at: 7, summary: "颗粒阀压差超限" }],
    },
  } as unknown as WorldStateView;
  const assets = {
    cover: { file: "assets/backgrounds/shift-console-cover.webp" },
    backgrounds: { "reactor-level": { file: "assets/backgrounds/maintenance-spine.webp", alt: "维修主干 B-12 的 P-07 检修口" } },
    portraits: {}, illustrations: {}, icons: {}, sprites: {}, voices: {}, ambient: {}, effects: {}, ui: {},
  } satisfies AssetManifest;
  const model = {
    scriptId: "starlight",
    state,
    catalog,
    assets,
  };
  function component<K extends SlotId>(slot: K): ComponentType<SlotProps<K>> {
    const value = slots.get(slot);
    if (!value) throw new Error(`slot not registered: ${slot}`);
    return value as unknown as ComponentType<SlotProps<K>>;
  }
  return { model, component };
}

afterEach(cleanup);

describe("Starlight conversation-first components", () => {
  it("renders only decision-critical worker metrics and a compact objective", () => {
    const { model, component } = fixture();
    const Hud = component("hud");
    const Tracker = component("objective-tracker");
    const { rerender } = render(<Hud {...model satisfies HudSlotProps} />);
    expect(screen.getByRole("banner", { name: "星港权威值班读数" })).toHaveTextContent("维修主干 B-12");
    expect(screen.getByRole("banner")).toHaveTextContent("EVA 氧100%");
    expect(screen.getByRole("banner")).toHaveTextContent("疲劳18%");
    expect(screen.getByRole("banner")).toHaveTextContent("电网61%");
    expect(screen.getByRole("banner")).toHaveTextContent("供给4 件");

    const openTasks = vi.fn();
    const trackerProps = { ...model, trackedTaskId: null, openTasks } satisfies ObjectiveTrackerSlotProps;
    rerender(<Tracker {...trackerProps} />);
    fireEvent.click(screen.getByRole("button", { name: "查看 P-07 当前工单" }));
    expect(openTasks).toHaveBeenCalledOnce();
  });

  it("uses the host preview and submit callbacks for the first work-order action", async () => {
    const { model, component } = fixture();
    const Composer = component("composer");
    const previewAction = vi.fn(async (hint: Parameters<ComposerSlotProps["previewAction"]>[0]) => ({
      actionId: hint.actionId,
      displayName: "检查 P-07",
      executable: true,
      timeCost: 1,
      costs: { currency: 0, items: [], resources: [{ kind: "runtime" as const, id: "fatigue_capacity", amount: 4 }] },
      risk: { type: "none" as const },
    }));
    const submitTurn = vi.fn(async () => undefined);
    render(<Composer {...model} busy={false} previewAction={previewAction} submitTurn={submitTurn} />);

    fireEvent.click(screen.getByRole("button", { name: /检查 P-07/ }));
    await waitFor(() => expect(previewAction).toHaveBeenCalledWith({ actionId: "investigate" }));
    expect(await screen.findByText("可执行 · 成本已锁定")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(submitTurn).toHaveBeenCalledWith(
      "检查 P-07",
      { actionId: "investigate" },
    ));
  });
});
