import type {
  EngineExtensionContext,
  RuntimeActionHandler,
  RuntimeLifecycleHandler,
} from "../../../src/engine/extensions";
import type { ResultGrade, WorldState } from "../../../src/engine/types";

type IncidentStage = "reported" | "assessed" | "contained";
type IncidentSolution = "standard-repair" | "exterior-bypass" | "allocation-exception";

interface ShiftLogEntry {
  id: string;
  channel: "ALM" | "MAINT" | "HAB" | "CARGO" | "LIGHTHOUSE" | "HANDOFF";
  source: string;
  at: number;
  summary: string;
}

interface StarlightRuntime {
  schema_version: 1;
  hull: number;
  grid: number;
  supply: number;
  fatigue: number;
  fatigue_capacity: number;
  eva_oxygen: number;
  heat: number;
  airflow: number;
  incident: {
    id: "scrubber-p07";
    status: "open" | "contained";
    stage: IncidentStage;
    solution: IncidentSolution | null;
    resolved_at: number | null;
  };
  allocation: {
    register: "REG-2178";
    registered: 182;
    unregistered: 47;
    excluded: number;
    policy: "registered-only" | "temporary-maintenance-exception" | "mechanical-service-restored";
  };
  shift: {
    number: number;
    label: string;
    next_handoff_at: number;
    last_feedback: string;
  };
  logs: ShiftLogEntry[];
}

