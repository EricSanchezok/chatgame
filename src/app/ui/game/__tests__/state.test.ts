// Game state reducer tests: pure transitions + active theme resolution.
// The reducer and resolver are plain functions (no React runtime needed).
import { describe, expect, it } from "vitest";
import {
  gameReducer,
  initialGameState,
  resolveActiveTheme,
  type GameState,
  type SessionHandle,
} from "../state";
import type { SessionPresentation, ScriptDetail } from "../../../lib/api";

function makeSession(): SessionHandle {
  const presentation: SessionPresentation = {
    themes: [
      {
        id: "default",
        name: "默认",
        palette: {
          background: "#111", surface: "#222", surface_alt: "#333", primary: "#666",
          accent: "#777", text: "#eee", text_dim: "#999", border: "#444",
        },
        typography: { font: "sans", scale: 1, line_height: 1.6, letter_spacing_em: 0, faces: [], roles: {} },
        effects: { bubble_radius: 14, chrome_radius: 12, glass: 0.6, blur_px: 8, shadow: "medium", border_width_px: 1, density: "cozy", motion: "subtle", scene_tint: "#000", overlay_strength: 0.45 },
      },
      {
        id: "dark-mine",
        name: "暗矿",
        palette: {
          background: "#000", surface: "#111", surface_alt: "#1a1a1a", primary: "#884",
          accent: "#a95", text: "#eee", text_dim: "#888", border: "#333",
        },
        typography: { font: "sans", scale: 1, line_height: 1.6, letter_spacing_em: 0, faces: [], roles: {} },
        effects: { bubble_radius: 14, chrome_radius: 12, glass: 0.6, blur_px: 8, shadow: "medium", border_width_px: 1, density: "cozy", motion: "subtle", scene_tint: "#000", overlay_strength: 0.45 },
      },
    ],
    currentTheme: {
      id: "default",
      name: "默认",
      palette: {
        background: "#111", surface: "#222", surface_alt: "#333", primary: "#666",
        accent: "#777", text: "#eee", text_dim: "#999", border: "#444",
      },
      typography: { font: "sans", scale: 1, line_height: 1.6, letter_spacing_em: 0, faces: [], roles: {} },
      effects: { bubble_radius: 14, chrome_radius: 12, glass: 0.6, blur_px: 8, shadow: "medium", border_width_px: 1, density: "cozy", motion: "subtle", scene_tint: "#000", overlay_strength: 0.45 },
    },
    hasAssets: true,
  };
  return {
    id: "s1",
    scriptId: "emberfall",
    state: {
      scriptId: "emberfall",
      clock: {
        totalHours: 0, day: 1, month: 1, year: 1, hour: 8,
        weekday: 0, weather: "晴", season: "夏",
      },
      player: {
        originId: "miner", name: "矿工", stats: { hp: 20 }, skills: {},
        needs: {}, inventory: { stacks: [], currency: 0 }, locationId: "tavern",
        flags: [], threatGauge: 0, statuses: [], memories: [],
        relations: [], reputation: [],
      },
      npcs: {}, flags: [], facts: [], eventLog: [],
      commitments: [],
      tasks: [], playedEventIds: [], secretHolders: {},
      locationInventories: {}, transcript: [],
    },
    presentation,
  };
}

const detail = { scriptId: "emberfall" } as ScriptDetail;

describe("gameReducer", () => {
  it("enter switches to the game screen and resets dirty/panel", () => {
    const before: GameState = {
      ...initialGameState,
      dirty: true,
      panel: "inventory",
    };
    const after = gameReducer(before, { type: "enter", session: makeSession(), detail });
    expect(after.screen).toBe("game");
    expect(after.session?.id).toBe("s1");
    expect(after.dirty).toBe(false);
    expect(after.panel).toBeNull();
  });

  it("turn applies the fresh state and marks dirty", () => {
    const session = makeSession();
    const entered = gameReducer(initialGameState, { type: "enter", session, detail });
    const result = {
      narrative: "回应",
      logEntries: [],
      descriptorUpdates: [],
      fellBackToTalk: false,
      worldEvents: [],
      taskCompletions: [],
      mediaCues: [],
      state: { ...session.state, player: { ...session.state.player, locationId: "mine" } },
      presentation: session.presentation,
    };
    const after = gameReducer(entered, { type: "turn", result });
    expect(after.session?.state.player.locationId).toBe("mine");
    expect(after.dirty).toBe(true);
    expect(after.lastTurn?.narrative).toBe("回应");
  });

  it("saved clears dirty; exit returns to the initial launcher state", () => {
    const entered = gameReducer(initialGameState, { type: "enter", session: makeSession(), detail });
    const dirty = gameReducer(entered, { type: "theme", mode: "dark-mine" });
    const saved = gameReducer(dirty, { type: "saved" });
    expect(saved.dirty).toBe(false);
    expect(saved.themeMode).toBe("dark-mine");
    const exited = gameReducer(saved, { type: "exit" });
    expect(exited).toEqual(initialGameState);
  });

  it("panel toggles the active overlay", () => {
    const entered = gameReducer(initialGameState, { type: "enter", session: makeSession(), detail });
    const opened = gameReducer(entered, { type: "panel", panel: "inventory" });
    expect(opened.panel).toBe("inventory");
    expect(gameReducer(opened, { type: "panel", panel: null }).panel).toBeNull();
  });

  it("pause toggles the overlay and closes panels", () => {
    const entered = gameReducer(initialGameState, { type: "enter", session: makeSession(), detail });
    const withPanel = gameReducer(entered, { type: "panel", panel: "inventory" });
    const paused = gameReducer(withPanel, { type: "pause", on: true });
    expect(paused.paused).toBe(true);
    expect(paused.panel).toBeNull(); // opening pause closes any panel
    const resumed = gameReducer(paused, { type: "pause", on: false });
    expect(resumed.paused).toBe(false);
  });
});

describe("resolveActiveTheme", () => {
  it("follow mode resolves the current (by_location) theme", () => {
    const session = makeSession();
    expect(resolveActiveTheme(session.presentation, "follow")?.id).toBe("default");
  });

  it("manual mode resolves the selected theme by id", () => {
    const session = makeSession();
    expect(resolveActiveTheme(session.presentation, "dark-mine")?.name).toBe("暗矿");
  });

  it("unknown manual ids degrade to follow", () => {
    const session = makeSession();
    expect(resolveActiveTheme(session.presentation, "nope")?.id).toBe("default");
  });

  it("returns null without a presentation", () => {
    expect(resolveActiveTheme(undefined, "follow")).toBeNull();
  });
});
