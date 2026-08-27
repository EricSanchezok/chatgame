import type {
  AgentPerspectiveView,
  BeliefValue,
  PerspectiveFactValue,
} from "../../shared/world-api";

export type RelationKind = "exact" | "believed" | "suspected" | "disbelieved";
export type RelationSource = "location" | "containment" | "fact" | "claim" | "attitude" | "goal" | "commitment";
export type ViewNodeKind = "self" | "entity" | "authorized" | "unidentified" | "value";

export interface PerspectiveViewNode {
  id: string;
  kind: ViewNodeKind;
  name: string;
  description: string;
  status: string;
  targetable: boolean;
}

export interface PerspectiveViewRelation {
  id: string;
  source: string;
  target: string;
  label: string;
  description: string;
  kind: RelationKind;
  origin: RelationSource;
  evidenceIds: string[];
}

function localRef(localEntityId: string): string {
  return `local:${localEntityId}`;
}

function factValueLabel(value: PerspectiveFactValue): string {
  switch (value.kind) {
    case "text": return value.value;
    case "number": return String(value.value);
    case "boolean": return value.value ? "是" : "否";
    case "none": return "无";
    case "entity": return value.entityRef;
  }
}

function beliefValueLabel(value: BeliefValue): string {
  switch (value.kind) {
    case "text": return value.value;
    case "number": return String(value.value);
    case "boolean": return value.value ? "是" : "否";
    case "none": return "无";
    case "local_entity": return value.localEntityId;
  }
}

export function buildAgentPerspectiveGraph(perspective: AgentPerspectiveView): {
  nodes: PerspectiveViewNode[];
  relations: PerspectiveViewRelation[];
  selfRef: string;
} {
  const selfRef = localRef(perspective.self.localEntityId);
  const nodeMap = new Map<string, PerspectiveViewNode>();
  for (const entity of perspective.knowledge.entities) {
    nodeMap.set(entity.ref, {
      id: entity.ref,
      kind: entity.ref === selfRef
        ? "self"
        : entity.status === "authorized" || entity.status === "unidentified"
          ? entity.status
          : "entity",
      name: entity.name,
      description: entity.description,
      status: entity.ref === selfRef ? "observed" : entity.status,
      targetable: entity.targetable,
    });
  }
  nodeMap.set(selfRef, {
    id: selfRef,
    kind: "self",
    name: perspective.self.name,
    description: perspective.self.description,
    status: "observed",
    targetable: true,
  });

  const relations: PerspectiveViewRelation[] = [];
  const locationRef = perspective.self.location?.localEntityId
    ? localRef(perspective.self.location.localEntityId)
    : undefined;
  if (locationRef && nodeMap.has(locationRef)) {
    relations.push({
      id: "location:self",
      source: selfRef,
      target: locationRef,
      label: "位于",
      description: `你当前位于${perspective.self.location?.name ?? "这个地点"}。`,
      kind: "exact",
      origin: "location",
      evidenceIds: [],
    });
  }
  relations.push(...perspective.knowledge.containment.map((relation, index): PerspectiveViewRelation => ({
    id: `containment:${index}`,
    source: relation.containerRef,
    target: relation.entityRef,
    label: relation.viaUnknownContainer ? "随身范围" : relation.depth === 1 ? "随身" : "包含",
    description: relation.viaUnknownContainer
      ? "这个存在处于你的随身范围内，但中间容器尚未识别。"
      : relation.depth === 1 ? "这个存在当前直接由你携带。" : "这个存在位于你携带的容器中。",
    kind: "exact",
    origin: "containment",
    evidenceIds: [],
  })));

  perspective.knowledge.exactFacts.forEach((fact, index) => {
    let target: string;
    if (fact.value.kind === "entity") {
      target = fact.value.entityRef;
    } else {
      target = `fact-value:${index}`;
      nodeMap.set(target, {
        id: target,
        kind: "value",
        name: factValueLabel(fact.value),
        description: fact.description,
        status: "authorized",
        targetable: false,
      });
    }
    relations.push({
      id: `fact:${index}`,
      source: fact.subjectRef,
      target,
      label: fact.predicate,
      description: fact.description,
      kind: "exact",
      origin: "fact",
      evidenceIds: [],
    });
  });

  perspective.knowledge.claims.forEach((claim, index) => {
    let target: string;
    if (claim.value.kind === "local_entity") {
      target = localRef(claim.value.localEntityId);
    } else {
      target = `claim-value:${index}`;
      nodeMap.set(target, {
        id: target,
        kind: "value",
        name: beliefValueLabel(claim.value),
        description: claim.description,
        status: "hypothesized",
        targetable: false,
      });
    }
    if (!nodeMap.has(localRef(claim.subjectId)) || !nodeMap.has(target)) return;
    relations.push({
      id: `claim:${claim.id}`,
      source: localRef(claim.subjectId),
      target,
      label: claim.predicate,
      description: claim.description,
      kind: claim.stance,
      origin: "claim",
      evidenceIds: claim.evidenceIds,
    });
  });

  const addCharacterRelation = (
    id: string,
    targets: readonly string[],
    label: string,
    description: string,
    origin: RelationSource,
    evidenceIds: string[],
  ) => {
    const validTargets = targets.filter((targetId) => nodeMap.has(localRef(targetId)));
    if (validTargets.length === 0) {
      const target = `${origin}-value:${id}`;
      nodeMap.set(target, {
        id: target,
        kind: "value",
        name: description,
        description,
        status: "hypothesized",
        targetable: false,
      });
      relations.push({
        id: `${origin}:${id}:untargeted`,
        source: selfRef,
        target,
        label,
        description,
        kind: "believed",
        origin,
        evidenceIds,
      });
      return;
    }
    for (const targetId of validTargets) {
      const target = localRef(targetId);
      relations.push({
        id: `${origin}:${id}:${targetId}`,
        source: selfRef,
        target,
        label,
        description,
        kind: "believed",
        origin,
        evidenceIds,
      });
    }
  };
  for (const attitude of Object.values(perspective.character.attitudes)) {
    if (attitude.status === "active") addCharacterRelation(
      attitude.id, [attitude.subjectId], "态度", attitude.description, "attitude", attitude.evidenceIds,
    );
  }
  for (const goal of Object.values(perspective.character.goals)) {
    if (goal.status === "active" || goal.status === "suspended") addCharacterRelation(
      goal.id, goal.targetIds, "目标", goal.description, "goal", goal.evidenceIds,
    );
  }
  for (const commitment of Object.values(perspective.character.commitments)) {
    if (commitment.status === "active") addCharacterRelation(
      commitment.id,
      commitment.subjectIds,
      "承诺",
      commitment.description,
      "commitment",
      commitment.evidenceIds,
    );
  }

  return {
    nodes: [...nodeMap.values()].sort((left, right) =>
      Number(right.id === selfRef) - Number(left.id === selfRef) || left.id.localeCompare(right.id)),
    relations: relations.sort((left, right) =>
      left.source.localeCompare(right.source) || left.target.localeCompare(right.target) || left.id.localeCompare(right.id)),
    selfRef,
  };
}
