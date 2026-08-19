"use client";

// The game screen: a stable three-region shell (top HUD / stage / bottom
// composer) + right floating toolbar. The chat stream is the primary
// surface; the composer never moves with the message flow; secondary world
// data opens as centered modals over the shell. Esc opens the pause menu
// (settings/save/exit). Script UI bundles load once per script and may
// replace the HUD, toolbar, pause menu, bubbles, or panels via slots.

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Catalog, WorldState } from "../../lib/api";
import { loadScriptUi } from "../../lib/script-registry";
import { EntryCards, ResolutionChip } from "./cards";
import { ActivePanel } from "./panels";
import { Hud } from "./hud";
import { Toolbar } from "./toolbar";
import { PauseMenu } from "./pause-menu";
import { UiIcon } from "./ui-icon";
import { useGame } from "./state";

export function GameScreen() {
  const { state, sendTurn, save, exitGame, setTheme, setAudio, setPanel, setPause, advance, updateDescriptor } = useGame();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const session = state.session;
  const detail = state.detail;

  // Load the script's UI bundle (slot registrations) once per script.
  // No bundle / load failure degrades to the framework defaults.
  useEffect(() => {
    if (session) {
      void loadScriptUi(session.scriptId);
    }
  }, [session?.scriptId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.session?.state.transcript.length]);

  // Esc toggles the pause menu while in game (panels close first).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (state.panel) {
        setPanel(null);
      } else {
        setPause(!state.paused);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [state.panel, state.paused, setPanel, setPause]);

  if (!session || !detail) return null;
  const world: WorldState = session.state;
  const catalog: Catalog | undefined = detail.catalog;
  const actionName = (id: string) => catalog?.actions.find((a) => a.id === id)?.displayName ?? id;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || state.busy) return;
    setInput("");
    await sendTurn(text);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: "var(--cg-background)" }}>
      {/* Top chrome: default/slot HUD (health bar + clock + location). */}
      <Hud state={world} catalog={catalog} scriptId={session.scriptId} assets={detail.assets} />

      {/* Stage: the chat stream — the only scrolling region. */}
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
          {state.lastTurn ? (
            <SystemFeedbackBlock
              lastTurn={state.lastTurn}
              actionName={actionName}
            />
          ) : null}
          {state.busy ? (
            <div className="self-start text-sm italic" style={{ color: "var(--cg-text-dim)" }}>
              世界正在回应……
            </div>
          ) : null}
        </div>
      </main>

      {/* Right floating toolbar (default/slot): panel entry points. */}
      <Toolbar
        state={world}
        catalog={catalog}
        scriptId={session.scriptId}
        assets={detail.assets}
        panel={state.panel}
        onOpenPanel={setPanel}
      />

      {/* Bottom chrome: fixed composer (input + send). */}
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
        </div>
      </footer>

      {/* Overlays: centered modal panels + pause menu + toast. */}
      <ActivePanel
        panel={state.panel}
        state={world}
        catalog={catalog}
        scriptId={session.scriptId}
        assets={detail.assets}
        onClose={() => setPanel(null)}
        handlers={{ onAdvance: advance, onUpdateDescriptor: updateDescriptor }}
      />

      {state.paused ? (
        <PauseMenu
          themeMode={state.themeMode}
          themes={session.presentation.themes}
          audioEnabled={state.audioEnabled}
          dirty={state.dirty}
          busy={state.busy}
          onTheme={setTheme}
          onAudio={setAudio}
          onSave={async () => {
            try {
              await save();
            } catch {
              /* error toast handled by state.error */
            }
          }}
          onExit={async (saveFirst) => {
            await exitGame(saveFirst);
            setPause(false);
          }}
          onClose={() => setPause(false)}
        />
      ) : null}

      {state.error ? (
        <div
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 text-sm"
          style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface)", color: "var(--cg-text)" }}
        >
          {state.error}
        </div>
      ) : null}
    </div>
  );
}
/** TurnResult consumption block: engine-owned facts surfaced as system
 * entries after the narrative (world events / task outcomes / death /
 * intent fallback). Rendered only for the last turn, using system styles. */
function SystemFeedbackBlock({
  lastTurn,
  actionName,
}: {
  lastTurn: NonNullable<ReturnType<typeof useGame>["state"]["lastTurn"]>;
  actionName: (id: string) => string;
}) {
  const { worldEvents, taskCompletions, deathFired, fellBackToTalk } = lastTurn;
  if (worldEvents.length === 0 && taskCompletions.length === 0 && !deathFired && !fellBackToTalk) {
    return null;
  }
  return (
    <div
      className="self-start max-w-[85%] rounded-2xl border px-4 py-2 text-sm"
      style={{ background: "var(--cg-surface-alt)", color: "var(--cg-text-dim)", borderColor: "var(--cg-border)" }}
    >
      {worldEvents.length > 0 ? (
        <ul className="space-y-1">
          {worldEvents.map((e, i) => (
            <li key={i} className="whitespace-pre-wrap leading-relaxed">🌍 {e}</li>
          ))}
        </ul>
      ) : null}
      {taskCompletions.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {taskCompletions.map((t) => (
            <li key={t.taskId} className="whitespace-pre-wrap leading-relaxed">
              {t.status === "complete" ? "✓" : "✗"} 任务{t.status === "complete" ? "完成" : "失败"}：{actionName(t.taskId)}
            </li>
          ))}
        </ul>
      ) : null}
      {deathFired ? (
        <p className="mt-1 font-semibold" style={{ color: "var(--cg-accent)" }}>
          你遭遇了致命打击。
        </p>
      ) : null}
      {fellBackToTalk ? (
        <p className="mt-1 italic">未能识别你的意图，按交谈处理。</p>
      ) : null}
    </div>
  );
}
