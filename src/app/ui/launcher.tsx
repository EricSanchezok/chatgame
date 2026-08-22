"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, LockKeyhole } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Badge, Button, Input } from "@/shared/ui-runtime";
import type { LauncherSlotProps } from "../lib/script-registry";
import type { ScriptDetail, ScriptMeta, ScriptSummary } from "../lib/api";
import { loadScriptUi } from "../lib/script-registry";
import { enterFullscreen } from "../lib/fullscreen";
import { applyTheme } from "../lib/theme";
import { patchPlayerSettings, readPlayerSettings } from "../lib/settings";
import { Dialog } from "./dialog";
import { HostAppShell } from "./host-app-shell";
import { SlotRenderer } from "./game/slots";
import { useGameActions, useGamePort, useGameSelector } from "./game/state";

type ActiveProgramme = { script: ScriptSummary; detail: ScriptDetail };
type LauncherDialog = "saves" | null;
type NewGameStep = LauncherSlotProps["newGame"]["step"];
type NewGameStatus = LauncherSlotProps["newGame"]["status"];

function originAvailable(originId: string, meta: ScriptMeta | null): boolean {
  if (!meta || !meta.lockableOrigins.includes(originId)) return true;
  return meta.unlockedOrigins.includes(originId);
}

function coverUrl(script: ScriptSummary, assetUrl: (scriptId: string, file: string) => string): string {
  return script.cover?.file ? assetUrl(script.id, script.cover.file) : "";
}

function latestSaveFor(saves: ScriptDetail["saves"]): ScriptDetail["saves"][number] | null {
  return saves.reduce<ScriptDetail["saves"][number] | null>((latest, save) => {
    if (!latest) return save;
    const latestTime = Date.parse(latest.updatedAt);
    const saveTime = Date.parse(save.updatedAt);
    if (Number.isNaN(latestTime)) return save;
    if (Number.isNaN(saveTime)) return latest;
    return saveTime > latestTime ? save : latest;
  }, null);
}

function DefaultLauncherBackground({ script, coverUrl: src }: Pick<LauncherSlotProps, "script" | "coverUrl">) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- local script assets are runtime-addressed.
    <img className="cg-launcher__cover-image" src={src} alt={script.cover?.alt ?? ""} />
  ) : (
    <div className="cg-launcher__cover-fallback" aria-hidden="true">{script.name.slice(0, 1)}</div>
  );
}

function centerOriginCard(container: HTMLDivElement | null, originId: string): void {
  const card = container?.querySelector<HTMLElement>(`[data-origin-id="${CSS.escape(originId)}"]`);
  if (!container || !card) return;
  const containerRect = container.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  container.scrollTo({
    left: container.scrollLeft + cardRect.left - containerRect.left - (container.clientWidth - card.clientWidth) / 2,
  });
}

