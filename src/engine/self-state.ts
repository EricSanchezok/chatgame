import type { AgentSelfStateView, AgentState, BeliefValue, FactValue, SimulationState } from "./model";

function localIdFor(agent: AgentState, canonicalId: string): string | undefined {
  return Object.values(agent.bindings)
    .filter((binding) => binding.canonicalEntityIds.includes(canonicalId))
    .map((binding) => binding.localEntityId)
    .sort((left, right) => left.localeCompare(right))[0];
}

function beliefValueFor(agent: AgentState, value: FactValue): BeliefValue | undefined {
  if (value.kind !== "entity") return structuredClone(value);
  const localEntityId = localIdFor(agent, value.entityId);
  return localEntityId ? { kind: "local_entity", localEntityId } : undefined;
}

export function projectAgentSelfState(state: SimulationState, agent: AgentState): AgentSelfStateView {
  const entity = state.truth.entities[agent.entityId];
  if (!entity) throw new Error(`agent ${agent.id} has no entity`);
  const selfBindings = Object.values(agent.bindings)
    .filter((binding) => binding.canonicalEntityIds.includes(agent.entityId));
  if (selfBindings.length !== 1) throw new Error(`agent ${agent.id} must have exactly one self binding`);

  const placementId = state.truth.placements[agent.entityId];
  const placement = placementId ? state.truth.entities[placementId] : undefined;
  const facts = Object.values(state.truth.facts)
    .filter((fact) => fact.subjectId === agent.entityId)
    .filter((fact) => fact.access.kind === "public" ||
      (fact.access.kind === "agents" && fact.access.agentIds.includes(agent.id)))
    .flatMap((fact) => {
      const value = beliefValueFor(agent, fact.value);
      return value ? [{ predicate: fact.predicate, value, description: fact.description }] : [];
    })
    .sort((left, right) => left.predicate.localeCompare(right.predicate));

  return {
    selfLocalEntityId: selfBindings[0].localEntityId,
    lifecycle: entity.lifecycle,
    elapsedSeconds: state.truth.elapsedSeconds,
    location: placement ? {
      localEntityId: localIdFor(agent, placement.id),
      name: placement.name,
      description: placement.description,
    } : undefined,
    meters: Object.values(state.truth.meters)
      .filter((meter) => meter.entityId === agent.entityId)
      .map((meter) => {
        const definition = state.truth.mechanics.meters[meter.definitionId];
        return {
          name: definition.name,
          current: meter.current,
          min: definition.min,
          max: definition.max,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
    quantities: Object.values(state.truth.quantities)
      .filter((quantity) => quantity.holderId === agent.entityId)
      .map((quantity) => {
        const definition = state.truth.mechanics.quantities[quantity.definitionId];
        return {
          name: definition.name,
          unit: definition.unit,
          amount: quantity.amount,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
    ratings: Object.values(state.truth.ratings)
      .filter((rating) => rating.entityId === agent.entityId)
      .map((rating) => {
        const definition = state.truth.mechanics.ratings[rating.definitionId];
        return {
          name: definition.name,
          value: rating.value,
          min: definition.min,
          max: definition.max,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
    facts,
  };
}
