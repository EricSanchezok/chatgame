import { describe, expect, it } from "vitest";
import { actionDependencyComponents, normalizeActionDependency } from "../action-dependency";
import type { ActionDependency } from "../execution";
import type { AgentActionProposal, SimulationState } from "../model";

function dependency(
  actorId: string,
  reads: ActionDependency["reads"],
  writes: ActionDependency["writes"],
  audienceAgentIds: string[] = [],
  globalFallback = false,
): ActionDependency {
  return { actionId: `action-${actorId}`, actorId, reads, writes, audienceAgentIds, globalFallback };
}

describe("action dependencies", () => {
  it("keeps independent footprints separate and joins read/write or audience dependencies", () => {
    expect(actionDependencyComponents([
      dependency("a", [], [{ kind: "entity", id: "entity-a" }]),
      dependency("b", [], [{ kind: "entity", id: "entity-b" }]),
    ])).toEqual([["a"], ["b"]]);

    expect(actionDependencyComponents([
      dependency("a", [], [{ kind: "entity", id: "shared" }]),
      dependency("b", [{ kind: "entity", id: "shared" }], []),
    ])).toEqual([["a", "b"]]);

    expect(actionDependencyComponents([
      dependency("a", [], [{ kind: "entity", id: "entity-a" }], ["b"]),
      dependency("b", [], [{ kind: "entity", id: "entity-b" }]),
    ])).toEqual([["a", "b"]]);
  });

  it("puts every action in one component when any footprint requires global fallback", () => {
    expect(actionDependencyComponents([
      dependency("a", [{ kind: "global", id: "world" }], [{ kind: "global", id: "world" }], [], true),
      dependency("b", [], [{ kind: "entity", id: "entity-b" }]),
      dependency("c", [], [{ kind: "entity", id: "entity-c" }]),
    ])).toEqual([["a", "b", "c"]]);
  });

  it("turns unknown dependency hints into a conservative global footprint", () => {
    const state = {
      agents: { a: { id: "a", entityId: "entity-a" } },
      truth: {
        entities: { "entity-a": { id: "entity-a" } },
        facts: {},
        meters: {},
        quantities: {},
        ratings: {},
      },
    } as unknown as SimulationState;
    const action = { id: "action-a", actorId: "a" } as AgentActionProposal;
    const normalized = normalizeActionDependency(state, action, dependency(
      "a",
      [{ kind: "entity", id: "weather" }],
      [],
      ["unknown-group"],
    ));

    expect(normalized.dependency).toEqual({
      actionId: "action-a",
      actorId: "a",
      reads: [{ kind: "global", id: "world" }],
      writes: [{ kind: "global", id: "world" }],
      audienceAgentIds: [],
      globalFallback: true,
    });
    expect(normalized.fallbackReasons).toEqual(["unknown_audience_agent", "unknown_entity"]);
  });
});
