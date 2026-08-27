import type {
  AgentResolutionEffectView,
  AgentResolutionReceiptView,
  AgentSelfStateView,
  AgentState,
  BeliefValue,
  FactValue,
  SimulationState,
  WorldFact,
} from "./model";
import type { ResolutionReceipt, ResolutionSourceRef } from "./resolution";

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

function canAccess(access: WorldFact["access"], agentId: string): boolean {
  return access.kind === "public" || (access.kind === "agents" && access.agentIds.includes(agentId));
}

function sourceIsVisible(
  state: SimulationState,
  agent: AgentState,
  receipt: ResolutionReceipt,
  source: ResolutionSourceRef,
): boolean {
  switch (source.kind) {
    case "action": return source.id === receipt.plan.actionId;
    case "entity": return source.id === agent.entityId || Boolean(localIdFor(agent, source.id));
    case "fact": {
      const fact = state.truth.facts[source.id];
      return Boolean(fact && canAccess(fact.access, agent.id));
    }
    case "condition": {
      const condition = state.truth.conditions[source.id];
      return Boolean(condition && canAccess(condition.access, agent.id));
    }
    case "rating": return state.truth.ratings[source.id]?.entityId === agent.entityId;
    case "law": return state.lawIds.includes(source.id);
    case "placement": return source.id === state.truth.placements[agent.entityId] || Boolean(localIdFor(agent, source.id));
  }
}

function projectEffects(receipt: ResolutionReceipt): AgentResolutionEffectView[] {
  return receipt.effects.map((effect) => ({
    role: effect.role,
    kind: effect.intent.kind,
    magnitude: effect.magnitude,
    channel: effect.intent.channel,
    label: effect.intent.label,
    description: effect.intent.description,
  }));
}

export function projectAgentResolutionReceipt(
  state: SimulationState,
  agent: AgentState,
  receipt: ResolutionReceipt,
): AgentResolutionReceiptView | null {
  if (receipt.plan.visibility === "hidden" ||
    (receipt.plan.actorId !== agent.entityId && !receipt.plan.targetIds.includes(agent.entityId))) return null;
  const base = {
    id: receipt.id,
    actionId: receipt.plan.actionId,
    outcome: receipt.outcome,
    effects: projectEffects(receipt),
  };
  if (receipt.plan.visibility === "result_only") return { ...base, visibility: "result_only" };
  const actorRating = receipt.plan.actorRatingId
    ? state.truth.ratings[receipt.plan.actorRatingId]
    : null;
  return {
    ...base,
    visibility: "full",
    plan: {
      goal: receipt.plan.goal,
      means: receipt.plan.means
        .filter((mean) => sourceIsVisible(state, agent, receipt, mean.source))
        .map((mean) => mean.description),
      mode: receipt.plan.mode,
      difficulty: receipt.plan.difficulty?.kind === "environment"
        ? { kind: "environment", band: receipt.plan.difficulty.band }
        : receipt.plan.difficulty ? { kind: "opposed" } : null,
      actorRating: actorRating?.entityId === agent.entityId
        ? { name: state.truth.mechanics.ratings[actorRating.definitionId].name, value: actorRating.value }
        : null,
      factors: receipt.plan.factors
        .filter((factor) => sourceIsVisible(state, agent, receipt, factor.source))
        .map((factor) => ({
          role: factor.role,
          direction: factor.direction,
          steps: factor.steps,
          explanation: factor.explanation,
        })),
      risk: receipt.plan.risk,
      baseEffect: receipt.plan.baseEffect,
    },
    check: {
      dc: receipt.dc,
      modifier: receipt.modifier,
      mode: receipt.checkMode,
      dice: [...receipt.dice],
      kept: receipt.kept,
      total: receipt.total,
      margin: receipt.margin,
    },
  };
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
    conditions: Object.values(state.truth.conditions)
      .filter((condition) => condition.subjectId === agent.entityId)
      .filter((condition) => condition.access.kind === "public" ||
        (condition.access.kind === "agents" && condition.access.agentIds.includes(agent.id)))
      .map((condition) => ({
        id: condition.id,
        label: condition.label,
        description: condition.description,
        magnitude: condition.magnitude,
        durationProfileId: condition.durationProfileId,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    resolutionReceipts: state.history
      .flatMap((step) => step.resolutionReceipts)
      .map((receipt) => projectAgentResolutionReceipt(state, agent, receipt))
      .filter((receipt): receipt is AgentResolutionReceiptView => receipt !== null),
    facts,
  };
}
