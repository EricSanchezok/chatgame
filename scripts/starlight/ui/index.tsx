import {
  Button,
  SCRIPT_UI_API_VERSION,
  type GameObjective,
  type GameSuggestion,
  type PanelSlotProps,
  type ScriptHostModel,
  type ScriptUiContext,
} from "@chatgame/ui";
import { STARLIGHT_STYLES } from "./styles";

export const apiVersion = SCRIPT_UI_API_VERSION;

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

function readRuntime(model: ScriptHostModel): RuntimeView {
  const root = record(model.state.runtimeState);
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

export function starlightObjective(model: ScriptHostModel): GameObjective {
  const runtime = readRuntime(model);
  if (runtime.incident.status === "contained") return { title: "事故已签结", detail: runtime.shift.feedback };
  if (runtime.incident.stage === "assessed") return { title: "选择处置方案", detail: "维修、舱外旁路或配给例外" };
  return { title: "检查 P-07 颗粒阀", detail: "确认压差与住户影响" };
}

function suggestion(id: string, label: string, detail: string, intentHint: GameSuggestion["intentHint"]): GameSuggestion {
  return { id, label, detail, intentHint };
}

export function starlightSuggestions(model: ScriptHostModel): GameSuggestion[] {
  const runtime = readRuntime(model);
  if (runtime.incident.status === "contained") return [
    suggestion("rest", "轮休二十分钟", "恢复疲劳与工装氧", { actionId: "rest" }),
    suggestion("handoff", "汇报交班结果", "无线电 MAINT", { actionId: "talk", params: { channel: "MAINT" } }),
  ];
  if (runtime.incident.stage === "reported") return [
    suggestion("investigate", "检查 P-07", "读取压差、阀体与住户影响", { actionId: "investigate" }),
    suggestion("ask-chief", "询问老周", "核对库存与交班责任", { actionId: "talk", target: "chief-engineer" }),
    suggestion("move-hab", "前往居住环", "核实未登记住户人数", { actionId: "move", target: "habitat-deck" }),
  ];
  const choices = [
    { id: "repair", label: "更换颗粒阀", location: "reactor-level", detail: "消耗库存与电网，恢复全量风量" },
    { id: "sneak", label: "舱外接通旁路", location: "eva-truss", detail: "消耗工装氧，绕过故障阀" },
    { id: "trade", label: "谈判配给例外", location: "cargo-bay", detail: "支付工分，让册外人口进入配给" },
  ];
  const locationNames: Record<string, string> = { "reactor-level": "维修主干", "eva-truss": "舱外桁架", "cargo-bay": "货运配给" };
  return choices.map((choice) => model.state.player.locationId === choice.location
    ? suggestion(choice.id, choice.label, choice.detail, { actionId: choice.id })
    : suggestion(`move-${choice.id}`, `前往${locationNames[choice.location]}`, `为“${choice.label}”就位`, { actionId: "move", target: choice.location }));
}

const ZONES = [
  { id: "hab-ring", code: "HAB", name: "居住环" },
  { id: "cargo-bay", code: "CARGO", name: "货运配给" },
  { id: "reactor-level", code: "MAINT", name: "维修主干" },
  { id: "eva-truss", code: "EVA", name: "舱外桁架" },
] as const;

function RingDiagram({ current }: { current: string }) {
  return <ol className="sl-ring" aria-label="星港四区剖面">{ZONES.map((zone) => <li key={zone.id} aria-current={current === zone.id ? "location" : undefined}><span>{zone.code}</span><strong>{zone.name}</strong></li>)}</ol>;
}

function StarlightPanel(props: PanelSlotProps) {
  const runtime = readRuntime(props);
  const task = props.catalog.tasks[0];
  return (
    <section data-starlight="panel" className="sl-panel"><StyleSheet />
      {props.panelId === "map" ? <RingDiagram current={props.state.player.locationId} /> : null}
      {props.panelId === "tasks" ? <div className="sl-task-sheet"><h3>{task?.name ?? "P-07 颗粒阀压差超限"}</h3><p>{task?.objectiveText ?? starlightObjective(props).detail}</p>{task ? <Button type="button" variant="secondary" aria-pressed={props.trackedTaskId === task.id} onClick={() => props.trackTask(props.trackedTaskId === task.id ? null : task.id)}>{props.trackedTaskId === task.id ? "取消追踪" : "追踪此工单"}</Button> : null}<dl><div><dt>状态</dt><dd>{runtime.incident.status}</dd></div><div><dt>登记册</dt><dd>{runtime.allocation.register}</dd></div><div><dt>册外人口</dt><dd>{runtime.allocation.excluded ?? "未读"}</dd></div></dl></div> : null}
      {props.panelId === "records" ? <ol className="sl-log-list">{runtime.logs.map((entry) => <li key={entry.id}><strong>{entry.channel} · {entry.source}</strong><p>{entry.summary}</p></li>)}</ol> : null}
      {props.panelId === "inventory" ? <><p>工分：{props.state.player.inventory.currency} {props.catalog.currency.symbol}</p><ul>{props.state.player.inventory.stacks.map((stack) => <li key={stack.itemId}>{props.catalog.items.find((item) => item.id === stack.itemId)?.name ?? stack.itemId} × {stack.quantity}</li>)}</ul><p>EVA 氧：{runtime.evaOxygen ?? "未读"}% · 疲劳：{runtime.fatigue ?? "未读"}% · 电网：{runtime.grid ?? "未读"}% · 供给：{runtime.supply ?? "未读"}</p></> : null}
    </section>
  );
}

export default function registerStarlightUi(ctx: ScriptUiContext): void {
  ctx.configureGame({ objective: starlightObjective, suggestions: starlightSuggestions });
  ctx.register("panel:map", { component: StarlightPanel });
  ctx.register("panel:tasks", { component: StarlightPanel });
  ctx.register("panel:records", { component: StarlightPanel });
  ctx.register("panel:inventory", { component: StarlightPanel });
}
