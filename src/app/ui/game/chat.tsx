"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ArrowDown, ArrowUp, Sparkles, Target } from "lucide-react";
import { Button, InputGroup, Textarea } from "@/shared/ui-runtime";
import type {
  BubbleSlotProps,
  GameObjective,
  GamePresentation,
  GameShellSlotProps,
  GameSuggestion,
  SceneSlotProps,
  ScriptHostModel,
} from "../../lib/script-registry";
import type { ActionPreview, Catalog, IntentHint, TurnResultFull } from "../../lib/api";
import { useScriptRegistry } from "../../lib/script-registry";
import { EntryCards, ResolutionChip, assetSrc } from "./cards";
import { ActivePanel } from "./panels";
import { PauseMenu } from "./pause-menu";
import { SlotRenderer } from "./slots";
import { useGameActions, useGameSelector } from "./state";
import {
  GameToolRail,
  MobileToolsButton,
  ToolPickerDialog,
} from "./toolbar";
import { useScrollActivity } from "../use-scroll-activity";

function DefaultGameShell({ regions }: GameShellSlotProps) {
  return (
    <div className="cg-game-workspace">
      <a className="cg-skip-link" href="#cg-game-conversation">跳到游戏对话</a>
      {regions.topbar}
      <main id="cg-game-conversation" className="cg-game-main" aria-label="游戏会话">
        {regions.conversation}
      </main>
      {regions.toolRail}
      {regions.overlays}
    </div>
  );
}

function DefaultScene({ transcript }: SceneSlotProps) {
  return <>{transcript}</>;
}

function NpcIdentity({
  speaker,
  first,
  scriptId,
  assets,
  onOpen,
}: {
  speaker: NonNullable<BubbleSlotProps["speaker"]>;
  first: boolean;
  scriptId: string;
  assets: ScriptHostModel["assets"];
  onOpen(id: string): void;
}) {
  const portrait = assetSrc(scriptId, assets, "portraits", speaker.id);
  return (
    <button type="button" className="cg-speaker" onClick={() => onOpen(speaker.id)} aria-label={`查看人物：${speaker.name}`}>
      <span className="cg-speaker__avatar" aria-hidden="true">
        {speaker.name.slice(0, 1)}
        {portrait ? (
          // eslint-disable-next-line @next/next/no-img-element -- script portraits are runtime-addressed.
          <img src={portrait} alt="" />
        ) : null}
      </span>
      <span className="cg-speaker__copy">
        <strong>{speaker.name}</strong>
        {speaker.occupation ? <small>{speaker.occupation}</small> : null}
        {first ? <em>首次相遇</em> : null}
      </span>
    </button>
  );
}

function DefaultBubble({ entry, speaker, isFirstAppearance, scriptId, assets, children, openPerson }: BubbleSlotProps & { openPerson?(id: string): void }) {
  return (
    <article className="cg-message" data-role={entry.role}>
      {entry.role === "world" ? (
        speaker ? (
          <NpcIdentity
            speaker={speaker}
            first={isFirstAppearance}
            scriptId={scriptId}
            assets={assets}
            onOpen={(id) => openPerson?.(id)}
          />
        ) : (
          <div className="cg-world-identity">
            <span className="cg-world-identity__mark" aria-hidden="true"><Sparkles /></span>
            <strong>世界</strong>
          </div>
        )
      ) : null}
      <div className="cg-message__body">{children}</div>
    </article>
  );
}

