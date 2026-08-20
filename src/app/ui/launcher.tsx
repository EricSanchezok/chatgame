"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LauncherSlotProps } from "../lib/script-registry";
import type { ScriptDetail, ScriptMeta, ScriptSummary } from "../lib/api";
import { loadScriptUi } from "../lib/script-registry";
import { enterFullscreen } from "../lib/fullscreen";
import { applyTheme } from "../lib/theme";
import { patchPlayerSettings, readPlayerSettings } from "../lib/settings";
import { Dialog } from "./dialog";
import { SlotRenderer } from "./game/slots";
import { useGameActions, useGamePort, useGameSelector } from "./game/state";

type ActiveProgramme = { script: ScriptSummary; detail: ScriptDetail };
type LauncherDialog = "new" | "saves" | null;

function originAvailable(originId: string, meta: ScriptMeta | null): boolean {
  if (!meta || !meta.lockableOrigins.includes(originId)) return true;
  return meta.unlockedOrigins.includes(originId);
}

function coverUrl(script: ScriptSummary, assetUrl: (scriptId: string, file: string) => string): string {
  return script.cover?.file ? assetUrl(script.id, script.cover.file) : "";
}

function DefaultLauncherBackground({ script, coverUrl: src }: Pick<LauncherSlotProps, "script" | "coverUrl">) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- local script assets are runtime-addressed.
    <img className="cg-programme__cover-image" src={src} alt={script.cover?.alt ?? ""} />
  ) : (
    <div className="cg-programme__cover-fallback" aria-hidden="true">{script.name.slice(0, 1)}</div>
  );
}

function DefaultLauncherProgramme({ script, detail, coverUrl: src, actions }: LauncherSlotProps) {
  return (
    <main className="cg-programme">
      <section className="cg-programme__stage" aria-labelledby="programme-title">
        <div className="cg-programme__cover">
          <DefaultLauncherBackground script={script} coverUrl={src} />
        </div>
        <div className="cg-programme__copy">
          <h1 id="programme-title">{script.name}</h1>
          <p>{script.description}</p>
          <dl className="cg-programme__facts">
            <div><dt>作者</dt><dd>{script.author}</dd></div>
            <div><dt>语言</dt><dd>{script.language}</dd></div>
            {script.safety?.age_rating ? <div><dt>分级</dt><dd>{script.safety.age_rating}</dd></div> : null}
          </dl>
          {script.tone.length > 0 ? <p className="cg-programme__tone">{script.tone.join(" · ")}</p> : null}
        </div>
      </section>

      <aside className="cg-programme__actions" aria-label={`${script.name} 玩家操作`}>
        <button type="button" className="cg-button cg-button--primary" onClick={actions.openNewGame}>
          开始新游戏
        </button>
        <button
          type="button"
          className="cg-button cg-button--secondary"
          onClick={actions.openSaves}
          disabled={detail.saves.length === 0}
          aria-describedby={detail.saves.length === 0 ? "no-saves-help" : undefined}
        >
          选择存档
        </button>
        {detail.saves.length === 0 ? <p id="no-saves-help" className="cg-help">尚无可继续的存档。</p> : null}
      </aside>
    </main>
  );
}

