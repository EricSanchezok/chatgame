"use client";

// Launcher: script card wall (theme-colored), zip import, new-game origin
// picker, and continue (save list). Fills the viewport shell: the header
// stays, the card grid scrolls, one modal per flow. Errors surface inline
// without breaking the library.

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { api, type SaveSummary, type ScriptDetail, type ScriptSummary } from "../lib/api";
import { rgba } from "../lib/theme";
import { useGame } from "./game/state";

type Modal = { kind: "new" | "continue" | "none"; scriptId: string } | { kind: "none" };

export function Launcher() {
  const { state, startNewGame, continueGame, clearError } = useGame();
  const [scripts, setScripts] = useState<ScriptSummary[]>([]);
  const [modal, setModal] = useState<Modal>({ kind: "none" });
  const [detail, setDetail] = useState<ScriptDetail | null>(null);
  const [originId, setOriginId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [importOk, setImportOk] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadScripts = useCallback(async () => {
    try {
      const res = await api.listScripts();
      setScripts(res.scripts);
    } catch {
      // The library is empty or unreachable; show the empty state.
      setScripts([]);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listScripts();
        if (!cancelled) setScripts(res.scripts);
      } catch {
        // The library is empty or unreachable; show the empty state.
        if (!cancelled) setScripts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  async function openModal(kind: "new" | "continue", scriptId: string) {
    clearError();
    setModal({ kind, scriptId });
    try {
      const d = await api.scriptDetail(scriptId);
      setDetail(d);
      setOriginId(d.origins[0]?.id ?? "");
      setSaves(d.saves);
    } catch (err) {
      setDetail(null);
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  function closeModal() {
    setModal({ kind: "none" });
    setDetail(null);
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
      const result = await api.importScript(file, false);
      setImportOk(`已导入「${result.scriptId}」`);
      await loadScripts();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
    }
  }

  const openScript = modal.kind !== "none" ? scripts.find((s) => s.id === modal.scriptId) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: "var(--cg-background)", color: "var(--cg-text)" }}>
      <header className="shrink-0 border-b px-6 py-5" style={{ borderColor: "var(--cg-border)" }}>
        <h1 className="text-2xl font-bold tracking-wide">Chatgame · 剧本库</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--cg-text-dim)" }}>
          选择一个剧本，开始一段由规则与叙事共同驱动的冒险。
        </p>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {scripts.map((s) => {
              const bg = s.theme?.palette.background ?? "var(--cg-background)";
              const surface = s.theme?.palette.surface ?? "var(--cg-surface)";
              const primary = s.theme?.palette.primary ?? "var(--cg-primary)";
              const text = s.theme?.palette.text ?? "var(--cg-text)";
              const dim = s.theme?.palette.text_dim ?? "var(--cg-text-dim)";
              return (
                <article
                  key={s.id}
                  className="cg-chrome flex flex-col overflow-hidden border"
                  style={{ borderColor: rgba(s.theme?.palette.border ?? "#2a2f3a", 0.6), background: bg }}
                >
                  <div className="h-20" style={{ background: `linear-gradient(135deg, ${primary}, ${rgba(s.theme?.palette.accent ?? primary, 0.35)})` }} />
                  <div className="flex flex-1 flex-col gap-2 p-4" style={{ background: surface }}>
                    <h2 className="text-lg font-bold" style={{ color: text }}>{s.name}</h2>
                    <p className="line-clamp-3 text-sm" style={{ color: dim }}>{s.description}</p>
                    <p className="text-xs" style={{ color: dim }}>
                      {s.author} · {s.tone.join(" / ") || "—"} · {s.hasAssets ? "含资产" : "无资产"}
                    </p>
                    <div className="mt-auto flex gap-2 pt-3">
                      <button
                        type="button"
                        className="cg-chrome flex-1 rounded-lg px-3 py-2 text-sm font-semibold"
                        style={{ background: primary, color: bg }}
                        onClick={() => void openModal("new", s.id)}
                      >
                        新游戏
                      </button>
                      <button
                        type="button"
                        className="cg-chrome flex-1 rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--cg-border)", color: text }}
                        onClick={() => void openModal("continue", s.id)}
                      >
                        继续
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}

            {/* Import card (always present). */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={importBusy}
              className="cg-chrome flex min-h-48 flex-col items-center justify-center gap-2 border-2 border-dashed p-6 text-sm"
              style={{ borderColor: "var(--cg-border)", color: "var(--cg-text-dim)" }}
            >
              <span className="text-2xl">＋</span>
              {importBusy ? "导入中……" : "导入剧本（zip）"}
            </button>
            <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={(e) => void onImport(e)} />
          </div>

          {scripts.length === 0 ? (
            <p className="mt-8 text-center text-sm" style={{ color: "var(--cg-text-dim)" }}>
              还没有已安装的剧本 —— 上传一个 zip 开始。
            </p>
          ) : null}

          {importError ? (
            <p className="mt-4 rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--cg-border)", color: "var(--cg-accent)" }}>
              {importError}
            </p>
          ) : null}
          {importOk ? (
            <p className="mt-4 rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}>
              {importOk}
            </p>
          ) : null}
          {state.error ? (
            <p className="mt-4 rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--cg-border)", color: "var(--cg-accent)" }}>
              {state.error}
            </p>
          ) : null}
        </div>
      </main>

      {/* New game / continue modal (centered overlay, same z-layer as game). */}
      {modal.kind !== "none" && openScript ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={modal.kind === "new" ? "新游戏" : "继续游戏"}>
          <button type="button" tabIndex={-1} className="absolute inset-0" style={{ background: "color-mix(in srgb, var(--cg-background) calc(var(--cg-overlay-strength) * 100%), transparent)" }} onClick={closeModal} />
          <div className="cg-glass cg-chrome relative max-h-[80vh] w-full max-w-lg overflow-y-auto border p-5"
            style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface)", boxShadow: "var(--cg-shadow-value)" }}>
            <h2 className="mb-4 text-lg font-bold" style={{ color: "var(--cg-text)" }}>
              {modal.kind === "new" ? `新游戏 · ${openScript.name}` : `继续 · ${openScript.name}`}
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
                    {detail.origins.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}{o.difficulty ? `（${o.difficulty}）` : ""}
                      </option>
                    ))}
                  </select>
                  {detail.origins.find((o) => o.id === originId)?.description ? (
                    <p className="mt-2 text-sm" style={{ color: "var(--cg-text-dim)" }}>
                      {detail.origins.find((o) => o.id === originId)?.description}
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

            {state.busy ? (
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
                  disabled={!originId || state.busy}
                  className="cg-chrome rounded-lg px-4 py-1.5 text-sm font-semibold"
                  style={{ background: "var(--cg-primary)", color: "var(--cg-surface)", opacity: originId && !state.busy ? 1 : 0.5 }}
                  onClick={async () => {
                    closeModal();
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
