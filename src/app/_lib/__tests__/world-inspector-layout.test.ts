import { describe, expect, it } from "vitest";
import type {
  WorldInspectorEdgeSummary,
  WorldInspectorNodeSummary,
} from "../../../shared/world-inspector-api";
import { worldInspectorFallbackPositions } from "../world-inspector-layout";

describe("world inspector fallback layout", () => {
  it("lays out a 100 Agent × 24 revision window deterministically without overlap", () => {
    const nodes: WorldInspectorNodeSummary[] = [];
    const edges: WorldInspectorEdgeSummary[] = [];
    for (let actor = 0; actor < 100; actor += 1) {
      for (let revision = 1; revision <= 24; revision += 1) {
        const id = `actor-${actor}:revision-${revision}`;
        nodes.push({
          id,
          revision,
          laneId: `actor-${actor}`,
          kind: "mind",
          label: `Agent ${actor}`,
          description: `Revision ${revision}`,
        });
        if (revision > 1) {
          edges.push({
            id: `temporal:${actor}:${revision}`,
            source: `actor-${actor}:revision-${revision - 1}`,
            target: id,
            kind: "temporal",
          });
        }
      }
    }

    const positions = worldInspectorFallbackPositions(nodes, edges);
    expect(Object.keys(positions)).toHaveLength(2_400);
    expect(new Set(Object.values(positions).map(({ x, y }) => `${x}:${y}`)).size).toBe(2_400);
    expect(positions).toEqual(worldInspectorFallbackPositions(nodes, edges));
    expect(positions["actor-99:revision-24"].x).toBe(23 * 334);
  });
});
