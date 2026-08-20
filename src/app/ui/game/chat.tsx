"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { BubbleSlotProps, ComposerSlotProps, GameShellSlotProps, SceneSlotProps, ScriptHostModel } from "../../lib/script-registry";
import type { ActionPreview, Catalog, IntentHint, TranscriptEntry, TurnResultFull } from "../../lib/api";
import { useScriptRegistry } from "../../lib/script-registry";
import { EntryCards, ResolutionChip } from "./cards";
import { ActivePanel } from "./panels";
import { Hud } from "./hud";
import { Toolbar } from "./toolbar";
import { PauseMenu } from "./pause-menu";
import { UiIcon } from "./ui-icon";
import { SlotRenderer } from "./slots";
import { useGameActions, useGameSelector } from "./state";

function DefaultGameShell({ regions }: GameShellSlotProps) {
  return (
    <div className="cg-game-shell">
      {regions.hud}
      {regions.scene}
      {regions.toolbar}
      {regions.composer}
      {regions.overlays}
    </div>
  );
}

function DefaultScene({ transcript }: SceneSlotProps) {
  return <>{transcript}</>;
}

function DefaultBubble({ entry, children }: BubbleSlotProps) {
  return (
    <article className="cg-message" data-role={entry.role}>
      {children}
    </article>
  );
}

function BubbleAdapter(props: ScriptHostModel & { entry: TranscriptEntry; children: ReactNode }) {
  return (
    <SlotRenderer
      slot={`bubble:${props.entry.role}`}
      fallback={DefaultBubble}
      slotProps={props}
    />
  );
}

const Transcript = memo(function Transcript({
  model,
  lastTurn,
  busy,
}: {
  model: ScriptHostModel;
  lastTurn: TurnResultFull | null;
  busy: boolean;
}) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const atBottomRef = useRef(true);
  const transcript = model.state.transcript;
  const actionName = (id: string) => model.catalog.actions.find((action) => action.id === id)?.displayName ?? id;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !atBottomRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [transcript.length, lastTurn]);

  return (
    <main
      ref={scrollRef}
      data-region="transcript"
      className="cg-transcript"
      onScroll={(event) => {
        const element = event.currentTarget;
        atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
      }}
    >
      <div className="cg-transcript__inner">
        {transcript.map((entry) => (
          <BubbleAdapter key={entry.id} {...model} entry={entry}>
            <p>{entry.text}</p>
            {entry.role === "world" ? <EntryCards entry={entry} {...model} manifest={model.assets} /> : null}
          </BubbleAdapter>
        ))}
        {lastTurn?.resolution && lastTurn.resolution.actionId !== "talk" ? (
          <div className="cg-resolution-row">
            <ResolutionChip
              actionName={actionName(lastTurn.resolution.actionId)}
              grade={lastTurn.resolution.grade}
              roll={lastTurn.resolution.roll}
              dc={lastTurn.resolution.dc}
            />
          </div>
        ) : null}
        {lastTurn ? <SystemFeedbackBlock lastTurn={lastTurn} actionName={actionName} /> : null}
        {busy ? <p className="cg-world-wait" role="status">世界正在回应……</p> : null}
      </div>
    </main>
  );
});

const RESOURCE_KIND_LABELS = {
  need: "需求",
  stat: "属性",
  skill: "技能",
  runtime: "剧本资源",
} as const;

const RISK_TYPE_LABELS = {
  none: "无需判定",
  stat: "属性判定",
  skill: "技能判定",
  opposed: "对抗判定",
} as const;

