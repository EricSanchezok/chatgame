// Prompt builder tests: the relationship & status summary injected into the
// LLM turn prompt (Blueprint R3). Asserts the dual-track descriptions are
// visible to the LLM (same-category-different-texture nuance) and that
// in-scene filtering bounds the prompt.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../../index";
import { MockProvider } from "../mock";
import { buildTurnPrompt } from "../prompt";
import type { WorldState } from "../../types";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const EMBERFALL = path.join(REPO_ROOT, "scripts/emberfall");

function createEngine(seed = 42): Engine {
  return Engine.create({
    scriptDir: EMBERFALL,
    originId: "miner",
    seed,
    provider: new MockProvider(),
  });
}

/** Moves an NPC to the player's current location (in-scene for the prompt). */
function placeNpcWithPlayer(engine: Engine, npcId: string): WorldState {
  const state = engine.worldState;
  const npc = state.npcs[npcId];
  if (!npc) return state;
  const next: WorldState = {
    ...state,
    npcs: {
      ...state.npcs,
      [npcId]: { ...npc, currentLocationId: state.player.locationId },
    },
  };
  return next;
}

describe("buildTurnPrompt relationship & status summary", () => {
  it("injects the 关系与状态摘要 section with in-scene relations", () => {
    const engine = createEngine();
    const state = placeNpcWithPlayer(engine, "old-miner");
    const prompt = buildTurnPrompt({
      definition: engine.definition,
      state,
      playerInput: "你好",
      npcId: "old-miner",
    });
    expect(prompt).toContain("## 关系与状态摘要");
    // The miner origin starts with a relation to old-miner.
    expect(prompt).toContain("你与老矿工");
    // The relation type is the free-text semantic label authored in the script.
    expect(prompt).toMatch(/关系值 \d+/);
  });

  it("injects the author's static description as the semantic texture", () => {
    const engine = createEngine();
    const state = placeNpcWithPlayer(engine, "old-miner");
    const prompt = buildTurnPrompt({
      definition: engine.definition,
      state,
      playerInput: "老矿工，早啊",
      npcId: "old-miner",
    });
    // The miner origin's starting relation to old-miner carries the authored
    // description "同一条巷道里刨过食" — the LLM must see this texture, not a
    // bare enum.
    expect(prompt).toContain("同一条巷道里刨过食");
  });

  it("injects NPC-to-NPC relations for in-scene NPCs", () => {
    const engine = createEngine();
    const state = placeNpcWithPlayer(engine, "old-miner");
    const prompt = buildTurnPrompt({
      definition: engine.definition,
      state,
      playerInput: "你好",
      npcId: "old-miner",
    });
    // old-miner's relations carry free-text labels ("死对头", "老主顾").
    expect(prompt).toMatch(/老矿工与/);
    expect(prompt).toMatch(/死对头|老主顾/);
  });

  it("keeps out-of-scene relations out of the summary", () => {
    const engine = createEngine();
    const state = placeNpcWithPlayer(engine, "old-miner");
    const prompt = buildTurnPrompt({
      definition: engine.definition,
      state,
      playerInput: "你好",
      npcId: "old-miner",
    });
    // shen-jiugu is not in-scene, so her own relations are not injected
    // (NPCs not present at the player's location are filtered out).
    expect(prompt).not.toMatch(/沈九姑与/);
  });

  it("still returns a usable prompt when no relations exist", () => {
    const engine = createEngine();
    const emptyState = {
      ...engine.worldState,
      player: { ...engine.worldState.player, relations: [] },
    };
    const prompt = buildTurnPrompt({
      definition: engine.definition,
      state: emptyState,
      playerInput: "你好",
      npcId: "elara",
    });
    expect(prompt).toContain("## 玩家输入");
  });
});
