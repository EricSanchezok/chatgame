"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Button, Select, SettingRow, Switch } from "@/shared/ui-runtime";
import type { AssetManifest, Catalog, ThemeView, WorldState } from "../../lib/api";
import { exitFullscreen, isFullscreen, subscribeFullscreen } from "../../lib/fullscreen";
import { Dialog } from "../dialog";
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
}: {
  themeMode: string;
  themes: ThemeView[];
  audioEnabled: boolean;
  isFullscreen: boolean;
  dirty: boolean;
  busy: boolean;
  setTheme(mode: string): void;
  setAudio(enabled: boolean): void;
  exitFullscreen(): Promise<void>;
  save(): Promise<void>;
  exit(saveFirst: boolean): Promise<void>;
  close(): void;
}) {
  return (
    <div className="cg-form-stack">
        <SettingRow controlId="pause-theme" label="主题" description="固定当前主题，或继续跟随剧本。"><Select id="pause-theme" value={themeMode} onValueChange={setTheme} options={[{ value: "follow", label: "跟随剧本" }, ...themes.map((theme) => ({ value: theme.id, label: theme.name }))]} /></SettingRow>
        <SettingRow controlId="pause-audio" label="声音" description="环境音、语音与事件音效。"><Switch id="pause-audio" checked={audioEnabled} onCheckedChange={setAudio} /></SettingRow>
        <div className="cg-pause-actions">
          {fullscreen ? (
            <Button type="button" variant="quiet" className="cg-pause-actions__utility" onClick={() => void leaveFullscreen()}>
              退出全屏
            </Button>
          ) : null}
          <Button type="button" variant="quiet" className="cg-pause-actions__utility" disabled={busy} onClick={() => void save().then(close)}>
            {busy ? "正在保存……" : dirty ? "保存当前进度" : "再次保存"}
          </Button>
          <Button type="button" variant="quiet" className="cg-pause-actions__exit" disabled={busy} onClick={() => void exit(false)}>
            不保存返回
          </Button>
          <Button type="button" variant="primary" className="cg-pause-actions__exit" disabled={busy} onClick={() => void exit(true)}>
            保存并返回
          </Button>
        </div>
        <Link href="/settings" className="cg-text-link">打开全局设置</Link>
    </div>
  );
}

export function PauseMenu(props: PauseMenuProps) {
  const fullscreen = useSyncExternalStore(subscribeFullscreen, isFullscreen, () => false);
  return (
    <Dialog title="游戏菜单" description="当前世界停在这一回合。" onClose={props.onClose} className="cg-game-dialog cg-game-menu-dialog">
      <DefaultPauseMenu
        busy={props.busy}
        dirty={props.dirty}
        themeMode={props.themeMode}
        themes={props.themes}
        audioEnabled={props.audioEnabled}
        isFullscreen={fullscreen}
        setTheme={props.onTheme}
        setAudio={props.onAudio}
        exitFullscreen={async () => { await exitFullscreen(); }}
        save={props.onSave}
        exit={props.onExit}
        close={props.onClose}
      />
    </Dialog>
  );
}
