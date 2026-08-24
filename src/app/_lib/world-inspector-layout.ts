import type {
  WorldInspectorEdgeSummary,
  WorldInspectorNodeSummary,
} from "../../shared/world-inspector-api";

export interface WorldInspectorNodePosition {
  x: number;
  y: number;
}

/**
 * Produces a stable, non-overlapping first frame while ELK lays out the same graph
 * in a worker. It is intentionally linear in nodes + edges so large debug windows
 * never block on an empty canvas.
 */
export function worldInspectorFallbackPositions(
  nodes: readonly WorldInspectorNodeSummary[],
  edges: readonly WorldInspectorEdgeSummary[],
): Record<string, WorldInspectorNodePosition> {
  const ids = new Set(nodes.map((node) => node.id));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    outgoing.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const depth = new Map(nodes.map((node) => [node.id, 0]));
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    for (const target of outgoing.get(source) ?? []) {
      depth.set(target, Math.max(depth.get(target) ?? 0, (depth.get(source) ?? 0) + 1));
      const nextIndegree = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, nextIndegree);
      if (nextIndegree === 0) queue.push(target);
    }
  }
  const columns = new Map<number, WorldInspectorNodeSummary[]>();
  for (const node of nodes) {
    const column = depth.get(node.id) ?? 0;
    const entries = columns.get(column) ?? [];
    entries.push(node);
    columns.set(column, entries);
  }
  const positions: Record<string, WorldInspectorNodePosition> = {};
  for (const [column, entries] of columns) {
    entries.sort((left, right) => left.laneId.localeCompare(right.laneId) ||
      (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0));
    entries.forEach((node, row) => {
      positions[node.id] = { x: column * 334, y: row * 122 };
    });
  }
  return positions;
}
