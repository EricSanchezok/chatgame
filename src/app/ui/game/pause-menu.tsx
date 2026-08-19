"use client";

// Esc pause menu: the game's settings / save / exit overlay. Opens with Esc
// (or the HUD menu button), closes with Esc / backdrop / Continue. Theme
// selection, audio toggle and script settings slots live here — the old
// top-bar buttons are gone. Script ui bundles may replace the whole menu
// via the "pause-menu" slot.
import { getSlot } from "../../lib/script-registry";
import { UiIcon } from "./ui-icon";
import type { ThemeMode } from "./state";

export interface PauseMenuProps {
  themeMode: ThemeMode;
  themes: Array<{ id: string; name: string }>;
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
  dirty,
  busy,
  onTheme,
  onAudio,
  onSave,
  onExit,
  onClose,
}: PauseMenuProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="暂停菜单"
    >
      <button
        type="button"
        aria-label="关闭暂停菜单"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        style={{ background: "color-mix(in srgb, var(--cg-background) calc(var(--cg-overlay-strength) * 100%), transparent)" }}
        onClick={onClose}
      />
      <section
        className="cg-glass cg-chrome relative flex max-h-[85dvh] w-full max-w-md flex-col border p-5 shadow-xl"
        style={{ borderColor: "var(--cg-border)", boxShadow: "var(--cg-shadow-value)" }}
      >
        <header className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--cg-border)" }}>
          <h2 className="text-lg font-semibold" style={{ color: "var(--cg-text)" }}>设置</h2>
          <button
            type="button"
            onClick={onClose}
            className="cg-chrome flex items-center gap-1 rounded-lg border px-2.5 py-1 text-sm"
            style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
          >
            <UiIcon slot="close" scriptId="" manifest={undefined} className="h-4 w-4" />
            关闭
          </button>
        </header>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div>
            <label className="mb-1 block text-sm" style={{ color: "var(--cg-text-dim)" }}>主题</label>
            <select
              value={themeMode}
              onChange={(e) => onTheme(e.target.value)}
              className="cg-chrome w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface-alt)", color: "var(--cg-text)" }}
            >
              <option value="follow">跟随剧本</option>
              {themes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--cg-text)" }}>声音</span>
            <button
              type="button"
              onClick={() => onAudio(!audioEnabled)}
              className="cg-chrome flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
              aria-pressed={audioEnabled}
            >
              <UiIcon slot={audioEnabled ? "audio_on" : "audio_off"} scriptId="" manifest={undefined} className="h-4 w-4" />
              {audioEnabled ? "开" : "关"}
            </button>
          </div>

          <div className="border-t pt-4" style={{ borderColor: "var(--cg-border)" }}>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  await onSave();
                  onClose();
                }}
                className="cg-chrome flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
              >
                <UiIcon slot="save" scriptId="" manifest={undefined} className="h-4 w-4" />
                保存{dirty ? "（未保存进度）" : ""}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => onExit(false)}
                className="cg-chrome rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
              >
                不保存返回主菜单
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => onExit(true)}
                className="cg-chrome rounded-lg px-3 py-2 text-sm font-semibold"
                style={{ background: "var(--cg-primary)", color: "var(--cg-surface)" }}
              >
                保存并返回主菜单
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Slot-replaceable pause menu entry point. */
export function PauseMenu(props: PauseMenuProps) {
  const def = getSlot("pause-menu");
  if (def) {
    const C = def.component as React.ElementType;
    return <C {...props} />;
  }
  return <DefaultPauseMenu {...props} />;
}