function OriginCarousel({ newGame }: Pick<LauncherSlotProps, "newGame">) {
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const availableOrigins = newGame.origins.filter((origin) => origin.available);
  const selectedIndex = availableOrigins.findIndex((origin) => origin.id === newGame.selectedOriginId);

  const move = useCallback((delta: number) => {
    if (availableOrigins.length === 0) return;
    const nextIndex = Math.min(Math.max(selectedIndex + delta, 0), availableOrigins.length - 1);
    const next = availableOrigins[nextIndex];
    if (!next) return;
    newGame.selectOrigin(next.id);
    centerOriginCard(carouselRef.current, next.id);
  }, [availableOrigins, newGame, selectedIndex]);

  useEffect(() => {
    centerOriginCard(carouselRef.current, newGame.selectedOriginId);
  }, [newGame.selectedOriginId]);

  return (
    <div className="cg-origin-picker" onKeyDown={(event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        move(event.key === "ArrowLeft" ? -1 : 1);
      }
    }}>
      <div className="cg-origin-picker__toolbar">
        <p><strong>选择出身</strong><span>左右滑动，或使用方向键浏览。</span></p>
        <div aria-label="浏览出身">
          <Button type="button" size="icon" variant="secondary" aria-label="上一个出身" disabled={selectedIndex <= 0} onClick={() => move(-1)}><ArrowLeft /></Button>
          <Button type="button" size="icon" variant="secondary" aria-label="下一个出身" disabled={selectedIndex < 0 || selectedIndex >= availableOrigins.length - 1} onClick={() => move(1)}><ArrowRight /></Button>
        </div>
      </div>
      <div ref={carouselRef} className="cg-origin-carousel" role="listbox" aria-label="可选出身" tabIndex={0}>
        {newGame.origins.map((origin) => (
          <button
            key={origin.id}
            type="button"
            role="option"
            aria-selected={origin.id === newGame.selectedOriginId}
            aria-disabled={!origin.available}
            data-origin-id={origin.id}
            data-locked={!origin.available || undefined}
            className="cg-origin-card"
            onClick={() => { if (origin.available) newGame.selectOrigin(origin.id); }}
          >
            <span className="cg-origin-card__meta">
              <Badge tone={origin.available ? "outline" : "neutral"}>{origin.available ? origin.difficulty || "可用" : <><LockKeyhole /> 未解锁</>}</Badge>
              <span>{origin.id === newGame.selectedOriginId ? "已选择" : ""}</span>
            </span>
            <strong>{origin.name}</strong>
            <p>{origin.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function DefaultLauncherProgramme({ script, detail, coverUrl: src, resume, newGame, actions }: LauncherSlotProps) {
  const selectedOrigin = newGame.origins.find((origin) => origin.id === newGame.selectedOriginId);
  const stepIndex = newGame.step === "overview" ? 0 : newGame.step === "origin" ? 1 : 2;
  return (
    <div className="cg-launcher-stage" data-step={newGame.step}>
      <div className="cg-launcher-stage__track" style={{ "--cg-launcher-step": stepIndex } as CSSProperties}>
        <section className="cg-launcher-step" aria-labelledby="programme-title" inert={newGame.step !== "overview"} aria-hidden={newGame.step !== "overview"}>
          <div className="cg-launcher-card cg-launcher-card--programme">
            <div className="cg-launcher__cover"><DefaultLauncherBackground script={script} coverUrl={src} /></div>
            <div className="cg-launcher__copy">
              <Badge tone="outline">正在展映</Badge>
              <h1 id="programme-title">{script.name}</h1>
              <p>{script.description}</p>
              <dl className="cg-launcher__facts">
                <div><dt>作者</dt><dd>{script.author}</dd></div>
                <div><dt>语言</dt><dd>{script.language}</dd></div>
                {script.safety?.age_rating ? <div><dt>分级</dt><dd>{script.safety.age_rating}</dd></div> : null}
              </dl>
              {script.tone.length > 0 ? <p className="cg-launcher__tone">{script.tone.join(" · ")}</p> : null}
              <div className="cg-launcher-card__actions" aria-label={`${script.name} 玩家操作`}>
                <Button variant="primary" size="lg" disabled={resume.busy} onClick={actions.openNewGame}>开始新游戏</Button>
                {resume.save ? (
                  <Button type="button" variant="secondary" size="lg" disabled={resume.busy} onClick={() => void resume.continueGame()}>
                    {resume.busy ? "正在继续……" : "继续游戏"}
                  </Button>
                ) : null}
                <Button type="button" variant="secondary" size="lg" disabled={resume.busy || detail.saves.length === 0} onClick={actions.openSaves}>选择存档</Button>
                {detail.saves.length === 0 ? <p className="cg-help">当前剧本尚无存档。</p> : null}
              </div>
            </div>
          </div>
        </section>

        <section className="cg-launcher-step" aria-labelledby="origin-step-title" inert={newGame.step !== "origin"} aria-hidden={newGame.step !== "origin"}>
          <div className="cg-launcher-card cg-launcher-card--origin">
            <header className="cg-launcher-card__header"><div><span className="cg-kicker">新游戏 · 1 / 2</span><h2 id="origin-step-title">你从哪里来</h2><p>出身决定第一幕的关系、资源与可见机会。</p></div><Button type="button" variant="quiet" onClick={newGame.back}><ArrowLeft /> 返回介绍</Button></header>
            {newGame.status === "loading" ? <div className="cg-launcher-inline-state" role="status">正在读取已解锁出身……</div> : null}
            {newGame.status === "error" ? <div className="cg-launcher-inline-state cg-launcher-inline-state--error" role="alert"><p>{newGame.error}</p><Button type="button" variant="secondary" onClick={newGame.retry}>重新加载</Button></div> : null}
            {newGame.status === "ready" ? <OriginCarousel newGame={newGame} /> : null}
            <footer className="cg-launcher-card__footer"><p>{selectedOrigin ? `已选择：${selectedOrigin.name}` : "选择一个已解锁的出身。"}</p><Button type="button" variant="primary" size="lg" disabled={!selectedOrigin?.available} onClick={newGame.next}>确认这个出身</Button></footer>
          </div>
        </section>

        <section className="cg-launcher-step" aria-labelledby="identity-step-title" inert={newGame.step !== "identity"} aria-hidden={newGame.step !== "identity"}>
          <form className="cg-launcher-card cg-launcher-card--identity" onSubmit={(event) => { event.preventDefault(); if (selectedOrigin?.available) void actions.start(selectedOrigin.id, newGame.playerName.trim() || undefined); }}>
            <header className="cg-launcher-card__header"><div><span className="cg-kicker">新游戏 · 2 / 2</span><h2 id="identity-step-title">确认你的身份</h2><p>你将以这个身份进入《{script.name}》。</p></div><Button type="button" variant="quiet" onClick={newGame.back}><ArrowLeft /> 重选出身</Button></header>
            <div className="cg-identity-summary"><Badge tone="accent">{selectedOrigin?.difficulty || "出身"}</Badge><h3>{selectedOrigin?.name}</h3><p>{selectedOrigin?.description}</p></div>
            <div className="cg-identity-name"><label htmlFor="player-name">名字（可选）</label><p id="player-name-help">留空时使用剧本默认称呼。</p><Input id="player-name" aria-describedby="player-name-help" value={newGame.playerName} onChange={(event) => newGame.setPlayerName(event.target.value)} autoComplete="nickname" /></div>
            <footer className="cg-launcher-card__footer"><p>进入后将建立第一份自动存档。</p><Button type="submit" variant="primary" size="lg" disabled={!selectedOrigin?.available}>进入世界</Button></footer>
          </form>
        </section>
      </div>
    </div>
  );
}

export function Launcher() {
  const port = useGamePort();
  const { startNewGame, continueGame, clearError } = useGameActions();
  const operation = useGameSelector((state) => state.operation);
  const gameError = useGameSelector((state) => state.error);
  const [active, setActive] = useState<ActiveProgramme | null>(null);
  const [dialog, setDialog] = useState<LauncherDialog>(null);
  const [meta, setMeta] = useState<ScriptMeta | null>(null);
  const [newGameStep, setNewGameStep] = useState<NewGameStep>("overview");
  const [newGameStatus, setNewGameStatus] = useState<NewGameStatus>("idle");
  const [newGameError, setNewGameError] = useState<string | null>(null);
  const [originId, setOriginId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [loading, setLoading] = useState(true);
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
          setLoading(false);
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
        setStatus(
          ui.ok
            ? `${selected.name}已就绪。`
            : `${selected.name}使用宿主界面；扩展加载失败：${ui.error ?? "未知错误"}。`,
        );
        setLoading(false);

      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus(`剧目单读取失败：${error instanceof Error ? error.message : String(error)}。请重试。`);
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [port]);

  const loadOrigins = useCallback(() => {
    if (!active) return;
    clearError();
    setMeta(null);
    setNewGameError(null);
    setNewGameStatus("loading");
    void port.scriptMeta(active.script.id).then((nextMeta) => {
      setMeta(nextMeta);
      setOriginId(active.detail.origins.find((origin) => originAvailable(origin.id, nextMeta))?.id ?? "");
      setNewGameStatus("ready");
    }).catch((error) => {
      setNewGameError(`出身信息读取失败：${error instanceof Error ? error.message : String(error)}`);
      setNewGameStatus("error");
    });
  }, [active, clearError, port]);

  const openNewGame = useCallback(() => {
    setNewGameStep("origin");
    loadOrigins();
  }, [loadOrigins]);

  const openSaves = useCallback(() => {
    clearError();
    setDialog("saves");
  }, [clearError]);

  const actions = useMemo<LauncherSlotProps["actions"]>(() => ({
    openNewGame,
    openSaves,
    async start(nextOriginId, nextPlayerName) {
      if (!active) return;
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

  const newGame = useMemo<LauncherSlotProps["newGame"]>(() => ({
    step: newGameStep,
    status: newGameStatus,
    origins: active?.detail.origins.map((origin) => ({ ...origin, available: originAvailable(origin.id, meta) })) ?? [],
    selectedOriginId: originId,
    playerName,
    error: newGameError,
    selectOrigin(nextOriginId) {
      const origin = active?.detail.origins.find((item) => item.id === nextOriginId);
      if (origin && originAvailable(origin.id, meta)) setOriginId(nextOriginId);
    },
    setPlayerName,
    next() {
      if (newGameStep === "overview") openNewGame();
      else if (newGameStep === "origin" && originId) setNewGameStep("identity");
    },
    back() { setNewGameStep((step) => step === "identity" ? "origin" : "overview"); },
    retry: loadOrigins,
  }), [active, loadOrigins, meta, newGameError, newGameStatus, newGameStep, openNewGame, originId, playerName]);

  const latestSave = useMemo(() => latestSaveFor(active?.detail.saves ?? []), [active]);

  const resume = useMemo<LauncherSlotProps["resume"]>(() => ({
    save: latestSave,
    busy,
    async continueGame() {
      if (!active || !latestSave) return;
      if (readPlayerSettings().fullscreenOnStart) void enterFullscreen();
      await continueGame(active.script.id, latestSave.runId);
    },
  }), [active, busy, continueGame, latestSave]);

  const DefaultLauncherSurface = useCallback((props: LauncherSlotProps) => (
    <HostAppShell
      active="home"
      script={{ name: props.script.name, description: props.script.description }}
      recentCount={props.detail.saves.length}
      onOpenRecent={openSaves}
    >
      <DefaultLauncherProgramme {...props} />
    </HostAppShell>
  ), [openSaves]);

  return (
    <>
      {active ? (
        <SlotRenderer
          slot="launcher"
          fallback={DefaultLauncherSurface}
          slotProps={{
            script: active.script,
            detail: active.detail,
            coverUrl: coverUrl(active.script, port.assetUrl.bind(port)),
            resume,
            newGame,
            actions,
          }}
        />
      ) : (
        <HostAppShell active="home">
          <div className="cg-empty-library">
            <h1>{loading ? "正在准备剧目" : "今晚还没有剧目"}</h1>
            <p role="status" aria-live="polite">{status}</p>
            {!loading ? <Button render={<Link href="/scripts" />} nativeButton={false} variant="primary">打开剧本库</Button> : null}
          </div>
        </HostAppShell>
      )}

      {active ? <p className={gameError ? "cg-toast" : "cg-sr-only"} role="status" aria-live="polite">{gameError || status}</p> : null}

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
    </>
  );
}
