import type {
  AgentPerspectiveTurn,
  AgentPerspectiveView,
  AgentState,
  EntityId,
  FactValue,
  LocalEntityId,
  PerspectiveEntity,
  PerspectiveFactValue,
  SimulationState,
  WorldFact,
} from "./model";

function localRef(localEntityId: LocalEntityId): string {
  return `local:${localEntityId}`;
}

function factIsAccessible(fact: WorldFact, agentId: string): boolean {
  return fact.access.kind === "public" ||
    fact.access.kind === "agents" && fact.access.agentIds.includes(agentId);
}

function stableValue(value: PerspectiveFactValue): string {
  switch (value.kind) {
    case "entity": return `entity:${value.entityRef}`;
    case "none": return "none";
    default: return `${value.kind}:${String(value.value)}`;
  }
}

function projectHistory(state: Readonly<SimulationState>, agentId: string): AgentPerspectiveTurn[] {
  return state.history.map((entry) => {
    const action = entry.actions.find((candidate) => candidate.actorId === agentId) ?? null;
    const outcome = action
      ? entry.outcomes.find((candidate) => candidate.proposalId === action.id) ?? null
      : null;
    return {
      revision: entry.revision,
      step: entry.step,
      ownAction: action?.rawText ?? null,
      perceivedOutcome: outcome?.status ?? null,
      observations: entry.observations
        .filter((observation) => observation.observerId === agentId)
        .map((observation) => ({
          kind: observation.kind,
          summary: observation.summary,
          introductions: observation.introductions.map(({ localEntity }) => structuredClone(localEntity)),
          apparentClaims: observation.apparentClaims.map((claim) => structuredClone(claim)),
        })),
    };
  });
}

