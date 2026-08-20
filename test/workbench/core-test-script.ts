import type {
  AssetManifest,
  Catalog,
  ScriptDetail,
  ScriptMeta,
  ScriptSummary,
  SessionPresentation,
  TranscriptEntry,
  TurnResultFull,
  WorldState,
} from "@/app/lib/api";
import type { ThemeView } from "@/app/lib/theme";

export const CORE_SCRIPT_ID = "core-test-script";
export const ALT_SCRIPT_ID = "core-test-script-alt";

export type ConversationFixture = "short" | "empty" | "long";

const coreTheme: ThemeView = {
  id: "workbench-core",
  name: "工作台暖色",
  palette: {
    background: "#0d1113",
    surface: "#171d20",
    surface_alt: "#222b2f",
    primary: "#e5bd6b",
    on_primary: "#101719",
    accent: "#8fc9c4",
    text: "#f4f0e7",
    text_dim: "#b8c0bd",
    border: "#667379",
    focus: "#9edbd6",
    success: "#8ecb98",
    warning: "#e5bd6b",
    danger: "#df8b85",
    selected: "#33454a",
  },
  typography: {
    font: "sans",
    scale: 1,
    line_height: 1.6,
    letter_spacing_em: 0,
    faces: [],
    roles: { ui: "sans", narrative: "serif", mono: "mono" },
  },
  effects: {
    bubble_radius: 8,
    chrome_radius: 6,
    glass: 0,
    blur_px: 0,
    shadow: "none",
    border_width_px: 1,
    density: "cozy",
    motion: "subtle",
    scene_tint: "#111719",
    overlay_strength: 0.72,
  },
};

const alternateTheme: ThemeView = {
  ...coreTheme,
  id: "workbench-alt",
  name: "工作台冷色",
  palette: {
    ...coreTheme.palette,
    background: "#111019",
    surface: "#1b1925",
    surface_alt: "#292638",
    primary: "#9fc6ff",
    accent: "#d7b7ff",
    border: "#716d85",
  },
};

const emptyAssets: AssetManifest = {
  portraits: {},
  backgrounds: {},
  icons: {},
  sprites: {},
  voices: {},
  ambient: {},
  effects: {},
  ui: {},
};

const catalog: Catalog = {
  locations: [
    {
      id: "relay-room",
      name: "中继室",
      type: "interior",
      description: "一间用于测试宿主布局的确定性房间。",
      npcsPresent: ["operator"],
      connections: [{ to: "service-corridor", distance: 1, travel_time: 1 }],
    },
    {
      id: "service-corridor",
      name: "维护走廊",
      type: "interior",
      description: "狭窄、低矮、没有随机资产。",
      npcsPresent: [],
      connections: [{ to: "relay-room", distance: 1, travel_time: 1 }],
    },
  ],
  items: [{ id: "test-key", name: "测试钥匙", type: "tool", description: "只服务于工作台夹具。" }],
  npcs: [{ id: "operator", name: "值班员" }],
  events: [{ id: "signal-loss", name: "信号中断" }],
  actions: [
    { id: "talk", displayName: "交谈" },
    { id: "inspect", displayName: "检查" },
  ],
  stats: [{ name: "hp", min: 0, max: 100, description: "生命状态" }],
  skills: [{ name: "focus", min: 0, max: 10, description: "专注" }],
  needs: [{ name: "rest" }],
  factions: [{ id: "operators", name: "值班组" }],
  statusEffects: [],
  tasks: [{ id: "restore-signal", name: "恢复信号" }],
  origins: [
    { id: "observer", name: "观察员" },
    { id: "operator", name: "值班员" },
  ],
  currency: { name: "配给点", symbol: "点" },
  hpStat: "hp",
};

function transcriptFor(fixture: ConversationFixture): TranscriptEntry[] {
  if (fixture === "empty") return [];
  const short: TranscriptEntry[] = [
    {
      id: "opening-1",
      turn: 1,
      role: "system",
      text: "交班记录已载入。",
      mediaCues: [],
    },
    {
      id: "opening-2",
      turn: 2,
      role: "world",
      text: "中继室的指示灯依次熄灭，只剩最远端的一盏仍在闪烁。",
      mediaCues: [{ kind: "event", eventId: "signal-loss" }],
    },
    {
      id: "opening-3",
      turn: 3,
      role: "player",
      text: "我先核对交班记录，再检查中继柜。",
      mediaCues: [],
    },
    {
      id: "opening-4",
      turn: 4,
      role: "world",
      text: "值班员把测试钥匙推到你面前，提醒你先确认备用线路。",
      mediaCues: [{ kind: "npc_speech", npcId: "operator" }],
    },
  ];
  if (fixture === "short") return short;
  const long = Array.from({ length: 28 }, (_, index): TranscriptEntry => {
    const role = index % 2 === 0 ? "player" : "world";
    return {
      id: `history-${index + 1}`,
      turn: short.length + index + 1,
      role,
      text:
        role === "player"
          ? `第 ${index + 1} 次确认：沿维护走廊复核线路、门禁和备用电源，并把异常写入交班记录。`
          : `记录 ${index + 1}：指示灯的节奏发生变化，远处传来继电器吸合声，系统保留了这次可追溯的结果。`,
      mediaCues: [],
    };
  });
  return [...short, ...long];
}

