// Presentation layer: themes, asset manifest and media cues.
// The engine resolves the active theme (default + by_location remaps) and
// derives deterministic media cues from state transitions — the LLM never
// decides media (extension of the "LLM 管叙事" boundary).
import type { WorldDefinition, WorldState, MediaCue, ResolutionLogEntry } from "./types";
import type { Theme, PaletteOverride, EffectsOverride, TypographyOverride } from "../script/schemas/theme";
import type { AssetsManifest } from "../script/schemas/assets";

/** Flat theme view for the frontend (no by_location; the single server DTO shape). */
export type ThemeView = Omit<Theme, "by_location">;

/** Maps a full Theme to its flat frontend view (single mapping function). */
export function toThemeView(theme: Theme): ThemeView {
  return {
    id: theme.id,
    name: theme.name,
    palette: theme.palette,
    typography: theme.typography,
    effects: theme.effects,
  };
}

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
    on_primary: "#0b111b",
    accent: "#9ecbff",
    text: "#e6e9ef",
    text_dim: "#9aa3b2",
    border: "#2a2f3a",
    focus: "#8ec9ba",
    success: "#82b99e",
    warning: "#e3b55e",
    danger: "#df7866",
    selected: "#283246",
  },
  typography: { font: "sans", scale: 1.0, line_height: 1.6, letter_spacing_em: 0, faces: [], roles: {} },
  effects: {
    bubble_radius: 14,
    chrome_radius: 12,
    glass: 0.65,
    blur_px: 8,
    shadow: "medium",
    border_width_px: 1,
    density: "cozy",
    motion: "subtle",
    scene_tint: "#000000",
    overlay_strength: 0.45,
  },
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
    on_primary: "#ffffff",
    accent: "#4a8f6c",
    text: "#22262b",
    text_dim: "#6a7280",
    border: "#d8d4c9",
    focus: "#176a58",
    success: "#2f7757",
    warning: "#8a5a00",
    danger: "#a63f32",
    selected: "#dce9e1",
  },
  typography: { font: "sans", scale: 1.0, line_height: 1.6, letter_spacing_em: 0, faces: [], roles: {} },
  effects: {
    bubble_radius: 14,
    chrome_radius: 12,
    glass: 0.8,
    blur_px: 8,
    shadow: "medium",
    border_width_px: 1,
    density: "cozy",
    motion: "subtle",
    scene_tint: "#ffffff",
    overlay_strength: 0.45,
  },
  by_location: {},
};

/** Merges an inline palette override onto a base palette. */
function applyPaletteOverride(
  palette: Theme["palette"],
  override: PaletteOverride,
): Theme["palette"] {
  return { ...palette, ...override };
}

/** Merges an inline effects override onto a base effects object. */
function applyEffectsOverride(
  effects: Theme["effects"],
  override: EffectsOverride,
): Theme["effects"] {
  return { ...effects, ...override };
}

/** Merges an inline typography override onto a base typography object. */
function applyTypographyOverride(
  typography: Theme["typography"],
  override: TypographyOverride,
): Theme["typography"] {
  return {
    ...typography,
    ...(override.scale !== undefined ? { scale: override.scale } : {}),
    ...(override.line_height !== undefined ? { line_height: override.line_height } : {}),
    ...(override.letter_spacing_em !== undefined ? { letter_spacing_em: override.letter_spacing_em } : {}),
    roles: { ...typography.roles, ...override.roles },
  };
}

/**
 * Resolves the active theme for a player location: the script default theme
 * (or the framework fallback), remapped by by_location (theme id reference
 * or inline palette/effects/typography override). Always returns a complete
 * flat Theme.
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
  return {
    ...defaultTheme,
    palette: applyPaletteOverride(defaultTheme.palette, remap),
    effects: remap.effects ? applyEffectsOverride(defaultTheme.effects, remap.effects) : defaultTheme.effects,
    typography: remap.typography ? applyTypographyOverride(defaultTheme.typography, remap.typography) : defaultTheme.typography,
  };
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
  cover?: ResolvedAsset;
  portraits: Record<string, ResolvedAsset>;
  backgrounds: Record<string, ResolvedAsset>;
  icons: Record<string, ResolvedAsset>;
  sprites: Record<string, ResolvedAsset>;
  voices: Record<string, ResolvedAsset>;
  ambient: Record<string, ResolvedAsset>;
  effects: Record<string, ResolvedAsset>;
  illustrations: Record<string, ResolvedAsset>;
  ui: Record<string, ResolvedAsset>;
} {
  const empty = (): Record<string, ResolvedAsset> => ({});
  const out = {
    cover: undefined as ResolvedAsset | undefined,
    portraits: empty(),
    backgrounds: empty(),
    icons: empty(),
    sprites: empty(),
    voices: empty(),
    ambient: empty(),
    effects: empty(),
    illustrations: empty(),
    ui: empty(),
  };
  const manifest: AssetsManifest | undefined = definition.assets;
  if (!manifest) return out;
  if (manifest.cover) {
    out.cover = {
      file: manifest.cover.file,
      alt: manifest.cover.alt,
    };
  }
  for (const kind of ["portraits", "backgrounds", "icons", "sprites", "voices", "ambient", "effects", "illustrations", "ui"] as const) {
    const section = manifest[kind] as Record<string, ResolvedAsset> | undefined;
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
 *  - item_reveal: the player's inventory gained an item this turn
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
  const previousItems = new Map(prev.player.inventory.stacks.map((stack) => [stack.itemId, stack.quantity]));
  for (const stack of next.player.inventory.stacks) {
    const gained = stack.quantity - (previousItems.get(stack.itemId) ?? 0);
    if (gained > 0) cues.push({ kind: "item_reveal", itemId: stack.itemId, quantity: gained });
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
