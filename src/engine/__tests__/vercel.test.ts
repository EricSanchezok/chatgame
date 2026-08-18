// VercelProvider dual-path tests using ai/test MockLanguageModelV4:
//   (a) valid JSON goes through the real generateObject schema-validation path;
//   (b) invalid JSON throws and the LLMProvider caller (parseIntent) degrades
//       to the deterministic fallback (Blueprint success criterion: 双路验证).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { VercelProvider } from "../narrative/vercel";
import { intentSchema, parseIntent } from "../narrative/intent";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import type { WorldState, WorldDefinition } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/** A MockLanguageModelV4 that always emits the given raw text. */
function mockModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

function setup(): { def: WorldDefinition; state: WorldState } {
  const def = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
  const { state } = generateWorld(def, "miner", { seed: 42 });
  return { def, state };
}

describe("VercelProvider dual-path (MockLanguageModelV4)", () => {
  it("generateObject validates valid JSON against the zod schema", async () => {
    const provider = new VercelProvider({
      languageModel: mockModel(JSON.stringify({ actionId: "talk" })),
    });
    const out = await provider.generateObject({ system: "", prompt: "x", schema: intentSchema });
    expect(out).toEqual({ actionId: "talk" });
  });

  it("generateObject rejects invalid JSON", async () => {
    const provider = new VercelProvider({
      languageModel: mockModel("this is not json {"),
    });
    await expect(
      provider.generateObject({ system: "", prompt: "x", schema: intentSchema }),
    ).rejects.toThrow();
  });

  it("parseIntent degrades to vocabulary fallback when the model emits garbage", async () => {
    const { def, state } = setup();
    const provider = new VercelProvider({
      languageModel: mockModel("not json at all"),
    });
    const tier = await parseIntent(provider, def, state, "我想休息一下");
    // The LLM path failed -> deterministic vocabulary fallback maps 休息 -> rest.
    expect(["direct", "fallback_talk"]).toContain(tier.tier);
    if (tier.tier === "direct") expect(tier.intent.actionId).toBe("rest");
  });
});
