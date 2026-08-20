// LLM bridge tests: intent parsing (fallback tiers), narrative dual-channel
// output, and consistency enforcement (PDVA gate: schema/perm/rule +
// secret/taboo guards). MockProvider keeps everything deterministic.
import { describe, expect, it } from "vitest";
import { generateWorld } from "../worldgen";
import { MockProvider } from "../narrative/mock";
import { parseIntent } from "../narrative/intent";
import {
  generateNarrative,
  fallbackNarrative,
} from "../narrative/narrative";
import {
  checkOutputConsistency,
  withConsistencyRetry,
  tagsToEffects,
  consistencySchema,
} from "../narrative/consistency";
import { buildSystemPrompt, buildTurnPrompt, buildIntentPrompt, memorySelections } from "../narrative/prompt";
import { createMemoryEntry, recordMemoryAccess } from "../memory";
import type { WorldState, WorldDefinition } from "../types";
import type { Npc } from "../../script/schemas/npc";
import { loadCoreTestDefinition } from "./core-test-fixture";

const SECRET_ID = "relay-secret";
const SECRET_CONTENT = "备用中继线路位于封闭的维护舱内";

function withNarrativeContracts(def: WorldDefinition): WorldDefinition {
  const operator = def.npcs.get("operator");
  if (!operator) throw new Error("core test fixture must define operator");

  const operatorWithSecret: Npc = {
    ...operator,
    secrets: [
      ...operator.secrets,
      {
        id: SECRET_ID,
        content: SECRET_CONTENT,
        reveal: {
          logic: {
            all: [{ source: "flag", key: "access-granted", op: "has" }],
          },
        },
      },
    ],
  };
  const auditor: Npc = {
    ...operator,
    id: "auditor",
    name: "审计员",
    description: "独立复核中继记录的测试角色。",
    occupation: undefined,
    schedule: undefined,
    home: "service-corridor",
    relations: [],
    secrets: [],
    knowledge_flags: [],
  };

  return {
    ...def,
    world: {
      ...def.world,
      taboos: [
        ...def.world.taboos,
        { id: "no-internal-protocol", text: "不得提及\"内部协议\"", severity: "hard" },
      ],
    },
    npcs: new Map([
      ...def.npcs,
      [operatorWithSecret.id, operatorWithSecret],
      [auditor.id, auditor],
    ]),
  };
}

function setup(): { def: WorldDefinition; state: WorldState } {
  const def = withNarrativeContracts(loadCoreTestDefinition());
  const { state } = generateWorld(def, "observer", { seed: 42 });
  return { def, state };
}

describe("intent parsing", () => {
  it("obvious cheat input is rejected deterministically", async () => {
    const { def, state } = setup();
    const provider = new MockProvider();
    const tier = await parseIntent(provider, def, state, "我要瞬移到宝库");
    expect(tier.tier).toBe("reject");
    if (tier.tier === "reject") expect(tier.reason).toBe("teleport");
  });

  it("vocabulary fallback maps action ids", async () => {
    const { def, state } = setup();
    const provider = new MockProvider({ onGenerateObject: () => ({ actionId: "unknown" }) });
    const tier = await parseIntent(provider, def, state, "我要校验线路");
    expect(tier.tier).toBe("direct");
    if (tier.tier === "direct") expect(tier.intent.actionId).toBe("investigate");
  });

  it("unknown input degrades to talk", async () => {
    const { def, state } = setup();
    const provider = new MockProvider();
    const tier = await parseIntent(provider, def, state, "asdfghjkl 完全无意义");
    expect(["fallback_talk", "direct"]).toContain(tier.tier);
  });

  it("extracts npc target from text", async () => {
    const { def, state } = setup();
    const provider = new MockProvider();
    const tier = await parseIntent(provider, def, state, "我要和值班员说话");
    if (tier.tier === "direct") {
      expect(["operator", undefined]).toContain(tier.intent.target);
    }
  });
});

