import type { WorldInspectorWindow } from "../../shared/world-inspector-api";

export function mergeWorldInspectorWindows(
  current: WorldInspectorWindow | undefined,
  incoming: WorldInspectorWindow,
): WorldInspectorWindow {
  if (!current || current.session.worldHash !== incoming.session.worldHash) return incoming;
  const byRevision = new Map(current.steps.map((step) => [step.revision, step]));
  for (const step of incoming.steps) byRevision.set(step.revision, step);
  const byNode = new Map(current.nodes
    .filter((node) => node.kind !== "attempt")
    .map((node) => [node.id, node]));
  for (const node of incoming.nodes) byNode.set(node.id, node);
  const byEdge = new Map(current.edges
    .filter((edge) => !edge.source.startsWith("attempt:") && !edge.target.startsWith("attempt:"))
    .map((edge) => [edge.id, edge]));
  for (const edge of incoming.edges) byEdge.set(edge.id, edge);
  const currentOldest = current.pagination.oldestRevision;
  const incomingOldest = incoming.pagination.oldestRevision;
  const oldestFromIncoming = incomingOldest !== undefined &&
    (currentOldest === undefined || incomingOldest <= currentOldest);
  const oldestRevision = currentOldest === undefined
    ? incomingOldest
    : incomingOldest === undefined
      ? currentOldest
      : Math.min(currentOldest, incomingOldest);
  const currentNewest = current.pagination.newestRevision;
  const incomingNewest = incoming.pagination.newestRevision;
  const newestRevision = currentNewest === undefined
    ? incomingNewest
    : incomingNewest === undefined
      ? currentNewest
      : Math.max(currentNewest, incomingNewest);
  const nodes = [...byNode.values()].sort((left, right) => left.revision - right.revision);
  const nodeRevisions = new Map(nodes.map((node) => [node.id, node.revision]));
  const edges = [...byEdge.values()].sort((left, right) =>
    Math.max(nodeRevisions.get(left.source) ?? 0, nodeRevisions.get(left.target) ?? 0) -
      Math.max(nodeRevisions.get(right.source) ?? 0, nodeRevisions.get(right.target) ?? 0) ||
    left.id.localeCompare(right.id));
  return {
    ...incoming,
    actors: incoming.actors,
    steps: [...byRevision.values()].sort((left, right) => left.revision - right.revision),
    nodes,
    edges,
    pagination: {
      limit: incoming.pagination.limit,
      hasOlder: oldestFromIncoming ? incoming.pagination.hasOlder : current.pagination.hasOlder,
      ...(oldestRevision !== undefined ? { oldestRevision } : {}),
      ...(newestRevision !== undefined ? { newestRevision } : {}),
    },
  };
}
