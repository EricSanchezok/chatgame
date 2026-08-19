// Presentation layer: themes, asset manifest and media cues.
// The engine resolves the active theme (default + by_location remaps) and
// derives deterministic media cues from state transitions — the LLM never
// decides media (extension of the "LLM 管叙事" boundary).
import type { WorldDefinition, WorldState, MediaCue, ResolutionLogEntry } from "./types";
import type { Theme, PaletteOverride } from "../script/schemas/theme";
import type { AssetsManifest } from "../script/schemas/assets";

// ---------------------------------------------------------------------------
// Theme resolution
// ---------------------------------------------------------------------------

/** Built-in fallback theme used when a script ships no theme.yaml. */
export const FRAMEWORK_DARK_THEME: Theme = {
  id: "framework-dark",
  name: "框架暗色",
  palette: {
    background: "#0f1115",
    surface: "#171a21",
    surface_alt: "#1e222b",
    primary: "#6ea8fe",
    accent: "#9ecbff",
    text: "#e6e9ef",
    text_dim: "#9aa3b2",
    border: "#2a2f3a",
  },
  typography: { font: "sans", scale: 1.0 },
  effects: { bubble_radius: 14, glass: 0.65, motion: "subtle", scene_tint: "#000000" },
  by_location: {},
};

export const FRAMEWORK_LIGHT_THEME: Theme = {
  id: "framework-light",
  name: "框架亮色",
  palette: {
    background: "#f5f4f0",
    surface: "#ffffff",
    surface_alt: "#ece9e2",
    primary: "#2f6f4f",
    accent: "#4a8f6c",
    text: "#22262b",
    text_dim: "#6a7280",
    border: "#d8d4c9",
  },
  typography: { font: "sans", scale: 1.0 },
  effects: { bubble_radius: 14, glass: 0.8, motion: "subtle", scene_tint: "#ffffff" },
  by_location: {},
};

/** Merges an inline palette override onto a base palette. */
function applyPaletteOverride(
  palette: Theme["palette"],
  override: PaletteOverride,
): Theme["palette"] {
  return { ...palette, ...override };
}

/**
 * Resolves the active theme for a player location: the script default theme
 * (or the framework fallback), remapped by by_location (theme id reference
 * or inline palette override). Always returns a complete flat Theme.
 */
export function resolveTheme(
  definition: WorldDefinition,
  state: WorldState,
): Theme {
  const defaultTheme = definition.themes.get("default") ?? FRAMEWORK_DARK_THEME;
  const locationId = state.player.locationId;
  const remap = defaultTheme.by_location[locationId];
  if (remap === undefined) return defaultTheme;
  if (typeof remap === "string") {
    const target = definition.themes.get(remap);
    if (target) return target;
    return defaultTheme; // unknown id (should be caught by validation) — degrade
  }
  return { ...defaultTheme, palette: applyPaletteOverride(defaultTheme.palette, remap) };
}

/** All selectable themes for a script: default + extras + framework built-ins. */
export function listSelectableThemes(definition: WorldDefinition): Theme[] {
  return [
    ...definition.themes.values(),
    FRAMEWORK_DARK_THEME,
    FRAMEWORK_LIGHT_THEME,
  ];
}

// ---------------------------------------------------------------------------
// Asset manifest helpers
// ---------------------------------------------------------------------------

export interface ResolvedAsset {
  /** Available file path relative to the script dir (when the file exists). */
  file?: string;
  /** Image/TTS prompt placeholder (when no file). */
  prompt?: string;
  alt?: string;
  profile?: string;
}

/** Classifies manifest entries into available files vs prompt placeholders. */
export function buildAssetManifest(definition: WorldDefinition): {
  portraits: Record<string, ResolvedAsset>;
  backgrounds: Record<string, ResolvedAsset>;
  icons: Record<string, ResolvedAsset>;
  sprites: Record<string, ResolvedAsset>;
  voices: Record<string, ResolvedAsset>;
  ambient: Record<string, ResolvedAsset>;
  effects: Record<string, ResolvedAsset>;
} {
  const empty = (): Record<string, ResolvedAsset> => ({});
  const out = {
    portraits: empty(),
    backgrounds: empty(),
    icons: empty(),
    sprites: empty(),
    voices: empty(),
    ambient: empty(),
    effects: empty(),
  };
  const manifest: AssetsManifest | undefined = definition.assets;
  if (!manifest) return out;
  for (const kind of Object.keys(out) as Array<keyof typeof out>) {
    const section = manifest[kind];
    if (!section) continue;
    for (const [id, entry] of Object.entries(section)) {
      out[kind][id] = {
        file: entry.file,
        prompt: entry.prompt,
        alt: entry.alt,
        profile: entry.profile,
      };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Media cues (engine-derived, deterministic)
// ---------------------------------------------------------------------------

/** Conversation-oriented action ids that imply an NPC speaking this turn. */
const SPEECH_ACTIONS = new Set([
  "talk",
  "ask",
  "persuade",
  "intimidate",
  "deceive",
  "give",
  "trade",
  "steal",
]);

/**
 * Derives deterministic media cues from a turn transition:
 *  - npc_speech: the resolution targeted an NPC with a speech-like action
 *  - location_enter: the player's location changed
 *  - event: events were newly played this turn (playedEventIds diff)
 */
export function deriveMediaCues(
  prev: WorldState,
  next: WorldState,
  resolution?: ResolutionLogEntry,
): MediaCue[] {
  const cues: MediaCue[] = [];
  if (resolution?.target && SPEECH_ACTIONS.has(resolution.actionId)) {
    cues.push({ kind: "npc_speech", npcId: resolution.target });
  }
  if (next.player.locationId !== prev.player.locationId) {
    cues.push({ kind: "location_enter", locationId: next.player.locationId });
  }
  const prevSet = new Set(prev.playedEventIds);
  for (const id of next.playedEventIds) {
    if (!prevSet.has(id)) {
      cues.push({ kind: "event", eventId: id });
    }
  }
  return cues;
}

/** Appends a transcript entry to the world state (immutable update). */
export function appendTranscript(
  state: WorldState,
  role: "player" | "world" | "system",
  text: string,
  mediaCues: MediaCue[],
): WorldState {
  const turn = state.transcript.length + 1;
  const entry = {
    id: `t-${turn}`,
    turn,
    role,
    text,
    mediaCues,
  };
  return { ...state, transcript: [...state.transcript, entry] };
}
