"use client";

import { useTheme } from "next-themes";
import { useMemo, useSyncExternalStore } from "react";
import {
  parsePreferences,
  preferencesSnapshot,
  serverPreferencesSnapshot,
  subscribePreferences,
  writePreferences,
} from "../_lib/browser-state";
import { normalizeThemePreference, themePreferences } from "../_lib/theme-preference";
import { ModelRegistrySettings } from "./model-registry-settings";

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
      <div className="cg-setting-row">
        <span><strong>减少动态效果</strong><small>关闭不必要的位移和过渡。</small></span>
        <div className="cg-setting-row__control">
          <button
            aria-checked={preferences.reduceMotion}
            aria-label="减少动态效果"
            className="cg-switch"
            onClick={() => writePreferences({ ...preferences, reduceMotion: !preferences.reduceMotion })}
            role="switch"
            type="button"
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </div>
      <ModelRegistrySettings />
      <section aria-labelledby="settings-developer-title" className="cg-settings__group cg-settings__developer">
        <header>
          <h3 id="settings-developer-title">开发者工具</h3>
          <p>这些工具会揭示玩家通常无法知道的世界信息。</p>
        </header>
        <div className="cg-setting-row">
          <span>
            <strong>显示世界调试器</strong>
            <small>在世界实例页面显示“世界演化”入口。调试器会暴露客观真相、隐藏检定和所有角色认知。</small>
          </span>
          <div className="cg-setting-row__control">
            <button
              aria-checked={preferences.showWorldInspector}
              aria-label="显示世界调试器"
              className="cg-switch"
              onClick={() => writePreferences({
                ...preferences,
                showWorldInspector: !preferences.showWorldInspector,
              })}
              role="switch"
              type="button"
            >
              <span aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="cg-setting-row">
          <span>
            <strong>高级角色控制</strong>
            <small>显示离开当前角色、切换视角和接管其他 Agent 的入口。</small>
          </span>
          <div className="cg-setting-row__control">
            <button
              aria-checked={preferences.advancedRoleControl}
              aria-label="高级角色控制"
              className="cg-switch"
              onClick={() => writePreferences({
                ...preferences,
                advancedRoleControl: !preferences.advancedRoleControl,
              })}
              role="switch"
              type="button"
            >
              <span aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
