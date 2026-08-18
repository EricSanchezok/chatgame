// Entity runtime tests: relations matrix, memory layering/forgetting,
// and the dual-track descriptor layer (labels + stale + lazy refresh +
// user edits + descriptions never participate in resolution).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import {
  setRelation,
  adjustRelation,
  applyRelationUpdates,
  playerRelationValue,
  npcRelationValue,
  sameLocation,
  PLAYER_REF,
} from "../relations";
import {
  createMemoryEntry,
  applyForgetting,
  applyGlobalForgetting,
  activeMemories,
  summarizeForInjection,
} from "../memory";
import {
  createDescriptor,
  fallbackDescription,
  refreshDescriptor,
  editDescriptor,
  setUserDescriptor,
  refreshAllStale,
  labelForValue,
  crossedBand,
  DESCRIPTOR_MAX_CHARS,
} from "../descriptors";
import type { WorldState, Descriptor } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const emberfall = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    scriptId: "emberfall",
    clock: { totalHours: 0, day: 1, month: 1, year: 1, hour: 0, weekday: 0, weather: "晴", season: "春" },
    player: {
      originId: "miner",
      name: "矿工",
      stats: { hp: 50 },
      skills: {},
      needs: { hunger: { value: 70 } },
      inventory: { stacks: [], currency: 30 },
      locationId: "emberfall-tavern",
      flags: [],
      threatGauge: 0,
      statuses: [],
      memories: [],
      relations: [],
      reputation: [],
    },
    npcs: {
      elara: {
        id: "elara",
        stats: { hp: 80 },
        skills: {},
        needs: {},
        inventory: { stacks: [], currency: 0 },
        relations: [{ npcId: PLAYER_REF, value: 65, stance: "friendly", type: "business" }],
        memories: [],
        knowledgeFlags: [],
        revealedSecrets: [],
        currentLocationId: "emberfall-tavern",
        statuses: [],
        reputation: [],
      },
      oldminer: {
        id: "oldminer",
        stats: { hp: 60 },
        skills: {},
        needs: {},
        inventory: { stacks: [], currency: 0 },
        relations: [],
        memories: [],
        knowledgeFlags: [],
        revealedSecrets: [],
        currentLocationId: "mine-entrance",
        statuses: [],
        reputation: [],
      },
    },
    flags: [],
    facts: [],
    eventLog: [],
    commitments: [],
    director: { seenEventIds: [], lastEventDay: null, tension: {} },
    rng: { seed: 1, state: 1 },
    tasks: [],
    activeEventIds: [],
    ...overrides,
  };
}

describe("relations", () => {
  it("setRelation creates an edge with deterministic stance", () => {
    const rels = setRelation([], "elara", 70);
    expect(rels).toHaveLength(1);
    expect(rels[0].value).toBe(70);
    expect(rels[0].stance).toBe("allied");
    expect(rels[0].type).toBe("acquaintance");
  });
  it("setRelation updates existing edge and marks descriptor stale", () => {
    const base = [{ npcId: "elara", value: 10, stance: "neutral", type: "friend", descriptor: createDescriptor("陌生", "旧描述") }];
    const rels = setRelation(base, "elara", 80, "romantic");
    expect(rels[0].value).toBe(80);
    expect(rels[0].type).toBe("romantic");
    expect(rels[0].descriptor?.stale).toBe(true);
    expect(rels[0].descriptor?.description).toBe("旧描述"); // value untouched by descriptor edit
  });
  it("adjustRelation adds delta", () => {
    const rels = adjustRelation([{ npcId: "elara", value: 10, stance: "neutral", type: "friend" }], "elara", 15);
    expect(rels[0].value).toBe(25);
  });
  it("values clamp to -100..100", () => {
    const rels = setRelation([], "elara", 150);
    expect(rels[0].value).toBe(100);
  });
  it("playerRelationValue / npcRelationValue", () => {
    const s = makeState();
    s.player.relations = [{ npcId: "elara", value: 40, stance: "friendly", type: "friend" }];
    expect(playerRelationValue(s, "elara")).toBe(40);
    expect(playerRelationValue(s, "unknown")).toBe(0);
    expect(npcRelationValue(s, "elara")).toBe(65);
  });
  it("sameLocation checks player-npc and npc-npc", () => {
    const s = makeState();
    expect(sameLocation(s, PLAYER_REF, "elara")).toBe(true);
    expect(sameLocation(s, "elara", "oldminer")).toBe(false);
  });
  it("applyRelationUpdates applies multiple directed edges", () => {
    const s = makeState();
    const next = applyRelationUpdates(s, [
      { owner: "player", target: "elara", value: 50 },
      { owner: "elara", target: "oldminer", value: 20 },
    ]);
    expect(playerRelationValue(next, "elara")).toBe(50);
    expect(next.npcs.elara.relations.find((r) => r.npcId === "oldminer")?.value).toBe(20);
  });
});

