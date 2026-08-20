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
import { loadCoreTestDefinition } from "./core-test-fixture";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const coreDefinition = loadCoreTestDefinition();

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  const { state } = generateWorld(coreDefinition, "observer", { seed: 42 });
  return { ...state, ...overrides };
}

function resolution(overrides: Partial<ResolutionLogEntry> = {}): ResolutionLogEntry {
  return {
    actionId: "talk",
    target: "operator",
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
    const def = { ...coreDefinition, themes: new Map() };
    const theme = resolveTheme(def, makeState());
    expect(theme.id).toBe(FRAMEWORK_DARK_THEME.id);
    expect(theme.palette.background).toMatch(/^#/);
  });

  it("returns the script default theme when present and no by_location matches", () => {
    const theme = resolveTheme(coreDefinition, makeState());
    expect(theme.id).toBe("default");
    expect(theme.palette.background).toBe("#0d1113");
  });

  it("remaps by_location theme id references", () => {
    const corridorTheme = { ...FRAMEWORK_DARK_THEME, id: "corridor", name: "维护走廊" };
    const def = {
      ...coreDefinition,
      themes: new Map([
        ["default", { ...FRAMEWORK_DARK_THEME, id: "default", by_location: { "service-corridor": "corridor" } }],
        ["corridor", corridorTheme],
      ]),
    };
    const theme = resolveTheme(def, makeState({ player: { ...makeState().player, locationId: "service-corridor" } }));
    expect(theme.name).toBe("维护走廊");
  });

  it("applies inline palette overrides", () => {
    const def = {
      ...coreDefinition,
      themes: new Map([
        ["default", { ...FRAMEWORK_DARK_THEME, id: "default", by_location: { "service-corridor": { background: "#ff0000" } } }],
      ]),
    };
    const theme = resolveTheme(def, makeState({ player: { ...makeState().player, locationId: "service-corridor" } }));
    expect(theme.palette.background).toBe("#ff0000");
    expect(theme.palette.surface).toBe(FRAMEWORK_DARK_THEME.palette.surface); // other fields kept
  });

  it("listSelectableThemes includes script themes + framework built-ins", () => {
    const def = { ...coreDefinition, themes: new Map([["default", FRAMEWORK_DARK_THEME]]) };
    const themes = listSelectableThemes(def);
    expect(themes.length).toBeGreaterThanOrEqual(3); // script default + dark + light
    expect(themes.map((t) => t.id)).toContain("framework-dark");
    expect(themes.map((t) => t.id)).toContain("framework-light");
  });
});

describe("buildAssetManifest", () => {
  it("returns empty sections for scripts without assets.yaml", () => {
    const def = { ...coreDefinition, assets: undefined };
    const manifest = buildAssetManifest(def);
    expect(manifest.portraits).toEqual({});
    expect(manifest.backgrounds).toEqual({});
    expect(manifest.voices).toEqual({});
  });

});

describe("Built-in asset content regression", () => {
  it("loads the real built-in asset manifests", () => {
    const emberfall = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
    const starlight = loadScript(path.join(REPO_ROOT, "scripts/starlight"));
    const ember = buildAssetManifest(emberfall);
    expect(ember.cover?.file).toBe("assets/backgrounds/emberfall-cover.png");
    expect(ember.portraits["han-zhi"].file).toBe("assets/portraits/han-zhi.png");
    const star = buildAssetManifest(starlight);
    expect(star.cover?.file).toBe("assets/backgrounds/shift-console-cover.webp");
    expect(star.backgrounds["reactor-level"].file).toBe("assets/backgrounds/maintenance-spine.webp");
    expect(star.effects["scrubber-p07-alert"].file).toBe("assets/audio/p07-alert.ogg");
    expect(star.portraits["night-cat"].prompt).toBeTruthy();
    expect(star.portraits["night-cat"].file).toBeUndefined();
    // Voices stay prompt/profile placeholders (no TTS files shipped).
    expect(star.voices["night-cat"].profile).toBeTruthy();
  });
});

describe("deriveMediaCues", () => {
  it("emits npc_speech when the resolution targets an NPC with a speech action", () => {
    const prev = makeState();
    const next = { ...prev, player: { ...prev.player } };
    const cues = deriveMediaCues(prev, next, resolution({ actionId: "talk", target: "operator" }));
    expect(cues).toContainEqual({ kind: "npc_speech", npcId: "operator" });
  });

  it("does not emit npc_speech for non-speech actions", () => {
    const prev = makeState();
    const next = { ...prev, player: { ...prev.player } };
    const cues = deriveMediaCues(prev, next, resolution({ actionId: "investigate", target: "operator" }));
    expect(cues.some((c) => c.kind === "npc_speech")).toBe(false);
  });

  it("emits location_enter when the player moves", () => {
    const prev = makeState();
    const next = { ...prev, player: { ...prev.player, locationId: "service-corridor" } };
    const cues = deriveMediaCues(prev, next);
    expect(cues).toContainEqual({ kind: "location_enter", locationId: "service-corridor" });
  });

  it("does not emit location_enter when the player stays", () => {
    const prev = makeState();
    const next = { ...prev, player: { ...prev.player } };
    const cues = deriveMediaCues(prev, next);
    expect(cues.some((c) => c.kind === "location_enter")).toBe(false);
  });

  it("emits event cues for newly played events (playedEventIds diff)", () => {
    const prev = makeState();
    const next = { ...prev, playedEventIds: [...prev.playedEventIds, "handoff-signal"] };
    const cues = deriveMediaCues(prev, next);
    expect(cues).toContainEqual({ kind: "event", eventId: "handoff-signal" });
  });

  it("combines multiple cue kinds in one turn", () => {
    const prev = makeState();
    const next = {
      ...prev,
      player: { ...prev.player, locationId: "service-corridor" },
      playedEventIds: [...prev.playedEventIds, "handoff-signal"],
    };
    const cues = deriveMediaCues(prev, next, resolution({ actionId: "talk", target: "operator" }));
    expect(cues).toHaveLength(3);
    expect(cues.some((c) => c.kind === "npc_speech")).toBe(true);
    expect(cues.some((c) => c.kind === "location_enter")).toBe(true);
    expect(cues.some((c) => c.kind === "event")).toBe(true);
  });
});

describe("appendTranscript", () => {
  it("appends player/world entries with turn numbers and cues", () => {
    let state = makeState();
    const cues: MediaCue[] = [{ kind: "event", eventId: "handoff-signal" }];
    state = appendTranscript(state, "player", "你好", []);
    state = appendTranscript(state, "world", "回应", cues);
    expect(state.transcript).toHaveLength(2);
    expect(state.transcript[0]).toMatchObject({ turn: 1, role: "player", text: "你好" });
    expect(state.transcript[1]).toMatchObject({ turn: 2, role: "world", text: "回应" });
    expect(state.transcript[1].mediaCues).toEqual(cues);
    expect(makeState().transcript).toEqual([]); // original untouched
  });
});
