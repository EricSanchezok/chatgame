import type {
  EngineExtensionContext,
  RuntimeActionHandler,
  RuntimeConditionEvaluator,
  RuntimeLifecycleHandler,
  RuntimeRuleChecker,
} from "../../../src/engine/extensions";
import type { WorldState } from "../../../src/engine/types";

interface ShiftRuntime {
  phase: "preparing" | "underground" | "returned" | "settled";
  lamp: number;
  ashExposure: number;
  supports: number;
  depth: number;
  minePressure: number;
  undergroundActions: number;
  carriedCoal: number;
  coalExtracted: number;
  publicFurnace: number;
  coalSpent: number;
  coalAllocated: number;
  clinicCoal: number;
  pumpCoal: number;
  hearthCoal: number;
  settlementCount: number;
  allocationOutcome: string;
  physicalEvidence: boolean;
  testimonyEvidence: boolean;
  conclusionReached: boolean;
  echoRecorded: boolean;
  tokenRecovered: boolean;
  testimonyAttempts: number;
  conversations: number;
  lastDutyTarget: string;
  npcDutyHeGui: string;
  npcDebtHanZhi: string;
  npcPromiseWangShulan: string;
  npcPlanLiangSu: string;
}

const DEFAULT_RUNTIME: ShiftRuntime = {
  phase: "preparing",
  lamp: 70,
  ashExposure: 0,
  supports: 1,
  depth: 0,
  minePressure: 18,
  undergroundActions: 0,
  carriedCoal: 0,
  coalExtracted: 0,
  publicFurnace: 24,
  coalSpent: 0,
  coalAllocated: 0,
  clinicCoal: 0,
  pumpCoal: 0,
  hearthCoal: 0,
  settlementCount: 0,
  allocationOutcome: "尚未配火；诊所、排水泵与居民炉都在等待本班结论。",
  physicalEvidence: false,
  testimonyEvidence: false,
  conclusionReached: false,
  echoRecorded: false,
  tokenRecovered: false,
  testimonyAttempts: 0,
  conversations: 0,
  lastDutyTarget: "",
  npcDutyHeGui: "职责：领班何桂负责木牌与支柱清点，欠三队一轮新木料。",
  npcDebtHanZhi: "回钟人韩直欠公共账一份封班后第二次钟响的证词。",
  npcPromiseWangShulan: "炉司王漱兰承诺本班只主持一次公开配火。",
  npcPlanLiangSu: "看护梁素计划按配煤结果维持下一周夜间吸灰柜。",
};

function runtime(state: WorldState): ShiftRuntime {
  return { ...DEFAULT_RUNTIME, ...(state.runtimeState as Partial<ShiftRuntime>) };
}

function withRuntime(state: WorldState, patch: Partial<ShiftRuntime>): WorldState {
  return { ...state, runtimeState: { ...state.runtimeState, ...patch } };
}

function addFact(state: WorldState, fact: string): WorldState {
  return state.facts.includes(fact) ? state : { ...state, facts: [...state.facts, fact] };
}

function accepted(
  execute: ReturnType<RuntimeActionHandler>["execute"],
  resources: Array<{ kind: "runtime"; id: string; amount: number }> = [],
): ReturnType<RuntimeActionHandler> {
  return { ...(resources.length ? { costs: { resources } } : {}), execute };
}

function rejected(reason: string, message: string): ReturnType<RuntimeActionHandler> {
  return {
    rejected: true,
    rejectReason: reason,
    rejectMessage: message,
    execute: (state) => ({ state, summaries: [] }),
  };
}

function requirePhase(state: WorldState, phase: ShiftRuntime["phase"]): ReturnType<RuntimeActionHandler> | null {
  return runtime(state).phase === phase ? null : rejected("wrong_shift_phase", `本动作只可在 ${phase} 阶段执行`);
}

const talkHandler: RuntimeActionHandler = ({ state, targetNpcId }) => {
  if (state.player.locationId !== "lamp-house") return rejected("witness_absent", "职责核问必须在掌灯房当面进行");
  if (!targetNpcId || !["he-gui", "wang-shulan", "han-zhi", "liang-su"].includes(targetNpcId)) {
    return rejected("invalid_witness", "请选择班账中的一名当班人");
  }
  return accepted((nextState) => {
    const next = runtime(nextState);
    return {
      state: withRuntime(nextState, { conversations: next.conversations + 1, lastDutyTarget: targetNpcId }),
      summaries: [`核问 ${targetNpcId} 的职责、欠账、承诺与下一步计划`],
    };
  });
};