function BubbleAdapter(props: ScriptHostModel & BubbleSlotProps & { openPerson(id: string): void }) {
  return (
    <SlotRenderer
      slot={`bubble:${props.entry.role}`}
      fallback={DefaultBubble}
      slotProps={props}
    />
  );
}

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
  const details = [`耗时 ${preview.timeCost} 小时`];
  if (preview.costs.currency > 0) details.push(`${catalog.currency.name} ${preview.costs.currency}`);
  for (const item of preview.costs.items) {
    const name = catalog.items.find((candidate) => candidate.id === item.itemId)?.name ?? item.itemId;
    details.push(`${name} ×${item.quantity}`);
  }
  for (const resource of preview.costs.resources ?? []) {
    details.push(`${RESOURCE_KIND_LABELS[resource.kind]} ${resource.id} −${resource.amount}`);
  }
  const risk = preview.risk;
  const riskParts: string[] = [RISK_TYPE_LABELS[risk.type]];
  if (risk.key) riskParts.push(risk.key);
  if (risk.dc !== undefined) riskParts.push(`DC ${risk.dc}`);
  details.push(riskParts.join(" · "));
  return details;
}

export function ActionPreviewFeedback({ preview, catalog }: { preview: ActionPreview; catalog: Catalog }) {
  const reason = preview.reason ?? preview.reasonCode ?? "条件不足";
  return (
    <div className="cg-action-preview" role="status" aria-live="polite" aria-atomic="true" data-executable={preview.executable ? "true" : "false"}>
      {!preview.executable ? <strong>当前不可执行：{reason}</strong> : null}
      <span>{actionPreviewDetails(preview, catalog).join(" · ")}</span>
    </div>
  );
}

function SystemFeedbackBlock({ lastTurn, actionName }: { lastTurn: TurnResultFull; actionName(id: string): string }) {
  const { taskCompletions, deathFired, fellBackToTalk } = lastTurn;
  const worldEvents = lastTurn.worldEvents.filter((event) => !/^event "[^"]+" played$/i.test(event));
  if (worldEvents.length === 0 && taskCompletions.length === 0 && !deathFired && !fellBackToTalk) return null;
  return (
    <section className="cg-system-feedback" aria-label="回合结果">
      {worldEvents.map((event) => <p key={event}>{event}</p>)}
      {taskCompletions.map((task) => <p key={task.taskId}>任务{task.status === "complete" ? "完成" : "失败"}：{actionName(task.taskId)}</p>)}
      {deathFired ? <p>你遭遇了致命打击。</p> : null}
      {fellBackToTalk ? <p>未能识别你的意图，已按交谈处理。</p> : null}
    </section>
  );
}