describe("prompt building", () => {
  it("system prompt contains world constitution + taboos", () => {
    const { def } = setup();
    const sys = buildSystemPrompt(def);
    expect(sys).toContain("世界设定");
    expect(sys).toContain("世界规则");
    expect(sys).toContain("叙事禁忌");
    expect(sys).toContain(def.script.name);
  });
  it("turn prompt contains the state snapshot (time lives there) + player input", () => {
    const { def, state } = setup();
    const prompt = buildTurnPrompt({ definition: def, state, playerInput: "你好" });
    expect(prompt).toContain("当前状态快照");
    expect(prompt).toContain("时间：");
    expect(prompt).toContain("你好");
  });
  it("intent prompt lists available actions", () => {
    const { def, state } = setup();
    const { system } = buildIntentPrompt(def, state, "测试");
    expect(system).toContain("可用动作");
    expect(system).toContain("talk");
  });

  it("turn prompt injects the player memory block when memories exist", () => {
    const { def, state } = setup();
    const withMemories = {
      ...state,
      player: {
        ...state.player,
        memories: [createMemoryEntry("需复核第二路信号", "minor", 1, ["audit"], "pm1")],
      },
    };
    const prompt = buildTurnPrompt({
      definition: def,
      state: withMemories,
      playerInput: "复核信号",
    });
    expect(prompt).toContain("## 玩家的记忆");
    expect(prompt).toContain("需复核第二路信号");
  });

  it("turn prompt omits the player memory block when no active memories", () => {
    const { def, state } = setup();
    const prompt = buildTurnPrompt({ definition: def, state, playerInput: "你好" });
    expect(prompt).not.toContain("## 玩家的记忆");
  });

  it("injects the full secret content for its runtime holder", () => {
    const { def, state } = setup();
    const secret = def.npcs.get("operator")!.secrets[0];
    const reassigned = {
      ...state,
      facts: [...state.facts, secret.id],
      secretHolders: { ...state.secretHolders, [secret.id]: "auditor" },
    };
    const prompt = buildTurnPrompt({
      definition: def,
      state: reassigned,
      playerInput: "备用线路在哪里？",
      npcId: "auditor",
    });
    expect(prompt).toContain(secret.id);
    expect(prompt).toContain(secret.content);
  });

  it("memorySelections is deterministic and reinforces the same ids", () => {
    const { def, state } = setup();
    const withMemories = {
      ...state,
      player: {
        ...state.player,
        memories: [createMemoryEntry("需复核第二路信号", "minor", 1, ["audit"], "pm1")],
      },
    };
    const input = { definition: def, state: withMemories, playerInput: "复核", npcId: "operator" };
    const sel = memorySelections(input);
    const memId = withMemories.player.memories[0].id; // "pm1-1-1"
    expect(sel.player.ids).toContain(memId);
    // recordMemoryAccess boosts the exact injected ids.
    const next = recordMemoryAccess(withMemories, def, sel.player.ids);
    expect(next.player.memories[0].lastAccessedDay).not.toBeNull();
    expect(next.player.memories[0].strength).toBeGreaterThan(0.3);
  });
});

describe("narrative generation", () => {
  it("MockProvider produces schema-valid output", async () => {
    const { def, state } = setup();
    const provider = new MockProvider();
    const output = await generateNarrative({
      provider,
      definition: def,
      state,
      playerInput: "你好，值班员",
      npcId: "operator",
    });
    expect(typeof output.narrative).toBe("string");
    expect(Array.isArray(output.mechanics_tags)).toBe(true);
  });

  it("fallbackNarrative narrates resolution deterministically", () => {
    const { def, state } = setup();
    const out = fallbackNarrative(def, state, {
      actionId: "investigate",
      resolveType: "skill_check",
      roll: 10,
      dc: 12,
      grade: "fail",
      effectsApplied: [],
    });
    expect(out.narrative).toContain("没能做到");
  });
});

