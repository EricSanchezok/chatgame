export const WORLD_INSPECTOR_LAYOUT_KEY = "livingworld:inspector-layout:v2";
export const WORLD_INSPECTOR_ACTOR_MIN = 176;
export const WORLD_INSPECTOR_ACTOR_MAX = 360;
export const WORLD_INSPECTOR_ACTOR_DEFAULT = 216;
export const WORLD_INSPECTOR_DETAIL_MIN = 352;
export const WORLD_INSPECTOR_DETAIL_MAX = 880;
export const WORLD_INSPECTOR_DETAIL_DEFAULT = 480;

export type WorldInspectorView = "graph" | "timeline";

export interface WorldInspectorLayoutPreferences {
  view: WorldInspectorView;
  actorWidth: number;
  detailWidth: number;
}

export const defaultWorldInspectorLayout: WorldInspectorLayoutPreferences = {
  view: "graph",
  actorWidth: WORLD_INSPECTOR_ACTOR_DEFAULT,
  detailWidth: WORLD_INSPECTOR_DETAIL_DEFAULT,
};

export function clampWorldInspectorActorWidth(value: number): number {
  return Math.min(WORLD_INSPECTOR_ACTOR_MAX, Math.max(WORLD_INSPECTOR_ACTOR_MIN, Math.round(value)));
}

export function clampWorldInspectorDetailWidth(value: number): number {
  return Math.min(WORLD_INSPECTOR_DETAIL_MAX, Math.max(WORLD_INSPECTOR_DETAIL_MIN, Math.round(value)));
}

export function resizeWorldInspectorPanelWidth(
  current: number,
  key: "ArrowLeft" | "ArrowRight" | "End" | "Home",
  panel: "actors" | "detail",
  options: { rtl?: boolean; shift?: boolean } = {},
): number {
  const clamp = panel === "actors" ? clampWorldInspectorActorWidth : clampWorldInspectorDetailWidth;
  const minimum = panel === "actors" ? WORLD_INSPECTOR_ACTOR_MIN : WORLD_INSPECTOR_DETAIL_MIN;
  const maximum = panel === "actors" ? WORLD_INSPECTOR_ACTOR_MAX : WORLD_INSPECTOR_DETAIL_MAX;
  if (key === "Home") return minimum;
  if (key === "End") return maximum;
  const delta = options.shift ? 48 : 16;
  const inlineDirection = (key === "ArrowRight" ? 1 : -1) * (options.rtl ? -1 : 1);
  return clamp(current + inlineDirection * delta * (panel === "actors" ? 1 : -1));
}

export function parseWorldInspectorLayout(serialized: string): WorldInspectorLayoutPreferences {
  try {
    const value = JSON.parse(serialized || "null") as Partial<WorldInspectorLayoutPreferences> | null;
    return {
      view: value?.view === "timeline" ? "timeline" : "graph",
      actorWidth: typeof value?.actorWidth === "number" && Number.isFinite(value.actorWidth)
        ? clampWorldInspectorActorWidth(value.actorWidth)
        : WORLD_INSPECTOR_ACTOR_DEFAULT,
      detailWidth: typeof value?.detailWidth === "number" && Number.isFinite(value.detailWidth)
        ? clampWorldInspectorDetailWidth(value.detailWidth)
        : WORLD_INSPECTOR_DETAIL_DEFAULT,
    };
  } catch {
    return defaultWorldInspectorLayout;
  }
}

export function readWorldInspectorLayout(): WorldInspectorLayoutPreferences {
  return parseWorldInspectorLayout(localStorage.getItem(WORLD_INSPECTOR_LAYOUT_KEY) ?? "");
}

export function writeWorldInspectorLayout(preferences: WorldInspectorLayoutPreferences): void {
  localStorage.setItem(WORLD_INSPECTOR_LAYOUT_KEY, JSON.stringify({
    view: preferences.view,
    actorWidth: clampWorldInspectorActorWidth(preferences.actorWidth),
    detailWidth: clampWorldInspectorDetailWidth(preferences.detailWidth),
  }));
}
