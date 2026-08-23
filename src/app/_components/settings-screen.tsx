"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  CONTROL_CORNER_KEY,
  parsePreferences,
  preferencesSnapshot,
  serverPreferencesSnapshot,
  subscribePreferences,
  writePreferences,
} from "../_lib/browser-state";
import { ManagementShell } from "./management-shell";

export function SettingsScreen() {
  const serialized = useSyncExternalStore(
    subscribePreferences,
    preferencesSnapshot,
    serverPreferencesSnapshot,
  );
  const preferences = useMemo(() => parsePreferences(serialized), [serialized]);

  return (
    <ManagementShell eyebrow="LOCAL PREFERENCES" title="设置" description="只调整这台设备上的阅读体验。设置不会离开浏览器。">
      <div className="cg-settings">
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
          <span><strong>重置控制球位置</strong><small>下次进入游戏时恢复到右下角。</small></span>
          <button className="cg-button--quiet" onClick={() => localStorage.removeItem(CONTROL_CORNER_KEY)} type="button">重置</button>
        </div>
      </div>
    </ManagementShell>
  );
}