export function actionPreviewDetails(preview: ActionPreview, catalog: Catalog): string[] {
  const details = [`耗时：${preview.timeCost} 小时`];
  if (preview.costs.currency > 0) {
    details.push(`货币：${preview.costs.currency} ${catalog.currency.name}`);
  }
  for (const item of preview.costs.items) {
    const name = catalog.items.find((candidate) => candidate.id === item.itemId)?.name ?? item.itemId;
    details.push(`物品：${name} ×${item.quantity}`);
  }
  for (const resource of preview.costs.resources ?? []) {
    details.push(`${RESOURCE_KIND_LABELS[resource.kind]} ${resource.id}：消耗 ${resource.amount}`);
  }
  if (preview.costs.currency <= 0 && preview.costs.items.length === 0 && (preview.costs.resources?.length ?? 0) === 0) {
    details.push("无资源消耗");
  }

  const risk = preview.risk;
  const riskParts = [`判定：${RISK_TYPE_LABELS[risk.type]}`];
  if (risk.key) riskParts.push(risk.key);
  if (risk.dc !== undefined) riskParts.push(`DC ${risk.dc}`);
  details.push(riskParts.join(" · "));
  return details;
}

export function ActionPreviewFeedback({ preview, catalog }: { preview: ActionPreview; catalog: Catalog }) {
  const reason = preview.reason ?? preview.reasonCode ?? "条件不足";
  return (
    <div className="cg-action-preview" role="status" aria-live="polite" aria-atomic="true">
      <strong>{preview.displayName}</strong>
      {!preview.executable ? <span className="cg-action-preview__reason">当前不可执行：{reason}</span> : null}
      <ul aria-label="行动成本与风险">
        {actionPreviewDetails(preview, catalog).map((detail) => <li key={detail}>{detail}</li>)}
      </ul>
    </div>
  );
}

function DefaultComposer({ busy, submitTurn, previewAction, scriptId, assets, catalog }: ComposerSlotProps) {
  const [input, setInput] = useState("");
  const [intentHint, setIntentHint] = useState<IntentHint | undefined>();
  const [preview, setPreview] = useState<ActionPreview | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await submitTurn(text, intentHint);
    setIntentHint(undefined);
    setPreview(null);
  }

  return (
    <footer data-region="composer" className="cg-composer">
      {catalog.actions.length > 0 ? (
        <div className="cg-action-shortcuts" aria-label="行动快捷方式">
          {catalog.actions.slice(0, 4).map((action) => (
            <button
              key={action.id}
              type="button"
              className="cg-button cg-button--quiet"
              aria-pressed={intentHint?.actionId === action.id}
              disabled={busy}
              onClick={() => {
                const hint = { actionId: action.id };
                void previewAction(hint).then((result) => {
                  setPreview(result);
                  setIntentHint(result?.executable ? hint : undefined);
                });
              }}
            >
              {action.displayName}
            </button>
          ))}
        </div>
      ) : null}
      {preview ? <ActionPreviewFeedback preview={preview} catalog={catalog} /> : null}
      <form onSubmit={(event) => void onSubmit(event)}>
        <label className="cg-sr-only" htmlFor="player-input">输入你的话或行动</label>
        <textarea
          id="player-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="说点什么，或描述你的行动"
          disabled={busy}
          maxLength={2000}
          rows={2}
        />
        <button type="submit" className="cg-button cg-button--primary" disabled={busy || input.trim().length === 0}>
          <UiIcon slot="send" scriptId={scriptId} manifest={assets} className="cg-icon" />
          {busy ? "等待世界" : "发送"}
        </button>
      </form>
    </footer>
  );
}

function ComposerRegion({
  model,
  busy,
  submitTurn,
  previewAction,
}: {
  model: ScriptHostModel;
  busy: boolean;
  submitTurn(text: string, intentHint?: IntentHint): Promise<void>;
  previewAction(intentHint: IntentHint): Promise<ActionPreview | null>;
}) {
  return <SlotRenderer slot="composer" fallback={DefaultComposer} slotProps={{ ...model, busy, submitTurn, previewAction }} />;
}

