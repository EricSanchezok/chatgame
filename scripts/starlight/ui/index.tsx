// Direction contract: an ordinary worker's worn shift console. Warm near-black
// metal, cream thermal paper, amber work light and muted teal system status;
// no captain fantasy, cold-blue neon, glass cards, fake clocks or client state authority.
import { useState, type FormEvent, type ReactNode } from "react";
import {
  SCRIPT_UI_API_VERSION,
  type BubbleSlotProps,
  type ComposerSlotProps,
  type GameShellSlotProps,
  type HudSlotProps,
  type LauncherSlotProps,
  type MessageCardSlotProps,
  type PanelSlotProps,
  type PauseMenuSlotProps,
  type SceneSlotProps,
  type ScriptUiContext,
  type SettingsSlotProps,
  type ToolbarSlotProps,
} from "@chatgame/ui";
import { STARLIGHT_STYLES } from "./styles";

export const apiVersion = SCRIPT_UI_API_VERSION;

type Preview = NonNullable<Awaited<ReturnType<ComposerSlotProps["previewAction"]>>>;

interface RuntimeView {
  hull: number | null;
  grid: number | null;
  supply: number | null;
  fatigue: number | null;
  evaOxygen: number | null;
  heat: number | null;
  airflow: number | null;
  incident: { status: string; stage: string; solution: string | null };
  allocation: { register: string; registered: number | null; unregistered: number | null; excluded: number | null; policy: string };
  shift: { label: string; nextHandoffAt: number | null; feedback: string };
  logs: Array<{ id: string; channel: string; source: string; at: number; summary: string }>;
}

