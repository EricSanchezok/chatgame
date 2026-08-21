import type { PlayerUiSettings } from "../../shared/ui-api";

export const SETTINGS_STORAGE_KEY = "chatgame:settings:v3";

export type PlayerSettingsV3 = PlayerUiSettings;

export const defaultPlayerSettings: PlayerSettingsV3 = {
  version: 3,
  audioEnabled: false,
  masterVolume: 80,
  ambientVolume: 65,
  voiceVolume: 85,
  effectsVolume: 75,
  fullscreenOnStart: true,
  themeMode: "follow",
  textScale: 1,
  contrast: "system",
  motion: "system",
  activeScriptId: null,
  lastRun: null,
  trackedTasks: {},
};

let snapshot = defaultPlayerSettings;
let hydrated = false;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseSettings(raw: string | null): PlayerSettingsV3 {
  try {
    const parsed = JSON.parse(raw ?? "null") as Partial<PlayerSettingsV3> | null;
    if (!parsed || parsed.version !== 3) return defaultPlayerSettings;
    const textScale = [1, 1.25, 1.5, 2].includes(parsed.textScale ?? 0)
      ? parsed.textScale as PlayerSettingsV3["textScale"]
      : 1;
    const lastRun = parsed.lastRun && typeof parsed.lastRun.scriptId === "string" && typeof parsed.lastRun.runId === "string"
      ? parsed.lastRun
      : null;
    return {
      version: 3,
      audioEnabled: parsed.audioEnabled === true,
      masterVolume: volume(parsed.masterVolume, 80),
      ambientVolume: volume(parsed.ambientVolume, 65),
      voiceVolume: volume(parsed.voiceVolume, 85),
      effectsVolume: volume(parsed.effectsVolume, 75),
      fullscreenOnStart: parsed.fullscreenOnStart !== false,
      themeMode: typeof parsed.themeMode === "string" ? parsed.themeMode : "follow",
      textScale,
      contrast: parsed.contrast === "more" ? "more" : "system",
      motion: parsed.motion === "reduce" ? "reduce" : "system",
      activeScriptId: typeof parsed.activeScriptId === "string" ? parsed.activeScriptId : null,
      lastRun,
      trackedTasks: Object.fromEntries(Object.entries(parsed.trackedTasks ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string",
      )),
    };
  } catch {
    return defaultPlayerSettings;
  }
}

function volume(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;
}

function publish(next: PlayerSettingsV3): PlayerSettingsV3 {
  snapshot = next;
  for (const listener of listeners) listener();
  return next;
}

export function hydratePlayerSettings(): PlayerSettingsV3 {
  if (!hydrated) {
    hydrated = true;
    publish(parseSettings(storage()?.getItem(SETTINGS_STORAGE_KEY) ?? null));
  }
  return snapshot;
}

export function readPlayerSettings(): PlayerSettingsV3 {
  return typeof window === "undefined" ? defaultPlayerSettings : hydratePlayerSettings();
}

export function getPlayerSettingsSnapshot(): PlayerSettingsV3 {
  return snapshot;
}

export function getServerPlayerSettingsSnapshot(): PlayerSettingsV3 {
  return defaultPlayerSettings;
}

export function subscribePlayerSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function writePlayerSettings(next: PlayerSettingsV3): void {
  try {
    storage()?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Settings remain usable in memory when storage is disabled or full.
  }
  publish(next);
}

export function patchPlayerSettings(
  patch: Partial<Omit<PlayerSettingsV3, "version">>,
): PlayerSettingsV3 {
  const next = { ...readPlayerSettings(), ...patch, version: 3 as const };
  writePlayerSettings(next);
  return next;
}

export function applyPreferenceAttributes(settings: PlayerSettingsV3, target?: HTMLElement): void {
  const root = target ?? (typeof document === "undefined" ? undefined : document.documentElement);
  if (!root) return;
  root.dataset.cgContrast = settings.contrast;
  root.dataset.cgMotionPreference = settings.motion;
  root.style.setProperty("--cg-player-scale", String(settings.textScale));
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== SETTINGS_STORAGE_KEY) return;
    hydrated = true;
    publish(parseSettings(event.newValue));
  });
}