export function GameScreen() {
  const session = useGameSelector((state) => state.session);
  const detail = useGameSelector((state) => state.detail);
  const operation = useGameSelector((state) => state.operation);
  const panel = useGameSelector((state) => state.panel);
  const paused = useGameSelector((state) => state.paused);
  const dirty = useGameSelector((state) => state.dirty);
  const error = useGameSelector((state) => state.error);
  const announcement = useGameSelector((state) => state.announcement);
  const themeMode = useGameSelector((state) => state.themeMode);
  const audioEnabled = useGameSelector((state) => state.audioEnabled);
  const lastTurn = useGameSelector((state) => state.lastTurn);
  const registry = useScriptRegistry();
  const { submitTurn, previewAction, save, exitGame, setTheme, setAudio, setPanel, setPause } = useGameActions();
  const busy = operation !== "idle";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panel) setPanel(null);
      else setPause(!paused);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panel, paused, setPanel, setPause]);

  const submit = useCallback((text: string, intentHint?: IntentHint) => submitTurn(text, intentHint), [submitTurn]);
  const preview = useCallback((intentHint: IntentHint) => previewAction(intentHint), [previewAction]);

  if (!session || !detail) return null;
  if (registry.scriptId !== session.scriptId || registry.status === "loading") {
    return <div className="cg-game-loading" role="status">正在装台，世界即将就绪……</div>;
  }

  const model: ScriptHostModel = {
    scriptId: session.scriptId,
    state: session.state,
    catalog: detail.catalog,
    assets: detail.assets,
  };
  const transcript = <Transcript model={model} lastTurn={lastTurn} busy={busy} />;
  const scene = <SlotRenderer slot="scene" fallback={DefaultScene} slotProps={{ ...model, transcript }} />;
  const overlays = (
    <>
      <ActivePanel panel={panel} {...model} onClose={() => setPanel(null)} />
      {paused ? (
        <PauseMenu
          {...model}
          themeMode={themeMode}
          themes={session.presentation.themes}
          audioEnabled={audioEnabled}
          dirty={dirty}
          busy={busy}
          onTheme={setTheme}
          onAudio={setAudio}
          onSave={save}
          onExit={async (saveFirst) => {
            await exitGame(saveFirst);
            setPause(false);
          }}
          onClose={() => setPause(false)}
        />
      ) : null}
      {error ? <div className="cg-toast" role="alert">{error}</div> : null}
      <p className="cg-sr-only" role="status" aria-live="polite">{announcement}</p>
    </>
  );
  const regions: GameShellSlotProps["regions"] = {
    hud: <Hud {...model} />,
    scene,
    toolbar: <Toolbar {...model} panel={panel} onOpenPanel={setPanel} />,
    composer: <ComposerRegion model={model} busy={busy} submitTurn={submit} previewAction={preview} />,
    overlays,
  };
  return <SlotRenderer slot="game-shell" fallback={DefaultGameShell} slotProps={{ ...model, regions }} />;
}

function SystemFeedbackBlock({
  lastTurn,
  actionName,
}: {
  lastTurn: TurnResultFull;
  actionName: (id: string) => string;
}) {
  const { worldEvents, taskCompletions, deathFired, fellBackToTalk } = lastTurn;
  if (worldEvents.length === 0 && taskCompletions.length === 0 && !deathFired && !fellBackToTalk) return null;
  return (
    <section className="cg-system-feedback" aria-label="回合结果">
      {worldEvents.length > 0 ? <ul>{worldEvents.map((event, index) => <li key={`${index}-${event}`}>世界事件：{event}</li>)}</ul> : null}
      {taskCompletions.length > 0 ? <ul>{taskCompletions.map((task) => <li key={task.taskId}>任务{task.status === "complete" ? "完成" : "失败"}：{actionName(task.taskId)}</li>)}</ul> : null}
      {deathFired ? <p>你遭遇了致命打击。</p> : null}
      {fellBackToTalk ? <p>未能识别你的意图，已按交谈处理。</p> : null}
    </section>
  );
}
