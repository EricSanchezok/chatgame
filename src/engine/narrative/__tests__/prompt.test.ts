// Prompt builder tests: the relationship & status summary injected into the
// LLM turn prompt (Blueprint R3). Asserts the dual-track descriptions are
// visible to the LLM (same-category-different-texture nuance) and that
// in-scene filtering bounds the prompt.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../../index";
import { generateWorld } from "../../worldgen";
import { MockProvider } from "../mock";
import { buildTurnPrompt } from "../prompt";
import type { WorldDefinition, WorldState } from "../../types";
import { loadCoreTestDefinition } from "../../__tests__/core-test-fixture";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const EMBERFALL = path.join(REPO_ROOT, "scripts/emberfall");
const STARLIGHT = path.join(REPO_ROOT, "scripts/starlight");

function createEmberfallEngine(seed = 42): Engine {
  return Engine.create({
    scriptDir: EMBERFALL,
    originId: "lamp-keeper",
    seed,
    provider: new MockProvider(),
  });
}

function createStarlightEngine(seed = 42): Engine {
  return Engine.create({
    scriptDir: STARLIGHT,
    originId: "crew-member",
    seed,
    provider: new MockProvider(),
  });
}

function createCoreWorld(): { definition: WorldDefinition; state: WorldState } {
  const definition = loadCoreTestDefinition();
  const { state } = generateWorld(definition, "observer", { seed: 42 });
  return { definition, state };
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
    const { definition, state } = createCoreWorld();
    const prompt = buildTurnPrompt({
      definition,
      state,
      playerInput: "你好",
      npcId: "operator",
    });
    expect(prompt).toContain("## 关系与状态摘要");
    expect(prompt).toContain("你与值班员");
    // The relation type is the free-text semantic label authored in the script.
    expect(prompt).toMatch(/关系值 \d+/);
  });

  it("keeps out-of-scene relations out of the summary", () => {
    const { definition, state } = createCoreWorld();
    const outsideState = {
      ...state,
      npcs: {
        ...state.npcs,
        operator: { ...state.npcs.operator, currentLocationId: "service-corridor" },
      },
    };
    const prompt = buildTurnPrompt({
      definition,
      state: outsideState,
      playerInput: "你好",
      npcId: "operator",
    });
    expect(prompt).not.toContain("你与值班员");
  });

  it("still returns a usable prompt when no relations exist", () => {
    const { definition, state } = createCoreWorld();
    const emptyState = {
      ...state,
      player: { ...state.player, relations: [] },
    };
    const prompt = buildTurnPrompt({
      definition,
      state: emptyState,
      playerInput: "你好",
      npcId: "operator",
    });
    expect(prompt).toContain("## 玩家输入");
  });
});

describe("Emberfall content regression", () => {
  it("injects the author's static description as the semantic texture", () => {
    const engine = createEmberfallEngine();
    const state = placeNpcWithPlayer(engine, "wang-shulan");
    const prompt = buildTurnPrompt({
      definition: engine.definition,
      state,
      playerInput: "请核对公账",
      npcId: "wang-shulan",
    });
    expect(prompt).toContain("共守公账");
    expect(prompt).toContain("她认可你对数量的谨慎。");
    expect(prompt).toContain("关系值 20");
  });

  it("injects authored NPC-to-NPC relation texture", () => {
    const engine = createStarlightEngine();
    const state = placeNpcWithPlayer(engine, "chief-engineer");
    const prompt = buildTurnPrompt({
      definition: engine.definition,
      state,
      playerInput: "复核交班关系",
      npcId: "chief-engineer",
    });
    expect(prompt).toContain("老周与林小北：事故联络");
    expect(prompt).toContain("两人对居住环设备底数比灯塔更熟");
    expect(prompt).toContain("老周与阿岑：库存对账对象");
    expect(prompt).toContain("关系值 -8");
  });
});
