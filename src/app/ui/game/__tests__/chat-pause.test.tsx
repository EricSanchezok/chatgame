// @vitest-environment jsdom
// Esc pause-menu behavior: mounting GameProvider + GameScreen, dispatching
// Escape renders the pause menu dialog; Escape again closes it. Panel-first
// ordering is asserted (Escape closes an open panel before pausing).
// API and script-ui loading are mocked so the keydown -> reducer -> render
// path is exercised deterministically.
//
// Note: vi.mock factories are hoisted above every top-level const, so all
// fixture data lives in function declarations (also hoisted) and the
// factories call them at runtime. RTL auto-cleanup needs globals, which
// vitest does not enable here — cleanup runs explicitly in afterEach.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useEffect } from "react";

function makeWorldState() {
  return {
    scriptId: "fixture-script",
    clock: { totalHours: 0, day: 1, month: 1, year: 1, hour: 8, weekday: 0, weather: "晴", season: "春" },
    player: {
      originId: "miner", name: "矿工", stats: { hp: 80 }, skills: {}, needs: {},
      inventory: { stacks: [], currency: 10 }, locationId: "tavern", flags: [],
      threatGauge: 0, statuses: [], memories: [], relations: [], reputation: [],
    },
    npcs: {}, flags: [], facts: [], eventLog: [], commitments: [], tasks: [],
    playedEventIds: [], secretHolders: {}, locationInventories: {}, transcript: [], runtimeState: {},
  };
}

function makeTheme() {
  return {
    id: "default", name: "默认",
    palette: { background: "#111", surface: "#222", surface_alt: "#333", primary: "#666", on_primary: "#fff", accent: "#777", text: "#eee", text_dim: "#999", border: "#444", focus: "#8ec9ba", success: "#6a6", warning: "#ca5", danger: "#c66", selected: "#555" },
    typography: { font: "serif", scale: 1, line_height: 1.6, letter_spacing_em: 0, faces: [], roles: {} },
    effects: { bubble_radius: 14, chrome_radius: 12, glass: 0.6, blur_px: 8, shadow: "medium", border_width_px: 1, density: "cozy", motion: "subtle", scene_tint: "#000", overlay_strength: 0.45 },
  };
}

function makePresentation() {
  const theme = makeTheme();
  return { themes: [theme], currentTheme: theme, defaultThemeId: "default", hasAssets: true };
}

function makeCatalog() {
  return {
    locations: [{ id: "tavern", name: "酒馆", type: "indoor", description: "", npcsPresent: [], connections: [] }],
    items: [{ id: "lamp-oil", name: "灯油", type: "supply", description: "" }], npcs: [], events: [], actions: [{ id: "talk", displayName: "交谈" }],
    stats: [{ name: "hp", min: 0, max: 100 }], skills: [{ name: "focus", min: 0, max: 10 }], needs: [{ name: "energy" }], factions: [], statusEffects: [], tasks: [],
    origins: [{ id: "miner", name: "矿工" }], currency: { name: "金币", symbol: "金" }, hpStat: "hp",
  };
}

function makeAssets() {
  return { portraits: {}, backgrounds: {}, icons: {}, sprites: {}, voices: {}, ambient: {}, effects: {}, ui: {} };
}

vi.mock("../../../lib/api", () => ({
  httpGamePort: {
    scriptDetail: vi.fn().mockResolvedValue({
      scriptId: "fixture-script",
      presentation: makePresentation(),
      origins: [{ id: "miner", name: "矿工", description: "" }],
      catalog: makeCatalog(),
      assets: makeAssets(),
      saves: [],
    }),
    createSession: vi.fn().mockResolvedValue({ id: "s1", state: makeWorldState(), presentation: makePresentation() }),
    submitTurn: vi.fn(),
    previewAction: vi.fn(),
    save: vi.fn().mockResolvedValue({ saved: true, path: "" }),
    destroySession: vi.fn().mockResolvedValue(undefined),
    state: vi.fn(),
    listScripts: vi.fn().mockResolvedValue({ scripts: [] }),
    previewImport: vi.fn(),
    commitImport: vi.fn(),
    setDescriptor: vi.fn(),
    advance: vi.fn(),
    scriptMeta: vi.fn(),
    assetUrl: (_scriptId: string, file: string) => `/api/scripts/x/assets/${file.replace(/^assets\//, "")}`,
    entityAssetUrl: () => "",
  },
}));

