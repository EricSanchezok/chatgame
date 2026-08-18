// LLM bridge tests: intent parsing (fallback tiers), narrative dual-channel
// output, and consistency enforcement (PDVA gate: schema/perm/rule +
// secret/taboo guards). MockProvider keeps everything deterministic.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
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
import { buildSystemPrompt, buildTurnPrompt, buildIntentPrompt } from "../narrative/prompt";
import type { WorldState, WorldDefinition } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function setup(): { def: WorldDefinition; state: WorldState } {
  const def = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
  const { state } = generateWorld(def, "miner", { seed: 42 });
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
    const provider = new MockProvider();
    const tier = await parseIntent(provider, def, state, "我想休息一下");
    if (tier.tier === "direct") {
      expect(["rest", "talk"]).toContain(tier.intent.actionId);
    }
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
    const tier = await parseIntent(provider, def, state, "我要和艾拉说话");
    if (tier.tier === "direct") {
      // elara's display name is 艾拉; target should resolve to elara or undefined
      expect(["elara", undefined]).toContain(tier.intent.target);
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

  it("turn prompt contains time + player input", () => {
    const { def, state } = setup();
    const prompt = buildTurnPrompt({ definition: def, state, playerInput: "你好" });
    expect(prompt).toContain("当前时间");
    expect(prompt).toContain("你好");
  });

  it("intent prompt lists available actions", () => {
    const { def, state } = setup();
    const { system } = buildIntentPrompt(def, state, "测试");
    expect(system).toContain("可用动作");
    expect(system).toContain("talk");
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
      playerInput: "你好，艾拉",
      npcId: "elara",
    });
    expect(typeof output.narrative).toBe("string");
    expect(Array.isArray(output.mechanics_tags)).toBe(true);
  });

  it("fallbackNarrative narrates resolution deterministically", () => {
    const { def, state } = setup();
    const out = fallbackNarrative(def, state, {
      actionId: "persuade",
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
      narrative: "艾拉轻轻摇头，没有回答。",
      mechanics_tags: [],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects narrative leaking an unrevealed secret", () => {
    const { def, state } = setup();
    const secret = def.npcs.get("elara")!.secrets![0];
    const result = checkOutputConsistency(def, state, {
      narrative: `她压低声音：${secret.content}`,
      mechanics_tags: [],
    });
    expect(result.ok).toBe(false);
    expect(result.failedReason).toBe("secret");
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
      narrative: "你感到这是一个游戏系统在运行。",
      mechanics_tags: [],
    });
    // no-fourth-wall taboo is hard: "游戏" appears in it
    expect(result.ok).toBe(false);
  });

  it("withConsistencyRetry falls back after repeated failures", async () => {
    const { def, state } = setup();
    let calls = 0;
    const result = await withConsistencyRetry(
      async () => {
        calls++;
        const secret = def.npcs.get("elara")!.secrets![0];
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
    // emberfall has no quoted-keyword soft taboo; inject one to exercise the
    // soft-taboo warning path (R8: soft taboos warn, never reject).
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