function SuggestionRows({ suggestions, disabled, onSelect }: {
  suggestions: readonly GameSuggestion[];
  disabled: boolean;
  onSelect(suggestion: GameSuggestion): void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="cg-suggestions" aria-label="建议行动">
      {suggestions.slice(0, 3).map((suggestion) => (
        <button key={suggestion.id} type="button" disabled={disabled} onClick={() => onSelect(suggestion)}>
          <span>{suggestion.label}</span>
          {suggestion.detail ? <small>{suggestion.detail}</small> : null}
          <ArrowUp aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

const Transcript = memo(function Transcript({
  model,
  lastTurn,
  busy,
  suggestions,
  onSelectSuggestion,
  onOpenPerson,
}: {
  model: ScriptHostModel;
  lastTurn: TurnResultFull | null;
  busy: boolean;
  suggestions: readonly GameSuggestion[];
  onSelectSuggestion(suggestion: GameSuggestion): void;
  onOpenPerson(id: string): void;
}) {
  const transcript = model.state.transcript;
  const latestWorldIndex = transcript.findLastIndex((entry) => entry.role === "world");
  const actionName = (id: string) => model.catalog.actions.find((action) => action.id === id)?.displayName
    ?? model.catalog.tasks.find((task) => task.id === id)?.name
    ?? id;

  return (
    <div role="log" className="cg-transcript" aria-label="游戏对话记录" aria-live="polite">
      {transcript.map((entry, index) => {
        const speech = entry.mediaCues.find((cue) => cue.kind === "npc_speech");
        const npcId = speech?.kind === "npc_speech" ? speech.npcId : null;
        const npc = npcId ? model.catalog.npcs.find((candidate) => candidate.id === npcId) : undefined;
        const relation = npcId ? model.state.player.relations.find((candidate) => candidate.npcId === npcId) : undefined;
        const isFirstAppearance = Boolean(npcId) && !transcript.slice(0, index).some((candidate) =>
          candidate.mediaCues.some((cue) => cue.kind === "npc_speech" && cue.npcId === npcId));
        const speaker = npc ? { ...npc, relationLabel: relation ? `${relation.stance} · ${relation.value}` : undefined } : undefined;
        const isLatestWorld = index === latestWorldIndex;
        return (
          <BubbleAdapter
            key={entry.id}
            {...model}
            entry={entry}
            speaker={speaker}
            isFirstAppearance={isFirstAppearance}
            openPerson={onOpenPerson}
          >
            <p>{entry.text}</p>
            {entry.role === "world" ? <EntryCards entry={entry} {...model} manifest={model.assets} /> : null}
            {isLatestWorld && lastTurn?.resolution && lastTurn.resolution.actionId !== "talk" ? (
              <ResolutionChip
                actionName={actionName(lastTurn.resolution.actionId)}
                grade={lastTurn.resolution.grade}
                roll={lastTurn.resolution.roll}
                dc={lastTurn.resolution.dc}
              />
            ) : null}
            {isLatestWorld && lastTurn ? <SystemFeedbackBlock lastTurn={lastTurn} actionName={actionName} /> : null}
            {isLatestWorld ? <SuggestionRows suggestions={suggestions} disabled={busy} onSelect={onSelectSuggestion} /> : null}
          </BubbleAdapter>
        );
      })}
      {busy ? <p className="cg-world-wait" role="status"><span aria-hidden="true" />世界正在回应</p> : null}
    </div>
  );
});

function Composer({
  model,
  busy,
  previewing,
  input,
  preview,
  previewError,
  textareaRef,
  onInput,
  onSubmit,
}: {
  model: ScriptHostModel;
  busy: boolean;
  previewing: boolean;
  input: string;
  preview: ActionPreview | null;
  previewError: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onInput(value: string): void;
  onSubmit(): Promise<void>;
}) {
  const cannotSubmit = busy || previewing || !input.trim() || preview?.executable === false;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!cannotSubmit) void onSubmit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!cannotSubmit) event.currentTarget.form?.requestSubmit();
  };
  return (
    <div className="cg-composer-mask">
      <footer className="cg-composer" data-busy={busy || previewing ? "true" : "false"}>
        <form onSubmit={submit}>
          <label className="cg-sr-only" htmlFor="player-input">输入你的话或行动</label>
          <InputGroup className="cg-composer__surface">
            <Textarea
              ref={textareaRef}
              id="player-input"
              value={input}
              onChange={(event) => onInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="说点什么，或描述你的行动"
              disabled={busy}
              maxLength={2000}
              rows={1}
            />
            <Button type="submit" variant="primary" size="icon" aria-label={busy ? "等待世界回应" : "发送"} disabled={cannotSubmit}>
              <ArrowUp aria-hidden="true" />
            </Button>
          </InputGroup>
        </form>
        {previewing ? <div className="cg-action-preview" role="status">正在读取行动成本与风险……</div> : null}
        {preview ? <ActionPreviewFeedback preview={preview} catalog={model.catalog} /> : null}
        {previewError ? <div className="cg-action-preview" data-executable="false" role="alert">{previewError}</div> : null}
        <p className="cg-composer__hint">Enter 发送 · Shift + Enter 换行</p>
      </footer>
    </div>
  );
}

function Conversation({
  model,
  lastTurn,
  operation,
  suggestions,
  submitTurn,
  previewAction,
  openPerson,
}: {
  model: ScriptHostModel;
  lastTurn: TurnResultFull | null;
  operation: string;
  suggestions: readonly GameSuggestion[];
  submitTurn(text: string, intentHint?: IntentHint): Promise<void>;
  previewAction(intentHint: IntentHint): Promise<ActionPreview | null>;
  openPerson(id: string): void;
}) {
  const [input, setInput] = useState("");
  const [intentHint, setIntentHint] = useState<IntentHint | undefined>();
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewGeneration = useRef(0);
  const scrollActivity = useScrollActivity();
  const busy = operation !== "idle" && operation !== "preview";
  const previewing = operation === "preview";
  const transcriptLength = model.state.transcript.length;

  const jumpToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const element = scrollRef.current;
    if (!element) return;
    if (typeof element.scrollTo === "function") element.scrollTo({ top: element.scrollHeight, behavior });
    else element.scrollTop = element.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    if (atBottom) jumpToLatest(lastTurn ? "smooth" : "auto");
  }, [atBottom, jumpToLatest, lastTurn, transcriptLength]);

  const clearSuggestion = useCallback(() => {
    previewGeneration.current += 1;
    setIntentHint(undefined);
    setPreview(null);
    setPreviewError("");
  }, []);

  const selectSuggestion = useCallback(async (suggestion: GameSuggestion) => {
    const generation = ++previewGeneration.current;
    setInput(suggestion.label);
    setIntentHint(suggestion.intentHint);
    setPreview(null);
    setPreviewError("");
    requestAnimationFrame(() => textareaRef.current?.focus());
    const result = await previewAction(suggestion.intentHint);
    if (generation !== previewGeneration.current) return;
    if (!result) {
      setPreviewError("暂时无法读取行动成本与风险，请重试。");
      setIntentHint(undefined);
      return;
    }
    setPreview(result);
    if (!result.executable) setIntentHint(undefined);
  }, [previewAction]);

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || previewing || preview?.executable === false) return;
    setInput("");
    clearSuggestion();
    await submitTurn(text, intentHint);
  }, [busy, clearSuggestion, input, intentHint, preview?.executable, previewing, submitTurn]);

  const transcript = (
    <Transcript
      model={model}
      lastTurn={lastTurn}
      busy={busy}
      suggestions={suggestions}
      onSelectSuggestion={(suggestion) => void selectSuggestion(suggestion)}
      onOpenPerson={openPerson}
    />
  );
  const scene = <SlotRenderer slot="scene" fallback={DefaultScene} slotProps={{ ...model, transcript }} />;
  const { onScroll: markScrollActive, ...activityProps } = scrollActivity;

  return (
    <section
      ref={scrollRef}
      className="cg-conversation-scroll cg-scroll-surface"
      tabIndex={0}
      {...activityProps}
      data-scroll-active={scrollActivity["data-scroll-active"]}
      onScroll={(event) => {
        markScrollActive();
        const element = event.currentTarget;
        setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight <= 64);
      }}
    >
      <div className="cg-conversation-lane">
        {scene}
        <div className="cg-composer-anchor">
          {!atBottom ? (
            <button type="button" className="cg-jump-latest" onClick={() => jumpToLatest()} aria-label="跳到最新消息">
              <ArrowDown aria-hidden="true" />
            </button>
          ) : null}
          <Composer
            model={model}
            busy={busy}
            previewing={previewing}
            input={input}
            preview={preview}
            previewError={previewError}
            textareaRef={textareaRef}
            onInput={(value) => { setInput(value); clearSuggestion(); }}
            onSubmit={submit}
          />
        </div>
      </div>
    </section>
  );
}

