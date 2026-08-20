export const SETTINGS_STORAGE_KEY = "chatgame:settings:v1";

export interface PlayerSettingsV1 {
  version: 1;
  audioEnabled: boolean;
  themeMode: "follow" | string;
  textScale: 1 | 1.25 | 1.5 | 2;
  contrast: "system" | "more";
  motion: "system" | "reduce";
  lastRun: { scriptId: string; runId: string } | null;
}

export const defaultPlayerSettings: PlayerSettingsV1 = {
  version: 1,
  audioEnabled: false,
  themeMode: "follow",
  textScale: 1,
  contrast: "system",
  motion: "system",
  lastRun: null,
};

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readPlayerSettings(): PlayerSettingsV1 {
  const store = storage();
  if (!store) return defaultPlayerSettings;
  try {
    const parsed = JSON.parse(store.getItem(SETTINGS_STORAGE_KEY) ?? "null") as Partial<PlayerSettingsV1> | null;
    if (!parsed || parsed.version !== 1) return defaultPlayerSettings;
    const textScale = [1, 1.25, 1.5, 2].includes(parsed.textScale ?? 0)
      ? parsed.textScale as PlayerSettingsV1["textScale"]
      : 1;
    const lastRun = parsed.lastRun && typeof parsed.lastRun.scriptId === "string" && typeof parsed.lastRun.runId === "string"
      ? parsed.lastRun
      : null;
    return {
      version: 1,
      audioEnabled: parsed.audioEnabled === true,
      themeMode: typeof parsed.themeMode === "string" ? parsed.themeMode : "follow",
      textScale,
      contrast: parsed.contrast === "more" ? "more" : "system",
      motion: parsed.motion === "reduce" ? "reduce" : "system",
      lastRun,
    };
  } catch {
    return defaultPlayerSettings;
  }
}

export function writePlayerSettings(next: PlayerSettingsV1): void {
  try {
    storage()?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Settings are best-effort when storage is disabled or full.
  }
}

export function patchPlayerSettings(patch: Partial<Omit<PlayerSettingsV1, "version">>): PlayerSettingsV1 {
  const next = { ...readPlayerSettings(), ...patch, version: 1 as const };
  writePlayerSettings(next);
  return next;
}

export function applyPreferenceAttributes(settings: PlayerSettingsV1, target?: HTMLElement): void {
  const root = target ?? (typeof document === "undefined" ? undefined : document.documentElement);
  if (!root) return;
  root.dataset.cgContrast = settings.contrast;
  root.dataset.cgMotionPreference = settings.motion;
  root.style.setProperty("--cg-player-scale", String(settings.textScale));
}
