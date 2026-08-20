import { useState, type FormEvent, type ReactNode } from "react";
import {
  SCRIPT_UI_API_VERSION,
  type ComposerSlotProps,
  type GameShellSlotProps,
  type HudSlotProps,
  type PanelSlotProps,
  type SceneSlotProps,
  type ScriptHostModel,
  type ScriptUiContext,
  type ToolbarSlotProps,
} from "@chatgame/ui";

export const apiVersion = SCRIPT_UI_API_VERSION;
type IntentHint = Parameters<ComposerSlotProps["previewAction"]>[0];
type ActionPreview = Awaited<ReturnType<ComposerSlotProps["previewAction"]>>;

const CSS = `
.ef-shell,.ef-panel,.ef-composer{font-family:var(--cg-font);color:var(--cg-text)}
.ef-shell{height:100%;min-height:0;display:grid;grid-template:"rail rail" auto "scene tools" minmax(0,1fr) "composer composer" auto/ minmax(0,1fr) auto;background:var(--cg-background);overflow:hidden}
.ef-rail{grid-area:rail;position:relative;z-index:2;padding-top:env(safe-area-inset-top);border-bottom:var(--cg-border-width) solid var(--cg-border)}
.ef-scene-region{grid-area:scene;min-width:0;min-height:0;overflow:hidden}
.ef-tool-region{grid-area:tools;padding-right:env(safe-area-inset-right);border-left:var(--cg-border-width) solid var(--cg-border)}
.ef-composer-region{grid-area:composer;padding-bottom:env(safe-area-inset-bottom);border-top:var(--cg-border-width) solid var(--cg-border)}
.ef-hud{display:grid;grid-template-columns:auto repeat(5,minmax(5.5rem,1fr));align-items:stretch;background:var(--cg-surface)}
.ef-mark{display:grid;place-items:center;min-width:4.75rem;padding:var(--cg-space-2);background:var(--cg-primary);color:var(--cg-on-primary);font-weight:700;letter-spacing:.12em}
.ef-readout{min-width:0;padding:var(--cg-space-2) var(--cg-space-3);border-left:var(--cg-border-width) solid var(--cg-border)}
.ef-label{display:block;color:var(--cg-text-dim);font-family:var(--cg-font-mono);font-size:calc(.66rem * var(--cg-scale));letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}
.ef-value{display:block;margin-top:var(--cg-space-1);font-size:calc(.92rem * var(--cg-scale));font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ef-meter{height:.22rem;margin-top:var(--cg-space-2);background:var(--cg-surface-alt);overflow:hidden}
.ef-meter>span{display:block;height:100%;background:var(--cg-accent)}
.ef-meter.ef-warn>span{background:var(--cg-warning)}
.ef-workface{height:100%;min-height:0;display:grid;grid-template-columns:minmax(11rem,.78fr) minmax(20rem,1.55fr) minmax(13rem,.9fr);background:var(--cg-background)}
.ef-ledger{min-width:0;min-height:0;overflow:auto;padding:var(--cg-space-3);background:var(--cg-surface);border-right:var(--cg-border-width) solid var(--cg-border)}
.ef-ledger:last-child{border-right:0;border-left:var(--cg-border-width) solid var(--cg-border)}
.ef-ledger h2,.ef-panel h2{margin:0 0 var(--cg-space-3);font-size:calc(1rem * var(--cg-scale));letter-spacing:.08em}
.ef-entry{padding:var(--cg-space-2) 0;border-top:var(--cg-border-width) solid var(--cg-border)}
.ef-entry:first-of-type{border-top:0}
.ef-entry time,.ef-kicker{color:var(--cg-accent);font-family:var(--cg-font-mono);font-size:calc(.68rem * var(--cg-scale));letter-spacing:.08em}
.ef-entry p{margin:var(--cg-space-1) 0 0;color:var(--cg-text-dim);font-size:calc(.78rem * var(--cg-scale));line-height:1.45}
.ef-main-scene{position:relative;min-width:0;min-height:0;display:grid;grid-template-rows:minmax(14rem,1fr) auto;overflow:hidden;background:var(--cg-background)}
.ef-image{position:relative;min-height:0;overflow:hidden;background:var(--cg-surface-alt)}
.ef-image img{width:100%;height:100%;object-fit:cover;filter:saturate(.72) contrast(1.06)}
.ef-image::after{content:"";position:absolute;inset:0;background:var(--cg-background);opacity:.2;pointer-events:none}
.ef-caption{position:absolute;z-index:1;left:var(--cg-space-3);bottom:var(--cg-space-3);max-width:32rem;padding:var(--cg-space-2) var(--cg-space-3);background:var(--cg-background);border-left:.24rem solid var(--cg-accent)}
.ef-caption strong{display:block;font-size:calc(1.05rem * var(--cg-scale))}
.ef-caption span{display:block;margin-top:var(--cg-space-1);color:var(--cg-text-dim);font-size:calc(.76rem * var(--cg-scale))}
.ef-transcript{min-height:7.5rem;max-height:13rem;overflow:auto;border-top:var(--cg-border-width) solid var(--cg-border);background:var(--cg-surface)}
.ef-tools{height:100%;display:flex;flex-direction:column;background:var(--cg-surface)}
.ef-tool{appearance:none;min-width:3.15rem;min-height:3.15rem;border:0;border-bottom:var(--cg-border-width) solid var(--cg-border);background:var(--cg-surface);color:var(--cg-text-dim);cursor:pointer;transition:background 150ms ease,color 150ms ease,transform 150ms ease}
.ef-tool:hover{background:var(--cg-surface-alt);color:var(--cg-text)}
.ef-tool:active{transform:translateY(1px)}
.ef-tool[aria-pressed=true]{background:var(--cg-selected);color:var(--cg-accent)}
.ef-tool:focus-visible,.ef-action:focus-visible,.ef-execute:focus-visible,.ef-send:focus-visible,.ef-input:focus-visible{outline:calc(var(--cg-border-width) * 2) solid var(--cg-focus);outline-offset:-2px}
.ef-composer{display:grid;grid-template-columns:minmax(0,1fr) minmax(15rem,.48fr);gap:var(--cg-space-3);padding:var(--cg-space-3);background:var(--cg-surface)}
.ef-actions{display:flex;gap:var(--cg-space-2);overflow-x:auto;padding-bottom:var(--cg-space-1)}
.ef-action{appearance:none;flex:0 0 auto;min-height:2.7rem;padding:var(--cg-space-2) var(--cg-space-3);border:var(--cg-border-width) solid var(--cg-border);border-radius:var(--cg-radius-chrome);background:var(--cg-surface-alt);color:var(--cg-text);font:inherit;text-align:left;cursor:pointer;transition:transform 150ms ease,border-color 150ms ease,background 150ms ease}
.ef-action:hover{transform:translateY(-1px);border-color:var(--cg-accent)}
.ef-action:active{transform:translateY(1px)}
.ef-action[aria-pressed=true]{background:var(--cg-selected);border-color:var(--cg-focus)}
.ef-action small{display:block;margin-top:var(--cg-space-1);color:var(--cg-text-dim);font-size:calc(.67rem * var(--cg-scale))}
.ef-preview{min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--cg-space-2);align-items:center;padding-left:var(--cg-space-3);border-left:var(--cg-border-width) solid var(--cg-border)}
.ef-preview p{margin:0;color:var(--cg-text-dim);font-size:calc(.76rem * var(--cg-scale));line-height:1.35}
.ef-preview strong{color:var(--cg-text)}
.ef-execute,.ef-send{appearance:none;border:var(--cg-border-width) solid var(--cg-primary);border-radius:var(--cg-radius-chrome);background:var(--cg-primary);color:var(--cg-on-primary);font:inherit;font-weight:700;cursor:pointer;transition:transform 150ms ease,opacity 150ms ease}
.ef-execute{min-height:2.75rem;padding:var(--cg-space-2) var(--cg-space-3)}
.ef-execute:active,.ef-send:active{transform:translateY(1px)}
.ef-execute:disabled,.ef-send:disabled{opacity:.5;cursor:not-allowed}
.ef-freeform{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--cg-space-2)}
.ef-input{min-height:2.6rem;padding:var(--cg-space-2) var(--cg-space-3);border:var(--cg-border-width) solid var(--cg-border);border-radius:var(--cg-radius-chrome);background:var(--cg-background);color:var(--cg-text);font:inherit}
.ef-input::placeholder{color:var(--cg-text-dim)}
.ef-send{padding:var(--cg-space-2) var(--cg-space-4)}
.ef-panel{min-width:min(38rem,88vw);max-width:48rem;max-height:78vh;overflow:auto;padding:var(--cg-space-4);background:var(--cg-surface);border:var(--cg-border-width) solid var(--cg-border);box-shadow:var(--cg-shadow-value)}
.ef-panel .ef-ledger{display:block;border:0;padding:0;background:var(--cg-surface)}
.ef-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--cg-space-3)}
.ef-cross{width:100%;height:auto;margin-top:var(--cg-space-3);color:var(--cg-text-dim)}
.ef-cross .ef-tunnel{fill:none;stroke:currentColor;stroke-width:3}
.ef-cross .ef-node{fill:var(--cg-surface-alt);stroke:currentColor;stroke-width:2}
.ef-cross .ef-active{fill:var(--cg-selected);stroke:var(--cg-accent)}
.ef-cross text{fill:currentColor;font-family:var(--cg-font);font-size:calc(.75rem * var(--cg-scale))}
.ef-evidence{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:var(--cg-space-3);margin-top:var(--cg-space-3)}
.ef-source{padding:var(--cg-space-3);border:var(--cg-border-width) solid var(--cg-border);background:var(--cg-surface-alt)}
.ef-source[data-found=true]{border-color:var(--cg-accent);background:var(--cg-selected)}
.ef-link{width:2.5rem;color:var(--cg-text-dim);opacity:.35}
.ef-link[data-linked=true]{color:var(--cg-accent);opacity:1}
.ef-conclusion{margin-top:var(--cg-space-3);padding:var(--cg-space-3);border-left:.24rem solid var(--cg-warning);background:var(--cg-background)}
.ef-empty{color:var(--cg-text-dim)}
.ef-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (max-width:900px){.ef-workface{grid-template-columns:minmax(0,1fr)}.ef-ledger{display:none}.ef-hud{grid-template-columns:auto repeat(3,minmax(4.5rem,1fr))}.ef-hud .ef-optional{display:none}.ef-composer{grid-template-columns:minmax(0,1fr)}.ef-preview{padding:var(--cg-space-2) 0 0;border-left:0;border-top:var(--cg-border-width) solid var(--cg-border)}.ef-freeform{grid-column:auto}.ef-main-scene{grid-template-rows:minmax(12rem,1fr) auto}}
@media (max-width:520px){.ef-shell{grid-template:"rail rail" auto "scene scene" minmax(0,1fr) "composer composer" auto "tools tools" auto/1fr auto}.ef-tool-region{padding-right:env(safe-area-inset-right);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);border-left:0;border-top:var(--cg-border-width) solid var(--cg-border)}.ef-composer-region{padding-bottom:0}.ef-tools{height:auto;flex-direction:row}.ef-tool{flex:1;border-bottom:0;border-right:var(--cg-border-width) solid var(--cg-border)}.ef-mark{min-width:3.25rem;font-size:calc(.75rem * var(--cg-scale))}.ef-readout{padding:var(--cg-space-2)}.ef-hud{grid-template-columns:auto repeat(2,minmax(4.25rem,1fr))}.ef-hud .ef-mobile-hide{display:none}.ef-composer{padding:var(--cg-space-2)}.ef-caption{left:var(--cg-space-2);right:var(--cg-space-2);bottom:var(--cg-space-2)}.ef-transcript{max-height:10rem}.ef-freeform{grid-template-columns:minmax(0,1fr)}}
@media (max-height:430px) and (orientation:landscape){.ef-hud{grid-template-columns:auto repeat(5,minmax(4.2rem,1fr))}.ef-readout{padding:var(--cg-space-1) var(--cg-space-2)}.ef-main-scene{grid-template-rows:minmax(9rem,1fr)}.ef-transcript{display:none}.ef-composer{padding:var(--cg-space-2);grid-template-columns:minmax(0,1fr) minmax(13rem,.45fr)}.ef-freeform{display:none}}
@media (prefers-reduced-motion:reduce){.ef-meter>span,.ef-tool,.ef-action,.ef-execute,.ef-send{transition:none}.ef-action:hover{transform:none}}
`;

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