function fallbackObjective(model: ScriptHostModel, trackedTaskId: string | null): GameObjective | null {
  const active = model.state.tasks.filter((task) => task.status === "active");
  const selected = active.find((task) => task.taskId === trackedTaskId) ?? active[0];
  if (!selected) return null;
  const task = model.catalog.tasks.find((candidate) => candidate.id === selected.taskId);
  if (!task) return { title: selected.taskId };
  return {
    title: task.name,
    detail: task.objectiveText,
    progress: { value: selected.progress, max: task.quantity },
  };
}

function fallbackSuggestions(model: ScriptHostModel): readonly GameSuggestion[] {
  return model.catalog.actions.slice(0, 3).map((action) => ({
    id: action.id,
    label: action.displayName,
    intentHint: { actionId: action.id },
  }));
}

export function resolveGamePresentation(
  model: ScriptHostModel,
  trackedTaskId: string | null,
  presentation: GamePresentation | null,
): { objective: GameObjective | null; suggestions: readonly GameSuggestion[] } {
  let objective = fallbackObjective(model, trackedTaskId);
  let suggestions = fallbackSuggestions(model);
  try {
    objective = presentation?.objective(model) ?? objective;
  } catch {
    // Script presentation is optional decoration; host data remains usable.
  }
  try {
    suggestions = presentation?.suggestions(model) ?? suggestions;
  } catch {
    // A failing provider never removes the host's generic actions.
  }
  return { objective, suggestions: suggestions.slice(0, 3) };
}