const trimWickHandler: RuntimeActionHandler = ({ state }) => {
  const invalid = requirePhase(state, "preparing");
  if (invalid) return invalid;
  return accepted((nextState) => {
    const next = runtime(nextState);
    return {
      state: withRuntime(nextState, { lamp: Math.min(100, next.lamp + 15), coalSpent: next.coalSpent + 1 }),
      summaries: ["公炉煤 -1，灰灯火力 +15"],
    };
  }, [{ kind: "runtime", id: "publicFurnace", amount: 1 }]);
};

const drawSupportHandler: RuntimeActionHandler = ({ state }) => {
  const invalid = requirePhase(state, "preparing");
  if (invalid) return invalid;
  return accepted((nextState) => {
    const next = runtime(nextState);
    return {
      state: withRuntime(nextState, { supports: next.supports + 1, coalSpent: next.coalSpent + 2 }),
      summaries: ["公炉煤 -2，领取支护 +1"],
    };
  }, [{ kind: "runtime", id: "publicFurnace", amount: 2 }]);
};

const beginShiftHandler: RuntimeActionHandler = ({ state }) => {
  const invalid = requirePhase(state, "preparing");
  if (invalid) return invalid;
  if (state.player.locationId !== "lamp-house") return rejected("not_at_headframe", "必须从掌灯房击鼓下井");
  return accepted((nextState) => ({
    state: {
      ...withRuntime(nextState, { phase: "underground", depth: 1, undergroundActions: 0 }),
      player: { ...nextState.player, locationId: "upper-drift" },
    },
    summaries: ["第一遍鼓后下井，抵达上层斜巷"],
  }));
};

const ADJACENCY: Record<string, string[]> = {
  "upper-drift": ["bell-gallery"],
  "bell-gallery": ["upper-drift", "blue-seam"],
  "blue-seam": ["bell-gallery"],
};
const DEPTH: Record<string, number> = { "upper-drift": 1, "bell-gallery": 2, "blue-seam": 3 };

const mineMoveHandler: RuntimeActionHandler = ({ state, params }) => {
  const invalid = requirePhase(state, "underground");
  if (invalid) return invalid;
  const target = typeof params?.target === "string" ? params.target : "";
  if (!ADJACENCY[state.player.locationId]?.includes(target)) return rejected("not_adjacent", "只能沿剖面图移动到相邻矿点");
  return accepted((nextState) => {
    const next = runtime(nextState);
    return {
      state: {
        ...withRuntime(nextState, {
          depth: DEPTH[target],
          ashExposure: Math.min(100, next.ashExposure + 3),
          undergroundActions: next.undergroundActions + 1,
        }),
        player: { ...nextState.player, locationId: target },
      },
      summaries: [`沿巷移至 ${target}，灯火 -5`],
    };
  }, [{ kind: "runtime", id: "lamp", amount: 5 }]);
};

const surveySeamHandler: RuntimeActionHandler = ({ state }) => {
  const invalid = requirePhase(state, "underground");
  if (invalid) return invalid;
  if (state.player.locationId !== "upper-drift") return rejected("wrong_workface", "上层斜巷才保留着未登记楔痕");
  return accepted((nextState, grade) => {
    const next = runtime(nextState);
    const found = grade !== "fail";
    const ashDelta = grade === "fail" ? 16 : grade === "partial" ? 14 : grade === "crit" ? 8 : 12;
    let result = nextState;
    if (found) {
      result = addFact(result, "evidence:seam-sample");
    }
    return {
      state: withRuntime(result, {
        physicalEvidence: next.physicalEvidence || found,
        ashExposure: Math.min(100, next.ashExposure + ashDelta),
        minePressure: grade === "crit" ? Math.max(0, next.minePressure - 4) : next.minePressure,
        undergroundActions: next.undergroundActions + 1,
      }),
      summaries: [found
        ? `取得实物来源：青火煤层样；${grade === "crit" ? "同时辨明应力走向；" : ""}灯火 -8`
        : "煤层碎裂污染了取样，本次没有形成实物证据；灯火 -8"],
    };
  }, [{ kind: "runtime", id: "lamp", amount: 8 }]);
};

