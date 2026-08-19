// LLM context management tests: transcript windowing, rolling summary
// triggers + incremental continuation (generateText), failure degradation,
// save round-trip, and prompt injection order (A/B/C/D/E).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../index";
import { MockProvider } from "../narrative/mock";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import {
  SUMMARY_EVERY_TURNS,
  transcriptWindow,
  shouldSummarize,
  summarizeContext,
  buildContextBlocks,
  buildStateBlock,
  emptyContextSummary,
} from "../context";
import { buildTurnPrompt } from "../narrative/prompt";
import { appendTranscript } from "../presentation";
import type { WorldState, WorldDefinition } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const EMBERFALL = path.join(REPO_ROOT, "scripts/emberfall");

function setup(): { def: WorldDefinition; state: WorldState } {
  const def = loadScript(EMBERFALL);
  const { state } = generateWorld(def, "miner", { seed: 42 });
  return { def, state: { ...state, contextSummary: emptyContextSummary() } };
}

/** Appends one player + one world entry (one full turn). */
function addTurn(state: WorldState, text = "测试对话内容"): WorldState {
  let next = appendTranscript(state, "player", text, []);
  next = appendTranscript(next, "world", "世界安静地回应。", []);
  return next;
}

describe("transcript window (short-term verbatim layer)", () => {
  it("returns the last CONTEXT_WINDOW_TURNS player turns", () => {
    const { def, state } = setup();
    let s = state;
    for (let i = 0; i < 10; i++) s = addTurn(s, `第${i + 1}回合`);
    const window = transcriptWindow(s, def);
    // 10 turns => last 6 turns: entries from turn 13 (9th player entry)
    // through the last world entry (turn 20) => 12 entries.
    expect(window.length).toBe(12);
    expect(window[0].role).toBe("player");
    expect(window[0].text).toContain("第5回合");
    expect(window[window.length - 1].role).toBe("world");
    // The last player entry is the 10th turn (the final world entry
    // belongs to that same turn and carries no turn label).
    expect(window.filter((e) => e.role === "player").at(-1)!.text).toContain("第10回合");
    // Entries before the window are excluded.
    expect(window.some((e) => e.text.includes("第4回合"))).toBe(false);
  });

  it("returns everything when the transcript is shorter than the window", () => {
    const { def, state } = setup();
    let s = state;
    for (let i = 0; i < 3; i++) s = addTurn(s);
    const window = transcriptWindow(s, def);
    expect(window.length).toBe(6); // 3 player + 3 world
  });

  it("respects a run.ext override of the window", () => {
    const { def, state } = setup();
    const customDef = {
      ...def,
      run: { ...def.run, ext: { llm_context: { window_turns: 2 } } },
    } as WorldDefinition;
    let s = state;
    for (let i = 0; i < 5; i++) s = addTurn(s);
    const window = transcriptWindow(s, customDef);
    // Last 2 player turns => 4 entries.
    expect(window.length).toBe(4);
  });
});

describe("summary triggers", () => {
  it("does not trigger before SUMMARY_EVERY_TURNS turns", () => {
    const { def, state } = setup();
    let s = state;
    for (let i = 0; i < SUMMARY_EVERY_TURNS - 1; i++) s = addTurn(s);
    expect(shouldSummarize(s, def)).toBe(false);
  });

  it("triggers at SUMMARY_EVERY_TURNS player turns (turn-count fallback)", () => {
    const { def, state } = setup();
    let s = state;
    for (let i = 0; i < SUMMARY_EVERY_TURNS; i++) s = addTurn(s);
    expect(shouldSummarize(s, def)).toBe(true);
  });

  it("triggers on budget overflow even before the turn count", () => {
    const { def, state } = setup();
    // Shrink the budget so a short transcript overflows the ratio.
    const tightDef = {
      ...def,
      run: { ...def.run, ext: { llm_context: { budget: 20, trigger_ratio: 0.5 } } },
    } as WorldDefinition;
    const s = addTurn(state);
    expect(shouldSummarize(s, tightDef)).toBe(true);
  });

  it("does not re-trigger right after a summary", () => {
    const { def, state } = setup();
    let s = state;
    for (let i = 0; i < SUMMARY_EVERY_TURNS; i++) s = addTurn(s);
    s = {
      ...s,
      contextSummary: { text: "摘要", lastSummaryTurn: SUMMARY_EVERY_TURNS, sourceTurnRange: [1, 16] },
    };
    expect(shouldSummarize(s, def)).toBe(false);
  });
});

