import {
  defaultControlPosition,
  parseControlPosition,
  type ControlPosition,
} from "./control-orb-position";

export const CONTROL_POSITION_KEY = "livingworld:control-position:v2";
export const PREFERENCES_KEY = "livingworld:preferences:v2";
export const PREFERENCES_EVENT = "livingworld:preferences-changed";

export type FontScale = "compact" | "standard" | "large";

export interface PlayerPreferences {
  fontScale: FontScale;
  reduceMotion: boolean;
  showWorldInspector: boolean;
}

export const defaultPreferences: PlayerPreferences = {
  fontScale: "standard",
  reduceMotion: false,
  showWorldInspector: false,
};

export function parsePreferences(serialized: string): PlayerPreferences {
  try {
    const value = JSON.parse(serialized || "null") as Partial<PlayerPreferences> | null;
    const fontScale = value?.fontScale;
    return {
      fontScale: fontScale === "compact" || fontScale === "large" ? fontScale : "standard",
      reduceMotion: value?.reduceMotion === true,
      showWorldInspector: value?.showWorldInspector === true,
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

export function readControlPosition(): ControlPosition {
  return parseControlPosition(localStorage.getItem(CONTROL_POSITION_KEY));
}

export function writeControlPosition(position: ControlPosition): void {
  localStorage.setItem(CONTROL_POSITION_KEY, JSON.stringify(position));
}

export function resetControlPosition(): void {
  localStorage.removeItem(CONTROL_POSITION_KEY);
  writeControlPosition(defaultControlPosition);
}