const listenStrataHandler: RuntimeActionHandler = ({ state }) => {
  const invalid = requirePhase(state, "underground");
  if (invalid) return invalid;
  if (state.player.locationId !== "bell-gallery") return rejected("no_bell_echo", "只有回钟横巷能分辨铁索回声");
  return accepted((nextState, grade) => {
    const next = runtime(nextState);
    const heard = grade !== "fail";
    const ashDelta = grade === "fail" ? 10 : grade === "partial" ? 8 : grade === "crit" ? 4 : 7;
    return {
      state: withRuntime(nextState, {
        echoRecorded: next.echoRecorded || heard,
        ashExposure: Math.min(100, next.ashExposure + ashDelta),
        minePressure: grade === "crit" ? Math.max(0, next.minePressure - 2) : next.minePressure,
        undergroundActions: next.undergroundActions + 1,
      }),
      summaries: [heard
        ? `记下封班后第二次钟响${grade === "partial" ? "的大致" : "的准确"}方位；灯火 -6`
        : "落石声盖过铁索回响，本次没有形成钟声记录；灯火 -6"],
    };
  }, [{ kind: "runtime", id: "lamp", amount: 6 }]);
};

const collectCoalHandler: RuntimeActionHandler = ({ state }) => {
  const invalid = requirePhase(state, "underground");
  if (invalid) return invalid;
  if (state.player.locationId !== "blue-seam") return rejected("no_workable_coal", "只有青火煤层有可带回的炉煤");
  return accepted((nextState, grade) => {
    const next = runtime(nextState);
    const amount = grade === "fail" ? 0 : grade === "partial" ? 6 : grade === "crit" ? 14 : 10;
    const ashDelta = grade === "fail" ? 16 : grade === "partial" ? 13 : grade === "crit" ? 7 : 10;
    return {
      state: withRuntime(nextState, {
        carriedCoal: next.carriedCoal + amount,
        coalExtracted: next.coalExtracted + amount,
        ashExposure: Math.min(100, next.ashExposure + ashDelta),
        undergroundActions: next.undergroundActions + 1,
      }),
      summaries: [amount > 0 ? `采得炉煤 +${amount}；灯火 -10` : "煤层剥落成灰，本次没有采得可用炉煤；灯火 -10"],
    };
  }, [{ kind: "runtime", id: "lamp", amount: 10 }]);
};

const setPropHandler: RuntimeActionHandler = ({ state }) => {
  const invalid = requirePhase(state, "underground");
  if (invalid) return invalid;
  return accepted((nextState, grade) => {
    const next = runtime(nextState);
    const pressureReduction = grade === "fail" ? 0 : grade === "partial" ? 5 : grade === "crit" ? 15 : 10;
    const ashDelta = grade === "fail" ? 6 : grade === "partial" ? 4 : grade === "crit" ? 1 : 2;
    return {
      state: withRuntime(nextState, {
        minePressure: Math.max(0, next.minePressure - pressureReduction),
        ashExposure: Math.min(100, next.ashExposure + ashDelta),
        undergroundActions: next.undergroundActions + 1,
      }),
      summaries: [pressureReduction > 0
        ? `支护 -1，矿层压力 -${pressureReduction}；灯火 -4`
        : "支柱没有吃住岩层，支护与灯火已消耗但压力未降"],
    };
  }, [
    { kind: "runtime", id: "supports", amount: 1 },
    { kind: "runtime", id: "lamp", amount: 4 },
  ]);
};

const recoverTokenHandler: RuntimeActionHandler = ({ state }) => {
  const invalid = requirePhase(state, "underground");
  if (invalid) return invalid;
  if (state.player.locationId !== "blue-seam") return rejected("token_absent", "旧班签卡在青火煤层排水槽边");
  return accepted((nextState, grade) => {
    const next = runtime(nextState);
    const recovered = grade !== "fail";
    const ashDelta = grade === "fail" ? 12 : grade === "partial" ? 10 : grade === "crit" ? 5 : 8;
    let result = nextState;
    if (recovered) result = addFact(result, "evidence:old-shift-token");
    return {
      state: withRuntime(result, {
        tokenRecovered: next.tokenRecovered || recovered,
        ashExposure: Math.min(100, next.ashExposure + ashDelta),
        minePressure: grade === "crit" ? Math.max(0, next.minePressure - 3) : next.minePressure,
        undergroundActions: next.undergroundActions + 1,
      }),
      summaries: [recovered ? "起取旧班签与钟槌擦痕；灯火 -7" : "排水槽再次塌落，本次没有取出旧班签；灯火 -7"],
    };
  }, [{ kind: "runtime", id: "lamp", amount: 7 }]);
};