vi.mock("../../../lib/script-registry", () => ({
  loadScriptUi: vi.fn().mockResolvedValue({ ok: false }),
  useScriptRegistry: () => ({
    generation: 1,
    scriptId: "fixture-script",
    dependencyHash: null,
    status: "active",
    slots: new Map(),
    error: null,
  }),
  getSlot: () => undefined,
  clearSlots: () => {},
  registerSlot: () => {},
  hasSlot: () => false,
}));

import { GameProvider, useGameActions } from "../state";
import { GameScreen } from "../chat";
import { httpGamePort } from "../../../lib/api";

function Harness({ children }: { children: ReactNode }) {
  const { startNewGame } = useGameActions();
  // Run once on mount; startNewGame identity changes with every state
  // change, so an exhaustive-deps effect would loop forever.
  useEffect(() => {
    void startNewGame("fixture-script", "miner");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{children}</>;
}

describe("Esc pause menu (behavioral)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the pause menu on Escape and closes it on a second Escape", async () => {
    render(
      <GameProvider>
        <Harness>
          <GameScreen />
        </Harness>
      </GameProvider>,
    );

    // Game screen visible (composer input rendered).
    expect(await screen.findByLabelText("输入你的话或行动")).toBeTruthy();
    expect(screen.getByRole("main", { name: "游戏对话记录" })).toHaveAttribute("tabindex", "0");

    // Escape opens the pause menu dialog.
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(await screen.findByRole("dialog", { name: "暂停菜单" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "打开全局设置" })).toBeTruthy();

    // Second Escape closes it.
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "暂停菜单" })).toBeNull());
  });

  it("Escape closes an open panel first, then opens the pause menu", async () => {
    render(
      <GameProvider>
        <Harness>
          <GameScreen />
        </Harness>
      </GameProvider>,
    );

    expect(await screen.findByLabelText("输入你的话或行动")).toBeTruthy();

    // Open the inventory panel via the toolbar entry.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "背包" }));
    });
    expect(screen.getByRole("dialog", { name: "背包" })).toBeTruthy();

    // First Escape closes the panel (not the pause menu).
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "背包" })).toBeNull());
    expect(screen.queryByRole("dialog", { name: "暂停菜单" })).toBeNull();

    // Second Escape opens the pause menu.
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(await screen.findByRole("dialog", { name: "暂停菜单" })).toBeTruthy();
  });

  it("renders dynamic currency, item, resource and risk costs from an action preview", async () => {
    vi.mocked(httpGamePort.previewAction).mockResolvedValueOnce({
      actionId: "talk",
      displayName: "强行交涉",
      executable: true,
      timeCost: 2,
      costs: {
        currency: 4,
        items: [{ itemId: "lamp-oil", quantity: 1 }],
        resources: [
          { kind: "need", id: "energy", amount: 20 },
          { kind: "stat", id: "hp", amount: 2 },
          { kind: "skill", id: "focus", amount: 1 },
          { kind: "runtime", id: "oxygen", amount: 5 },
        ],
      },
      risk: { type: "skill", key: "focus", dc: 12 },
    });
    render(
      <GameProvider>
        <Harness>
          <GameScreen />
        </Harness>
      </GameProvider>,
    );

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "交谈" }));
    });

    const feedback = (await screen.findByText("强行交涉")).closest('[role="status"]');
    if (!feedback) throw new Error("action preview feedback was not rendered");
    expect(feedback.textContent).toContain("货币：4 金币");
    expect(feedback.textContent).toContain("物品：灯油 ×1");
    expect(feedback.textContent).toContain("需求 energy：消耗 20");
    expect(feedback.textContent).toContain("属性 hp：消耗 2");
    expect(feedback.textContent).toContain("技能 focus：消耗 1");
    expect(feedback.textContent).toContain("剧本资源 oxygen：消耗 5");
    expect(feedback.textContent).toContain("判定：技能判定 · focus · DC 12");
    expect(feedback.textContent).not.toContain("无货币消耗");

    vi.mocked(httpGamePort.previewAction).mockResolvedValueOnce({
      actionId: "talk",
      displayName: "维持供氧",
      executable: false,
      reason: "energy 不足",
      timeCost: 0,
      costs: { currency: 0, items: [], resources: [{ kind: "need", id: "energy", amount: 30 }] },
      risk: { type: "none" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "交谈" }));
    });
    const energyFeedback = (await screen.findByText("维持供氧")).closest('[role="status"]');
    expect(energyFeedback?.textContent).toContain("当前不可执行：energy 不足");
    expect(energyFeedback?.textContent).toContain("需求 energy：消耗 30");
    expect(energyFeedback?.textContent).not.toContain("无资源消耗");
    expect(energyFeedback?.textContent).not.toContain("无货币消耗");
  });
});