const EMPTY_RUNTIME: RuntimeView = {
  hull: null,
  grid: null,
  supply: null,
  fatigue: null,
  evaOxygen: null,
  heat: null,
  airflow: null,
  incident: { status: "loading", stage: "loading", solution: null },
  allocation: { register: "—", registered: null, unregistered: null, excluded: null, policy: "loading" },
  shift: { label: "读取交班…", nextHandoffAt: null, feedback: "等待服务器状态" },
  logs: [],
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readRuntime(state: HudSlotProps["state"]): RuntimeView {
  const root = record(state.runtimeState);
  if (!root) return EMPTY_RUNTIME;
  const incident = record(root.incident);
  const allocation = record(root.allocation);
  const shift = record(root.shift);
  const logs = Array.isArray(root.logs)
    ? root.logs.flatMap((value) => {
        const entry = record(value);
        if (!entry || typeof entry.summary !== "string") return [];
        return [{
          id: stringValue(entry.id),
          channel: stringValue(entry.channel),
          source: stringValue(entry.source),
          at: numeric(entry.at) ?? state.clock.totalHours,
          summary: entry.summary,
        }];
      })
    : [];
  return {
    hull: numeric(root.hull),
    grid: numeric(root.grid),
    supply: numeric(root.supply),
    fatigue: numeric(root.fatigue),
    evaOxygen: numeric(root.eva_oxygen),
    heat: numeric(root.heat),
    airflow: numeric(root.airflow),
    incident: {
      status: stringValue(incident?.status, "loading"),
      stage: stringValue(incident?.stage, "loading"),
      solution: typeof incident?.solution === "string" ? incident.solution : null,
    },
    allocation: {
      register: stringValue(allocation?.register),
      registered: numeric(allocation?.registered),
      unregistered: numeric(allocation?.unregistered),
      excluded: numeric(allocation?.excluded),
      policy: stringValue(allocation?.policy, "loading"),
    },
    shift: {
      label: stringValue(shift?.label, "读取交班…"),
      nextHandoffAt: numeric(shift?.next_handoff_at),
      feedback: stringValue(shift?.last_feedback, "等待服务器状态"),
    },
    logs,
  };
}

function assetUrl(scriptId: string, file?: string): string {
  if (!file || !file.startsWith("assets/")) return "";
  const relative = file.replace(/^assets\//, "");
  return `/api/scripts/${encodeURIComponent(scriptId)}/assets/${relative.split("/").map(encodeURIComponent).join("/")}`;
}

function StyleSheet() {
  return <style>{STARLIGHT_STYLES}</style>;
}

function formatHour(total: number): string {
  const day = Math.floor(total / 24) + 1;
  const hour = Math.floor(total % 24);
  return `D${day} ${String(hour).padStart(2, "0")}:00`;
}

function percent(value: number | null): number {
  return Math.max(0, Math.min(100, value ?? 0));
}

function Metric({ label, value, suffix = "%", warningAt, inverse = false }: {
  label: string;
  value: number | null;
  suffix?: string;
  warningAt?: number;
  inverse?: boolean;
}) {
  const danger = value !== null && warningAt !== undefined && (inverse ? value >= warningAt : value <= warningAt);
  const warn = value !== null && warningAt !== undefined && !danger && (inverse ? value >= warningAt * .7 : value <= warningAt * 1.25);
  return (
    <div className="sl-meter">
      <span className="sl-label">{label}</span>
      <div className="sl-meter-line">
        <span className="sl-meter-value">{value === null ? "—" : Math.round(value)}{value === null ? "" : suffix}</span>
        <span aria-hidden="true">{danger ? "▲" : warn ? "◆" : "●"}</span>
      </div>
      {suffix === "%" ? (
        <div className="sl-track" aria-hidden="true">
          <div className={`sl-fill${danger ? " sl-fill--danger" : warn ? " sl-fill--warning" : ""}`} style={{ width: `${percent(value)}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function StarlightLauncher({ script, detail, coverUrl, actions }: LauncherSlotProps) {
  return (
    <main data-starlight="launcher" className="sl-launcher sl-metal" aria-labelledby="starlight-title">
      <StyleSheet />
      <section className="sl-launcher-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={coverUrl} alt="" />
        <div className="sl-launcher-copy">
          <p className="sl-eyebrow">民用空间站 · 夜班工单</p>
          <h1 id="starlight-title">{script.name}</h1>
          <p>{script.description}</p>
          <p className="sl-mono">维修二班 / B-12 / 一起事故 / 三种处置</p>
        </div>
      </section>
      <aside className="sl-launcher-actions" aria-label="星港值班操作">
        <p className="sl-eyebrow">交班签</p>
        <h2>你不是舰长。</h2>
        <p>你有一套工具、一张岗位签，和把后果写进下一班记录的责任。</p>
        <p className="sl-label">{detail.origins.length} 个可用工种 · {detail.catalog.locations.length} 个站区</p>
        <button type="button" className="sl-button sl-button--primary" onClick={actions.openNewGame}>接下夜班</button>
        <button type="button" className="sl-button" disabled={detail.saves.length === 0} onClick={actions.openSaves}>读取交班存档</button>
      </aside>
    </main>
  );
}

function StarlightHud({ state, catalog }: HudSlotProps) {
  const runtime = readRuntime(state);
  const location = catalog.locations.find((entry) => entry.id === state.player.locationId)?.name ?? state.player.locationId;
  return (
    <header data-starlight="hud" className="sl-hud sl-metal" aria-label="星港权威值班读数">
      <StyleSheet />
      <div className="sl-brand">
        <span className="sl-eyebrow">{runtime.shift.label}</span>
        <strong>{location}</strong>
        <span className="sl-label sl-mono">{formatHour(state.clock.totalHours)} · 维修二班</span>
      </div>
      <Metric label="船体" value={runtime.hull} warningAt={45} />
      <Metric label="电网" value={runtime.grid} warningAt={30} />
      <Metric label="供给" value={runtime.supply} suffix=" 件" warningAt={2} />
      <Metric label="疲劳" value={runtime.fatigue} warningAt={70} inverse />
      <Metric label="追踪热度" value={runtime.heat} warningAt={55} inverse />
    </header>
  );
}

const ZONES = [
  { id: "hab-ring", code: "HAB", name: "居住环", role: "册外住户 / 空气" },
  { id: "cargo-bay", code: "CARGO", name: "货运配给", role: "物资 / 交易" },
  { id: "reactor-level", code: "MAINT", name: "维修主干", role: "P-07 / 工单" },
  { id: "eva-truss", code: "EVA", name: "舱外桁架", role: "旁路 / 工装氧" },
] as const;

function ZoneGlyph({ current }: { current: boolean }) {
  return (
    <svg className="sl-zone-mark" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M16 5v7m0 8v7M5 16h7m8 0h7" fill="none" stroke="currentColor" strokeWidth="2" />
      {current ? <circle cx="16" cy="16" r="4" fill="currentColor" /> : null}
    </svg>
  );
}

function StationSection({ state }: Pick<GameShellSlotProps, "state">) {
  const runtime = readRuntime(state);
  return (
    <aside className="sl-section sl-metal" aria-labelledby="station-section-title">
      <p className="sl-eyebrow">站体剖面 / 四区</p>
      <h2 id="station-section-title">事故路径</h2>
      <ol className="sl-station-list">
        {ZONES.map((zone) => {
          const current = state.player.locationId === zone.id;
          return (
            <li key={zone.id} className="sl-zone" data-current={current} aria-current={current ? "location" : undefined}>
              <ZoneGlyph current={current} />
              <span><strong>{zone.code} · {zone.name}</strong><small>{zone.role}</small></span>
            </li>
          );
        })}
      </ol>
      <section className="sl-allocation" aria-labelledby="allocation-title">
        <p className="sl-eyebrow">灯塔分配</p>
        <h3 id="allocation-title">登记册 {runtime.allocation.register}</h3>
        <div className="sl-allocation-grid">
          <div className="sl-count"><span className="sl-label">登记</span><strong>{runtime.allocation.registered ?? "—"}</strong></div>
          <div className="sl-count" data-excluded={(runtime.allocation.excluded ?? 0) > 0}><span className="sl-label">册外</span><strong>{runtime.allocation.unregistered ?? "—"}</strong></div>
        </div>
        <p>{runtime.allocation.excluded ? `${runtime.allocation.excluded} 人未计入权重` : "本班已覆盖全部实际人口"}</p>
      </section>
    </aside>
  );
}

function StarlightGameShell({ state, regions }: GameShellSlotProps) {
  return (
    <main data-starlight="game-shell" className="sl-shell">
      <StyleSheet />
      {regions.hud}
      <div className="sl-workspace">
        <StationSection state={state} />
        {regions.scene}
        {regions.composer}
      </div>
      {regions.toolbar}
      {regions.overlays}
    </main>
  );
}

function StarlightScene({ scriptId, state, catalog, assets, transcript }: SceneSlotProps) {
  const runtime = readRuntime(state);
  const location = catalog.locations.find((entry) => entry.id === state.player.locationId);
  const source = assetUrl(scriptId, assets.backgrounds[state.player.locationId]?.file);
  return (
    <section data-starlight="scene" className="sl-scene sl-metal" aria-label="现场与热敏交班记录">
      <StyleSheet />
      <figure className="sl-scene-figure">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {source ? <img src={source} alt={assets.backgrounds[state.player.locationId]?.alt ?? location?.name ?? "当前站区"} /> : null}
        <figcaption><strong>{location?.name ?? state.player.locationId}</strong> · {location?.description}</figcaption>
      </figure>
      <div className="sl-log">
        <header className="sl-log-head">
          <span><strong>事件记录</strong> / 热敏打印</span>
          <span className="sl-mono">风量 {runtime.airflow ?? "—"}%</span>
        </header>
        <div className="sl-log-scroll" tabIndex={0} aria-label="星港交班与游戏对话记录">
          {runtime.logs.map((entry) => (
            <div className="sl-log-row" key={entry.id}>
              <span className="sl-channel" data-alarm={entry.channel === "ALM"}>{entry.channel} {formatHour(entry.at)}</span>
              <strong>{entry.source}</strong>
              <span>{entry.summary}</span>
            </div>
          ))}
          <div className="sl-transcript">{transcript}</div>
        </div>
      </div>
    </section>
  );
}

const SOLUTIONS = [
  { actionId: "repair", name: "更换颗粒阀", location: "reactor-level", code: "标准维修", note: "消耗库存与电网；低热度；恢复全量风量" },
  { actionId: "sneak", name: "舱外接通旁路", location: "eva-truss", code: "零件绕行", note: "不动库存；消耗舱外氧；船体与热度承担风险" },
  { actionId: "trade", name: "谈判配给例外", location: "cargo-bay", code: "资源交易", note: "支付工分；册外人口临时入权；留下审计痕迹" },
] as const;

const RESOURCE_LABELS: Record<string, string> = {
  supply: "供给",
  grid: "电网",
  fatigue_capacity: "疲劳余量",
  eva_oxygen: "EVA 氧",
};

function PreviewBlock({ preview }: { preview: Preview | null }) {
  if (!preview) return <div className="sl-preview sl-loading" role="status">选择方案后读取权威成本……</div>;
  const costs: ReactNode[] = [<span key="time">时间 −{preview.timeCost}h</span>];
  if (preview.costs.currency > 0) costs.push(<span key="currency">工分 −{preview.costs.currency}</span>);
  for (const item of preview.costs.items) costs.push(<span key={`item-${item.itemId}`}>{item.itemId} −{item.quantity}</span>);
  for (const resource of preview.costs.resources ?? []) costs.push(<span key={`resource-${resource.id}`}>{RESOURCE_LABELS[resource.id] ?? resource.id} −{resource.amount}</span>);
  if (preview.risk.type !== "none") costs.push(<span key="risk">检定 {preview.risk.key}{preview.risk.dc ? ` / DC ${preview.risk.dc}` : ""}</span>);
  return (
    <div className="sl-preview" data-executable={preview.executable} role="status" aria-live="polite">
      <strong>{preview.executable ? "可执行 · 成本已锁定" : "当前不可执行"}</strong>
      {!preview.executable ? <p>{preview.reason ?? preview.reasonCode}</p> : null}
      <div className="sl-costs">{costs}</div>
    </div>
  );
}

function StarlightComposer({ state, busy, previewAction, submitTurn }: ComposerSlotProps) {
  const runtime = readRuntime(state);
  const [selection, setSelection] = useState("repair");
  const selected = runtime.incident.stage === "reported" ? "investigate" : selection === "investigate" ? "repair" : selection;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [channel, setChannel] = useState("MAINT");
  const [message, setMessage] = useState("");
  const selectedSolution = SOLUTIONS.find((entry) => entry.actionId === selected);
  const actionTarget = selectedSolution?.location;

  async function prepare(actionId = selected) {
    setSelection(actionId);
    setPreview(null);
    setPreviewError("");
    try {
      const result = await previewAction({ actionId });
      setPreview(result);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "预检失败");
    }
  }

  async function executeSelected() {
    if (!preview?.executable || preview.actionId !== selected) return;
    await submitTurn(`按工单执行：${preview.displayName}`, { actionId: selected });
    setPreview(null);
  }

  async function moveTo(locationId: string) {
    const hint = { actionId: "move", target: locationId };
    const route = await previewAction(hint);
    if (route?.executable) await submitTurn(`前往 ${locationId}`, hint);
    else setPreview(route);
  }

  async function sendRadio(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setMessage("");
    const target = channel === "HAB" ? "doctor-vera" : channel === "CARGO" ? "night-cat" : channel === "MAINT" ? "chief-engineer" : undefined;
    await submitTurn(`[${channel}] ${text}`, { actionId: "talk", ...(target ? { target } : {}), params: { channel } });
  }

  const incidentClosed = runtime.incident.status === "contained";
  return (
    <section data-starlight="composer" className="sl-composer sl-metal" aria-labelledby="work-order-title">
      <StyleSheet />
      <article className="sl-work-order sl-paper">
        <p className="sl-label">工单 ALM-20780517-074217 · 严重 L3</p>
        <h2 id="work-order-title">P-07 颗粒阀压差超限</h2>
        <ul className="sl-facts">
          <li>压差 2.81 kPa / 阈值 1.80</li>
          <li>影响 H-12 至 H-18：实住 63 / 登记 41</li>
          <li>事故状态：{incidentClosed ? "已签结" : runtime.incident.stage === "assessed" ? "已检查，待处置" : "待现场检查"}</li>
        </ul>
      </article>

      {incidentClosed ? (
        <div className="sl-preview" data-executable="true" role="status">
          <strong>工单已签结</strong>
          <p>{runtime.shift.feedback}</p>
        </div>
      ) : runtime.incident.stage === "reported" ? (
        <button type="button" className="sl-solution" aria-pressed={selected === "investigate"} onClick={() => void prepare("investigate")} disabled={busy}>
          <strong>先检查 P-07</strong><small>读取压差、阀体与住户影响；解锁三条处置路径</small>
        </button>
      ) : (
        <div className="sl-solutions" aria-label="三种有效处置方案">
          {SOLUTIONS.map((solution, index) => (
            <button key={solution.actionId} type="button" className="sl-solution" aria-pressed={selected === solution.actionId} onClick={() => void prepare(solution.actionId)} disabled={busy}>
              <strong>{index + 1}. {solution.code} · {solution.name}</strong><small>{solution.note}</small>
            </button>
          ))}
        </div>
      )}

      <div>
        {previewError ? <div className="sl-preview" data-executable="false" role="alert">{previewError}</div> : <PreviewBlock preview={preview} />}
        <div className="sl-actions">
          {actionTarget && state.player.locationId !== actionTarget ? (
            <button type="button" className="sl-button" disabled={busy} onClick={() => void moveTo(actionTarget)}>前往所需站区</button>
          ) : (
            <button type="button" className="sl-button" disabled={busy || incidentClosed} onClick={() => void prepare()}>刷新成本</button>
          )}
          <button type="button" className="sl-button sl-button--primary" disabled={busy || !preview?.executable || preview.actionId !== selected || incidentClosed} onClick={() => void executeSelected()}>
            {busy ? "值班总线处理中…" : "签署并执行"}
          </button>
        </div>
      </div>

      <form className="sl-radio" onSubmit={(event) => void sendRadio(event)}>
        <label><span className="sl-label">无线电频道</span><select value={channel} onChange={(event) => setChannel(event.target.value)} disabled={busy}><option>MAINT</option><option>HAB</option><option>CARGO</option><option>LIGHTHOUSE</option></select></label>
        <label><span className="sl-label">值班记录</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} disabled={busy} maxLength={2000} placeholder="报位置、设备号、事实和请求……" /></label>
        <button type="submit" className="sl-button" disabled={busy || message.trim().length === 0}>{busy ? "发送中" : "发送并记录"}</button>
      </form>
    </section>
  );
}

function StarlightToolbar({ panel, openPanel }: ToolbarSlotProps) {
  const entries = [{ id: "map", label: "站区剖面" }, { id: "log", label: "交班簿" }, { id: "inventory", label: "工装" }];
  return (
    <nav data-starlight="toolbar" className="sl-toolbar sl-metal" aria-label="星港工作台面板">
      <StyleSheet />
      {entries.map((entry) => <button key={entry.id} type="button" className="sl-button" aria-pressed={panel === entry.id} onClick={() => openPanel(entry.id)}>{entry.label}</button>)}
    </nav>
  );
}

function RingDiagram({ current }: { current: string }) {
  return (
    <svg className="sl-ring" viewBox="0 0 420 320" role="img" aria-labelledby="ring-title ring-desc">
      <title id="ring-title">星港四区环形剖面</title><desc id="ring-desc">居住环、货运配给、维修主干与舱外桁架的连接；当前区段以琥珀色标记。</desc>
      <circle cx="205" cy="160" r="112" fill="none" stroke="currentColor" strokeWidth="22" strokeDasharray="150 26" />
      {ZONES.map((zone, index) => {
        const points = [[205, 42], [323, 160], [205, 278], [87, 160]][index];
        return <g key={zone.id} className={current === zone.id ? "active" : ""} style={{ color: current === zone.id ? "var(--cg-primary)" : "var(--cg-text-dim)" }}><circle cx={points[0]} cy={points[1]} r="19" fill="var(--cg-surface)" stroke="currentColor" strokeWidth="5" /><text x={points[0]} y={points[1] + 4} textAnchor="middle" fill="currentColor" fontSize="11">{zone.code}</text></g>;
      })}
      <path d="M205 42L205 160L323 160M205 160L205 278M205 160L87 160" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function StarlightPanel({ panelId, state, catalog, close }: PanelSlotProps) {
  const runtime = readRuntime(state);
  const title = panelId === "map" ? "站区剖面" : panelId === "log" ? "交班簿" : "工装与资源";
  return (
    <section data-starlight="panel" className="sl-panel" aria-labelledby={`starlight-panel-${panelId}`}>
      <StyleSheet />
      <header className="sl-panel-head"><h2 id={`starlight-panel-${panelId}`}>{title}</h2><button type="button" className="sl-button" onClick={close}>关闭</button></header>
      {panelId === "map" ? <RingDiagram current={state.player.locationId} /> : null}
      {panelId === "log" ? <ol>{runtime.logs.map((entry) => <li key={entry.id}><strong>{entry.channel} · {entry.source}</strong><p>{entry.summary}</p></li>)}</ol> : null}
      {panelId === "inventory" ? <><p>工分：{state.player.inventory.currency} {catalog.currency.symbol}</p><ul>{state.player.inventory.stacks.map((stack) => <li key={stack.itemId}>{catalog.items.find((item) => item.id === stack.itemId)?.name ?? stack.itemId} × {stack.quantity}</li>)}</ul><p>EVA 氧：{runtime.evaOxygen ?? "—"}% · 疲劳：{runtime.fatigue ?? "—"}%</p></> : null}
    </section>
  );
}

function StarlightPause({ busy, dirty, audioEnabled, isFullscreen, save, exit, close, setAudio, exitFullscreen }: PauseMenuSlotProps) {
  return (
    <section data-starlight="pause" className="sl-panel" aria-label="星港交班暂停菜单">
      <StyleSheet /><p className="sl-eyebrow">暂停 / 交班签</p><h2>{dirty ? "本班有未存档记录" : "本班记录已归档"}</h2>
      <button type="button" className="sl-button" disabled={busy} onClick={() => void save()}>{busy ? "归档中…" : "保存交班记录"}</button>
      <button type="button" className="sl-button" onClick={() => setAudio(!audioEnabled)}>{audioEnabled ? "关闭值班声音" : "开启值班声音"}</button>
      {isFullscreen ? <button type="button" className="sl-button" onClick={() => void exitFullscreen()}>退出全屏</button> : null}
      <button type="button" className="sl-button" onClick={close}>返回工单</button>
      <button type="button" className="sl-button sl-button--primary" disabled={busy} onClick={() => void exit(false)}>交班并返回启动器</button>
    </section>
  );
}

function StarlightBubble({ entry, children }: BubbleSlotProps) {
  return <article data-starlight="bubble" className="sl-bubble" data-role={entry.role} aria-label={entry.role === "player" ? "值班员记录" : entry.role === "system" ? "系统记录" : "现场回应"}><StyleSheet />{children}</article>;
}

function StarlightMessageCard({ kind, children }: MessageCardSlotProps) {
  return <section data-starlight="message-card" className="sl-card" aria-label={kind === "event" ? "事故提示" : "站区抵达提示"}><StyleSheet />{children}</section>;
}

function StarlightSettings({ settings, update }: SettingsSlotProps) {
  return (
    <section data-starlight="settings" className="sl-panel" aria-labelledby="starlight-sound-title">
      <StyleSheet /><p className="sl-eyebrow">星港值班台</p><h2 id="starlight-sound-title">声音与动效</h2>
      <label><input type="checkbox" checked={settings.audioEnabled} onChange={(event) => update({ audioEnabled: event.target.checked })} /> 播放本地设备环境音与 P-07 警报</label>
      <label><input type="checkbox" checked={settings.motion === "reduce"} onChange={(event) => update({ motion: event.target.checked ? "reduce" : "system" })} /> 减少告警扫灯与空间移动</label>
    </section>
  );
}

export default function registerStarlightUi(ctx: ScriptUiContext): void {
  ctx.register("launcher", { component: StarlightLauncher });
  ctx.register("game-shell", { component: StarlightGameShell });
  ctx.register("scene", { component: StarlightScene });
  ctx.register("hud", { component: StarlightHud });
  ctx.register("toolbar", { component: StarlightToolbar });
  ctx.register("composer", { component: StarlightComposer });
  ctx.register("pause-menu", { component: StarlightPause });
  ctx.register("panel:map", { component: StarlightPanel });
  ctx.register("panel:log", { component: StarlightPanel });
  ctx.register("panel:inventory", { component: StarlightPanel });
  ctx.register("bubble:world", { component: StarlightBubble });
  ctx.register("bubble:player", { component: StarlightBubble });
  ctx.register("bubble:system", { component: StarlightBubble });
  ctx.register("message-card:event", { component: StarlightMessageCard });
  ctx.register("message-card:location_enter", { component: StarlightMessageCard });
  ctx.register("settings:starlight", { component: StarlightSettings });
}