const returnShiftHandler: RuntimeActionHandler = ({ state }) => {
  const invalid = requirePhase(state, "underground");
  if (invalid) return invalid;
  const current = runtime(state);
  if (current.undergroundActions < 3) return rejected("shift_length", "完整班次至少包含 3 个井下行动");
  const emergency = current.undergroundActions >= 8 || current.ashExposure >= 100;
  if (!emergency && current.carriedCoal <= 0) return rejected("empty_return", "至少带回一份炉煤才能正常收班");
  if (!emergency && !current.physicalEvidence) return rejected("missing_physical_source", "正常收班前必须带回一份实物证据");
  const carriedCoal = current.carriedCoal;
  const testimonyReady = carriedCoal > 0 && current.physicalEvidence;
  const lampCost = Math.min(4, current.lamp);
  return accepted((nextState) => {
    const next = runtime(nextState);
    return {
      state: {
        ...withRuntime(nextState, {
          phase: testimonyReady ? "returned" : "preparing",
          depth: 0,
          publicFurnace: next.publicFurnace + carriedCoal,
          carriedCoal: 0,
          ashExposure: Math.max(0, next.ashExposure - 40),
        }),
        player: { ...nextState.player, locationId: "lamp-house" },
      },
      summaries: [testimonyReady
        ? `收班返镇，炉煤入公账 +${carriedCoal}；灯火 -${lampCost}`
        : `紧急返镇，炉煤入公账 +${carriedCoal}；本班未满足见证条件，回到班前准备`],
    };
  }, lampCost > 0 ? [{ kind: "runtime", id: "lamp", amount: lampCost }] : []);
};

const recordTestimonyHandler: RuntimeActionHandler = ({ state, targetNpcId }) => {
  const invalid = requirePhase(state, "returned");
  if (invalid) return invalid;
  const current = runtime(state);
  if (targetNpcId !== "han-zhi") return rejected("wrong_witness", "第二次钟响必须由当班回钟人韩直作证");
  if (!current.physicalEvidence) return rejected("missing_physical_source", "先取得独立实物来源，再核对证词");
  return accepted((nextState, grade) => {
    const next = runtime(nextState);
    const recorded = grade !== "fail";
    const concluded = grade === "success" || grade === "crit";
    let result = nextState;
    if (recorded) result = addFact(result, "evidence:bell-testimony");
    if (concluded) result = addFact(result, "conclusion:unlogged-second-descent");
    if (grade === "crit") result = addFact(result, "evidence:bell-tally-copy");
    return {
      state: withRuntime(result, {
        testimonyAttempts: next.testimonyAttempts + 1,
        testimonyEvidence: next.testimonyEvidence || recorded,
        conclusionReached: next.conclusionReached || concluded,
      }),
      summaries: [grade === "fail"
        ? "证词时间与班账冲突，本次没有形成有效证词来源"
        : concluded
          ? `取得证词来源：韩直的钟房记录；双源互证成立${grade === "crit" ? "，并附得钟房班签抄件" : ""}`
          : "取得一份不完整的钟房证词，尚不足以形成双源结论"],
    };
  });
};