function GameTopbar({ model, objective, onOpenTasks, onOpenTools }: {
  model: ScriptHostModel;
  objective: GameObjective | null;
  onOpenTasks(): void;
  onOpenTools(): void;
}) {
  const location = model.catalog.locations.find((candidate) => candidate.id === model.state.player.locationId)?.name
    ?? model.state.player.locationId;
  const time = `第 ${model.state.clock.day} 天 · ${String(model.state.clock.hour).padStart(2, "0")}:00`;
  const progress = objective?.progress ? ` · ${objective.progress.value}/${objective.progress.max}` : "";
  return (
    <header className="cg-game-topbar">
      <div className="cg-game-topbar__inner">
        <MobileToolsButton onClick={onOpenTools} />
        <p className="cg-game-topbar__place"><strong>{location}</strong><span>·</span><span>{time}</span></p>
        {objective ? (
          <button type="button" className="cg-game-topbar__objective" onClick={onOpenTasks} title={objective.detail}>
            <Target aria-hidden="true" />
            <span>{objective.title}{progress}</span>
          </button>
        ) : <span className="cg-game-topbar__objective cg-game-topbar__objective--empty">暂无目标</span>}
      </div>
    </header>
  );
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
  const trackedTaskId = useGameSelector((state) => state.trackedTaskId);
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const registry = useScriptRegistry();
  const { submitTurn, previewAction, save, exitGame, setTheme, setAudio, setPanel, setPause, setTrackedTask } = useGameActions();
  const busy = operation !== "idle";

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || panel || paused || toolPickerOpen) return;
      setPause(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panel, paused, setPause, toolPickerOpen]);

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
  const { objective, suggestions } = resolveGamePresentation(model, trackedTaskId, registry.gamePresentation);

  const conversation = (
    <Conversation
      model={model}
      lastTurn={lastTurn}
      operation={operation}
      suggestions={suggestions}
      submitTurn={submitTurn}
      previewAction={previewAction}
      openPerson={(id) => setPanel({ id: "people", focusId: id })}
    />
  );
  const topbar = (
    <GameTopbar
      model={model}
      objective={objective}
      onOpenTasks={() => setPanel("tasks")}
      onOpenTools={() => setToolPickerOpen(true)}
    />
  );
  const toolRail = (
    <GameToolRail
      panel={panel}
      onOpenPanel={setPanel}
      onOpenPause={() => setPause(true)}
    />
  );
  const overlays = (
    <>
      <ActivePanel panel={panel} {...model} trackedTaskId={trackedTaskId} onTrackTask={setTrackedTask} onClose={() => setPanel(null)} />
      {toolPickerOpen ? (
        <ToolPickerDialog
          onClose={() => setToolPickerOpen(false)}
          onOpenPanel={setPanel}
          onOpenPause={() => setPause(true)}
        />
      ) : null}
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
  const regions: GameShellSlotProps["regions"] = { topbar, conversation, toolRail, overlays };
  return <SlotRenderer slot="game-shell" fallback={DefaultGameShell} slotProps={{ ...model, regions }} />;
}