function localAssetUrl(scriptId: string, file: string): string {
  const relative = file.replace(/^assets\//, "").split("/").map(encodeURIComponent).join("/");
  return `/api/scripts/${encodeURIComponent(scriptId)}/assets/${relative}`;
}

function Meter({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  const safe = Math.max(0, Math.min(100, value));
  return (
    <div className={`ef-meter${warning ? " ef-warn" : ""}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safe}>
      <span style={{ width: `${safe}%` }} />
    </div>
  );
}

function EmberfallHud(props: HudSlotProps) {
  const phase = stringValue(props, "phase", "preparing");
  const phaseName = { preparing: "班前", underground: "井下", returned: "返镇", settled: "已配火" }[phase] ?? phase;
  const location = props.catalog.locations.find((entry) => entry.id === props.state.player.locationId)?.name ?? props.state.player.locationId;
  const lamp = numberValue(props, "lamp");
  const ash = numberValue(props, "ashExposure");
  const pressure = numberValue(props, "minePressure");
  return (
    <div className="ef-hud" aria-label="灰烬镇班次状态">
      <div className="ef-mark" aria-hidden="true">灰灯</div>
      <div className="ef-readout"><span className="ef-label">鼓钟 / 班相</span><span className="ef-value">{String(props.state.clock.hour).padStart(2, "0")}:00 · {phaseName}</span></div>
      <div className="ef-readout"><span className="ef-label">深度 / 位置</span><span className="ef-value">D{numberValue(props, "depth")} · {location}</span></div>
      <div className="ef-readout"><span className="ef-label">灯火</span><span className="ef-value">{lamp}/100</span><Meter label="灰灯火力" value={lamp} /></div>
      <div className="ef-readout ef-mobile-hide"><span className="ef-label">灰量</span><span className="ef-value">{ash}/100</span><Meter label="灰蚀暴露" value={ash} warning /></div>
      <div className="ef-readout ef-optional"><span className="ef-label">支援 / 井压</span><span className="ef-value">{numberValue(props, "supports")} 柱 · {pressure}</span><Meter label="矿层压力" value={pressure} warning /></div>
      <div className="ef-readout ef-optional"><span className="ef-label">公共熔炉</span><span className="ef-value">{numberValue(props, "publicFurnace")} 煤</span></div>
    </div>
  );
}

function Schematic({ model, compact = false }: { model: ScriptHostModel; compact?: boolean }) {
  const current = model.state.player.locationId;
  const node = (id: string) => `ef-node${current === id ? " ef-active" : ""}`;
  return (
    <svg className="ef-cross" viewBox="0 0 640 260" role="img" aria-label={`矿井剖面，当前位置 ${current}`}>
      <path className="ef-tunnel" d="M72 52 L212 100 L374 158 L548 212" />
      <path className="ef-tunnel" d="M212 100 L212 224" opacity=".45" />
      <circle className={node("lamp-house")} cx="72" cy="52" r="18" />
      <circle className={node("upper-drift")} cx="212" cy="100" r="18" />
      <circle className={node("bell-gallery")} cx="374" cy="158" r="18" />
      <circle className={node("blue-seam")} cx="548" cy="212" r="18" />
      <text x="42" y="24">掌灯房</text><text x="174" y="70">上层斜巷</text><text x="338" y="128">回钟横巷</text><text x="514" y="182">青火煤层</text>
      {!compact ? <text x="225" y="238">封闭竖井 · 不可通行</text> : null}
    </svg>
  );
}

function IncidentLedger({ model }: { model: ScriptHostModel }) {
  const logs = model.state.eventLog.slice(-6).reverse();
  return (
    <aside className="ef-ledger" aria-label="本班事故与动作记录">
      <span className="ef-kicker">SHIFT / INCIDENT</span><h2>班次记录</h2>
      {logs.length ? logs.map((entry) => <div className="ef-entry" key={entry.id}><time>第 {entry.day} 日 · {String(entry.hour).padStart(2, "0")}:00</time><p>{entry.summary}</p></div>) : <p className="ef-empty">第一声鼓后，记录将在这里逐项出现。</p>}
    </aside>
  );
}

function PromiseLedger({ model }: { model: ScriptHostModel }) {
  const entries = [
    ["职责", stringValue(model, "npcDutyHeGui")],
    ["欠账", stringValue(model, "npcDebtHanZhi")],
    ["承诺", stringValue(model, "npcPromiseWangShulan")],
    ["计划", stringValue(model, "npcPlanLiangSu")],
  ];
  return <aside className="ef-ledger" aria-label="矿镇承诺账"><span className="ef-kicker">PUBLIC LEDGER</span><h2>承诺账</h2>{entries.map(([label, text]) => <div className="ef-entry" key={label}><time>{label}</time><p>{text}</p></div>)}</aside>;
}

function EmberfallScene(props: SceneSlotProps) {
  const current = props.catalog.locations.find((entry) => entry.id === props.state.player.locationId);
  const entry = props.assets.backgrounds[props.state.player.locationId] ?? props.assets.cover;
  return (
    <div className="ef-workface">
      <IncidentLedger model={props} />
      <section className="ef-main-scene" aria-label="当前矿班现场">
        <div className="ef-image">
          {/* Script assets use the host's authenticated asset route; Next Image is not available inside UI bundles. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {entry?.file ? <img src={localAssetUrl(props.scriptId, entry.file)} alt={entry.alt ?? ""} /> : null}
          <div className="ef-caption"><strong>{current?.name ?? props.state.player.locationId}</strong><span>{current?.description}</span></div>
        </div>
        <div className="ef-transcript">{props.transcript}</div>
      </section>
      <PromiseLedger model={props} />
    </div>
  );
}

function EmberfallShell(props: GameShellSlotProps) {
  return (
    <div className="ef-shell">
      <style>{CSS}</style>
      <header className="ef-rail">{props.regions.hud}</header>
      <main className="ef-scene-region">{props.regions.scene}</main>
      <nav className="ef-tool-region" aria-label="矿班工具">{props.regions.toolbar}</nav>
      <footer className="ef-composer-region">{props.regions.composer}</footer>
      {props.regions.overlays}
    </div>
  );
}

function ToolGlyph({ kind }: { kind: string }) {
  const path = kind === "map" ? "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15"
    : kind === "tasks" ? "M6 4h12v16H6zM9 8h6m-6 4h6m-6 4h4"
      : kind === "log" ? "M4 12h4l2-5 4 10 2-5h4M4 4h16v16H4z"
        : "M6 7h12l1 13H5zM9 7V4h6v3";
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={path} /></svg>;
}

function EmberfallToolbar(props: ToolbarSlotProps) {
  const tools = [["map", "剖面图"], ["tasks", "承诺账"], ["log", "证据图"], ["inventory", "随身物"]] as const;
  return <div className="ef-tools">{tools.map(([id, label]) => <button key={id} type="button" className="ef-tool" aria-label={label} aria-pressed={props.panel === id} onClick={() => props.openPanel(id)}><ToolGlyph kind={id} /></button>)}</div>;
}

interface ActionChoice { label: string; detail: string; hint: IntentHint }

function choices(model: ScriptHostModel): ActionChoice[] {
  const phase = stringValue(model, "phase", "preparing");
  const location = model.state.player.locationId;
  if (phase === "preparing") return [
    { label: "修整灰灯", detail: "炉煤 1", hint: { actionId: "trim-wick" } },
    { label: "领取支护", detail: "炉煤 2", hint: { actionId: "draw-support" } },
    { label: "击鼓下井", detail: "进入上层斜巷", hint: { actionId: "begin-shift" } },
    { label: "核问何桂", detail: "职责与支护欠账", hint: { actionId: "talk", target: "he-gui" } },
  ];
  if (phase === "underground") {
    const result: ActionChoice[] = [];
    if (location === "upper-drift") {
      result.push({ label: "测绘矿层", detail: "灯火 8 · 实物源", hint: { actionId: "survey-seam" } });
      result.push({ label: "去回钟横巷", detail: "灯火 5 · 深度 2", hint: { actionId: "mine-move", params: { target: "bell-gallery" } } });
    }
    if (location === "bell-gallery") {
      result.push({ label: "听辨岩钟", detail: "灯火 6", hint: { actionId: "listen-strata" } });
      result.push({ label: "去上层斜巷", detail: "灯火 5 · 深度 1", hint: { actionId: "mine-move", params: { target: "upper-drift" } } });
      result.push({ label: "去青火煤层", detail: "灯火 5 · 深度 3", hint: { actionId: "mine-move", params: { target: "blue-seam" } } });
    }
    if (location === "blue-seam") {
      result.push({ label: "采集炉煤", detail: "灯火 10 · 带回 10", hint: { actionId: "collect-coal" } });
      result.push({ label: "起取旧班签", detail: "灯火 7 · 辅证", hint: { actionId: "recover-token" } });
      result.push({ label: "去回钟横巷", detail: "灯火 5 · 深度 2", hint: { actionId: "mine-move", params: { target: "bell-gallery" } } });
    }
    result.push({ label: "加设支柱", detail: "支护 1 · 灯火 4", hint: { actionId: "set-prop" } });
    const count = numberValue(model, "undergroundActions");
    if (count >= 3 && count <= 8 && numberValue(model, "carriedCoal") > 0) result.push({ label: "收班返镇", detail: "灯火 4 · 炉煤入账", hint: { actionId: "return-shift" } });
    return result;
  }
  if (phase === "returned") return [
    { label: "记录韩直证词", detail: "第二独立来源", hint: { actionId: "record-testimony", target: "han-zhi" } },
    { label: "配给诊所", detail: "炉煤 8", hint: { actionId: "allocate-coal", params: { allocation: "clinic" } } },
    { label: "配给排水泵", detail: "炉煤 8", hint: { actionId: "allocate-coal", params: { allocation: "pump" } } },
    { label: "配给居民炉", detail: "炉煤 8", hint: { actionId: "allocate-coal", params: { allocation: "hearth" } } },
  ];
  return [{ label: "核问王漱兰", detail: "复核本班公账", hint: { actionId: "talk", target: "wang-shulan" } }];
}

function previewText(preview: ActionPreview | null): ReactNode {
  if (!preview) return "选择行动后读取权威预检。";
  if (!preview.executable) return <><strong>不可执行</strong><br />{preview.reason}</>;
  const resources = (preview.costs.resources ?? []).map((entry) => `${entry.id} ${entry.amount}`).join(" · ");
  const risk = preview.risk.type === "none" ? "自动" : `${preview.risk.key ?? preview.risk.type} / DC ${preview.risk.dc}`;
  return <><strong>{preview.displayName}</strong><br />{preview.timeCost} 小时 · {resources || "无资源消耗"} · {risk}</>;
}

function EmberfallComposer(props: ComposerSlotProps) {
  const [selected, setSelected] = useState<ActionChoice | null>(null);
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [text, setText] = useState("");
  const actionChoices = choices(props);
  const select = async (choice: ActionChoice) => {
    setSelected(choice);
    setChecking(true);
    try { setPreview(await props.previewAction(choice.hint)); } finally { setChecking(false); }
  };
  const execute = async () => {
    if (!selected || !preview?.executable || props.busy) return;
    await props.submitTurn(selected.label, selected.hint);
    setSelected(null); setPreview(null);
  };
  const submitText = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || props.busy) return;
    await props.submitTurn(value);
    setText("");
  };
  return (
    <div className="ef-composer">
      <div className="ef-actions" aria-label="本刻可执行行动">{actionChoices.map((choice) => <button key={`${choice.hint.actionId}-${choice.label}`} type="button" className="ef-action" aria-pressed={selected?.label === choice.label} onClick={() => void select(choice)} disabled={props.busy}><span>{choice.label}</span><small>{choice.detail}</small></button>)}</div>
      <div className="ef-preview" aria-live="polite"><p>{checking ? "班账核算中…" : previewText(preview)}</p><button type="button" className="ef-execute" onClick={() => void execute()} disabled={props.busy || checking || !preview?.executable}>{props.busy ? "记录中…" : "执行"}</button></div>
      <form className="ef-freeform" onSubmit={(event) => void submitText(event)}><label className="ef-sr-only" htmlFor="ef-freeform">补充做法</label><input id="ef-freeform" className="ef-input" value={text} onChange={(event) => setText(event.currentTarget.value)} placeholder="描述你的做法；资源与结果仍由班账判定" disabled={props.busy} /><button className="ef-send" type="submit" disabled={props.busy || !text.trim()}>记入班账</button></form>
    </div>
  );
}

function InventoryPanel({ model }: { model: ScriptHostModel }) {
  const stacks = model.state.player.inventory.stacks;
  return <div>{stacks.length ? stacks.map((stack) => { const item = model.catalog.items.find((entry) => entry.id === stack.itemId); return <div className="ef-entry" key={stack.itemId}><time>{item?.type ?? "物件"} · {stack.quantity}</time><p><strong>{item?.name ?? stack.itemId}</strong><br />{item?.description}</p></div>; }) : <p className="ef-empty">随身包为空。</p>}</div>;
}

function EvidencePanel({ model }: { model: ScriptHostModel }) {
  const physical = boolValue(model, "physicalEvidence");
  const testimony = boolValue(model, "testimonyEvidence");
  const conclusion = boolValue(model, "conclusionReached");
  return <div><div className="ef-evidence"><div className="ef-source" data-found={physical}><span className="ef-kicker">实物来源</span><p>青火煤层样 / 未登记楔痕</p></div><svg className="ef-link" data-linked={physical && testimony} viewBox="0 0 40 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 8h36M7 3 2 8l5 5m26-10 5 5-5 5" /></svg><div className="ef-source" data-found={testimony}><span className="ef-kicker">证词来源</span><p>韩直 / 封班后第二次钟响</p></div></div><div className="ef-conclusion" aria-live="polite">{conclusion ? "互证成立：事故报告遗漏了封班后的第二次下井。" : "结论封存：两类独立来源齐全后才可落账。"}</div></div>;
}

function EmberfallPanel(props: PanelSlotProps) {
  const titles: Record<string, string> = { map: "矿层剖面", tasks: "承诺账", log: "证据来源图", inventory: "随身物" };
  let content: ReactNode;
  if (props.panelId === "map") content = <Schematic model={props} />;
  else if (props.panelId === "tasks") content = <PromiseLedger model={props} />;
  else if (props.panelId === "log") content = <EvidencePanel model={props} />;
  else content = <InventoryPanel model={props} />;
  return <section className="ef-panel" aria-labelledby="ef-panel-title"><div className="ef-panel-head"><div><span className="ef-kicker">WITNESS DESK</span><h2 id="ef-panel-title">{titles[props.panelId] ?? "矿班工具"}</h2></div></div>{content}</section>;
}

export default function registerEmberfallUi(ctx: ScriptUiContext): void {
  ctx.register("game-shell", { component: EmberfallShell });
  ctx.register("hud", { component: EmberfallHud });
  ctx.register("scene", { component: EmberfallScene });
  ctx.register("toolbar", { component: EmberfallToolbar });
  ctx.register("composer", { component: EmberfallComposer });
  ctx.register("panel:map", { component: EmberfallPanel });
  ctx.register("panel:tasks", { component: EmberfallPanel });
  ctx.register("panel:log", { component: EmberfallPanel });
  ctx.register("panel:inventory", { component: EmberfallPanel });
}
