"use client";

import { useTheme } from "next-themes";
import { useMemo, useSyncExternalStore } from "react";
import {
  parsePreferences,
  preferencesSnapshot,
  resetControlPosition,
  serverPreferencesSnapshot,
  subscribePreferences,
  writePreferences,
} from "../_lib/browser-state";
import { normalizeThemePreference, themePreferences } from "../_lib/theme-preference";

export function SettingsPanel() {
  const { setTheme, theme } = useTheme();
  const themeReady = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const serialized = useSyncExternalStore(
    subscribePreferences,
    preferencesSnapshot,
    serverPreferencesSnapshot,
  );
  const preferences = useMemo(() => parsePreferences(serialized), [serialized]);
  const selectedTheme = normalizeThemePreference(theme);

  return (
    <div className="cg-settings">
      <fieldset>
        <legend>外观</legend>
        <p>跟随系统，或固定使用浅色或深色外观。</p>
        <div className="cg-segmented">
          {themePreferences.map((value) => (
            <button
              aria-pressed={themeReady && selectedTheme === value}
              disabled={!themeReady}
              key={value}
              onClick={() => setTheme(value)}
              type="button"
            >
              {{ system: "跟随系统", light: "浅色", dark: "深色" }[value]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>文字大小</legend>
        <p>改变叙事和界面的整体比例。</p>
        <div className="cg-segmented">
          {(["compact", "standard", "large"] as const).map((scale) => (
            <button aria-pressed={preferences.fontScale === scale} key={scale} onClick={() => writePreferences({ ...preferences, fontScale: scale })} type="button">
              {{ compact: "紧凑", standard: "标准", large: "大字" }[scale]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="cg-setting-row">
        <span><strong>减少动态效果</strong><small>关闭不必要的位移和过渡。</small></span>
        <input checked={preferences.reduceMotion} onChange={(event) => writePreferences({ ...preferences, reduceMotion: event.target.checked })} type="checkbox" />
      </label>
      <div className="cg-setting-row">
        <span><strong>重置控制球位置</strong><small>恢复到页面右侧的默认位置。</small></span>
        <button className="cg-button--quiet" onClick={resetControlPosition} type="button">重置位置</button>
      </div>
    </div>
  );
}
