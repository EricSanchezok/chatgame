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
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { useEffect } from "react";

function makeWorldState() {
  return {
    scriptId: "emberfall",
    clock: { totalHours: 0, day: 1, month: 1, year: 1, hour: 8, weekday: 0, weather: "晴", season: "春" },
    player: {
      originId: "miner", name: "矿工", stats: { hp: 80 }, skills: {}, needs: {},
      inventory: { stacks: [], currency: 10 }, locationId: "tavern", flags: [],
      threatGauge: 0, statuses: [], memories: [], relations: [], reputation: [],
    },
    npcs: {}, flags: [], facts: [], eventLog: [], commitments: [], tasks: [],
    playedEventIds: [], secretHolders: {}, locationInventories: {}, transcript: [],
  };
}

function makeTheme() {
  return {
    id: "default", name: "默认",
    palette: { background: "#111", surface: "#222", surface_alt: "#333", primary: "#666", accent: "#777", text: "#eee", text_dim: "#999", border: "#444" },
    typography: { font: "serif", scale: 1, line_height: 1.6, letter_spacing_em: 0, faces: [], roles: {} },
    effects: { bubble_radius: 14, chrome_radius: 12, glass: 0.6, blur_px: 8, shadow: "medium", border_width_px: 1, density: "cozy", motion: "subtle", scene_tint: "#000", overlay_strength: 0.45 },
  };
}

function makePresentation() {
  const theme = makeTheme();
  return { themes: [theme], currentTheme: theme, hasAssets: true };
}

function makeCatalog() {
  return {
    locations: [{ id: "tavern", name: "酒馆", type: "indoor", description: "", npcsPresent: [], connections: [] }],
    items: [], npcs: [], events: [], actions: [{ id: "talk", displayName: "交谈" }],
    stats: [{ name: "hp", min: 0, max: 100 }], needs: [], statusEffects: [], tasks: [],
    origins: [{ id: "miner", name: "矿工" }], currency: { name: "金币", symbol: "金" }, hpStat: "hp",
  };
}

function makeAssets() {
  return { portraits: {}, backgrounds: {}, icons: {}, sprites: {}, voices: {}, ambient: {}, effects: {}, ui: {} };
}

vi.mock("../../../lib/api", () => ({
  api: {
    scriptDetail: vi.fn().mockResolvedValue({
      scriptId: "emberfall",
      presentation: makePresentation(),
      origins: [{ id: "miner", name: "矿工", description: "" }],
      catalog: makeCatalog(),
      assets: makeAssets(),
      saves: [],
    }),
    createSession: vi.fn().mockResolvedValue({ id: "s1", state: makeWorldState(), presentation: makePresentation() }),
    turn: vi.fn(),
    save: vi.fn().mockResolvedValue({ saved: true, path: "" }),
    destroySession: vi.fn().mockResolvedValue(undefined),
    state: vi.fn(),
    listScripts: vi.fn().mockResolvedValue({ scripts: [] }),
    importScript: vi.fn(),
    fileAsset: (_scriptId: string, file: string) => `/api/scripts/x/assets/${file.replace(/^assets\//, "")}`,
    entityAsset: () => "",
  },
}));

vi.mock("../../../lib/script-registry", () => ({
  loadScriptUi: vi.fn().mockResolvedValue({ ok: false }),
  getSlot: () => undefined,
  clearSlots: () => {},
  registerSlot: () => {},
  hasSlot: () => false,
}));

import { GameProvider, useGame } from "../state";
import { GameScreen } from "../chat";

function Harness({ children }: { children: ReactNode }) {
  const { startNewGame } = useGame();
  // Run once on mount; startNewGame identity changes with every state
  // change, so an exhaustive-deps effect would loop forever.
  useEffect(() => {
    void startNewGame("emberfall", "miner");
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
    expect(await screen.findByLabelText("玩家输入")).toBeTruthy();

    // Escape opens the pause menu dialog.
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.getByRole("dialog", { name: "暂停菜单" })).toBeTruthy();
    expect(screen.getByText("设置")).toBeTruthy();

    // Second Escape closes it.
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog", { name: "暂停菜单" })).toBeNull();
  });

  it("Escape closes an open panel first, then opens the pause menu", async () => {
    render(
      <GameProvider>
        <Harness>
          <GameScreen />
        </Harness>
      </GameProvider>,
    );

    expect(await screen.findByLabelText("玩家输入")).toBeTruthy();

    // Open the inventory panel via the toolbar entry.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "背包" }));
    });
    expect(screen.getByRole("dialog", { name: "背包" })).toBeTruthy();

    // First Escape closes the panel (not the pause menu).
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog", { name: "背包" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "暂停菜单" })).toBeNull();

    // Second Escape opens the pause menu.
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.getByRole("dialog", { name: "暂停菜单" })).toBeTruthy();
  });
});