const allocateCoalHandler: RuntimeActionHandler = ({ state, params }) => {
  const invalid = requirePhase(state, "returned");
  if (invalid) return invalid;
  const current = runtime(state);
  if (!current.physicalEvidence || !current.testimonyEvidence || !current.conclusionReached) {
    return rejected("missing_evidence", "实物与证词尚未形成双源结论，不能公开配火");
  }
  if (current.settlementCount !== 0) return rejected("already_settled", "本班配火已经结算，不能重复");
  const allocation = typeof params?.allocation === "string" ? params.allocation : "";
  if (!["clinic", "pump", "hearth"].includes(allocation)) return rejected("invalid_allocation", "请选择诊所、排水泵或居民炉火");
  return accepted((nextState) => {
    const next = runtime(nextState);
    const field = allocation === "clinic" ? "clinicCoal" : allocation === "pump" ? "pumpCoal" : "hearthCoal";
    const outcome = allocation === "clinic"
      ? "诊所获得 8 煤；梁素下一班开启夜间吸灰柜，排水泵与居民炉继续登记欠煤。"
      : allocation === "pump"
        ? "排水泵获得 8 煤；下一班青火煤层积水下降，梁素把夜间吸灰柜延期。"
        : "居民炉获得 8 煤；下一班掌灯房维持夜间供暖，诊所与排水泵继续登记欠煤。";
    const liangPlan = allocation === "clinic"
      ? "计划已启动：梁素下一班开启夜间吸灰柜，并复核灰蚀名单。"
      : allocation === "pump"
        ? "计划已调整：梁素等待下一次配火，先把灰蚀重症转到日间处理。"
        : "计划已调整：梁素维持日间诊疗，继续登记夜间吸灰柜欠煤。";
    return {
      state: withRuntime(nextState, {
        [field]: next[field] + 8,
        coalAllocated: next.coalAllocated + 8,
        settlementCount: 1,
        phase: "settled",
        allocationOutcome: outcome,
        npcPlanLiangSu: liangPlan,
        npcPromiseWangShulan: `承诺兑现：王漱兰公开把 8 煤配给${allocation === "clinic" ? "诊所" : allocation === "pump" ? "排水泵" : "居民炉"}，其余请求留在欠账。`,
      }),
      summaries: [`公开配火：${allocation} +8；${outcome}`],
    };
  }, [{ kind: "runtime", id: "publicFurnace", amount: 8 }]);
};

const shiftCondition: RuntimeConditionEvaluator = (state, leaf) => {
  const value = runtime(state)[leaf.key as keyof ShiftRuntime];
  switch (leaf.op) {
    case "eq": return value === leaf.value;
    case "neq": return value !== leaf.value;
    case "gte": return typeof value === "number" && typeof leaf.value === "number" && value >= leaf.value;
    case "lte": return typeof value === "number" && typeof leaf.value === "number" && value <= leaf.value;
    case "gt": return typeof value === "number" && typeof leaf.value === "number" && value > leaf.value;
    case "lt": return typeof value === "number" && typeof leaf.value === "number" && value < leaf.value;
    default: return false;
  }
};

const shiftRule: RuntimeRuleChecker = ({ state, actionId }) => {
  const current = runtime(state);
  if (current.phase === "underground" && actionId !== "return-shift") {
    if (current.ashExposure >= 100) return "灰蚀已满，只能立即收班返镇";
    if (current.undergroundActions >= 8) return "本班已完成八个井下行动，只能立即收班返镇";
  }
  return null;
};

const sessionStart: RuntimeLifecycleHandler = (state) => {
  const originPatch = state.player.originId === "rescue-surveyor" ? { lamp: 64, supports: 2 } : { lamp: 72, supports: 1 };
  return {
    state: { ...state, runtimeState: { ...DEFAULT_RUNTIME, ...originPatch } },
    summaries: ["公用灰灯、支护与炉煤班账已交接"],
  };
};

const hourPassed: RuntimeLifecycleHandler = (state) => {
  const current = runtime(state);
  if (current.phase !== "underground") return { state, summaries: [] };
  return {
    state: withRuntime(state, { minePressure: Math.min(100, current.minePressure + 2) }),
    summaries: [],
  };
};

export default function registerEmberfallExtensions(ctx: EngineExtensionContext): void {
  ctx.registerConditionSource("shift_state", shiftCondition);
  ctx.registerRuleMechanism("shift-discipline", shiftRule);
  ctx.registerActionHandler("talk", talkHandler);
  ctx.registerActionHandler("trim-wick", trimWickHandler);
  ctx.registerActionHandler("draw-support", drawSupportHandler);
  ctx.registerActionHandler("begin-shift", beginShiftHandler);
  ctx.registerActionHandler("mine-move", mineMoveHandler);
  ctx.registerActionHandler("survey-seam", surveySeamHandler);
  ctx.registerActionHandler("listen-strata", listenStrataHandler);
  ctx.registerActionHandler("collect-coal", collectCoalHandler);
  ctx.registerActionHandler("set-prop", setPropHandler);
  ctx.registerActionHandler("recover-token", recoverTokenHandler);
  ctx.registerActionHandler("return-shift", returnShiftHandler);
  ctx.registerActionHandler("record-testimony", recordTestimonyHandler);
  ctx.registerActionHandler("allocate-coal", allocateCoalHandler);
  ctx.onSessionStart(sessionStart);
  ctx.onHour(hourPassed);
}