describe("consistency enforcement (PDVA)", () => {
  it("accepts clean output", () => {
    const { def, state } = setup();
    const result = checkOutputConsistency(def, state, {
      narrative: "值班员确认线路没有变化。",
      mechanics_tags: [],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects narrative leaking an unrevealed secret", () => {
    const { def, state } = setup();
    const secret = def.npcs.get("operator")!.secrets[0];
    const result = checkOutputConsistency(def, state, {
      narrative: `她压低声音：${secret.content}`,
      mechanics_tags: [],
    });
    expect(result.ok).toBe(false);
    expect(result.failedReason).toBe("secret");
  });

  it("uses the runtime holder when filtering reassigned secret prose", () => {
    const { def, state } = setup();
    const secret = def.npcs.get("operator")!.secrets[0];
    const reassigned = {
      ...state,
      facts: [...state.facts, secret.id],
      secretHolders: { ...state.secretHolders, [secret.id]: "auditor" },
    };
    expect(checkOutputConsistency(def, reassigned, {
      narrative: secret.content,
      mechanics_tags: [],
    }).ok).toBe(true);
  });

  it("rejects mechanics tag referencing a nonexistent item", () => {
    const { def, state } = setup();
    const result = checkOutputConsistency(def, state, {
      narrative: "你捡起一把剑。",
      mechanics_tags: [{ kind: "item", target: "player", key: "nonexistent-sword", value: 1 }],
    });
    expect(result.ok).toBe(false);
    expect(result.failedReason).toBe("perm");
  });

  it("rejects hard taboo text in prose", () => {
    const { def, state } = setup();
    const result = checkOutputConsistency(def, state, {
      narrative: "值班员提到了内部协议。",
      mechanics_tags: [],
    });
    // The immutable test overlay declares "内部协议" as a hard taboo keyword.
    expect(result.ok).toBe(false);
  });

  it("withConsistencyRetry falls back after repeated failures", async () => {
    const { def, state } = setup();
    let calls = 0;
    const result = await withConsistencyRetry(
      async () => {
        calls++;
        const secret = def.npcs.get("operator")!.secrets[0];
        return { narrative: `泄漏：${secret.content}`, mechanics_tags: [] };
      },
      def,
      state,
      2,
    );
    expect(result.ok).toBe(false);
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("tagsToEffects converts validated tags", () => {
    const effects = tagsToEffects([
      { kind: "stat", target: "player", key: "hp", value: -5 },
      { kind: "flag", target: "player", key: "witnessed" },
    ]);
    expect(effects).toHaveLength(2);
    expect(effects[0].kind).toBe("stat");
    expect(effects[1].kind).toBe("flag");
  });

  it("rejects mechanics tag kinds outside the whitelist (memory/secret/event/narrative)", () => {
    // The tag-kind whitelist is narrowed to 10 mechanical kinds; the four
    // narrative/state kinds are rejected at schema level (I3/R8).
    for (const kind of ["memory", "secret", "event", "narrative"] as const) {
      const parsed = consistencySchema.safeParse({
        narrative: "测试",
        mechanics_tags: [{ kind, target: "player" }],
      });
      expect(parsed.success).toBe(false);
    }
    // The 10 allowed kinds still parse.
    const allowed = consistencySchema.safeParse({
      narrative: "测试",
      mechanics_tags: [
        { kind: "stat", target: "player", key: "hp", value: -1 },
        { kind: "flag", target: "player", key: "witnessed" },
      ],
    });
    expect(allowed.success).toBe(true);
  });

  it("soft taboo match returns ok=true with warnings", () => {
    const { def, state } = setup();
    // Inject a quoted-keyword soft taboo to exercise the warning path
    // (R8: soft taboos warn, never reject).
    const softDef = {
      ...def,
      world: {
        ...def.world,
        taboos: [
          ...def.world.taboos,
          { id: "soft-test", text: "避免使用\"划水\"等网络词汇", severity: "soft" as const },
        ],
      },
    };
    const result = checkOutputConsistency(softDef, state, {
      narrative: "他今天又在划水。",
      mechanics_tags: [],
    });
    expect(result.ok).toBe(true);
    expect(result.warnings?.length).toBeGreaterThan(0);
  });
});
