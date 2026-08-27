import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadWorldScript } from "../../script/world-loader";
import type { ResolutionReceipt } from "../resolution";
import { projectAgentResolutionReceipt } from "../self-state";
import { createTestModelCatalog } from "../testing/model-provider";

const fixture = path.resolve("test/fixtures/open-world-script");

function receipt(visibility: "full" | "result_only" | "hidden"): ResolutionReceipt {
  return {
    id: `receipt-${visibility}`,
    plan: {
      id: `plan-${visibility}`,
      actionId: "player-action",
      actorId: "player",
      targetIds: ["keeper"],
      goal: "让守门人开门",
      means: [
        { description: "使用随身铜钥匙", source: { kind: "entity", id: "key" } },
        { description: "利用钥匙其实是仿制品", source: { kind: "fact", id: "key-authenticity" } },
      ],
      mode: "check",
      difficulty: { kind: "opposed", targetId: "keeper", ratingId: "resolve:keeper", source: { kind: "rating", id: "resolve:keeper" } },
      actorRatingId: "resolve:player",
      factors: [{
        source: { kind: "fact", id: "key-authenticity" },
        role: "risk",
        direction: "neutral",
        steps: 0,
        authority: "semantic",
        channel: null,
        explanation: "钥匙是假的，揭穿后会失去信任。",
      }],
      risk: "risky",
      baseEffect: "standard",
      primaryEffect: {
        id: "opened",
        kind: "condition",
        targetId: "keeper",
        channel: "social",
        label: "愿意开门",
        description: "守门人同意放行。",
        sourceRefs: [{ kind: "action", id: "player-action" }],
        conditionId: "keeper-willing",
        conditionProfileId: null,
        durationProfileId: "brief",
        access: { kind: "public" },
        magnitude: "standard",
      },
      secondaryEffect: null,
      threatenedEffect: {
        id: "distrusted",
        kind: "condition",
        targetId: "player",
        channel: "social",
        label: "不被信任",
        description: "守门人看穿了欺骗。",
        sourceRefs: [{ kind: "fact", id: "key-authenticity" }],
        conditionId: "player-distrusted",
        conditionProfileId: null,
        durationProfileId: "brief",
        access: { kind: "public" },
      },
      visibility,
      causes: [{ kind: "action", id: "player-action" }],
    },
    checkRequestId: "check-1",
    dc: 13,
    modifier: 2,
    checkMode: "normal",
    dice: [15],
    kept: 15,
    total: 17,
    margin: 4,
    outcome: "full",
    effects: [],
    operations: [],
  };
}

describe("Agent resolution receipt projection", () => {
  it("shows a full adjudication chain without hidden canonical evidence", () => {
    const definition = loadWorldScript(fixture, { seed: 1, modelCatalog: createTestModelCatalog() });
    const view = projectAgentResolutionReceipt(
      definition.initialState,
      definition.initialState.agents.player,
      receipt("full"),
    );

    expect(view).toMatchObject({
      visibility: "full",
      plan: {
        means: ["使用随身铜钥匙"],
        actorRating: { name: "决心", value: 2 },
        factors: [],
      },
      check: { dc: 13, dice: [15], total: 17, margin: 4 },
    });
  });

  it("honors result-only and hidden visibility", () => {
    const definition = loadWorldScript(fixture, { seed: 1, modelCatalog: createTestModelCatalog() });
    const agent = definition.initialState.agents.player;
    expect(projectAgentResolutionReceipt(definition.initialState, agent, receipt("result_only")))
      .toEqual(expect.objectContaining({ visibility: "result_only", outcome: "full" }));
    expect(projectAgentResolutionReceipt(definition.initialState, agent, receipt("hidden"))).toBeNull();
  });
});
