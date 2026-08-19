// Prompt builder tests: the script-declared safety block, per-action
// llm_freedom guidance, and the turn-prompt action block.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import {
  buildSystemPrompt,
  buildActionFreedomBlock,
  buildTurnPrompt,
} from "../narrative/prompt";
import type { WorldDefinition, WorldState } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function setup(): { def: WorldDefinition; state: WorldState } {
  const def = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
  const { state } = generateWorld(def, "miner", { seed: 42 });
  return { def, state };
}

describe("buildSystemPrompt safety block", () => {
  it("lists age rating, allowed intensities, and forbidden content", () => {
    const { def } = setup();
    const sys = buildSystemPrompt(def);
    expect(sys).toContain("## 内容边界（必须遵守）");
    expect(sys).toContain("- 本作品分级：12+");
    // Only non-none classes appear in the allowed list.
    expect(sys).toContain("violence=moderate");
    expect(sys).not.toContain("self_harm=");
    expect(sys).not.toContain("sexual=");
    expect(sys).toContain("- 禁止的内容：self_harm、sexual");
  });
});

describe("buildActionFreedomBlock", () => {
  it("returns the right guidance for narration/process/result", () => {
    const { def } = setup();
    expect(buildActionFreedomBlock("talk", def)).toContain("本动作允许自由叙事");
    expect(buildActionFreedomBlock("attack", def)).toContain("本动作只叙述机械流程的结果");
    // No fixture action declares llm_freedom: result; inject one.
    const resultDef: WorldDefinition = {
      ...def,
      actions: {
        ...def.actions,
        actions: def.actions.actions.map((a) =>
          a.id === "rest" ? { ...a, llm_freedom: "result" as const } : a,
        ),
      },
    };
    expect(buildActionFreedomBlock("rest", resultDef)).toContain("本动作只叙述最终结果");
    // Every block keeps the LLM out of mechanics adjudication.
    for (const text of [
      buildActionFreedomBlock("talk", def),
      buildActionFreedomBlock("attack", def),
      buildActionFreedomBlock("rest", resultDef),
    ]) {
      expect(text).toContain("机制由引擎结算，你只负责叙事。");
    }
  });

  it("returns an empty string for unknown actions", () => {
    const { def } = setup();
    expect(buildActionFreedomBlock("no-such-action", def)).toBe("");
  });
});

describe("buildTurnPrompt action block", () => {
  it("inserts the action freedom block before output requirements", () => {
    const { def, state } = setup();
    const prompt = buildTurnPrompt({ definition: def, state, playerInput: "攻击", actionId: "attack" });
    expect(prompt).toContain("## 当前动作");
    expect(prompt.indexOf("## 当前动作")).toBeLessThan(prompt.indexOf("## 输出要求"));
  });

  it("omits the block when the action id is unknown", () => {
    const { def, state } = setup();
    const prompt = buildTurnPrompt({ definition: def, state, playerInput: "你好", actionId: "no-such-action" });
    expect(prompt).not.toContain("## 当前动作");
  });
});