describe("memory", () => {
  it("createMemoryEntry sets fields", () => {
    const m = createMemoryEntry("重要记忆", "major", 5, ["mine"], "mem");
    expect(m.text).toBe("重要记忆");
    expect(m.importance).toBe("major");
    expect(m.createdAtDay).toBe(5);
    expect(m.archived).toBe(false);
  });
  it("applyForgetting archives trivial past retention, keeps major when majorKeep", () => {
    const retention = { major: 0, minor: 90, trivial: 30 };
    const mems = [
      createMemoryEntry("旧琐事", "trivial", 1, [], "m1"),
      createMemoryEntry("旧要事", "major", 1, [], "m2"),
    ];
    const result = applyForgetting(mems, 60, retention, true);
    expect(result[0].archived).toBe(true); // trivial, 59 days > 30
    expect(result[1].archived).toBe(false); // major, majorKeep
  });
  it("activeMemories filters archived and sorts newest-first", () => {
    const state = makeState();
    const old = createMemoryEntry("旧", "minor", 1, [], "a");
    const fresh = createMemoryEntry("新", "major", 10, [], "b");
    state.player.memories = [old, { ...fresh }, { ...old, archived: true }];
    const active = activeMemories(state.player);
    expect(active).toHaveLength(2);
    expect(active[0].text).toBe("新");
  });
  it("applyGlobalForgetting archives trivial player memories", () => {
    const state = makeState();
    state.player.memories = [createMemoryEntry("旧琐事", "trivial", 1, [], "m1")];
    state.clock = { ...state.clock, totalHours: 24 * 100 }; // day 100
    const next = applyGlobalForgetting(state, emberfall);
    expect(next.player.memories[0].archived).toBe(true);
  });
  it("summarizeForInjection renders top memories", () => {
    const state = makeState();
    state.player.memories = [
      createMemoryEntry("遇见艾拉", "major", 1, [], "a"),
      createMemoryEntry("买了药水", "minor", 2, [], "b"),
    ];
    const summary = summarizeForInjection(state.player);
    expect(summary).toContain("[major] 遇见艾拉");
  });
});

