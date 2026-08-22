import { useState, type FormEvent, type ReactNode } from "react";
import {
  ActionChoice,
  Button,
  InputGroup,
  Metric,
  SCRIPT_UI_API_VERSION,
  Textarea,
  type ComposerSlotProps,
  type HudSlotProps,
  type ObjectiveTrackerSlotProps,
  type PanelSlotProps,
  type PauseMenuSlotProps,
  type ScriptUiContext,
  type ToolbarSlotProps,
} from "@chatgame/ui";
import { STARLIGHT_STYLES } from "./styles";

export const apiVersion = SCRIPT_UI_API_VERSION;
type Preview = NonNullable<Awaited<ReturnType<ComposerSlotProps["previewAction"]>>>;

interface RuntimeView {
  grid: number | null;
  supply: number | null;
  fatigue: number | null;
  evaOxygen: number | null;
  incident: { status: string; stage: string };
  allocation: { register: string; excluded: number | null };
  shift: { label: string; feedback: string };
  logs: Array<{ id: string; channel: string; source: string; summary: string }>;
}

const EMPTY_RUNTIME: RuntimeView = {
  grid: null,
  supply: null,
  fatigue: null,
  evaOxygen: null,
  incident: { status: "loading", stage: "loading" },
  allocation: { register: "未读", excluded: null },
  shift: { label: "读取交班…", feedback: "等待服务器状态" },
  logs: [],
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown, fallback = "未读"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readRuntime(state: HudSlotProps["state"]): RuntimeView {
  const root = record(state.runtimeState);
  if (!root) return EMPTY_RUNTIME;
  const incident = record(root.incident);
  const allocation = record(root.allocation);
  const shift = record(root.shift);
  const logs = Array.isArray(root.logs) ? root.logs.flatMap((value) => {
    const entry = record(value);
    if (!entry || typeof entry.summary !== "string") return [];
    return [{ id: text(entry.id), channel: text(entry.channel), source: text(entry.source), summary: entry.summary }];
  }) : [];
  return {
    grid: numeric(root.grid),
    supply: numeric(root.supply),
    fatigue: numeric(root.fatigue),
    evaOxygen: numeric(root.eva_oxygen),
    incident: { status: text(incident?.status, "loading"), stage: text(incident?.stage, "loading") },
    allocation: { register: text(allocation?.register), excluded: numeric(allocation?.excluded) },
    shift: { label: text(shift?.label, "读取交班…"), feedback: text(shift?.last_feedback, "等待服务器状态") },
    logs,
  };
}

function StyleSheet() { return <style>{STARLIGHT_STYLES}</style>; }
function formatHour(total: number): string { return `D${Math.floor(total / 24) + 1} ${String(Math.floor(total % 24)).padStart(2, "0")}:00`; }

function StarlightHud({ state, catalog }: HudSlotProps) {
  const runtime = readRuntime(state);
  const location = catalog.locations.find((entry) => entry.id === state.player.locationId)?.name ?? state.player.locationId;
  return (
    <header data-region="hud" data-starlight="hud" className="sl-hud" aria-label="星港权威值班读数">
      <StyleSheet />
      <div className="sl-hud-place"><span>当班摘要</span><strong>星港 · {location}</strong><small>{formatHour(state.clock.totalHours)} · 维修二班</small></div>
      <div className="sl-metrics"><Metric label="EVA 氧" value={runtime.evaOxygen === null ? "未读" : `${Math.round(runtime.evaOxygen)}%`} /><Metric label="疲劳" value={runtime.fatigue === null ? "未读" : `${Math.round(runtime.fatigue)}%`} /><Metric label="电网" value={runtime.grid === null ? "未读" : `${Math.round(runtime.grid)}%`} /><Metric label="供给" value={runtime.supply === null ? "未读" : `${Math.round(runtime.supply)} 件`} /></div>
    </header>
  );
}

function StarlightObjectiveTracker({ state, openTasks }: ObjectiveTrackerSlotProps) {
  const runtime = readRuntime(state);
  const contained = runtime.incident.status === "contained";
  const assessed = runtime.incident.stage === "assessed";
  return (
    <button type="button" data-starlight="tracker" className="cg-objective-tracker" onClick={openTasks} aria-label="查看 P-07 当前工单">
      <StyleSheet />
      <span className="cg-objective-tracker__label">P-07 追踪工单</span>
      <strong>{contained ? "事故已签结" : assessed ? "选择处置方案" : "检查颗粒阀"}</strong>
      <span>{contained ? runtime.shift.feedback : assessed ? "维修、舱外旁路或配给例外" : "确认压差与住户影响"}</span>
    </button>
  );
}

const ZONES = [
  { id: "hab-ring", code: "HAB", name: "居住环" },
  { id: "cargo-bay", code: "CARGO", name: "货运配给" },
  { id: "reactor-level", code: "MAINT", name: "维修主干" },
  { id: "eva-truss", code: "EVA", name: "舱外桁架" },
] as const;

const SOLUTIONS = [
  { actionId: "repair", name: "更换颗粒阀", location: "reactor-level", note: "消耗库存与电网，恢复全量风量" },
  { actionId: "sneak", name: "舱外接通旁路", location: "eva-truss", note: "消耗工装氧，绕过故障阀" },
  { actionId: "trade", name: "谈判配给例外", location: "cargo-bay", note: "支付工分，让册外人口进入配给" },
] as const;

const RESOURCE_LABELS: Record<string, string> = { supply: "供给", grid: "电网", fatigue_capacity: "疲劳余量", eva_oxygen: "EVA 氧" };

function PreviewBlock({ preview }: { preview: Preview | null }) {
  if (!preview) return <span>选择行动后读取权威成本。</span>;
  const costs: ReactNode[] = [<span key="time">时间 −{preview.timeCost}h</span>];
  if (preview.costs.currency > 0) costs.push(<span key="currency">工分 −{preview.costs.currency}</span>);
  for (const resource of preview.costs.resources ?? []) costs.push(<span key={resource.id}>{RESOURCE_LABELS[resource.id] ?? resource.id} −{resource.amount}</span>);
  if (preview.risk.type !== "none") costs.push(<span key="risk">检定 {preview.risk.key}{preview.risk.dc ? ` / DC ${preview.risk.dc}` : ""}</span>);
  return <div className="sl-preview" data-executable={preview.executable}><strong>{preview.executable ? "可执行 · 成本已锁定" : "当前不可执行"}</strong>{!preview.executable ? <p>{preview.reason ?? preview.reasonCode}</p> : null}<div>{costs}</div></div>;
}

function StarlightComposer({ state, busy, previewAction, submitTurn }: ComposerSlotProps) {
  const runtime = readRuntime(state);
  const [selection, setSelection] = useState<{ label: string; hint: Parameters<ComposerSlotProps["previewAction"]>[0] } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [message, setMessage] = useState("");
  const suggestions = runtime.incident.status === "contained"
    ? [{ label: "轮休二十分钟", detail: "恢复疲劳与工装氧", hint: { actionId: "rest" } }, { label: "汇报交班结果", detail: "无线电 MAINT", hint: { actionId: "talk", params: { channel: "MAINT" } } }]
    : runtime.incident.stage === "reported"
      ? [
          { label: "检查 P-07", detail: "读取压差、阀体与住户影响", hint: { actionId: "investigate" } },
          { label: "询问老周", detail: "核对库存与交班责任", hint: { actionId: "talk", target: "chief-engineer" } },
          { label: "前往居住环", detail: "核实未登记住户人数", hint: { actionId: "move", target: "habitat-deck" } },
        ]
      : SOLUTIONS.map((solution) => state.player.locationId === solution.location
        ? { label: solution.name, detail: solution.note, hint: { actionId: solution.actionId } }
        : { label: `前往${ZONES.find((zone) => zone.id === solution.location)?.name ?? solution.location}`, detail: `为“${solution.name}”就位`, hint: { actionId: "move", target: solution.location } });

  async function prepare(choice: (typeof suggestions)[number]) {
    setSelection(choice); setMessage(choice.label); setPreview(null); setPreviewError("");
    try { setPreview(await previewAction(choice.hint)); } catch (error) { setPreviewError(error instanceof Error ? error.message : "预检失败"); }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const messageText = message.trim();
    if (!messageText || busy) return;
    const hint = selection && messageText === selection.label && preview?.executable ? selection.hint : undefined;
    await submitTurn(messageText, hint);
    setMessage(""); setSelection(null); setPreview(null);
  }

  return (
    <footer data-region="composer" data-starlight="composer" className="cg-composer sl-chat-composer">
      <StyleSheet />
      <div className="cg-action-shortcuts" aria-label="建议行动">{suggestions.slice(0, 5).map((choice) => <ActionChoice key={`${choice.hint.actionId}-${choice.label}`} selected={selection?.label === choice.label} detail={choice.detail} disabled={busy} onClick={() => void prepare(choice)}>{choice.label}</ActionChoice>)}</div>
      <div className="cg-action-preview" role="status" aria-live="polite">{previewError ? <span role="alert">{previewError}</span> : <PreviewBlock preview={preview} />}</div>
      <form onSubmit={(event) => void send(event)}><label className="sl-sr-only" htmlFor="sl-player-input">输入你的话或行动</label><InputGroup><Textarea id="sl-player-input" value={message} onChange={(event) => setMessage(event.target.value)} disabled={busy} maxLength={2000} rows={1} placeholder="说点什么，或描述你的行动" /><Button type="submit" variant="primary" size="icon" aria-label={busy ? "等待世界回应" : "发送"} disabled={busy || message.trim().length === 0}><span aria-hidden="true">↑</span><span className="sl-sr-only">{busy ? "等待世界回应" : "发送"}</span></Button></InputGroup></form>
    </footer>
  );
}

function StarlightToolbar({ panel, openPanel, openPause }: ToolbarSlotProps) {
  const entries = [{ id: "map", label: "站区", glyph: "区" }, { id: "tasks", label: "工单", glyph: "单" }, { id: "log", label: "交班", glyph: "班" }, { id: "inventory", label: "工装", glyph: "装" }];
  return <nav data-region="toolbar" data-starlight="toolbar" className="cg-toolbar sl-toolbar" aria-label="星港资料面板"><StyleSheet />{entries.map((entry) => <Button key={entry.id} type="button" variant="quiet" aria-label={entry.label} aria-pressed={panel === entry.id} onClick={() => openPanel(entry.id)}><span className="sl-tool-glyph" aria-hidden="true">{entry.glyph}</span><span className="sl-tool-label">{entry.label}</span></Button>)}<Button type="button" variant="quiet" aria-label="暂停" onClick={openPause}><span className="sl-tool-glyph" aria-hidden="true">停</span><span className="sl-tool-label">暂停</span></Button></nav>;
}

function RingDiagram({ current }: { current: string }) {
  return <ol className="sl-ring" aria-label="星港四区剖面">{ZONES.map((zone) => <li key={zone.id} aria-current={current === zone.id ? "location" : undefined}><span>{zone.code}</span><strong>{zone.name}</strong></li>)}</ol>;
}

function StarlightPanel({ panelId, state, catalog, trackedTaskId, trackTask }: PanelSlotProps) {
  const runtime = readRuntime(state);
  const title = panelId === "map" ? "站区剖面" : panelId === "tasks" ? "P-07 工单" : panelId === "log" ? "交班簿" : "工装与资源";
  const task = catalog.tasks[0];
  return (
    <section data-starlight="panel" className="sl-panel" aria-labelledby={`starlight-panel-${panelId}`}><StyleSheet />
      <header><div><p className="sl-eyebrow">值班资料</p><h2 id={`starlight-panel-${panelId}`}>{title}</h2></div></header>
      {panelId === "map" ? <RingDiagram current={state.player.locationId} /> : null}
      {panelId === "tasks" ? <div className="sl-task-sheet"><h3>{task?.name ?? "P-07 颗粒阀压差超限"}</h3><p>{task?.objectiveText ?? (runtime.incident.stage === "assessed" ? "选择一种处置方案并承担资源后果。" : "先在维修主干检查 P-07。")}</p>{task ? <Button type="button" variant="secondary" aria-pressed={trackedTaskId === task.id} onClick={() => trackTask(trackedTaskId === task.id ? null : task.id)}>{trackedTaskId === task.id ? "取消追踪" : "追踪此工单"}</Button> : null}<dl><div><dt>状态</dt><dd>{runtime.incident.status}</dd></div><div><dt>登记册</dt><dd>{runtime.allocation.register}</dd></div><div><dt>册外人口</dt><dd>{runtime.allocation.excluded ?? "未读"}</dd></div></dl></div> : null}
      {panelId === "log" ? <ol className="sl-log-list">{runtime.logs.map((entry) => <li key={entry.id}><strong>{entry.channel} · {entry.source}</strong><p>{entry.summary}</p></li>)}</ol> : null}
      {panelId === "inventory" ? <><p>工分：{state.player.inventory.currency} {catalog.currency.symbol}</p><ul>{state.player.inventory.stacks.map((stack) => <li key={stack.itemId}>{catalog.items.find((item) => item.id === stack.itemId)?.name ?? stack.itemId} × {stack.quantity}</li>)}</ul><p>EVA 氧：{runtime.evaOxygen ?? "未读"}% · 疲劳：{runtime.fatigue ?? "未读"}%</p></> : null}
    </section>
  );
}

function StarlightPause({ busy, dirty, audioEnabled, isFullscreen, save, exit, close, setAudio, exitFullscreen }: PauseMenuSlotProps) {
  return (
    <section data-starlight="pause" className="sl-panel sl-pause" aria-label="星港交班暂停菜单">
      <StyleSheet />
      <p className="sl-eyebrow">暂停 / 交班签</p>
      <h2>{dirty ? "本班有未存档记录" : "本班记录已归档"}</h2>
      <div className="sl-pause__status"><span>当前状态</span><strong>{dirty ? "等待归档" : "已同步"}</strong></div>
      <div className="sl-pause__utilities">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void save()}>{busy ? "归档中…" : "保存交班记录"}</Button>
        <Button type="button" variant="secondary" onClick={() => setAudio(!audioEnabled)}>{audioEnabled ? "关闭值班声音" : "开启值班声音"}</Button>
        {isFullscreen ? <Button type="button" variant="secondary" onClick={() => void exitFullscreen()}>退出全屏</Button> : null}
      </div>
      <div className="sl-pause__exit">
        <Button type="button" variant="secondary" onClick={close}>返回工单</Button>
        <Button type="button" variant="primary" disabled={busy} onClick={() => void exit(false)}>交班并返回启动器</Button>
      </div>
    </section>
  );
}

export default function registerStarlightUi(ctx: ScriptUiContext): void {
  ctx.register("hud", { component: StarlightHud });
  ctx.register("objective-tracker", { component: StarlightObjectiveTracker });
  ctx.register("toolbar", { component: StarlightToolbar });
  ctx.register("composer", { component: StarlightComposer });
  ctx.register("pause-menu", { component: StarlightPause });
  ctx.register("panel:map", { component: StarlightPanel });
  ctx.register("panel:tasks", { component: StarlightPanel });
  ctx.register("panel:log", { component: StarlightPanel });
  ctx.register("panel:inventory", { component: StarlightPanel });
}