describe("rolling summary via generateText", () => {
  it("incrementally continues: the second prompt contains the first summary", async () => {
    const { def, state } = setup();
    let s = state;
    for (let i = 0; i < SUMMARY_EVERY_TURNS; i++) s = addTurn(s, `回合内容${i + 1}`);
    const prompts: string[] = [];
    const provider = new MockProvider({
      onGenerateText: (prompt) => {
        prompts.push(prompt);
        return "摘要一：玩家在矿井结识了艾拉。";
      },
    });
    const first = await summarizeContext(provider, def, s);
    expect(first).not.toBeNull();
    expect(first!.text).toContain("摘要一");
    expect(first!.lastSummaryTurn).toBe(SUMMARY_EVERY_TURNS);
    // The summary prompt includes the retained-tiers config + new range.
    // Continue: 4 more turns, then summarize again.
    for (let i = 0; i < 4; i++) s = addTurn(s, `后续内容${i + 1}`);
    const withPrior = { ...s, contextSummary: first! };
    const second = await summarizeContext(provider, def, withPrior);
    expect(prompts[1]).toContain("摘要一：玩家在矿井结识了艾拉。");
    expect(second!.sourceTurnRange[0]).toBeGreaterThan(first!.sourceTurnRange[1]);
  });

  it("clips output to the configured max", async () => {
    const { def, state } = setup();
    let s = state;
    for (let i = 0; i < SUMMARY_EVERY_TURNS; i++) s = addTurn(s);
    const tiny = {
      ...def,
      run: { ...def.run, ext: { llm_context: { summary_max_chars: 10 } } },
    } as WorldDefinition;
    const provider = new MockProvider({
      onGenerateText: () => "这是一段远超十字符号长度的摘要内容",
    });
    const out = await summarizeContext(provider, tiny, s);
    expect(out!.text.length).toBeLessThanOrEqual(10);
  });

  it("returns null on provider failure (degradation, never blocks)", async () => {
    const { def, state } = setup();
    let s = state;
    for (let i = 0; i < SUMMARY_EVERY_TURNS; i++) s = addTurn(s);
    const failing = new MockProvider({
      onGenerateText: () => {
        throw new Error("provider down");
      },
    });
    const out = await summarizeContext(failing, def, s);
    expect(out).toBeNull();
  });
});

describe("state snapshot block (layer B)", () => {
  it("contains structured facts only — no descriptor lines", () => {
    const { def, state } = setup();
    // Move the player to the tavern where elara is present, so the
    // snapshot includes present NPCs (scene-scoped).
    const moved = { ...state, player: { ...state.player, locationId: "tavern" } };
    const block = buildStateBlock(moved, def);
    expect(block).toContain("当前状态快照");
    expect(block).toContain("在场 NPC");
    expect(block).toContain("时间：");
    expect(block).toContain("地点：");
    // Descriptions live in the 关系与状态摘要 block (prompt.ts), not here.
    expect(block).not.toMatch(/关系 \d+\/100/);
    // System instruction: values are the only fact source.
    expect(block).toContain("数值为唯一事实源");
  });
});

describe("injection length stays bounded (no linear growth)", () => {
  it("keeps the prompt size roughly flat as the transcript grows past the window", () => {
    const { def, state } = setup();
    // 10-turn transcript: window is capped at 6 turns.
    let short = state;
    for (let i = 0; i < 10; i++) short = addTurn(short, `回合内容${i + 1}`);
    const shortPrompt = buildTurnPrompt({
      definition: def,
      state: short,
      playerInput: "你好",
      contextBlocks: buildContextBlocks(short, def),
    });
    // 40-turn transcript: the window stays at 6 turns, so the injected
    // prompt must not grow anywhere near linearly.
    let long = state;
    for (let i = 0; i < 40; i++) long = addTurn(long, `回合内容${i + 1}`);
    const longPrompt = buildTurnPrompt({
      definition: def,
      state: long,
      playerInput: "你好",
      contextBlocks: buildContextBlocks(long, def),
    });
    // 4x the turns => less than 1.2x the injected prompt (window-bound).
    expect(longPrompt.length).toBeLessThan(shortPrompt.length * 1.2);
  });
});

