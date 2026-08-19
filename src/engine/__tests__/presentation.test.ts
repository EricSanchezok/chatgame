// Presentation layer tests: theme resolution (default / by_location remap /
// inline override / framework fallback), asset manifest classification, and
// deterministic media cue derivation (three kinds × trigger/no-trigger).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import {
  resolveTheme,
  listSelectableThemes,
  buildAssetManifest,
  deriveMediaCues,
  appendTranscript,
  FRAMEWORK_DARK_THEME,
} from "../presentation";
import type { WorldState, MediaCue, ResolutionLogEntry } from "../types";
function makeState(overrides: Partial<WorldState> = {}): WorldState {
  const { state } = generateWorld(emberfall, "miner", { seed: 42 });
  // Normalize the player location so movement tests can assert real moves
  // (the miner origin already starts at mine-entrance).
  return { ...state, player: { ...state.player, locationId: "tavern" }, ...overrides };
}

const REPO_ROOT = path.resolve(__dirname, "../../..");
const emberfall = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
const starlight = loadScript(path.join(REPO_ROOT, "scripts/starlight"));


function resolution(overrides: Partial<ResolutionLogEntry> = {}): ResolutionLogEntry {
  return {
    actionId: "talk",
    target: "elara",
    resolveType: "auto",
    roll: null,
    dc: null,
    grade: "success",
    effectsApplied: [],
    ...overrides,
  };
}

describe("resolveTheme", () => {
  it("falls back to the framework dark theme when the script has no theme", () => {
    // A definition with no themes must always resolve a complete theme.
    const def = { ...emberfall, themes: new Map() };
    const theme = resolveTheme(def, makeState());
    expect(theme.id).toBe(FRAMEWORK_DARK_THEME.id);
    expect(theme.palette.background).toMatch(/^#/);
  });

  it("returns the script default theme when present and no by_location matches", () => {
    // emberfall ships theme.yaml with id "default".
    const theme = resolveTheme(emberfall, makeState());
    expect(theme.id).toBe("default");
    expect(theme.palette.background).toBe("#1a1410");
  });

  it("remaps by_location theme id references", () => {
    const mineTheme = { ...FRAMEWORK_DARK_THEME, id: "dark-mine", name: "暗矿" };
    const def = {
      ...emberfall,
      themes: new Map([
        ["default", { ...FRAMEWORK_DARK_THEME, id: "default", by_location: { "mine-entrance": "dark-mine" } }],
        ["dark-mine", mineTheme],
      ]),
    };
    const theme = resolveTheme(def, makeState({ player: { ...makeState().player, locationId: "mine-entrance" } }));
    expect(theme.name).toBe("暗矿");
  });

  it("applies inline palette overrides", () => {
    const def = {
      ...emberfall,
      themes: new Map([
        ["default", { ...FRAMEWORK_DARK_THEME, id: "default", by_location: { "mine-entrance": { background: "#ff0000" } } }],
      ]),
    };
    const theme = resolveTheme(def, makeState({ player: { ...makeState().player, locationId: "mine-entrance" } }));
    expect(theme.palette.background).toBe("#ff0000");
    expect(theme.palette.surface).toBe(FRAMEWORK_DARK_THEME.palette.surface); // other fields kept
  });

  it("listSelectableThemes includes script themes + framework built-ins", () => {
    const def = { ...emberfall, themes: new Map([["default", FRAMEWORK_DARK_THEME]]) };
    const themes = listSelectableThemes(def);
    expect(themes.length).toBeGreaterThanOrEqual(3); // script default + dark + light
    expect(themes.map((t) => t.id)).toContain("framework-dark");
    expect(themes.map((t) => t.id)).toContain("framework-light");
  });
});

describe("buildAssetManifest", () => {
  it("returns empty sections for scripts without assets.yaml", () => {
    const def = { ...emberfall, assets: undefined };
    const manifest = buildAssetManifest(def);
    expect(manifest.portraits).toEqual({});
    expect(manifest.backgrounds).toEqual({});
    expect(manifest.voices).toEqual({});
  });

  it("loads the real fixture manifests", () => {
    // emberfall ships file assets; starlight ships prompt-only placeholders.
    const ember = buildAssetManifest(emberfall);
    expect(ember.portraits.elara.file).toContain("elara.svg");
    const star = buildAssetManifest(starlight);
    expect(star.portraits["night-cat"].prompt).toBeTruthy();
    expect(star.voices["night-cat"].profile).toBeTruthy();
  });
});

describe("deriveMediaCues", () => {
  it("emits npc_speech when the resolution targets an NPC with a speech action", () => {
    const prev = makeState();
    const next = { ...prev, player: { ...prev.player } };
    const cues = deriveMediaCues(prev, next, resolution({ actionId: "talk", target: "elara" }));
    expect(cues).toContainEqual({ kind: "npc_speech", npcId: "elara" });
  });

  it("does not emit npc_speech for non-speech actions", () => {
    const prev = makeState();
    const next = { ...prev, player: { ...prev.player } };
    const cues = deriveMediaCues(prev, next, resolution({ actionId: "attack", target: "elara" }));
    expect(cues.some((c) => c.kind === "npc_speech")).toBe(false);
  });

  it("emits location_enter when the player moves", () => {
    const prev = makeState();
    const next = { ...prev, player: { ...prev.player, locationId: "mine-entrance" } };
    const cues = deriveMediaCues(prev, next);
    expect(cues).toContainEqual({ kind: "location_enter", locationId: "mine-entrance" });
  });

  it("does not emit location_enter when the player stays", () => {
    const prev = makeState();
    const next = { ...prev, player: { ...prev.player } };
    const cues = deriveMediaCues(prev, next);
    expect(cues.some((c) => c.kind === "location_enter")).toBe(false);
  });

  it("emits event cues for newly played events (playedEventIds diff)", () => {
    const prev = makeState();
    const next = { ...prev, playedEventIds: [...prev.playedEventIds, "mine-collapse"] };
    const cues = deriveMediaCues(prev, next);
    expect(cues).toContainEqual({ kind: "event", eventId: "mine-collapse" });
  });

  it("combines multiple cue kinds in one turn", () => {
    const prev = makeState();
    const next = {
      ...prev,
      player: { ...prev.player, locationId: "mine-entrance" },
      playedEventIds: [...prev.playedEventIds, "mine-fire"],
    };
    const cues = deriveMediaCues(prev, next, resolution({ actionId: "talk", target: "elara" }));
    expect(cues).toHaveLength(3);
    expect(cues.some((c) => c.kind === "npc_speech")).toBe(true);
    expect(cues.some((c) => c.kind === "location_enter")).toBe(true);
    expect(cues.some((c) => c.kind === "event")).toBe(true);
  });
});

describe("appendTranscript", () => {
  it("appends player/world entries with turn numbers and cues", () => {
    let state = makeState();
    const cues: MediaCue[] = [{ kind: "event", eventId: "mine-collapse" }];
    state = appendTranscript(state, "player", "你好", []);
    state = appendTranscript(state, "world", "回应", cues);
    expect(state.transcript).toHaveLength(2);
    expect(state.transcript[0]).toMatchObject({ turn: 1, role: "player", text: "你好" });
    expect(state.transcript[1]).toMatchObject({ turn: 2, role: "world", text: "回应" });
    expect(state.transcript[1].mediaCues).toEqual(cues);
    expect(makeState().transcript).toEqual([]); // original untouched
  });
});
