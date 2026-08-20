"use client";

// Main menu: the framework's universal shell — start a new game, continue,
// switch scripts, and settings (import). The selected script's theme /
// font / background apply immediately (launcher:background slot), so the
// menu itself wears the script's look. The old "script card wall" is gone:
// the script list is a compact switcher inside a themed shell.

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { SaveSummary, ScriptDetail, ScriptMeta, ScriptSummary } from "../lib/api";
import { getSlot, loadScriptUi } from "../lib/script-registry";
import { enterFullscreen } from "../lib/fullscreen";
import { applyTheme } from "../lib/theme";
import { readPlayerSettings } from "../lib/settings";
import { useGameActions, useGamePort, useGameSelector } from "./game/state";

type Modal = { kind: "new" | "continue" | "none"; scriptId: string } | { kind: "none" };

/**
 * An origin is selectable when it is a default origin (not listed in
 * run.yaml unlocks[].grant) or already unlocked by meta-progression.
 */
function originAvailable(originId: string, meta: ScriptMeta | null): boolean {
  if (!meta) return true;
  if (!meta.lockableOrigins.includes(originId)) return true;
  return meta.unlockedOrigins.includes(originId);
}

export function Launcher() {
  const state = useGameSelector((snapshot) => snapshot);
  const { startNewGame, continueGame, resumeLast, clearError } = useGameActions();
  const port = useGamePort();
  const busy = state.operation !== "idle";
  const [scripts, setScripts] = useState<ScriptSummary[]>([]);
  const [scriptId, setScriptId] = useState("");
  const [modal, setModal] = useState<Modal>({ kind: "none" });
  const [detail, setDetail] = useState<ScriptDetail | null>(null);
  const [meta, setMeta] = useState<ScriptMeta | null>(null);
  const [originId, setOriginId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [importOk, setImportOk] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Computed once on mount (client-only; the reference lives in
  // localStorage and is refreshed by the GameProvider on enter/exit).
  const [lastRunAvailable, setLastRunAvailable] = useState(() => readPlayerSettings().lastRun !== null);

  async function refreshScripts() {
    try {
      const res = await port.listScripts();
      setScripts(res.scripts);
      setScriptId((prev) => prev || res.scripts[0]?.id || "");
    } catch {
      setScripts([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await port.listScripts();
        if (!cancelled) {
          setScripts(res.scripts);
          setScriptId((prev) => prev || res.scripts[0]?.id || "");
        }
      } catch {
        if (!cancelled) setScripts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [port]);
  const script = scripts.find((s) => s.id === scriptId) ?? scripts[0];

  // The menu wears the selected script's skin: load its UI bundle (for the
  // launcher:background slot) and apply its default theme immediately.
  const activeScriptId = script?.id;
  useEffect(() => {
    if (!activeScriptId) return;
    let cancelled = false;
    void (async () => {
      await loadScriptUi(activeScriptId);
      try {
        const d = await port.scriptDetail(activeScriptId);
        const theme = d.presentation.themes.find((entry) => entry.id === d.presentation.defaultThemeId);
        if (!cancelled && theme) {
          applyTheme(theme, undefined, {
            assetUrl: (file) => port.assetUrl(activeScriptId, file),
          });
        }
      } catch {
        // Library unreachable; keep the framework default look.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeScriptId, port]);

  async function openModal(kind: "new" | "continue", id: string) {
    clearError();
    setModal({ kind, scriptId: id });
    try {
      const d = await port.scriptDetail(id);
      setDetail(d);
      setSaves(d.saves);
      if (kind === "new") {
        // Meta unlocks gate the origin picker (locked origins are dimmed).
        const m = await port.scriptMeta(id);
        setMeta(m);
        setOriginId(d.origins.find((o) => originAvailable(o.id, m))?.id ?? "");
      } else {
        setMeta(null);
        setOriginId(d.origins[0]?.id ?? "");
      }
    } catch (err) {
      setDetail(null);
      setMeta(null);
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  function closeModal() {
    setModal({ kind: "none" });
    setDetail(null);
    setMeta(null);
    setOriginId("");
    setPlayerName("");
    setSaves([]);
  }

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportBusy(true);
    setImportError("");
    setImportOk("");
    try {
      const preview = await port.previewImport(file);
      const result = await port.commitImport(preview.token, false);
      setImportOk(`已导入「${result.scriptId}」`);
      await refreshScripts();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
    }
  }

  const bgDef = getSlot("launcher:background");
  const Bg = bgDef?.component as React.ElementType | undefined;

  async function onResumeLast() {
    clearError();
    const ok = await resumeLast();
    if (!ok) {
      // The reference was stale (save/script deleted) and already cleared;
      // hide the entry and keep the launcher open with the inline error.
      setLastRunAvailable(false);
    }
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden"
      style={{ background: "var(--cg-background)", color: "var(--cg-text)" }}
    >
      {/* Script background (default: themed gradient; slot: script cover). */}
      {Bg ? (
        <div className="absolute inset-0 z-0" aria-hidden="true">
          <Bg />
        </div>
      ) : (
        <div
          className="absolute inset-0 z-0"
          aria-hidden="true"
          style={{
            background: "radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--cg-primary) 28%, transparent), transparent 65%), linear-gradient(180deg, var(--cg-background), var(--cg-surface))",
          }}
        />
      )}

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-6">
        <header className="text-center">
          <h1 className="text-4xl font-bold tracking-wide" style={{ color: "var(--cg-text)" }}>
            {script ? script.name : "Chatgame"}
            {script?.safety?.age_rating ? (
              <span
                className="ml-3 rounded-full border px-2 py-0.5 align-middle text-xs"
                style={{ borderColor: "var(--cg-text-dim)", color: "var(--cg-text-dim)" }}
                title="内容分级"
              >
                {script.safety.age_rating}
              </span>
            ) : null}
          </h1>
          {script ? (
            <p className="mt-2 max-w-md text-sm" style={{ color: "var(--cg-text-dim)" }}>
              {script.description}
            </p>
          ) : null}
        </header>

        <nav className="flex flex-col gap-2" aria-label="主菜单">
          <button
            type="button"
            disabled={!script}
            className="cg-chrome rounded-xl px-8 py-3 text-base font-semibold"
            style={{ background: "var(--cg-primary)", color: "var(--cg-surface)", opacity: script ? 1 : 0.5 }}
            onClick={() => script && openModal("new", script.id)}
          >
            开始新游戏
          </button>
          <button
            type="button"
            disabled={!script}
            className="cg-chrome rounded-xl border px-8 py-3 text-base"
            style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)", opacity: script ? 1 : 0.5 }}
            onClick={() => script && openModal("continue", script.id)}
          >
            继续
          </button>
          {lastRunAvailable ? (
            <button
              type="button"
              onClick={() => void onResumeLast()}
              disabled={busy}
              className="cg-chrome rounded-xl border px-8 py-3 text-base font-semibold"
              style={{ borderColor: "var(--cg-primary)", color: "var(--cg-primary)", background: "color-mix(in srgb, var(--cg-primary) 10%, transparent)" }}
            >
              继续上次游戏
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={importBusy}
            className="cg-chrome rounded-xl border px-8 py-3 text-base"
            style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
          >
            {importBusy ? "导入中……" : "设置 / 导入剧本"}
          </button>
        </nav>

        {/* Script switcher (compact). */}
        {scripts.length > 1 ? (
          <div className="flex flex-wrap items-center justify-center gap-2" aria-label="切换剧本">
            {scripts.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScriptId(s.id)}
                className="cg-chrome rounded-full border px-4 py-1.5 text-sm transition-colors"
                style={
                  s.id === script?.id
                    ? { borderColor: "var(--cg-primary)", color: "var(--cg-primary)", background: "color-mix(in srgb, var(--cg-primary) 12%, transparent)" }
                    : { borderColor: "var(--cg-border)", color: "var(--cg-text-dim)" }
                }
              >
                {s.name}
              </button>
            ))}
          </div>
        ) : null}

        {scripts.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--cg-text-dim)" }}>
            还没有已安装的剧本 —— 上传一个 zip 开始。
          </p>
        ) : null}

        {importError ? (
          <p className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--cg-border)", color: "var(--cg-accent)" }}>
            {importError}
          </p>
        ) : null}
        {importOk ? (
          <p className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}>
            {importOk}
          </p>
        ) : null}
        {state.error ? (
          <p className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--cg-border)", color: "var(--cg-accent)" }}>
            {state.error}
          </p>
        ) : null}

        <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={(e) => void onImport(e)} />
      </div>

      {/* New game / continue modal (centered overlay). */}
      {modal.kind !== "none" && script ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={modal.kind === "new" ? "新游戏" : "继续游戏"}>
          <button type="button" tabIndex={-1} className="absolute inset-0" style={{ background: "color-mix(in srgb, var(--cg-background) calc(var(--cg-overlay-strength) * 100%), transparent)" }} onClick={closeModal} />
          <div className="cg-glass cg-chrome relative max-h-[80vh] w-full max-w-lg overflow-y-auto border p-5"
            style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface)", boxShadow: "var(--cg-shadow-value)" }}>
            <h2 className="mb-4 text-lg font-bold" style={{ color: "var(--cg-text)" }}>
              {modal.kind === "new" ? `新游戏 · ${script.name}` : `继续 · ${script.name}`}
            </h2>

            {modal.kind === "new" && detail ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm" style={{ color: "var(--cg-text-dim)" }}>出身</label>
                  <select
                    value={originId}
                    onChange={(e) => setOriginId(e.target.value)}
                    className="cg-chrome w-full rounded-lg border px-3 py-2"
                    style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface-alt)", color: "var(--cg-text)" }}
                  >
                    {detail.origins.map((o) => {
                      const available = originAvailable(o.id, meta);
                      return (
                        <option key={o.id} value={o.id} disabled={!available}>
                          {o.name}{o.difficulty ? `（${o.difficulty}）` : ""}
                          {available ? "" : " · 未解锁"}
                        </option>
                      );
                    })}
                  </select>
                  {detail.origins.find((o) => o.id === originId)?.description ? (
                    <p className="mt-2 text-sm" style={{ color: "var(--cg-text-dim)" }}>
                      {detail.origins.find((o) => o.id === originId)?.description}
                    </p>
                  ) : null}
                  {meta && meta.lockableOrigins.some((id) => !meta.unlockedOrigins.includes(id)) ? (
                    <p className="mt-2 text-xs" style={{ color: "var(--cg-text-dim)" }}>
                      部分出身需要完成特定结局或事件才能解锁。
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="mb-1 block text-sm" style={{ color: "var(--cg-text-dim)" }}>名字（可选）</label>
                  <input
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="留空则使用出身名"
                    className="cg-chrome w-full rounded-lg border px-3 py-2"
                    style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface-alt)", color: "var(--cg-text)" }}
                  />
                </div>
              </div>
            ) : null}

            {modal.kind === "continue" ? (
              saves.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--cg-text-dim)" }}>还没有存档 —— 先开一局新游戏吧。</p>
              ) : (
                <ul className="space-y-2">
                  {saves.map((s) => (
                    <li key={s.runId}>
                      <button
                        type="button"
                        className="cg-chrome w-full rounded-lg border px-3 py-2 text-left text-sm"
                        style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
                        onClick={async () => {
                          closeModal();
                          await continueGame(modal.scriptId, s.runId);
                        }}
                      >
                        {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : s.runId}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}

            {busy ? (
              <p className="mt-4 text-sm" style={{ color: "var(--cg-text-dim)" }}>正在创建会话……</p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="cg-chrome rounded-lg border px-3 py-1.5 text-sm"
                style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }} onClick={closeModal}>
                取消
              </button>
              {modal.kind === "new" ? (
                <button
                  type="button"
                  disabled={!originId || busy}
                  className="cg-chrome rounded-lg px-4 py-1.5 text-sm font-semibold"
                  style={{ background: "var(--cg-primary)", color: "var(--cg-surface)", opacity: originId && !busy ? 1 : 0.5 }}
                  onClick={async () => {
                    closeModal();
                    // User-gesture fullscreen request (silent degradation).
                    void enterFullscreen();
                    await startNewGame(modal.scriptId, originId, playerName.trim() || undefined);
                  }}
                >
                  开始冒险
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
