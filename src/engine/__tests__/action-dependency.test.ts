import { describe, expect, it } from "vitest";
import {
  ActivityFootprintIndex,
  affectedActivityIdsExhaustive,
  interactionDependencyComponents,
  normalizeInteractionDependency,
} from "../action-dependency";
import type { InteractionDependency } from "../execution";
import type { AgentActionProposal, SimulationState } from "../model";
import type { ActivityState } from "../temporal";

function dependency(
  actorId: string,
  reads: InteractionDependency["reads"],
  writes: InteractionDependency["writes"],
  audienceAgentIds: string[] = [],
  globalFallback = false,
): InteractionDependency {
  return { kind: "action", id: `action-${actorId}`, actorId, reads, writes, audienceAgentIds, globalFallback };
}

describe("action dependencies", () => {
  it("keeps independent footprints separate and joins read/write or audience dependencies", () => {
    expect(interactionDependencyComponents([
      dependency("a", [], [{ kind: "entity", id: "entity-a" }]),
      dependency("b", [], [{ kind: "entity", id: "entity-b" }]),
    ])).toEqual([["action-a"], ["action-b"]]);

    expect(interactionDependencyComponents([
      dependency("a", [], [{ kind: "entity", id: "shared" }]),
      dependency("b", [{ kind: "entity", id: "shared" }], []),
    ])).toEqual([["action-a", "action-b"]]);

    expect(interactionDependencyComponents([
      dependency("a", [], [{ kind: "entity", id: "entity-a" }], ["b"]),
      dependency("b", [], [{ kind: "entity", id: "entity-b" }]),
    ])).toEqual([["action-a", "action-b"]]);
  });

  it("puts every action in one component when any footprint requires global fallback", () => {
    expect(interactionDependencyComponents([
      dependency("a", [{ kind: "global", id: "world" }], [{ kind: "global", id: "world" }], [], true),
      dependency("b", [], [{ kind: "entity", id: "entity-b" }]),
      dependency("c", [], [{ kind: "entity", id: "entity-c" }]),
    ])).toEqual([["action-a", "action-b", "action-c"]]);
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
    const normalized = normalizeInteractionDependency(state, action, dependency(
      "a",
      [{ kind: "entity", id: "weather" }],
      [],
      ["unknown-group"],
    ));

    expect(normalized.dependency).toEqual({
      kind: "action",
      id: "action-a",
      actorId: "a",
      reads: [{ kind: "global", id: "world" }],
      writes: [{ kind: "global", id: "world" }],
      audienceAgentIds: [],
      globalFallback: true,
    });
    expect(normalized.fallbackReasons).toEqual(["unknown_audience_agent", "unknown_entity"]);
  });

  it("matches the exhaustive affected-Activity oracle across sparse, dense, audience, and global footprints", () => {
    let seed = 0x5eed;
    const random = (): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const agents = Array.from({ length: 8 }, (_, index) => `agent-${index}`);
    const refs = Array.from({ length: 12 }, (_, index) => ({
      kind: "entity" as const,
      id: `entity-${index}`,
    }));
    const choose = <T>(values: readonly T[]): T[] => values.filter(() => random() < 0.22);
    for (let trial = 0; trial < 100; trial += 1) {
      const activities = Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
        const actorId = agents[index % agents.length]!;
        const globalFallback = trial % 17 === 0 && index === 0;
        const global = { kind: "global" as const, id: "world" as const };
        const footprint: InteractionDependency = {
          kind: "activity",
          id: `activity-${index}`,
          actorId,
          reads: globalFallback ? [global] : choose(refs),
          writes: globalFallback ? [global] : choose(refs),
          audienceAgentIds: [...new Set([actorId, ...choose(agents)])].sort(),
          globalFallback,
        };
        return [footprint.id, {
          id: footprint.id,
          actorId,
          status: index % 11 === 0 ? "paused" : "active",
          interactionFootprint: footprint,
        } as ActivityState];
      }));
      const incoming = Array.from({ length: 6 }, (_, index): InteractionDependency => {
        const actorId = agents[(index + trial) % agents.length]!;
        const globalFallback = trial % 19 === 0 && index === 5;
        const global = { kind: "global" as const, id: "world" as const };
        return {
          kind: "action",
          id: `incoming-${trial}-${index}`,
          actorId,
          reads: globalFallback ? [global] : choose(refs),
          writes: globalFallback ? [global] : choose(refs),
          audienceAgentIds: [...new Set([actorId, ...choose(agents)])].sort(),
          globalFallback,
        };
      });
      expect(new ActivityFootprintIndex(activities).affectedBy(incoming)).toEqual(
        affectedActivityIdsExhaustive(activities, incoming),
      );
    }
  });
});