const INITIAL_RUNTIME: StarlightRuntime = {
  schema_version: 1,
  hull: 83,
  grid: 61,
  supply: 4,
  fatigue: 18,
  fatigue_capacity: 82,
  eva_oxygen: 100,
  heat: 12,
  airflow: 42,
  incident: { id: "scrubber-p07", status: "open", stage: "reported", solution: null, resolved_at: null },
  allocation: { register: "REG-2178", registered: 182, unregistered: 47, excluded: 47, policy: "registered-only" },
  shift: { number: 1, label: "夜班 B-12", next_handoff_at: 14, last_feedback: "等待 P-07 处置签名" },
  logs: [
    { id: "handoff-1", channel: "MAINT", source: "老周 / 维修一班", at: 7, summary: "P-07 压差连续三次超限；备用滤芯 4，只够撑到下一批补给" },
    { id: "handoff-2", channel: "HAB", source: "林小北 / 居住环", at: 7, summary: "H-12 至 H-18 实住 63 人；灯塔工单只计 41 人" },
    { id: "handoff-3", channel: "LIGHTHOUSE", source: "灯塔 / REG-2178", at: 7, summary: "登记人口未见异常；册外耗用归类为设备损耗" },
    { id: "handoff-4", channel: "ALM", source: "P-07", at: 7, summary: "颗粒阀压差 2.81 kPa，反相转速 78%，净化效率 42%" },
  ],
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function runtimeOf(state: WorldState): StarlightRuntime {
  const runtime = state.runtimeState as Partial<StarlightRuntime>;
  if (runtime.schema_version !== 1 || !runtime.incident || !runtime.allocation || !runtime.shift || !Array.isArray(runtime.logs)) {
    throw new Error("starlight runtimeState is not initialized");
  }
  return runtime as StarlightRuntime;
}

function writeRuntime(state: WorldState, runtime: StarlightRuntime): WorldState {
  return { ...state, runtimeState: { ...runtime } };
}

function appendLog(runtime: StarlightRuntime, entry: Omit<ShiftLogEntry, "id">): StarlightRuntime {
  return { ...runtime, logs: [...runtime.logs, { ...entry, id: `handoff-${runtime.logs.length + 1}` }] };
}

function addFlag(state: WorldState, flag: string): WorldState {
  if (state.player.flags.includes(flag)) return state;
  return { ...state, player: { ...state.player, flags: [...state.player.flags, flag] } };
}

function addReputation(state: WorldState, factionId: string, amount: number): WorldState {
  const existing = state.player.reputation.find((entry) => entry.factionId === factionId);
  const row = {
    factionId,
    value: clamp((existing?.value ?? 0) + amount, -100, 100),
    descriptor: existing?.descriptor ? { ...existing.descriptor, stale: true } : undefined,
  };
  return {
    ...state,
    player: {
      ...state.player,
      reputation: existing
        ? state.player.reputation.map((entry) => entry.factionId === factionId ? row : entry)
        : [...state.player.reputation, row],
    },
  };
}

function applyHeat(state: WorldState, runtime: StarlightRuntime, delta: number): { state: WorldState; runtime: StarlightRuntime } {
  const heat = clamp(runtime.heat + delta);
  return { state: { ...state, player: { ...state.player, threatGauge: heat } }, runtime: { ...runtime, heat } };
}

function finishFatigue(runtime: StarlightRuntime, amount: number): StarlightRuntime {
  return { ...runtime, fatigue: clamp(runtime.fatigue + amount) };
}

function rejected(reason: string, message: string): ReturnType<RuntimeActionHandler> {
  return {
    rejected: true,
    rejectReason: reason,
    rejectMessage: message,
    execute: (state) => ({ state, summaries: [] }),
  };
}

function requireOpenIncident(state: WorldState, locationId: string, stage: IncidentStage): StarlightRuntime | ReturnType<RuntimeActionHandler> {
  const runtime = runtimeOf(state);
  if (runtime.incident.status !== "open") return rejected("incident_closed", "P-07 工单已经签结，不能重复结算");
  if (runtime.incident.stage !== stage) return rejected("incident_not_ready", stage === "reported" ? "P-07 等待现场检查" : "先在维修主干完成 P-07 检查");
  if (state.player.locationId !== locationId) return rejected("wrong_worksite", `这项处置只能在 ${locationId} 执行`);
  return runtime;
}

function isRejected(value: StarlightRuntime | ReturnType<RuntimeActionHandler>): value is ReturnType<RuntimeActionHandler> {
  return "execute" in value;
}

const radioHandler: RuntimeActionHandler = ({ state, targetNpcId, params }) => {
  runtimeOf(state);
  const channel = typeof params?.channel === "string" ? params.channel.toUpperCase() : "MAINT";
  const safeChannel: ShiftLogEntry["channel"] = channel === "HAB" || channel === "CARGO" || channel === "LIGHTHOUSE" ? channel : "MAINT";
  return {
    costs: { resources: [{ kind: "runtime", id: "fatigue_capacity", amount: 1 }] },
    timeCost: 1,
    execute: (nextState) => {
      const paid = finishFatigue(runtimeOf(nextState), 1);
      const next = appendLog(paid, {
        channel: safeChannel,
        source: targetNpcId ?? "维修二班",
        at: nextState.clock.totalHours,
        summary: "无线电联络已记录；具体叙述由当班对话生成",
      });
      return { state: writeRuntime(nextState, next), summaries: [`radio ${safeChannel} recorded`] };
    },
  };
};

const inspectHandler: RuntimeActionHandler = ({ state }) => {
  const check = requireOpenIncident(state, "reactor-level", "reported");
  if (isRejected(check)) return check;
  return {
    costs: { resources: [{ kind: "runtime", id: "fatigue_capacity", amount: 4 }] },
    timeCost: 1,
    execute: (nextState) => {
      let next = finishFatigue(runtimeOf(nextState), 4);
      next = { ...next, incident: { ...next.incident, stage: "assessed" }, airflow: 38 };
      next = appendLog(next, {
        channel: "MAINT",
        source: "维修二班 / P-07",
        at: nextState.clock.totalHours,
        summary: "现场确认颗粒阀卡滞；标准更换、舱外旁路、配给例外均可恢复册外空气",
      });
      return { state: writeRuntime(addFlag(nextState, "p07-inspected"), next), summaries: ["P-07 assessed; three solution paths unlocked"] };
    },
  };
};

const repairHandler: RuntimeActionHandler = ({ state }) => {
  const check = requireOpenIncident(state, "reactor-level", "assessed");
  if (isRejected(check)) return check;
  return {
    costs: { resources: [
      { kind: "runtime", id: "supply", amount: 1 },
      { kind: "runtime", id: "grid", amount: 5 },
      { kind: "runtime", id: "fatigue_capacity", amount: 12 },
    ] },
    timeCost: 1,
    execute: (nextState) => {
      let next = finishFatigue(runtimeOf(nextState), 12);
      next = {
        ...next,
        hull: clamp(next.hull + 2),
        airflow: 100,
        incident: { ...next.incident, status: "contained", stage: "contained", solution: "standard-repair", resolved_at: nextState.clock.totalHours },
        allocation: { ...next.allocation, excluded: 0, policy: "mechanical-service-restored" },
      };
      next = appendLog(next, { channel: "MAINT", source: "P-07 工单", at: nextState.clock.totalHours, summary: "颗粒阀更换完成；消耗库存 1、电网 5，册外住户恢复供气" });
      return { state: writeRuntime(nextState, next), summaries: ["P-07 contained by standard repair"] };
    },
  };
};

const bypassHandler: RuntimeActionHandler = ({ state }) => {
  const check = requireOpenIncident(state, "eva-truss", "assessed");
  if (isRejected(check)) return check;
  return {
    costs: { resources: [
      { kind: "runtime", id: "grid", amount: 2 },
      { kind: "runtime", id: "eva_oxygen", amount: 24 },
      { kind: "runtime", id: "fatigue_capacity", amount: 16 },
    ] },
    timeCost: 2,
    execute: (nextState, grade) => {
      let next = finishFatigue(runtimeOf(nextState), 16);
      const solved = grade !== "fail";
      const hullLoss: Record<ResultGrade, number> = { fail: 1, partial: 5, success: 3, crit: 2 };
      const heatGain: Record<ResultGrade, number> = { fail: 5, partial: 12, success: 8, crit: 5 };
      const heated = applyHeat(nextState, next, heatGain[grade]);
      next = {
        ...heated.runtime,
        hull: clamp(next.hull - hullLoss[grade]),
        airflow: solved ? 86 : next.airflow,
        incident: solved ? { ...next.incident, status: "contained", stage: "contained", solution: "exterior-bypass", resolved_at: nextState.clock.totalHours } : next.incident,
        allocation: solved ? { ...next.allocation, excluded: 0, policy: "mechanical-service-restored" } : next.allocation,
      };
      next = appendLog(next, { channel: "MAINT", source: "E-4 舱外工装", at: nextState.clock.totalHours, summary: solved ? `外部旁路接通（${grade}）；库存未动，船体与审计热度承担代价` : "旁路接头未锁定；舱外氧已消耗，P-07 仍待处置" });
      let world = heated.state;
      if (solved) {
        world = addFlag(world, "p07-exterior-bypass");
        world = addReputation(world, "deck-gang", 6);
        world = addReputation(world, "station-committee", -4);
      }
      return { state: writeRuntime(world, next), summaries: [solved ? "P-07 contained by exterior bypass" : "exterior bypass attempt failed"] };
    },
  };
};

const tradeHandler: RuntimeActionHandler = ({ state }) => {
  const check = requireOpenIncident(state, "cargo-bay", "assessed");
  if (isRejected(check)) return check;
  return {
    costs: { currency: 18, resources: [
      { kind: "runtime", id: "grid", amount: 3 },
      { kind: "runtime", id: "fatigue_capacity", amount: 6 },
    ] },
    timeCost: 1,
    execute: (nextState, grade) => {
      let next = finishFatigue(runtimeOf(nextState), 6);
      const solved = grade !== "fail";
      const heatGain: Record<ResultGrade, number> = { fail: 4, partial: 14, success: 10, crit: 6 };
      const heated = applyHeat(nextState, next, heatGain[grade]);
      next = {
        ...heated.runtime,
        airflow: solved ? 92 : next.airflow,
        incident: solved ? { ...next.incident, status: "contained", stage: "contained", solution: "allocation-exception", resolved_at: nextState.clock.totalHours } : next.incident,
        allocation: solved ? { ...next.allocation, excluded: 0, policy: "temporary-maintenance-exception" } : next.allocation,
      };
      next = appendLog(next, { channel: "CARGO", source: "阿岑 / 配给窗口", at: nextState.clock.totalHours, summary: solved ? `配给例外获批（${grade}）；册外 47 人临时计入，审计热度上升` : "配给例外被灯塔退回；工分已用于加急审核，P-07 仍待处置" });
      let world = heated.state;
      if (solved) {
        world = addFlag(world, "p07-allocation-exception");
        world = addFlag(world, "lighthouse-ledger-copy");
        world = addReputation(world, "deck-gang", 8);
        world = addReputation(world, "station-committee", -2);
      }
      return { state: writeRuntime(world, next), summaries: [solved ? "P-07 contained by allocation exception" : "allocation negotiation failed"] };
    },
  };
};

const recoverHandler: RuntimeActionHandler = ({ state }) => {
  runtimeOf(state);
  return {
    timeCost: 1,
    execute: (nextState) => {
      let next = runtimeOf(nextState);
      const recovered = Math.min(15, next.fatigue);
      next = { ...next, fatigue: next.fatigue - recovered, fatigue_capacity: clamp(next.fatigue_capacity + recovered), eva_oxygen: clamp(next.eva_oxygen + 10) };
      next = appendLog(next, { channel: "MAINT", source: "轮休计时器", at: nextState.clock.totalHours, summary: `轮休完成；疲劳恢复 ${recovered}，舱外氧回充 10` });
      return { state: writeRuntime(nextState, next), summaries: ["worker recovered during scheduled pause"] };
    },
  };
};

const sessionStart: RuntimeLifecycleHandler = (state) => ({
  state: {
    ...state,
    clock: { ...state.clock, totalHours: 7, hour: 7 },
    player: { ...state.player, threatGauge: INITIAL_RUNTIME.heat },
    runtimeState: { ...INITIAL_RUNTIME, logs: INITIAL_RUNTIME.logs.map((entry) => ({ ...entry })) },
  },
  summaries: ["starlight night shift B-12 initialized at 07:00"],
});

const onHour: RuntimeLifecycleHandler = (state) => {
  let runtime = runtimeOf(state);
  if (state.clock.totalHours < runtime.shift.next_handoff_at) return { state, summaries: [] };
  const unresolved = runtime.incident.status === "open";
  const solution = runtime.incident.solution;
  const feedback = unresolved
    ? "事故未签结：灯塔切除册外空气权重，下一班接手降压区"
    : solution === "standard-repair"
      ? "标准维修通过复核：库存少一只，居住环全量供气"
      : solution === "exterior-bypass"
        ? "旁路维持供气：下一班须复检船体接头与舱外工装"
        : "配给例外生效：册外人口获得本班权重，审计员要求复核底单";
  runtime = {
    ...runtime,
    hull: clamp(runtime.hull - (unresolved ? 3 : solution === "exterior-bypass" ? 1 : 0)),
    supply: Math.max(0, runtime.supply - (unresolved ? 1 : 0)),
    heat: clamp(runtime.heat + (unresolved ? 6 : solution === "allocation-exception" ? 2 : 0)),
    allocation: unresolved ? { ...runtime.allocation, excluded: 47, policy: "registered-only" } : runtime.allocation,
    shift: {
      number: runtime.shift.number + 1,
      label: runtime.shift.number % 3 === 1 ? "日班 B-12" : "后续班 B-12",
      next_handoff_at: runtime.shift.next_handoff_at + 8,
      last_feedback: feedback,
    },
  };
  runtime = appendLog(runtime, { channel: "HANDOFF", source: "下一班复核", at: state.clock.totalHours, summary: feedback });
  return {
    state: writeRuntime({ ...state, player: { ...state.player, threatGauge: runtime.heat } }, runtime),
    summaries: [`handoff feedback: ${feedback}`],
  };
};

export default function registerStarlightExtensions(ctx: EngineExtensionContext): void {
  ctx.registerActionHandler("radio", radioHandler);
  ctx.registerActionHandler("inspect-scrubber", inspectHandler);
  ctx.registerActionHandler("repair-scrubber", repairHandler);
  ctx.registerActionHandler("bypass-scrubber", bypassHandler);
  ctx.registerActionHandler("trade-allocation", tradeHandler);
  ctx.registerActionHandler("recover", recoverHandler);
  ctx.onSessionStart(sessionStart);
  ctx.onHour(onHour);
}
