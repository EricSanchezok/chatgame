import { describe, expect, it } from "vitest";
import type { SimulationState } from "../../contracts/model";
import { evaluateCausalAssertion } from "../causality";

describe("causal assertions", () => {
  it("keeps travel active while the actor placement differs from the destination", () => {
    const state = {
      truth: {
        entities: { traveler: { id: "traveler", lifecycle: "active" } },
        placements: { traveler: "road" },
      },
    } as unknown as SimulationState;

    expect(evaluateCausalAssertion(state, {
      kind: "placement_not_equals",
      entityId: "traveler",
      placementId: "destination",
    })).toMatchObject({ passed: true });
    expect(evaluateCausalAssertion({
      ...state,
      truth: { ...state.truth, placements: { traveler: "destination" } },
    }, {
      kind: "placement_not_equals",
      entityId: "traveler",
      placementId: "destination",
    })).toMatchObject({ passed: false });
  });
});
