"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { AssetManifest, Catalog, ThemeView, WorldState } from "../../lib/api";
import { exitFullscreen, isFullscreen, subscribeFullscreen } from "../../lib/fullscreen";
import type { PauseMenuSlotProps } from "../../lib/script-registry";
import { Dialog } from "../dialog";
import { SlotRenderer } from "./slots";
import type { ThemeMode } from "./state";

export interface PauseMenuProps {
  scriptId?: string;
  state?: WorldState;
  catalog?: Catalog;
  assets?: AssetManifest;
  themeMode: ThemeMode;
  themes: ThemeView[];
  audioEnabled: boolean;
  dirty: boolean;
  busy: boolean;
  onTheme: (mode: ThemeMode) => void;
  onAudio: (on: boolean) => void;
  onSave: () => Promise<void>;
  onExit: (saveFirst: boolean) => Promise<void>;
  onClose: () => void;
}

function DefaultPauseMenu({
  themeMode,
  themes,
  audioEnabled,
  isFullscreen: fullscreen,
  dirty,
  busy,
  setTheme,
  setAudio,
  exitFullscreen: leaveFullscreen,
  save,
  exit,
  close,
}: PauseMenuSlotProps) {
  return (
    <div className="cg-form-stack">
        <label htmlFor="pause-theme">主题</label>
        <select id="pause-theme" value={themeMode} onChange={(event) => setTheme(event.target.value)}>
          <option value="follow">跟随剧本</option>
          {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
        </select>
        <div className="cg-switch">
          <span><strong>声音</strong><small>环境音、语音与事件音效</small></span>
          <button type="button" className="cg-button cg-button--secondary" aria-pressed={audioEnabled} onClick={() => setAudio(!audioEnabled)}>
            {audioEnabled ? "开" : "关"}
          </button>
        </div>
        <div className="cg-dialog-actions">
          {fullscreen ? (
            <button type="button" className="cg-button cg-button--secondary" onClick={() => void leaveFullscreen()}>
              退出全屏
            </button>
          ) : null}
          <button type="button" className="cg-button cg-button--secondary" disabled={busy} onClick={() => void save().then(close)}>
            {busy ? "正在保存……" : dirty ? "保存当前进度" : "再次保存"}
          </button>
          <button type="button" className="cg-button cg-button--quiet" disabled={busy} onClick={() => void exit(false)}>
            不保存返回
          </button>
          <button type="button" className="cg-button cg-button--primary" disabled={busy} onClick={() => void exit(true)}>
            保存并返回
          </button>
        </div>
        <Link href="/settings" className="cg-text-link">打开全局设置</Link>
    </div>
  );
}

export function PauseMenu(props: PauseMenuProps) {
  const fullscreen = useSyncExternalStore(subscribeFullscreen, isFullscreen, () => false);
  const slotProps: PauseMenuSlotProps = {
    scriptId: props.scriptId ?? "",
    state: props.state ?? emptyState,
    catalog: props.catalog ?? emptyCatalog,
    assets: props.assets ?? emptyAssets,
    busy: props.busy,
    dirty: props.dirty,
    themeMode: props.themeMode,
    themes: props.themes,
    audioEnabled: props.audioEnabled,
    isFullscreen: fullscreen,
    setTheme: props.onTheme,
    setAudio: props.onAudio,
    exitFullscreen: async () => { await exitFullscreen(); },
    save: props.onSave,
    exit: props.onExit,
    close: props.onClose,
  };
  return (
    <Dialog title="暂停菜单" description="世界已停在当前回合。" onClose={props.onClose}>
      <SlotRenderer slot="pause-menu" fallback={DefaultPauseMenu} slotProps={slotProps} />
    </Dialog>
  );
}

const emptyAssets: AssetManifest = {
  portraits: {}, backgrounds: {}, icons: {}, sprites: {}, voices: {}, ambient: {}, effects: {}, ui: {},
};
const emptyCatalog = {
  locations: [], items: [], npcs: [], events: [], actions: [], stats: [], skills: [], needs: [], factions: [], statusEffects: [], tasks: [], origins: [],
  currency: { name: "", symbol: "" }, hpStat: "hp",
} as Catalog;
const emptyState = {
  scriptId: "", clock: { totalHours: 0, day: 1, month: 1, year: 1, hour: 0, weekday: 0, weather: "", season: "" },
  player: { originId: "", name: "", stats: {}, skills: {}, needs: {}, inventory: { stacks: [], currency: 0 }, locationId: "", flags: [], threatGauge: 0, statuses: [], memories: [], relations: [], reputation: [] },
  npcs: {}, flags: [], facts: [], eventLog: [], commitments: [], tasks: [], playedEventIds: [], secretHolders: {}, locationInventories: {}, transcript: [], runtimeState: {},
} as WorldState;
