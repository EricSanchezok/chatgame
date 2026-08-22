import type { ReactNode } from "react";
import {
  SCRIPT_UI_API_VERSION,
  type GameObjective,
  type GameSuggestion,
  type PanelSlotProps,
  type ScriptHostModel,
  type ScriptUiContext,
} from "@chatgame/ui";
import { EMBERFALL_STYLES } from "./styles";

export const apiVersion = SCRIPT_UI_API_VERSION;

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

export function emberfallObjective(model: ScriptHostModel): GameObjective {
  const phase = stringValue(model, "phase", "preparing");
  const evidence = boolValue(model, "conclusionReached");
  const objectives: Record<string, GameObjective> = {
    preparing: { title: "班前准备", detail: "修整灰灯、领取支护，然后击鼓下井" },
    underground: {
      title: "完成本班巡查",
      detail: "在灯火耗尽前取得煤样并安全返镇",
      progress: { value: numberValue(model, "undergroundActions"), max: 8 },
    },
    returned: evidence
      ? { title: "公开配火", detail: "选择本班唯一一次公共煤炭分配" }
      : { title: "交叉核实", detail: "记录韩直证词，与矿层实物互证" },
    settled: { title: "复核本班公账", detail: "查看配火后果与仍未履行的承诺" },
  };
  return objectives[phase] ?? objectives.preparing;
}

function suggestion(id: string, label: string, detail: string, intentHint: GameSuggestion["intentHint"]): GameSuggestion {
  return { id, label, detail, intentHint };
}

export function emberfallActionChoices(model: ScriptHostModel): GameSuggestion[] {
  const phase = stringValue(model, "phase", "preparing");
  const location = model.state.player.locationId;
  if (phase === "preparing") return [
    suggestion("trim-wick", "修整灰灯", "炉煤 1", { actionId: "trim-wick" }),
    suggestion("draw-support", "领取支护", "炉煤 2", { actionId: "draw-support" }),
    suggestion("begin-shift", "击鼓下井", "进入上层斜巷", { actionId: "begin-shift" }),
  ];
  if (phase === "underground") {
    const count = numberValue(model, "undergroundActions");
    if (count >= 8 || numberValue(model, "ashExposure") >= 100) {
      return [suggestion("emergency-return", "紧急返镇", "封口并保留下一班", { actionId: "return-shift" })];
    }
    const result: GameSuggestion[] = [];
    if (location === "upper-drift") result.push(
      suggestion("survey-seam", "测绘矿层", "灯火 8 · 实物源", { actionId: "survey-seam" }),
      suggestion("move-bell", "去回钟横巷", "灯火 5 · 深度 2", { actionId: "mine-move", params: { target: "bell-gallery" } }),
    );
    if (location === "bell-gallery") result.push(
      suggestion("listen-strata", "听辨岩钟", "灯火 6", { actionId: "listen-strata" }),
      suggestion("move-blue", "去青火煤层", "灯火 5 · 深度 3", { actionId: "mine-move", params: { target: "blue-seam" } }),
    );
    if (location === "blue-seam") result.push(
      suggestion("collect-coal", "采集炉煤", "灯火 10 · 带回 10", { actionId: "collect-coal" }),
      suggestion("recover-token", "起取旧班签", "灯火 7 · 辅证", { actionId: "recover-token" }),
    );
    if (count >= 3 && numberValue(model, "carriedCoal") > 0 && boolValue(model, "physicalEvidence")) {
      result.push(suggestion("return-shift", "收班返镇", "炉煤入账", { actionId: "return-shift" }));
    } else {
      result.push(suggestion("set-prop", "加设支柱", "支护 1 · 灯火 4", { actionId: "set-prop" }));
    }
    return result.slice(0, 3);
  }
  if (phase === "returned") {
    if (!boolValue(model, "conclusionReached")) {
      return [suggestion("record-testimony", "记录韩直证词", "必需的独立来源", { actionId: "record-testimony", target: "han-zhi" })];
    }
    return [
      suggestion("allocate-clinic", "配给诊所", "炉煤 8", { actionId: "allocate-coal", params: { allocation: "clinic" } }),
      suggestion("allocate-pump", "配给排水泵", "炉煤 8", { actionId: "allocate-coal", params: { allocation: "pump" } }),
      suggestion("allocate-hearth", "配给居民炉", "炉煤 8", { actionId: "allocate-coal", params: { allocation: "hearth" } }),
    ];
  }
  return [suggestion("audit", "核问王漱兰", "复核本班公账", { actionId: "talk", target: "wang-shulan" })];
}

function MineMap({ model }: { model: ScriptHostModel }) {
  const current = model.state.player.locationId;
  return (
    <svg className="ef-cross" viewBox="0 0 640 260" role="img" aria-label={`矿井剖面，当前位置 ${current}`}>
      <path d="M72 52 L212 100 L374 158 L548 212" />
      <circle data-active={current === "lamp-house"} cx="72" cy="52" r="18" />
      <circle data-active={current === "upper-drift"} cx="212" cy="100" r="18" />
      <circle data-active={current === "bell-gallery"} cx="374" cy="158" r="18" />
      <circle data-active={current === "blue-seam"} cx="548" cy="212" r="18" />
      <text x="42" y="24">掌灯房</text><text x="174" y="70">上层斜巷</text>
      <text x="338" y="128">回钟横巷</text><text x="514" y="182">青火煤层</text>
    </svg>
  );
}

function EvidencePanel({ model }: { model: ScriptHostModel }) {
  const physical = boolValue(model, "physicalEvidence");
  const testimony = boolValue(model, "testimonyEvidence");
  const conclusion = boolValue(model, "conclusionReached");
  return (
    <div>
      <div className="ef-evidence">
        <div className="ef-source" data-found={physical}><span className="ef-kicker">实物来源</span><p>青火煤层样 / 未登记楔痕</p></div>
        <svg className="ef-link" data-linked={physical && testimony} viewBox="0 0 40 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 8h36" /></svg>
        <div className="ef-source" data-found={testimony}><span className="ef-kicker">证词来源</span><p>韩直 / 封班后第二次钟响</p></div>
      </div>
      <div className="ef-conclusion">{conclusion ? "互证成立：事故报告遗漏了封班后的第二次下井。" : "两类独立来源齐全后才可形成结论。"}</div>
    </div>
  );
}

function EmberfallPanel(props: PanelSlotProps) {
  let content: ReactNode;
  if (props.panelId === "map") content = <MineMap model={props} />;
  else if (props.panelId === "records") content = <EvidencePanel model={props} />;
  else if (props.panelId === "tasks") content = <div className="ef-entry"><span className="ef-kicker">当前目标</span><p>{emberfallObjective(props).detail}</p></div>;
  else content = <div>{props.state.player.inventory.stacks.length ? props.state.player.inventory.stacks.map((stack) => {
    const item = props.catalog.items.find((entry) => entry.id === stack.itemId);
    return <div className="ef-entry" key={stack.itemId}><strong>{item?.name ?? stack.itemId} × {stack.quantity}</strong><p>{item?.description}</p></div>;
  }) : <p>随身包为空。</p>}</div>;
  return <section data-emberfall="panel" className="ef-panel"><StyleSheet />{content}</section>;
}

export default function registerEmberfallUi(ctx: ScriptUiContext): void {
  ctx.configureGame({ objective: emberfallObjective, suggestions: emberfallActionChoices });
  ctx.register("panel:map", { component: EmberfallPanel });
  ctx.register("panel:tasks", { component: EmberfallPanel });
  ctx.register("panel:records", { component: EmberfallPanel });
  ctx.register("panel:inventory", { component: EmberfallPanel });
}