export function Launcher() {
  const port = useGamePort();
  const { startNewGame, continueGame, resumeLast, clearError } = useGameActions();
  const operation = useGameSelector((state) => state.operation);
  const gameError = useGameSelector((state) => state.error);
  const [active, setActive] = useState<ActiveProgramme | null>(null);
  const [dialog, setDialog] = useState<LauncherDialog>(null);
  const [meta, setMeta] = useState<ScriptMeta | null>(null);
  const [originId, setOriginId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [lastRunValid, setLastRunValid] = useState(false);
  const [status, setStatus] = useState("正在整理剧目单……");
  const activationRef = useRef(0);
  const busy = operation !== "idle";

  useEffect(() => {
    const controller = new AbortController();
    const activation = ++activationRef.current;
    void (async () => {
      try {
        const { scripts } = await port.listScripts(controller.signal);
        if (controller.signal.aborted || activation !== activationRef.current) return;
        if (scripts.length === 0) {
          setActive(null);
          setStatus("剧本库为空。前往“剧本”导入一个 zip 文件。");
          return;
        }
        const settings = readPlayerSettings();
        const selected = scripts.find((script) => script.id === settings.activeScriptId) ?? scripts[0];
        const detail = await port.scriptDetail(selected.id, controller.signal);
        if (controller.signal.aborted || activation !== activationRef.current) return;
        const theme = detail.presentation.themes.find((item) => item.id === detail.presentation.defaultThemeId)
          ?? detail.presentation.themes[0];
        const ui = await loadScriptUi(selected.id, detail.presentation.uiBundle, {
          beforeCommit: () => {
            if (theme) applyTheme(theme, undefined, { assetUrl: (file) => port.assetUrl(selected.id, file) });
          },
        });
        if (controller.signal.aborted || activation !== activationRef.current || ui.stale) return;
        if (ui.ok) patchPlayerSettings({ activeScriptId: selected.id });
        setActive({ script: selected, detail });
        setStatus(ui.ok ? `${selected.name}已就绪。` : `${selected.name}使用宿主界面；扩展加载失败。`);

        const last = settings.lastRun;
        if (!last) {
          setLastRunValid(false);
        } else {
          const lastScript = scripts.find((script) => script.id === last.scriptId);
          if (!lastScript) {
            patchPlayerSettings({ lastRun: null });
            setLastRunValid(false);
          } else {
            const lastDetail = last.scriptId === selected.id
              ? detail
              : await port.scriptDetail(last.scriptId, controller.signal);
            const valid = lastDetail.saves.some((save) => save.runId === last.runId);
            if (!valid) patchPlayerSettings({ lastRun: null });
            if (!controller.signal.aborted) setLastRunValid(valid);
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus(`剧目单读取失败：${error instanceof Error ? error.message : String(error)}。请重试。`);
      }
    })();
    return () => controller.abort();
  }, [port]);

  const openNewGame = useCallback(() => {
    if (!active) return;
    clearError();
    setDialog("new");
    setMeta(null);
    void port.scriptMeta(active.script.id).then((nextMeta) => {
      setMeta(nextMeta);
      setOriginId(active.detail.origins.find((origin) => originAvailable(origin.id, nextMeta))?.id ?? "");
    }).catch((error) => setStatus(`出身信息读取失败：${error instanceof Error ? error.message : String(error)}`));
  }, [active, clearError, port]);

  const openSaves = useCallback(() => {
    clearError();
    setDialog("saves");
  }, [clearError]);

  const actions = useMemo<LauncherSlotProps["actions"]>(() => ({
    openNewGame,
    openSaves,
    async start(nextOriginId, nextPlayerName) {
      if (!active) return;
      setDialog(null);
      if (readPlayerSettings().fullscreenOnStart) void enterFullscreen();
      await startNewGame(active.script.id, nextOriginId, nextPlayerName);
    },
    async continueRun(runId) {
      if (!active) return;
      setDialog(null);
      if (readPlayerSettings().fullscreenOnStart) void enterFullscreen();
      await continueGame(active.script.id, runId);
    },
  }), [active, continueGame, openNewGame, openSaves, startNewGame]);

  const continueLastRun = useCallback(async () => {
    if (readPlayerSettings().fullscreenOnStart) void enterFullscreen();
    await resumeLast();
  }, [resumeLast]);

  return (
    <div className="cg-host-page">
      <header className="cg-host-header">
        <Link className="cg-wordmark" href="/" aria-label="Chatgame 游戏首页">Chatgame</Link>
        <nav className="cg-host-nav" aria-label="全局">
          <span aria-current="page">游戏</span>
          <Link href="/scripts">剧本</Link>
          <Link href="/settings">设置</Link>
        </nav>
      </header>

      {active ? (
        <>
          {lastRunValid ? (
            <div className="cg-resume-strip">
              <p>上一次世界仍停在原处。</p>
              <button type="button" className="cg-button cg-button--primary" disabled={busy} onClick={() => void continueLastRun()}>
                {busy ? "正在继续……" : "继续上次游戏"}
              </button>
            </div>
          ) : null}
          <SlotRenderer
            slot="launcher"
            fallback={DefaultLauncherProgramme}
            slotProps={{
              script: active.script,
              detail: active.detail,
              coverUrl: coverUrl(active.script, port.assetUrl.bind(port)),
              actions,
            }}
          />
        </>
      ) : (
        <main className="cg-empty-library">
          <h1>今晚还没有剧目</h1>
          <p>{status}</p>
          <Link className="cg-button cg-button--primary" href="/scripts">打开剧本库</Link>
        </main>
      )}

      <p className="cg-sr-only" role="status" aria-live="polite">{gameError || status}</p>

      {dialog === "new" && active ? (
        <Dialog title={`开始《${active.script.name}》`} description="选择一个已解锁的出身；世界会以此建立第一份存档。" onClose={() => setDialog(null)}>
          <form
            className="cg-form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (!originId || busy) return;
              void actions.start(originId, playerName.trim() || undefined);
            }}
          >
            <label htmlFor="origin">出身</label>
            <select id="origin" value={originId} onChange={(event) => setOriginId(event.target.value)} disabled={!meta || busy}>
              {active.detail.origins.map((origin) => (
                <option key={origin.id} value={origin.id} disabled={!originAvailable(origin.id, meta)}>
                  {origin.name}{origin.difficulty ? ` · ${origin.difficulty}` : ""}{originAvailable(origin.id, meta) ? "" : " · 未解锁"}
                </option>
              ))}
            </select>
            <p className="cg-help">{active.detail.origins.find((origin) => origin.id === originId)?.description}</p>
            <label htmlFor="player-name">名字（可选）</label>
            <input id="player-name" value={playerName} onChange={(event) => setPlayerName(event.target.value)} autoComplete="nickname" />
            <button data-autofocus type="submit" className="cg-button cg-button--primary" disabled={!originId || busy}>
              {busy ? "正在建立世界……" : "进入世界"}
            </button>
          </form>
        </Dialog>
      ) : null}

      {dialog === "saves" && active ? (
        <Dialog title="选择存档" description={`继续《${active.script.name}》中的一个时间点。`} onClose={() => setDialog(null)}>
          <ul className="cg-save-list">
            {active.detail.saves.map((save) => (
              <li key={save.runId}>
                <button type="button" className="cg-save-row" disabled={busy} onClick={() => void actions.continueRun(save.runId)}>
                  <span>{save.runId === "autosave.json" ? "自动存档" : save.runId.replace(/\.json$/, "")}</span>
                  <time dateTime={save.updatedAt}>{new Date(save.updatedAt).toLocaleString("zh-CN")}</time>
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      ) : null}
    </div>
  );
}
