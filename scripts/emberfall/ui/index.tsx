import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ActionChoice as ActionChoiceControl,
  Button,
  InputGroup,
  SCRIPT_UI_API_VERSION,
  Textarea,
  type ComposerSlotProps,
  type HudSlotProps,
  type ObjectiveTrackerSlotProps,
  type PanelSlotProps,
  type ScriptHostModel,
  type ScriptUiContext,
  type ToolbarSlotProps,
} from "@chatgame/ui";
import { EMBERFALL_STYLES } from "./styles";

export const apiVersion = SCRIPT_UI_API_VERSION;
type IntentHint = Parameters<ComposerSlotProps["previewAction"]>[0];
type ActionPreview = Awaited<ReturnType<ComposerSlotProps["previewAction"]>>;

function StyleSheet() { return <style>{EMBERFALL_STYLES}</style>; }

function numberValue(model: ScriptHostModel, key: string, fallback = 0): number {
  const value = model.state.runtimeState[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(model: ScriptHostModel, key: string, fallback = ""): string {
  const value = model.state.runtimeState[key];
  return typeof value === "string" ? value : fallback;
}

function boolValue(model: ScriptHostModel, key: string): boolean {
  return model.state.runtimeState[key] === true;
}

function Meter({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  const safe = Math.max(0, Math.min(100, value));
  return <span className="ef-meter" data-warning={warning} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safe}><span style={{ width: `${safe}%` }} /></span>;
}

function EmberfallHud(props: HudSlotProps) {
  const phase = stringValue(props, "phase", "preparing");
  const phaseName = { preparing: "班前", underground: "井下", returned: "返镇", settled: "已配火" }[phase] ?? phase;
  const location = props.catalog.locations.find((entry) => entry.id === props.state.player.locationId)?.name ?? props.state.player.locationId;
  const lamp = numberValue(props, "lamp");
  const ash = numberValue(props, "ashExposure");
  return (
    <header data-region="hud" data-emberfall="hud" className="ef-hud" aria-label="灰烬镇班次状态">
      <StyleSheet />
      <div className="ef-brand"><strong>灰烬镇</strong><small>公共灰灯值守</small></div>
      <div className="ef-readouts">
        <div className="ef-readout"><span className="ef-label">班相</span><span className="ef-value">{String(props.state.clock.hour).padStart(2, "0")}:00 · {phaseName}</span></div>
        <div className="ef-readout ef-readout--place"><span className="ef-label">位置</span><span className="ef-value">D{numberValue(props, "depth")} · {location}</span></div>
        <div className="ef-readout"><span className="ef-label">灯火</span><span className="ef-reading"><span className="ef-value">{lamp}/100</span><Meter label="灰灯火力" value={lamp} /></span></div>
        <div className="ef-readout"><span className="ef-label">支护 / 灰蚀</span><span className="ef-reading"><span className="ef-value">{numberValue(props, "supports")} 柱 · {ash}%</span><Meter label="灰蚀暴露" value={ash} warning /></span></div>
      </div>
    </header>
  );
}

function EmberfallObjectiveTracker({ state, openTasks }: ObjectiveTrackerSlotProps) {
  const phase = typeof state.runtimeState.phase === "string" ? state.runtimeState.phase : "preparing";
  const evidence = state.runtimeState.conclusionReached === true;
  const objectives: Record<string, [string, string]> = {
    preparing: ["班前准备", "修整灰灯、领取支护，然后击鼓下井"],
    underground: ["完成本班巡查", "在灯火耗尽前取得煤样并安全返镇"],
    returned: evidence ? ["公开配火", "选择本班唯一一次公共煤炭分配"] : ["交叉核实", "记录韩直证词，与矿层实物互证"],
    settled: ["复核本班公账", "查看配火后果与仍未履行的承诺"],
  };
  const [title, objective] = objectives[phase] ?? objectives.preparing;
  return <button type="button" data-emberfall="tracker" className="cg-objective-tracker" onClick={openTasks}><StyleSheet /><span className="cg-objective-tracker__label">本班要务</span><strong>{title}</strong><span>{objective}</span></button>;
}

function EmberfallToolbar({ panel, openPanel, openPause }: ToolbarSlotProps) {
  const tools = [["map", "地图", "图"], ["tasks", "承诺", "诺"], ["log", "证据", "证"], ["inventory", "背包", "包"]] as const;
  return <nav data-region="toolbar" data-emberfall="toolbar" className="cg-toolbar ef-chat-toolbar" aria-label="灰烬镇资料面板"><StyleSheet />{tools.map(([id, label, glyph]) => <Button key={id} type="button" variant="quiet" aria-label={label} aria-pressed={panel === id} onClick={() => openPanel(id)}><span className="ef-tool-glyph" aria-hidden="true">{glyph}</span><span className="ef-tool-label">{label}</span></Button>)}<Button type="button" variant="quiet" aria-label="暂停" onClick={openPause}><span className="ef-tool-glyph" aria-hidden="true">停</span><span className="ef-tool-label">暂停</span></Button></nav>;
}

interface EmberfallChoice { label: string; detail: string; hint: IntentHint }

export function createPreviewRequestGate() {
  let latest = 0;
  return { begin: () => { latest += 1; return latest; }, isCurrent: (generation: number) => generation === latest };
}

export function emberfallActionChoices(model: ScriptHostModel): EmberfallChoice[] {
  const phase = stringValue(model, "phase", "preparing");
  const location = model.state.player.locationId;
  if (phase === "preparing") return [
    { label: "修整灰灯", detail: "炉煤 1", hint: { actionId: "trim-wick" } },
    { label: "领取支护", detail: "炉煤 2", hint: { actionId: "draw-support" } },
    { label: "击鼓下井", detail: "进入上层斜巷", hint: { actionId: "begin-shift" } },
    { label: "核问何桂", detail: "职责与支护欠账", hint: { actionId: "talk", target: "he-gui" } },
  ];
  if (phase === "underground") {
    const count = numberValue(model, "undergroundActions");
    if (count >= 8 || numberValue(model, "ashExposure") >= 100) return [{ label: "紧急返镇", detail: "封口并保留下一班", hint: { actionId: "return-shift" } }];
    const result: EmberfallChoice[] = [];
    if (location === "upper-drift") result.push({ label: "测绘矿层", detail: "灯火 8 · 实物源", hint: { actionId: "survey-seam" } }, { label: "去回钟横巷", detail: "灯火 5 · 深度 2", hint: { actionId: "mine-move", params: { target: "bell-gallery" } } });
    if (location === "bell-gallery") result.push({ label: "听辨岩钟", detail: "灯火 6", hint: { actionId: "listen-strata" } }, { label: "去上层斜巷", detail: "灯火 5 · 深度 1", hint: { actionId: "mine-move", params: { target: "upper-drift" } } }, { label: "去青火煤层", detail: "灯火 5 · 深度 3", hint: { actionId: "mine-move", params: { target: "blue-seam" } } });
    if (location === "blue-seam") result.push({ label: "采集炉煤", detail: "灯火 10 · 带回 10", hint: { actionId: "collect-coal" } }, { label: "起取旧班签", detail: "灯火 7 · 辅证", hint: { actionId: "recover-token" } }, { label: "去回钟横巷", detail: "灯火 5 · 深度 2", hint: { actionId: "mine-move", params: { target: "bell-gallery" } } });
    result.push({ label: "加设支柱", detail: "支护 1 · 灯火 4", hint: { actionId: "set-prop" } });
    if (count >= 3 && numberValue(model, "carriedCoal") > 0 && boolValue(model, "physicalEvidence")) result.push({ label: "收班返镇", detail: "炉煤入账", hint: { actionId: "return-shift" } });
    return result;
  }
  if (phase === "returned") {
    if (!boolValue(model, "conclusionReached")) return [{ label: "记录韩直证词", detail: "必需的独立来源", hint: { actionId: "record-testimony", target: "han-zhi" } }];
    return [{ label: "配给诊所", detail: "炉煤 8", hint: { actionId: "allocate-coal", params: { allocation: "clinic" } } }, { label: "配给排水泵", detail: "炉煤 8", hint: { actionId: "allocate-coal", params: { allocation: "pump" } } }, { label: "配给居民炉", detail: "炉煤 8", hint: { actionId: "allocate-coal", params: { allocation: "hearth" } } }];
  }
  return [{ label: "核问王漱兰", detail: "复核本班公账", hint: { actionId: "talk", target: "wang-shulan" } }];
}

function previewText(preview: ActionPreview | null): ReactNode {
  if (!preview) return "选择行动后读取权威成本。";
  if (!preview.executable) return <><strong>当前不可执行：</strong> {preview.reason}</>;
  const resources = (preview.costs.resources ?? []).map((entry) => `${entry.id} −${entry.amount}`).join(" · ");
  const risk = preview.risk.type === "none" ? "无需判定" : `${preview.risk.key ?? preview.risk.type} · DC ${preview.risk.dc}`;
  return <><strong>{preview.displayName}</strong> · {preview.timeCost} 小时 · {resources || "无资源消耗"} · {risk}</>;
}

function EmberfallComposer(props: ComposerSlotProps) {
  const [selected, setSelected] = useState<EmberfallChoice | null>(null);
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [text, setText] = useState("");
  const previewGate = useRef(createPreviewRequestGate());
  const actionChoices = emberfallActionChoices(props);
  async function select(choice: EmberfallChoice) {
    const generation = previewGate.current.begin();
    setSelected(choice); setText(choice.label); setPreview(null); setChecking(true);
    try { const next = await props.previewAction(choice.hint); if (previewGate.current.isCurrent(generation)) setPreview(next); }
    finally { if (previewGate.current.isCurrent(generation)) setChecking(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || props.busy) return;
    const hint = selected && preview?.executable && value === selected.label ? selected.hint : undefined;
    await props.submitTurn(value, hint);
    setText(""); setSelected(null); setPreview(null);
  }
  return <footer data-region="composer" data-emberfall="composer" className="cg-composer ef-chat-composer"><StyleSheet /><div className="cg-action-shortcuts" aria-label="建议行动">{actionChoices.slice(0, 5).map((choice) => <ActionChoiceControl key={`${choice.hint.actionId}-${choice.label}`} selected={selected?.label === choice.label} detail={choice.detail} onClick={() => void select(choice)} disabled={props.busy}>{choice.label}</ActionChoiceControl>)}</div><div className="cg-action-preview" aria-live="polite">{checking ? "正在核算行动成本…" : previewText(preview)}</div><form onSubmit={(event) => void submit(event)}><label className="ef-sr-only" htmlFor="ef-player-input">输入你的话或行动</label><InputGroup><Textarea id="ef-player-input" value={text} onChange={(event) => setText(event.currentTarget.value)} placeholder="说点什么，或描述你的行动" disabled={props.busy} rows={1} maxLength={2000} /><Button variant="primary" size="icon" type="submit" aria-label={props.busy ? "等待世界回应" : "发送"} disabled={props.busy || !text.trim()}><span aria-hidden="true">↑</span><span className="ef-sr-only">{props.busy ? "等待世界回应" : "发送"}</span></Button></InputGroup></form></footer>;
}

function MineMap({ model }: { model: ScriptHostModel }) {
  const current = model.state.player.locationId;
  const node = (id: string) => current === id;
  return <svg className="ef-cross" viewBox="0 0 640 260" role="img" aria-label={`矿井剖面，当前位置 ${current}`}><path d="M72 52 L212 100 L374 158 L548 212" /><circle data-active={node("lamp-house")} cx="72" cy="52" r="18" /><circle data-active={node("upper-drift")} cx="212" cy="100" r="18" /><circle data-active={node("bell-gallery")} cx="374" cy="158" r="18" /><circle data-active={node("blue-seam")} cx="548" cy="212" r="18" /><text x="42" y="24">掌灯房</text><text x="174" y="70">上层斜巷</text><text x="338" y="128">回钟横巷</text><text x="514" y="182">青火煤层</text></svg>;
}

function EvidencePanel({ model }: { model: ScriptHostModel }) {
  const physical = boolValue(model, "physicalEvidence"); const testimony = boolValue(model, "testimonyEvidence"); const conclusion = boolValue(model, "conclusionReached");
  return <div><div className="ef-evidence"><div className="ef-source" data-found={physical}><span className="ef-kicker">实物来源</span><p>青火煤层样 / 未登记楔痕</p></div><svg className="ef-link" data-linked={physical && testimony} viewBox="0 0 40 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 8h36" /></svg><div className="ef-source" data-found={testimony}><span className="ef-kicker">证词来源</span><p>韩直 / 封班后第二次钟响</p></div></div><div className="ef-conclusion">{conclusion ? "互证成立：事故报告遗漏了封班后的第二次下井。" : "两类独立来源齐全后才可形成结论。"}</div></div>;
}

function EmberfallPanel(props: PanelSlotProps) {
  const titles: Record<string, string> = { map: "矿层剖面", tasks: "本班承诺", log: "证据来源", inventory: "随身物" };
  let content: ReactNode;
  if (props.panelId === "map") content = <MineMap model={props} />;
  else if (props.panelId === "log") content = <EvidencePanel model={props} />;
  else if (props.panelId === "tasks") content = <div className="ef-entry"><span className="ef-kicker">当前目标</span><p>{stringValue(props, "phase") === "settled" ? stringValue(props, "allocationOutcome", "本班已经结算。") : "完成巡查、交叉核实并公开配火。"}</p></div>;
  else content = <div>{props.state.player.inventory.stacks.length ? props.state.player.inventory.stacks.map((stack) => { const item = props.catalog.items.find((entry) => entry.id === stack.itemId); return <div className="ef-entry" key={stack.itemId}><strong>{item?.name ?? stack.itemId} × {stack.quantity}</strong><p>{item?.description}</p></div>; }) : <p>随身包为空。</p>}</div>;
  return <section data-emberfall="panel" className="ef-panel" aria-labelledby="ef-panel-title"><StyleSheet /><span className="ef-kicker">矿班档案</span><h2 id="ef-panel-title">{titles[props.panelId] ?? "矿班资料"}</h2>{content}</section>;
}

export default function registerEmberfallUi(ctx: ScriptUiContext): void {
  ctx.register("hud", { component: EmberfallHud });
  ctx.register("objective-tracker", { component: EmberfallObjectiveTracker });
  ctx.register("toolbar", { component: EmberfallToolbar });
  ctx.register("composer", { component: EmberfallComposer });
  ctx.register("panel:map", { component: EmberfallPanel });
  ctx.register("panel:tasks", { component: EmberfallPanel });
  ctx.register("panel:log", { component: EmberfallPanel });
  ctx.register("panel:inventory", { component: EmberfallPanel });
}