describe("descriptors (dual-track)", () => {
  it("labelForValue classifies relation bands", () => {
    expect(labelForValue("relation", 90)).toBe("挚友");
    expect(labelForValue("relation", 30)).toBe("友善");
    expect(labelForValue("relation", -90)).toBe("死敌");
    expect(labelForValue("reputation", 70)).toBe("德高望重");
  });
  it("crossedBand detects band transitions", () => {
    expect(crossedBand("relation", 10, 50)).toBe(true); // 陌生 -> 友善
    expect(crossedBand("relation", 10, 12)).toBe(false); // same band
  });
  it("createDescriptor starts stale with label", () => {
    const d = createDescriptor("友善");
    expect(d.stale).toBe(true);
    expect(d.version).toBe(0);
    expect(d.description).toBe("");
  });
  it("refreshDescriptor regenerates stale descriptor with fallback", async () => {
    const d = createDescriptor("友善");
    const refreshed = await refreshDescriptor(d, "relation", 50, {
      definition: emberfall,
      recentEvents: [],
    });
    expect(refreshed.stale).toBe(false);
    expect(refreshed.version).toBe(1);
    expect(refreshed.description).toContain("亲近");
  });
  it("refreshDescriptor keeps fresh descriptors untouched", async () => {
    const d = { ...createDescriptor("友善"), stale: false, description: "已生成" };
    const refreshed = await refreshDescriptor(d, "relation", 50, { definition: emberfall });
    expect(refreshed.description).toBe("已生成");
    expect(refreshed.version).toBe(0);
  });
  it("fallbackDescription is deterministic and bounded", () => {
    const text = fallbackDescription("relation", "友善", 50);
    expect(text.length).toBeLessThan(100);
    expect(text).toContain("友善");
  });
  it("editDescriptor sets userEdited and clamps length", () => {
    const d = createDescriptor("友善");
    const edited = editDescriptor(d, "x".repeat(500));
    expect(edited.userEdited).toBe(true);
    expect(edited.description.length).toBeLessThanOrEqual(DESCRIPTOR_MAX_CHARS);
    expect(edited.stale).toBe(false);
  });
  it("setUserDescriptor applies edit to state and returns update", () => {
    const state = makeState();
    state.player.relations = [{ npcId: "elara", value: 50, stance: "friendly", type: "friend", descriptor: createDescriptor("友善") }];
    const { state: next, update } = setUserDescriptor(state, "player.relations.elara", "她是我最信任的朋友");
    expect(update.descriptor.userEdited).toBe(true);
    const rel = next.player.relations.find((r) => r.npcId === "elara")!;
    expect(rel.descriptor?.description).toBe("她是我最信任的朋友");
    expect(rel.value).toBe(50); // value untouched
  });
  it("refreshAllStale refreshes stale descriptors only", async () => {
    const state = makeState();
    state.player.relations = [
      { npcId: "elara", value: 50, stance: "friendly", type: "friend", descriptor: createDescriptor("友善") }, // stale
      { npcId: "oldminer", value: 20, stance: "neutral", type: "acquaintance", descriptor: { ...createDescriptor("陌生"), stale: false, description: "已生成", version: 2 } }, // fresh
    ];
    const { state: next, updates } = await refreshAllStale(state, { definition: emberfall });
    // elara is stale -> refreshed; oldminer is fresh -> untouched.
    const paths = updates.map((u) => u.path);
    expect(paths).toContain("player.relations.elara");
    expect(paths).not.toContain("player.relations.oldminer");
    const elara = next.player.relations.find((r) => r.npcId === "elara")!;
    expect(elara.descriptor?.stale).toBe(false);
    expect(elara.descriptor?.version).toBe(1);
    const oldminer = next.player.relations.find((r) => r.npcId === "oldminer")!;
    expect(oldminer.descriptor?.version).toBe(2); // untouched
  });
  it("descriptor edit does not change resolution inputs (value untouched)", () => {
    const state = makeState();
    state.player.relations = [{ npcId: "elara", value: 50, stance: "friendly", type: "friend", descriptor: createDescriptor("友善") }];
    const { state: next } = setUserDescriptor(state, "player.relations.elara", "我们是不共戴天的仇敌");
    expect(next.player.relations[0].value).toBe(50);
    expect(next.player.relations[0].stance).toBe("friendly"); // deterministic label unchanged
  });
});

describe("descriptor type sanity", () => {
  it("Descriptor shape is complete", () => {
    const d: Descriptor = { label: "x", description: "y", version: 1, stale: false, sourceEventIds: ["e1"], userEdited: false };
    expect(d).toMatchObject({ label: "x", version: 1 });
  });
});