export function createFixtureWorld(
  scriptId = CORE_SCRIPT_ID,
  conversation: ConversationFixture = "short",
): WorldState {
  return {
    scriptId,
    clock: {
      totalHours: 31,
      day: 2,
      month: 1,
      year: 1,
      hour: 7,
      weekday: 2,
      weather: "室内",
      season: "值班周期",
    },
    player: {
      originId: "observer",
      name: "测试员",
      stats: { hp: 78 },
      skills: { focus: 6 },
      needs: { rest: { value: 62, descriptor: { label: "清醒", description: "仍能完成本班工作。" } } },
      inventory: { stacks: [{ itemId: "test-key", quantity: 1 }], currency: 12 },
      locationId: "relay-room",
      flags: [],
      threatGauge: 2,
      statuses: [],
      memories: [],
      relations: [
        {
          npcId: "operator",
          value: 18,
          stance: "合作",
          type: "同事",
          description: "愿意共享交班信息。",
        },
      ],
      reputation: [{ factionId: "operators", value: 10 }],
    },
    npcs: {
      operator: {
        id: "operator",
        stats: { hp: 100 },
        skills: { focus: 8 },
        needs: {},
        currentLocationId: "relay-room",
        relations: [],
        reputation: [],
        statuses: [],
      },
    },
    flags: [],
    facts: [],
    eventLog: [],
    commitments: [],
    tasks: [
      {
        taskId: "restore-signal",
        status: "active",
        acceptedDay: 2,
        acceptedEventCount: 0,
        progress: 1,
      },
    ],
    playedEventIds: ["signal-loss"],
    secretHolders: {},
    locationInventories: {
      "relay-room": { stacks: [], currency: 0 },
      "service-corridor": { stacks: [], currency: 0 },
    },
    transcript: transcriptFor(conversation),
    runtimeState: {},
  };
}

export function fixtureScripts(): ScriptSummary[] {
  return [
    {
      id: CORE_SCRIPT_ID,
      name: "工作台剧本",
      description: "不绑定内置故事内容 ID 的宿主测试夹具。",
      author: "chatgame",
      tone: ["deterministic"],
      language: "zh-CN",
      defaultThemeId: coreTheme.id,
      theme: { id: coreTheme.id, name: coreTheme.name, palette: coreTheme.palette },
      hasAssets: false,
      safety: { age_rating: "12+", content_classes: [] },
    },
    {
      id: ALT_SCRIPT_ID,
      name: "备用测试剧本",
      description: "用于验证快速切换和主题隔离。",
      author: "chatgame",
      tone: ["deterministic"],
      language: "zh-CN",
      defaultThemeId: alternateTheme.id,
      theme: { id: alternateTheme.id, name: alternateTheme.name, palette: alternateTheme.palette },
      hasAssets: false,
      safety: { age_rating: "12+", content_classes: [] },
    },
  ];
}

export function fixtureDetail(scriptId = CORE_SCRIPT_ID): ScriptDetail {
  const theme = scriptId === ALT_SCRIPT_ID ? alternateTheme : coreTheme;
  return {
    scriptId,
    presentation: {
      themes: [theme],
      defaultThemeId: theme.id,
      uiBundle: fixtureUiBundle(scriptId),
      assets: false,
    },
    origins: [
      { id: "observer", name: "观察员", description: "从完整日志开始。", difficulty: "标准" },
      { id: "operator", name: "值班员", description: "拥有测试门禁。", difficulty: "进阶" },
    ],
    catalog,
    assets: emptyAssets,
    saves: [{ runId: "autosave.json", updatedAt: "2026-08-20T08:00:00.000Z" }],
    safety: { age_rating: "12+", content_classes: [] },
  };
}

export function fixtureMeta(scriptId = CORE_SCRIPT_ID): ScriptMeta {
  return {
    scriptId,
    unlockedOrigins: [],
    lockableOrigins: [],
    updatedAt: null,
  };
}

export function fixturePresentation(scriptId = CORE_SCRIPT_ID): SessionPresentation {
  const currentTheme = scriptId === ALT_SCRIPT_ID ? alternateTheme : coreTheme;
  return {
    themes: [currentTheme],
    currentTheme,
    defaultThemeId: currentTheme.id,
    uiBundle: fixtureUiBundle(scriptId),
    hasAssets: false,
  };
}

function fixtureUiBundle(scriptId: string): NonNullable<SessionPresentation["uiBundle"]> {
  return {
    apiVersion: 3,
    dependencyHash: `${scriptId}-workbench`,
    url: `/api/scripts/${scriptId}/ui-bundle`,
  };
}

export function fixtureTurnResult(state: WorldState, input: string): TurnResultFull {
  const nextState: WorldState = {
    ...state,
    transcript: [
      ...state.transcript,
      {
        id: `player-${state.transcript.length + 1}`,
        turn: state.transcript.length + 1,
        role: "player",
        text: input,
        mediaCues: [],
      },
      {
        id: `world-${state.transcript.length + 2}`,
        turn: state.transcript.length + 2,
        role: "world",
        text: "备用线路恢复响应，系统把结果写入了交班记录。",
        mediaCues: [],
      },
    ],
  };
  return {
    narrative: "备用线路恢复响应，系统把结果写入了交班记录。",
    resolution: {
      actionId: "inspect",
      resolveType: "auto",
      roll: null,
      dc: null,
      grade: "success",
      effectsApplied: [],
    },
    logEntries: [],
    descriptorUpdates: [],
    fellBackToTalk: false,
    worldEvents: [],
    taskCompletions: [],
    mediaCues: [],
    state: nextState,
    presentation: fixturePresentation(state.scriptId),
  };
}
