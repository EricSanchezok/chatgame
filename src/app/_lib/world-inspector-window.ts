import type { WorldInspectorWindow } from "../../shared/world-inspector-api";

function sameArray(left: readonly (string | number)[] | undefined, right: readonly (string | number)[] | undefined): boolean {
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return leftValues.length === rightValues.length && leftValues.every((value, index) => value === rightValues[index]);
}

function sameStep(left: WorldInspectorWindow["steps"][number], right: WorldInspectorWindow["steps"][number]): boolean {
  return left.revision === right.revision && left.step === right.step && left.contentHash === right.contentHash &&
    left.elapsedSeconds === right.elapsedSeconds && left.primaryAction === right.primaryAction &&
    sameArray(left.actorIds, right.actorIds) && JSON.stringify(left.counts) === JSON.stringify(right.counts) &&
    JSON.stringify(left.tokenUsage) === JSON.stringify(right.tokenUsage) && sameArray(left.nodeIds, right.nodeIds);
}

function sameNode(left: WorldInspectorWindow["nodes"][number], right: WorldInspectorWindow["nodes"][number]): boolean {
  return left.id === right.id && left.revision === right.revision && left.laneId === right.laneId &&
    left.kind === right.kind && left.label === right.label && left.description === right.description &&
    left.status === right.status && left.count === right.count && left.relatedAttemptId === right.relatedAttemptId &&
    left.relatedInvocationId === right.relatedInvocationId && sameArray(left.relatedActorIds, right.relatedActorIds);
}

function sameEdge(left: WorldInspectorWindow["edges"][number], right: WorldInspectorWindow["edges"][number]): boolean {
  return left.id === right.id && left.source === right.source && left.target === right.target &&
    left.kind === right.kind && left.label === right.label;
}

function sameActor(left: WorldInspectorWindow["actors"][number], right: WorldInspectorWindow["actors"][number]): boolean {
  return left.id === right.id && left.entityId === right.entityId && left.kind === right.kind &&
    left.name === right.name && left.description === right.description && left.lifecycle === right.lifecycle &&
    JSON.stringify(left.activity) === JSON.stringify(right.activity);
}

function sameInstance(left: WorldInspectorWindow["instance"], right: WorldInspectorWindow["instance"]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function samePagination(left: WorldInspectorWindow["pagination"], right: WorldInspectorWindow["pagination"]): boolean {
  return left.limit === right.limit && left.hasOlder === right.hasOlder &&
    left.oldestRevision === right.oldestRevision && left.newestRevision === right.newestRevision;
}

function sameAlgorithmComposition(
  left: WorldInspectorWindow["algorithmComposition"],
  right: WorldInspectorWindow["algorithmComposition"],
): boolean {
  return left.nodeCount === right.nodeCount && left.root.manifestHash === right.root.manifestHash;
}

export function mergeWorldInspectorWindows(
  current: WorldInspectorWindow | undefined,
  incoming: WorldInspectorWindow,
): WorldInspectorWindow {
  if (!current || current.instance.worldHash !== incoming.instance.worldHash) return incoming;
  if (sameInstance(current.instance, incoming.instance) &&
    sameAlgorithmComposition(current.algorithmComposition, incoming.algorithmComposition) &&
    samePagination(current.pagination, incoming.pagination) &&
    current.actors.length === incoming.actors.length && current.actors.every((actor, index) => sameActor(actor, incoming.actors[index]!)) &&
    current.steps.length === incoming.steps.length && current.steps.every((step, index) => sameStep(step, incoming.steps[index]!)) &&
    current.nodes.length === incoming.nodes.length && current.nodes.every((node, index) => sameNode(node, incoming.nodes[index]!)) &&
    current.edges.length === incoming.edges.length && current.edges.every((edge, index) => sameEdge(edge, incoming.edges[index]!))) {
    return current;
  }
  const byRevision = new Map(current.steps.map((step) => [step.revision, step]));
  for (const step of incoming.steps) {
    const previous = byRevision.get(step.revision);
    byRevision.set(step.revision, previous && sameStep(previous, step) ? previous : step);
  }
  const incomingNodeIds = new Set(incoming.nodes.map((node) => node.id));
  const byNode = new Map(current.nodes
    .filter((node) => node.kind !== "attempt" || incomingNodeIds.has(node.id))
    .map((node) => [node.id, node]));
  for (const node of incoming.nodes) {
    const previous = byNode.get(node.id);
    byNode.set(node.id, previous && sameNode(previous, node) ? previous : node);
  }
  const incomingEdgeIds = new Set(incoming.edges.map((edge) => edge.id));
  const byEdge = new Map(current.edges
    .filter((edge) => (!edge.source.startsWith("attempt:") && !edge.target.startsWith("attempt:")) || incomingEdgeIds.has(edge.id))
    .map((edge) => [edge.id, edge]));
  for (const edge of incoming.edges) {
    const previous = byEdge.get(edge.id);
    byEdge.set(edge.id, previous && sameEdge(previous, edge) ? previous : edge);
  }
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
    actors: incoming.actors.length === current.actors.length && incoming.actors.every((actor, index) => {
      const previous = current.actors[index];
      return previous !== undefined && sameActor(previous, actor);
    }) ? current.actors : incoming.actors.map((actor) => {
      const previous = current.actors.find((candidate) => candidate.id === actor.id);
      return previous && sameActor(previous, actor) ? previous : actor;
    }),
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