export function projectAgentPerspective(
  state: Readonly<SimulationState>,
  agent: Readonly<AgentState>,
): AgentPerspectiveView {
  const selfEntity = state.truth.entities[agent.entityId];
  if (!selfEntity) throw new Error(`agent ${agent.id} has no entity`);
  const selfBindings = Object.values(agent.bindings)
    .filter((binding) => binding.canonicalEntityIds.includes(agent.entityId));
  if (selfBindings.length !== 1) throw new Error(`agent ${agent.id} must have exactly one self binding`);
  const selfLocalEntityId = selfBindings[0].localEntityId;
  const selfRef = localRef(selfLocalEntityId);

  const canonicalCandidates = new Map<EntityId, LocalEntityId[]>();
  for (const binding of Object.values(agent.bindings)) {
    if (binding.canonicalEntityIds.length !== 1 || !agent.belief.localEntities[binding.localEntityId]) continue;
    const [canonicalId] = binding.canonicalEntityIds;
    const candidates = canonicalCandidates.get(canonicalId) ?? [];
    candidates.push(binding.localEntityId);
    canonicalCandidates.set(canonicalId, candidates);
  }
  canonicalCandidates.set(agent.entityId, [selfLocalEntityId]);

  const uniqueLocalId = (canonicalId: EntityId): LocalEntityId | undefined => {
    const candidates = canonicalCandidates.get(canonicalId) ?? [];
    return candidates.length === 1 ? candidates[0] : undefined;
  };

  const entities = new Map<string, PerspectiveEntity>();
  for (const entity of Object.values(agent.belief.localEntities)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    entities.set(localRef(entity.id), {
      ref: localRef(entity.id),
      localEntityId: entity.id,
      name: entity.id === selfLocalEntityId ? selfEntity.name : entity.name,
      description: entity.id === selfLocalEntityId ? selfEntity.description : entity.description,
      status: entity.status,
      targetable: true,
    });
  }
  entities.set(selfRef, {
    ref: selfRef,
    localEntityId: selfLocalEntityId,
    name: selfEntity.name,
    description: selfEntity.description,
    status: agent.belief.localEntities[selfLocalEntityId]?.status ?? "observed",
    targetable: true,
  });

  const contained = (canonicalId: EntityId): { depth: number; directContainerId: EntityId } | null => {
    let current = canonicalId;
    let depth = 0;
    let directContainerId: EntityId | null = null;
    const seen = new Set<EntityId>([canonicalId]);
    while (true) {
      const parent = state.truth.placements[current];
      if (!parent || seen.has(parent)) return null;
      depth += 1;
      if (depth === 1) directContainerId = parent;
      if (parent === agent.entityId) return { depth, directContainerId: directContainerId! };
      seen.add(parent);
      current = parent;
    }
  };

  const containment: AgentPerspectiveView["knowledge"]["containment"] = [];
  const focusedCanonicalIds = new Set<EntityId>([agent.entityId]);
  let anonymousOrdinal = 0;
  for (const entity of Object.values(state.truth.entities)
    .filter((candidate) => candidate.id !== agent.entityId && candidate.lifecycle === "active")
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const relation = contained(entity.id);
    if (!relation) continue;
    const knownLocalId = uniqueLocalId(entity.id);
    let entityRef: string;
    if (knownLocalId) {
      entityRef = localRef(knownLocalId);
      focusedCanonicalIds.add(entity.id);
    } else {
      entityRef = `view:unidentified:${anonymousOrdinal++}`;
      entities.set(entityRef, {
        ref: entityRef,
        name: "未识别的随身存在",
        description: "你能确认有某种存在处于自己的随身范围内，但无法把它与已知对象可靠对应。",
        status: "unidentified",
        targetable: false,
      });
    }
    const containerLocalId = relation.directContainerId === agent.entityId
      ? selfLocalEntityId
      : uniqueLocalId(relation.directContainerId);
    containment.push({
      entityRef,
      containerRef: containerLocalId ? localRef(containerLocalId) : selfRef,
      depth: relation.depth,
      viaUnknownContainer: relation.directContainerId !== agent.entityId && !containerLocalId,
    });
  }

  const accessibleFacts = Object.values(state.truth.facts)
    .filter((fact) => factIsAccessible(fact, agent.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const rootFacts = accessibleFacts.filter((fact) =>
    fact.subjectId === agent.entityId || fact.value.kind === "entity" && fact.value.entityId === agent.entityId);
  for (const fact of rootFacts) {
    focusedCanonicalIds.add(fact.subjectId);
    if (fact.value.kind === "entity") focusedCanonicalIds.add(fact.value.entityId);
  }

  const authorizedRefs = new Map<EntityId, string>();
  let authorizedOrdinal = 0;
  const refForCanonical = (canonicalId: EntityId): string | undefined => {
    if (canonicalId === agent.entityId) return selfRef;
    const knownLocalId = uniqueLocalId(canonicalId);
    if (knownLocalId) return localRef(knownLocalId);
    const existing = authorizedRefs.get(canonicalId);
    if (existing) return existing;
    const canonical = state.truth.entities[canonicalId];
    if (!canonical) return undefined;
    const ref = `view:authorized:${authorizedOrdinal++}`;
    authorizedRefs.set(canonicalId, ref);
    entities.set(ref, {
      ref,
      name: canonical.name,
      description: canonical.description,
      status: "authorized",
      targetable: false,
    });
    return ref;
  };

  const candidateFacts = accessibleFacts.filter((fact) => focusedCanonicalIds.has(fact.subjectId));
  const exactFacts = candidateFacts.flatMap((fact) => {
    const subjectRef = refForCanonical(fact.subjectId);
    if (!subjectRef) return [];
    let value: PerspectiveFactValue;
    if (fact.value.kind === "entity") {
      const entityRef = refForCanonical(fact.value.entityId);
      if (!entityRef) return [];
      value = { kind: "entity", entityRef };
    } else {
      value = structuredClone(fact.value as Exclude<FactValue, { kind: "entity" }>);
    }
    return [{ subjectRef, predicate: fact.predicate, value, description: fact.description }];
  }).sort((left, right) =>
    left.subjectRef.localeCompare(right.subjectRef) ||
    left.predicate.localeCompare(right.predicate) ||
    stableValue(left.value).localeCompare(stableValue(right.value)) ||
    left.description.localeCompare(right.description));

  const placementId = state.truth.placements[agent.entityId];
  const placement = placementId ? state.truth.entities[placementId] : undefined;
  const placementLocalId = placementId ? uniqueLocalId(placementId) : undefined;

  return {
    agentId: agent.id,
    revision: state.revision,
    step: state.step,
    elapsedSeconds: state.truth.elapsedSeconds,
    self: {
      localEntityId: selfLocalEntityId,
      name: selfEntity.name,
      description: selfEntity.description,
      lifecycle: selfEntity.lifecycle,
      location: placement ? {
        ...(placementLocalId ? { localEntityId: placementLocalId } : {}),
        name: placement.name,
        description: placement.description,
      } : null,
    },
    mechanics: {
      meters: Object.values(state.truth.meters)
        .filter((meter) => meter.entityId === agent.entityId)
        .map((meter) => {
          const definition = state.truth.mechanics.meters[meter.definitionId];
          return { name: definition.name, current: meter.current, min: definition.min, max: definition.max };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
      quantities: Object.values(state.truth.quantities)
        .filter((quantity) => quantity.holderId === agent.entityId)
        .map((quantity) => {
          const definition = state.truth.mechanics.quantities[quantity.definitionId];
          return { name: definition.name, unit: definition.unit, amount: quantity.amount };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
      ratings: Object.values(state.truth.ratings)
        .filter((rating) => rating.entityId === agent.entityId)
        .map((rating) => {
          const definition = state.truth.mechanics.ratings[rating.definitionId];
          return { name: definition.name, value: rating.value, min: definition.min, max: definition.max };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    },
    knowledge: {
      entities: [...entities.values()].sort((left, right) => left.ref.localeCompare(right.ref)),
      containment: containment.sort((left, right) =>
        left.entityRef.localeCompare(right.entityRef) || left.containerRef.localeCompare(right.containerRef)),
      exactFacts,
      claims: Object.values(agent.belief.claims)
        .map((claim) => structuredClone(claim))
        .sort((left, right) =>
          left.subjectId.localeCompare(right.subjectId) ||
          left.predicate.localeCompare(right.predicate) ||
          left.id.localeCompare(right.id)),
      evidence: Object.values(agent.belief.evidence)
        .map((evidence) => structuredClone(evidence))
        .sort((left, right) => left.step - right.step || left.id.localeCompare(right.id)),
    },
    character: structuredClone(agent.character),
    history: projectHistory(state, agent.id),
  };
}
