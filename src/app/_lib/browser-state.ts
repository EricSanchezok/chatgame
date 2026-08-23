export const CURRENT_SESSION_KEY = "livingworld:current-session";
export const CONTROL_CORNER_KEY = "livingworld:control-corner";
export const PREFERENCES_KEY = "livingworld:preferences:v1";
export const PREFERENCES_EVENT = "livingworld:preferences-changed";

export type ControlCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type FontScale = "compact" | "standard" | "large";

export interface PlayerPreferences {
  fontScale: FontScale;
  reduceMotion: boolean;
}

export const defaultPreferences: PlayerPreferences = {
  fontScale: "standard",
  reduceMotion: false,
};

export function parsePreferences(serialized: string): PlayerPreferences {
  try {
    const value = JSON.parse(serialized || "null") as Partial<PlayerPreferences> | null;
    const fontScale = value?.fontScale;
    return {
      fontScale: fontScale === "compact" || fontScale === "large" ? fontScale : "standard",
      reduceMotion: value?.reduceMotion === true,
    };
  } catch {
    return defaultPreferences;
  }
}

export function preferencesSnapshot(): string {
  return localStorage.getItem(PREFERENCES_KEY) ?? "";
}

export function serverPreferencesSnapshot(): string {
  return "";
}

export function subscribePreferences(notify: () => void): () => void {
  window.addEventListener("storage", notify);
  window.addEventListener(PREFERENCES_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(PREFERENCES_EVENT, notify);
  };
}

export function readPreferences(): PlayerPreferences {
  return parsePreferences(preferencesSnapshot());
}

export function writePreferences(preferences: PlayerPreferences): void {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT));
}

export function readControlCorner(): ControlCorner {
  const corner = localStorage.getItem(CONTROL_CORNER_KEY);
  return corner === "top-left" || corner === "top-right" || corner === "bottom-left"
    ? corner
    : "bottom-right";
}