describe("prompt injection order (A/B/C/D/E)", () => {
  it("orders state snapshot -> summary -> transcript -> player input", () => {
    const { def, state } = setup();
    let s = state;
    for (let i = 0; i < 4; i++) s = addTurn(s);
    s = {
      ...s,
      contextSummary: { text: "滚动摘要文本", lastSummaryTurn: 2, sourceTurnRange: [1, 8] },
    };
    const blocks = buildContextBlocks(s, def);
    const prompt = buildTurnPrompt({
      definition: def,
      state: s,
      playerInput: "你好",
      npcId: "elara",
      contextBlocks: blocks,
    });
    const stateIdx = prompt.indexOf("当前状态快照");
    const summaryIdx = prompt.indexOf("剧情摘要");
    const transcriptIdx = prompt.indexOf("最近对话");
    const inputIdx = prompt.indexOf("## 玩家输入");
    expect(stateIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeGreaterThan(stateIdx);
    expect(transcriptIdx).toBeGreaterThan(summaryIdx);
    expect(inputIdx).toBeGreaterThan(transcriptIdx);
    // Summary text is present; player input is last.
    expect(prompt).toContain("滚动摘要文本");
    expect(prompt.indexOf("你好")).toBeGreaterThan(inputIdx);
  });
  it("still builds a valid prompt without a summary (empty blocks)", () => {
    const { def, state } = setup();
    const s = addTurn(state);
    const blocks = buildContextBlocks(s, def);
    const prompt = buildTurnPrompt({
      definition: def,
      state: s,
      playerInput: "你好",
      contextBlocks: blocks,
    });
    expect(prompt).toContain("当前状态快照");
    expect(prompt).toContain("最近对话");
    expect(prompt).toContain("你好");
  });
});

describe("engine integration", () => {
  it("produces a rolling summary after SUMMARY_EVERY_TURNS turns", async () => {
    const engine = Engine.create({
      scriptDir: EMBERFALL,
      originId: "miner",
      seed: 42,
      provider: new MockProvider(),
    });
    for (let i = 0; i < SUMMARY_EVERY_TURNS; i++) {
      await engine.playerTurn("你好，艾拉");
    }
    const summary = engine.worldState.contextSummary;
    expect(summary).toBeDefined();
    expect(summary!.text.length).toBeGreaterThan(0);
    expect(summary!.lastSummaryTurn).toBe(SUMMARY_EVERY_TURNS);
  });

  it("persists the summary across save/load round-trip", async () => {
    const engine = Engine.create({
      scriptDir: EMBERFALL,
      originId: "miner",
      seed: 42,
      provider: new MockProvider(),
    });
    for (let i = 0; i < SUMMARY_EVERY_TURNS; i++) {
      await engine.playerTurn("你好，艾拉");
    }
    const summaryBefore = engine.worldState.contextSummary;
    expect(summaryBefore!.text.length).toBeGreaterThan(0);
    const filePath = engine.save("context-summary-roundtrip");
    const engine2 = Engine.create({
      scriptDir: EMBERFALL,
      originId: "miner",
      seed: 42,
      provider: new MockProvider(),
      loadSaveFile: filePath,
    });
    expect(JSON.stringify(engine2.worldState.contextSummary)).toBe(JSON.stringify(summaryBefore));
  });

  it("keeps the turn working when the summary provider throws", async () => {
    const failing = new MockProvider({
      onGenerateText: () => {
        throw new Error("down");
      },
    });
    const engine = Engine.create({
      scriptDir: EMBERFALL,
      originId: "miner",
      seed: 42,
      provider: failing,
    });
    for (let i = 0; i < SUMMARY_EVERY_TURNS + 1; i++) {
      const result = await engine.playerTurn("你好，艾拉");
      expect(result.narrative.length).toBeGreaterThan(0);
    }
    // No summary was stored, but the turns completed.
    expect(engine.worldState.contextSummary?.text ?? "").toBe("");
    expect(engine.worldState.transcript.length).toBeGreaterThan(0);
  });
});
