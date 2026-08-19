"use client";

// The game screen: a stable three-region shell (top HUD / stage / bottom
// composer). The chat stream is the primary surface; the composer (input +
// panel entry points) never moves with the message flow; secondary world
// data opens as centered modals (PanelFrame) over the shell — they never
// change the flex tracks, so the input bar stays glued to the viewport
// bottom in every state.

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Catalog, WorldState } from "../../lib/api";
import { EntryCards, ResolutionChip } from "./cards";
import { ActivePanel, fmtClock } from "./panels";
import { UiIcon } from "./ui-icon";
import { useGame } from "./state";

export function GameScreen() {
  const { state, sendTurn, save, exitGame, setTheme, setAudio, setPanel } = useGame();
  const [input, setInput] = useState("");
  const [confirmExit, setConfirmExit] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const session = state.session;
  const detail = state.detail;

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.session?.state.transcript.length]);

  if (!session || !detail) return null;
  const world: WorldState = session.state;
  const catalog: Catalog | undefined = detail.catalog;
  const hpMax = catalog?.stats.find((s) => s.name === catalog.hpStat)?.max ?? 100;
  const hp = world.player.stats[catalog?.hpStat ?? "hp"] ?? 0;
  const locationName =
    catalog?.locations.find((l) => l.id === world.player.locationId)?.name ?? world.player.locationId;
  const actionName = (id: string) => catalog?.actions.find((a) => a.id === id)?.displayName ?? id;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || state.busy) return;
    setInput("");
    await sendTurn(text);
  }

  const panelEntries: Array<{ panel: Parameters<typeof setPanel>[0]; label: string; slot: "inventory" | "character" | "relations" | "tasks" | "map" | "log" }> = [
    { panel: "inventory", label: "背包", slot: "inventory" },
    { panel: "character", label: "角色", slot: "character" },
    { panel: "relations", label: "关系", slot: "relations" },
    { panel: "tasks", label: "任务", slot: "tasks" },
    { panel: "map", label: "地图", slot: "map" },
    { panel: "log", label: "日志", slot: "log" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: "var(--cg-background)" }}>
      {/* Top chrome: summary HUD + session menu. Never scrolls. */}
      <header
        data-region="hud"
        className="cg-glass cg-chrome flex shrink-0 items-center justify-between gap-3 px-4 py-2"
        style={{ borderBottom: "var(--cg-border-width) solid var(--cg-border)" }}
      >
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5" style={{ color: "var(--cg-text)" }}>
            <UiIcon slot="time" scriptId={session.scriptId} manifest={detail.assets} className="h-4 w-4" />
            {fmtClock(world)}
          </span>
          <span className="flex items-center gap-1.5" style={{ color: "var(--cg-text-dim)" }}>
            <UiIcon slot="location" scriptId={session.scriptId} manifest={detail.assets} className="h-4 w-4" />
            {locationName}
          </span>
          <span className="flex items-center gap-1.5" style={{ color: "var(--cg-text)" }}>
            <UiIcon slot="hp" scriptId={session.scriptId} manifest={detail.assets} className="h-4 w-4" />
            {hp}/{hpMax}
          </span>
          {state.dirty ? (
            <span className="text-xs" style={{ color: "var(--cg-accent)" }}>未保存</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={state.themeMode}
            onChange={(e) => setTheme(e.target.value)}
            className="cg-chrome rounded-lg border px-2 py-1 text-sm"
            style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface)", color: "var(--cg-text)" }}
            aria-label="主题"
          >
            <option value="follow">跟随剧本</option>
            {session.presentation.themes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setAudio(!state.audioEnabled)}
            className="cg-chrome rounded-lg border px-2 py-1 text-sm"
            style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
            aria-label={state.audioEnabled ? "关闭声音" : "打开声音"}
          >
            <UiIcon slot={state.audioEnabled ? "audio_on" : "audio_off"} scriptId={session.scriptId} manifest={detail.assets} className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await save();
              } catch {
                /* error toast handled by state.error */
              }
            }}
            disabled={state.busy}
            className="cg-chrome flex items-center gap-1 rounded-lg border px-2 py-1 text-sm"
            style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
          >
            <UiIcon slot="save" scriptId={session.scriptId} manifest={detail.assets} className="h-4 w-4" />
            保存
          </button>
          <button
            type="button"
            onClick={() => setConfirmExit(true)}
            className="cg-chrome rounded-lg border px-2 py-1 text-sm"
            style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
          >
            返回
          </button>
        </div>
      </header>

      {/* Stage: the chat stream — the only scrolling region on the game screen. */}
      <main data-region="stage" ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="cg-narrative mx-auto flex max-w-3xl flex-col gap-4">
          {world.transcript.map((entry) => (
            <article
              key={entry.id}
              className={
                entry.role === "player"
                  ? "self-end max-w-[85%] rounded-2xl px-4 py-2"
                  : "self-start max-w-[85%] rounded-2xl px-4 py-2"
              }
              style={
                entry.role === "player"
                  ? { background: "var(--cg-primary)", color: "var(--cg-surface)", borderTopRightRadius: "4px" }
                  : entry.role === "system"
                    ? { background: "var(--cg-surface-alt)", color: "var(--cg-text-dim)", border: "1px solid var(--cg-border)" }
                    : { background: "var(--cg-surface)", color: "var(--cg-text)", border: "1px solid var(--cg-border)", borderTopLeftRadius: "4px" }
              }
            >
              {entry.role === "world" || entry.role === "system" ? (
                <p className="whitespace-pre-wrap leading-relaxed">{entry.text}</p>
              ) : (
                <p className="leading-relaxed">{entry.text}</p>
              )}
              {entry.role === "world" ? (
                <EntryCards
                  entry={entry}
                  scriptId={session.scriptId}
                  manifest={detail.assets}
                  catalog={catalog}
                  state={world}
                />
              ) : null}
            </article>
          ))}
          {state.lastTurn?.resolution && state.lastTurn.resolution.actionId !== "talk" ? (
            <div className="self-center">
              <ResolutionChip
                actionName={actionName(state.lastTurn.resolution.actionId)}
                grade={state.lastTurn.resolution.grade}
                roll={state.lastTurn.resolution.roll}
                dc={state.lastTurn.resolution.dc}
              />
            </div>
          ) : null}
          {state.busy ? (
            <div className="self-start text-sm italic" style={{ color: "var(--cg-text-dim)" }}>
              世界正在回应……
            </div>
          ) : null}
        </div>
      </main>

      {/* Bottom chrome: fixed composer (input + send + panel entry points).
          Never moves with the transcript — the shell locks it to the viewport. */}
      <footer
        data-region="composer"
        className="cg-glass cg-chrome shrink-0 border-t px-4 py-3"
        style={{ borderTop: "var(--cg-border-width) solid var(--cg-border)", paddingBottom: "max(env(safe-area-inset-bottom), var(--cg-space-3))" }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <form onSubmit={onSubmit} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="说点什么，或试着行动（如：偷艾拉的东西 / 我去矿井入口）"
              disabled={state.busy}
              className="cg-chrome flex-1 rounded-full border px-4 py-2"
              style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface-alt)", color: "var(--cg-text)" }}
              aria-label="玩家输入"
            />
            <button
              type="submit"
              disabled={state.busy || !input.trim()}
              className="cg-chrome flex items-center gap-1.5 rounded-full px-5 py-2 font-semibold"
              style={{ background: "var(--cg-primary)", color: "var(--cg-surface)" }}
            >
              <UiIcon slot="send" scriptId={session.scriptId} manifest={detail.assets} className="h-4 w-4" />
              发送
            </button>
          </form>
          <nav className="flex flex-wrap items-center justify-center gap-2">
            {panelEntries.map(({ panel, label, slot }) => (
              <button
                key={panel}
                type="button"
                onClick={() => setPanel(panel)}
                className="cg-chrome flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm"
                style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
              >
                <UiIcon slot={slot} scriptId={session.scriptId} manifest={detail.assets} className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </footer>

      {/* Overlays: centered modal panels + exit confirm + toast. These are
          position:fixed and never participate in the shell's flex tracks. */}
      <ActivePanel
        panel={state.panel}
        state={world}
        catalog={catalog}
        scriptId={session.scriptId}
        assets={detail.assets}
        onClose={() => setPanel(null)}
      />

      {state.error ? (
        <div
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 text-sm"
          style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface)", color: "var(--cg-text)" }}
        >
          {state.error}
        </div>
      ) : null}

      {confirmExit ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="返回启动器">
          <button type="button" tabIndex={-1} className="absolute inset-0" style={{ background: "color-mix(in srgb, var(--cg-background) calc(var(--cg-overlay-strength) * 100%), transparent)" }} onClick={() => setConfirmExit(false)} />
          <div className="cg-chrome relative rounded-xl border p-5" style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface)" }}>
            <p className="mb-4" style={{ color: "var(--cg-text)" }}>
              {state.dirty ? "有未保存的进度。返回前要保存吗？" : "确定返回启动器吗？"}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="cg-chrome rounded-lg border px-3 py-1.5 text-sm"
                style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
                onClick={() => setConfirmExit(false)}>
                取消
              </button>
              {state.dirty ? (
                <button type="button" className="cg-chrome rounded-lg border px-3 py-1.5 text-sm"
                  style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
                  onClick={async () => {
                    setConfirmExit(false);
                    await exitGame(false);
                  }}>
                  不保存
                </button>
              ) : null}
              <button type="button" className="cg-chrome rounded-lg px-3 py-1.5 text-sm font-semibold"
                style={{ background: "var(--cg-primary)", color: "var(--cg-surface)" }}
                onClick={async () => {
                  setConfirmExit(false);
                  await exitGame(true);
                }}>
                保存并返回
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
